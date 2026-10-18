// Subtitled cinema screenings: shared helpers.
//
// Plain JS with top-level declarations only: Ansible concatenates these files
// into n8n Code nodes, and the tests load them the same way (test/load.js).
//
// A screening, as every reader returns it (times are Europe/London wall-clock):
//   { cinemaKey, sourceId, title, start: 'YYYY-MM-DDTHH:MM', screen,
//     bookingUrl, kind: 'captioned'|'subtitled'|'by-language', year,
//     runtimeMin, synopsis, image, chainFilmId }
// Unknown values are null.

const BFI_URL =
  'https://whatson.bfi.org.uk/imax/Online/default.asp?BOparam::WScontent::loadArticle::permalink=screenings-subtitles&BOparam::WScontent::loadArticle::context_id=';
const FLARESOLVERR_URL = 'http://flaresolverr:8191/v1';
const FREE_HOURS_DEFAULT = { weekdayBefore: '09:00', weekdayFrom: '17:00' };
const EVERYMAN_DAYS_AHEAD = 60;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHOWTIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

class ReaderError extends Error {
  constructor(cinemaKey, message) {
    super(`${cinemaKey}: ${message}`);
    this.name = 'ReaderError';
    this.cinemaKey = cinemaKey;
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function utcDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(iso, n) {
  const d = utcDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

function weekday(iso) {
  return utcDate(iso).getUTCDay();
}

function fitsFreeHours(start, hours = FREE_HOURS_DEFAULT) {
  const day = weekday(start);
  if (day === 0 || day === 6) return true;
  const time = start.slice(11, 16);
  return time < hours.weekdayBefore || time >= hours.weekdayFrom;
}

function normaliseTitle(raw) {
  const title = String(raw)
    .replace(/^.*?\bPresents:\s*/i, '')
    .replace(/\s+-\s+Preview\s*$/i, '')
    .replace(/\s*\((?:Re-release|Preview)\)\s*$/i, '')
    .replace(/\s*\+\s*Q\s*&\s*A\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, key: title.toLowerCase().replace(/[^a-z0-9]/g, '') };
}

function filmKey(screening) {
  return `${normaliseTitle(screening.title).key}|${screening.year ?? ''}`;
}

function digestWindow(today) {
  return { from: today, to: addDays(today, 13) };
}

function groupByFilm(screenings) {
  const groups = new Map();
  for (const s of [...screenings].sort((a, b) => a.start.localeCompare(b.start))) {
    const key = filmKey(s);
    if (!groups.has(key)) groups.set(key, { filmKey: key, title: normaliseTitle(s.title).title, screenings: [] });
    groups.get(key).screenings.push(s);
  }
  return [...groups.values()];
}

function formatDay(start) {
  const d = utcDate(start);
  return `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
}

function formatTime(start) {
  return start.slice(11, 16);
}

function formatRange(fromIso, toIso) {
  const f = (iso) => {
    const d = utcDate(iso);
    return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
  };
  return `${f(fromIso)} – ${f(toIso)}`;
}

function cinemaRequest(cinema, today) {
  switch (cinema.chain) {
    case 'picturehouse':
      return {
        method: 'POST',
        url: 'https://www.picturehouses.com/api/scheduled-movies-ajax',
        contentType: 'application/x-www-form-urlencoded',
        body: `cinema_id=${encodeURIComponent(cinema.chain_id)}`,
      };
    case 'everyman': {
      const theaters = encodeURIComponent(JSON.stringify({ id: cinema.chain_id, timeZone: 'Europe/London' }));
      const from = encodeURIComponent(`${today}T00:00:00`);
      const to = encodeURIComponent(`${addDays(today, EVERYMAN_DAYS_AHEAD)}T23:59:59`);
      return {
        method: 'GET',
        url: `https://www.everymancinema.com/api/gatsby-source-boxofficeapi/schedule?theaters=${theaters}&from=${from}&to=${to}`,
        contentType: null,
        body: null,
      };
    }
    case 'bfi':
      return {
        method: 'POST',
        url: FLARESOLVERR_URL,
        contentType: 'application/json',
        body: JSON.stringify({ cmd: 'request.get', url: BFI_URL, maxTimeout: 180000 }),
      };
    default:
      throw new ReaderError(cinema.key, `unknown chain ${cinema.chain}`);
  }
}

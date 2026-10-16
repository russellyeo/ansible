// Ally Pally farmers' market helpers.
//
// Shared by the n8n Code nodes (the n8n role pastes this file into them
// verbatim) and the node:test suite in ./test. Keep it dependency-free plain
// JS: Code nodes cannot require modules.

const CCFM_URL = 'https://www.weareccfm.com/our-markets/alexandra-palace/';

const LOCATIONS = {
  park: {
    heading: 'ALEXANDRA PALACE PARK LOCATION',
    name: 'Alexandra Palace Park',
    address: 'Muswell Hill (bottom) entrance, N10 3TG',
  },
  campsbourne: {
    heading: 'CAMPSBOURNE SCHOOL LOCATION',
    name: 'Campsbourne School',
    address: 'Nightingale Lane, N8 7AF',
  },
};

// More vanished dates than this in one sync looks like a page or parser
// problem rather than real cancellations, so nothing gets deleted.
const MAX_REMOVALS = 2;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "6TH SEPT 2026", "1st Nov. 2026", "8 NOVEMBER 2026"
const DATE_RE = /\b(\d{1,2})(?:ST|ND|RD|TH)?\s+([A-Z]+)\.?,?\s+(\d{4})\b/gi;

class ScheduleError extends Error {}

function toIso(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIso(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(iso, days) {
  const date = parseIso(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(iso) {
  return parseIso(iso).getUTCDay();
}

function formatDay(iso) {
  const date = parseIso(iso);
  return `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, "'")
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// Returns [{date, location}] sorted by date, or throws ScheduleError listing
// every problem. All-or-nothing: a partial result would make the sync
// delete the events of whichever location failed to parse.
function parseSchedule(html, today) {
  const text = htmlToText(html).toUpperCase();
  const errors = [];

  const headings = Object.entries(LOCATIONS).map(([key, loc]) => ({ key, at: text.indexOf(loc.heading) }));
  for (const h of headings) {
    if (h.at < 0) errors.push(`heading not found: ${LOCATIONS[h.key].heading}`);
  }
  const found = headings.filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);

  const thisYear = Number(today.slice(0, 4));
  const seen = new Map();
  const markets = [];

  found.forEach((h, i) => {
    const section = text.slice(h.at, i + 1 < found.length ? found[i + 1].at : undefined);
    for (const [raw, dayText, monthText, yearText] of section.matchAll(DATE_RE)) {
      const month = MONTHS.indexOf(monthText.slice(0, 3)) + 1;
      if (month === 0) {
        errors.push(`unknown month in "${raw}"`);
        continue;
      }
      const year = Number(yearText);
      const day = Number(dayText);
      const iso = toIso(year, month, day);
      if (parseIso(iso).getUTCDate() !== day) {
        errors.push(`invalid date "${raw}"`);
        continue;
      }
      if (year < thisYear - 1 || year > thisYear + 2) {
        errors.push(`implausible year in "${raw}"`);
        continue;
      }
      if (dayOfWeek(iso) !== 0) {
        errors.push(`not a Sunday: "${raw}" (${iso})`);
        continue;
      }
      const previous = seen.get(iso);
      if (previous && previous !== h.key) {
        errors.push(`${iso} listed at both locations`);
        continue;
      }
      if (!previous) {
        seen.set(iso, h.key);
        markets.push({ date: iso, location: h.key });
      }
    }
  });

  if (!errors.length && !markets.length) errors.push('no dates found');
  if (errors.length) {
    const from = found.length ? found[0].at : 0;
    throw new ScheduleError(
      `Could not parse ${CCFM_URL}:\n- ${errors.join('\n- ')}\n\nPage text:\n${text.slice(from, from + 3000)}`,
    );
  }
  return markets.sort((a, b) => a.date.localeCompare(b.date));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CCFM_URL,
    LOCATIONS,
    MAX_REMOVALS,
    ScheduleError,
    addDays,
    dayOfWeek,
    formatDay,
    htmlToText,
    parseSchedule,
  };
}

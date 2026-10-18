// BFI IMAX: the subtitles page, fetched through FlareSolverr (Cloudflare).
// The page embeds its listings as JS arrays, `searchNames : [...]` and
// `searchResults : [[...], ...]`, which are JSON once trailing commas go.

const BFI_BOOKING_BASE = 'https://whatson.bfi.org.uk/imax/Online/';
const BFI_START_RE = /^[A-Za-z]+ (\d{1,2}) ([A-Za-z]+) (\d{4}) (\d{2}):(\d{2})$/;
const LONG_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// The array literal that follows `name : `, by bracket matching that skips
// over quoted strings.
function bfiArray(html, name) {
  const at = html.indexOf(`${name} : [`);
  if (at < 0) return null;
  const start = html.indexOf('[', at);
  let depth = 0;
  let quoted = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (c === '\\') i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1).replace(/,\s*\]/g, ']'));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function bfiStart(value) {
  const m = BFI_START_RE.exec(String(value).trim());
  const month = m ? LONG_MONTHS.indexOf(m[2].toLowerCase()) : -1;
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4]}:${m[5]}`;
}

function readBfi(text, cinema) {
  let res;
  try {
    res = JSON.parse(text);
  } catch {
    throw new ReaderError(cinema.key, `FlareSolverr response is not JSON: ${String(text).slice(0, 80)}`);
  }
  if (!res || res.status !== 'ok' || !res.solution) {
    throw new ReaderError(cinema.key, `FlareSolverr failed: ${(res && res.message) || 'no solution'}`);
  }
  const html = String(res.solution.response || '');
  if (html.includes('<title>Just a moment...</title>')) {
    throw new ReaderError(cinema.key, 'still on the Cloudflare challenge page');
  }
  const names = bfiArray(html, 'searchNames');
  const rows = bfiArray(html, 'searchResults');
  if (!Array.isArray(names) || !Array.isArray(rows) || !names.includes('id') || !names.includes('start_date')) {
    throw new ReaderError(cinema.key, 'listing data (searchNames/searchResults) not found on the page');
  }

  return rows.map((row) => {
    const r = Object.fromEntries(names.map((n, i) => [n, row[i]]));
    const start = bfiStart(r.start_date);
    if (!start) throw new ReaderError(cinema.key, `unreadable start ${JSON.stringify(r.start_date)} for ${r.description}`);
    return {
      cinemaKey: cinema.key,
      sourceId: r.id,
      title: decodeEntities(r.description).replace(/\u00a0/g, ' ').trim(),
      start,
      screen: null,
      bookingUrl: r.additional_info ? BFI_BOOKING_BASE + r.additional_info : null,
      kind: cinema.kind || 'captioned',
      year: null,
      runtimeMin: null,
      synopsis: null,
      image: null,
      chainFilmId: null,
    };
  });
}

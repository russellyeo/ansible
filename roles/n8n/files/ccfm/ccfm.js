// Ally Pally farmers' market helpers.
//
// Shared by the n8n Code nodes (the n8n role pastes this file into them
// verbatim) and the node:test suite in ./test. Keep it dependency-free plain
// JS: Code nodes cannot require modules.

const CCFM_URL = 'https://www.weareccfm.com/our-markets/alexandra-palace/';
const NAME = "Ally Pally Farmers' Market";

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

// Date-like text DATE_RE did not consume: "29TH NOV", "15/11/2026", the "1ST"
// of "1ST & 8TH NOV 2026". Silently skipping it would drop a market.
const LOOSE_DATE_RE = /\b\d{1,2}(?:ST|ND|RD|TH)\b|\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/i;

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
  const lines = text.split('\n');
  const errors = [];

  // A heading counts only as a line of its own, so the phrase inside a
  // sentence elsewhere cannot split the page at the wrong place.
  const headings = [];
  for (const [key, loc] of Object.entries(LOCATIONS)) {
    const at = lines.flatMap((line, i) => (line === loc.heading ? [i] : []));
    if (!at.length) errors.push(`heading not found: ${loc.heading}`);
    else if (at.length > 1) errors.push(`heading appears ${at.length} times: ${loc.heading}`);
    else headings.push({ key, at: at[0] });
  }
  const found = headings.sort((a, b) => a.at - b.at);

  const thisYear = Number(today.slice(0, 4));
  const seen = new Map();
  const markets = [];

  found.forEach((h, i) => {
    const section = lines.slice(h.at + 1, i + 1 < found.length ? found[i + 1].at : undefined);
    const matches = [];
    for (const line of section) {
      matches.push(...line.matchAll(DATE_RE));
      if (LOOSE_DATE_RE.test(line.replace(DATE_RE, ' '))) errors.push(`unparsed date text: "${line}"`);
    }
    if (!matches.length) errors.push(`no dates under ${LOCATIONS[h.key].heading}`);
    for (const [raw, dayText, monthText, yearText] of matches) {
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

  if (errors.length) {
    const from = found.length ? found[0].at : 0;
    throw new ScheduleError(
      `Could not parse ${CCFM_URL}:\n- ${errors.join('\n- ')}\n\nPage text:\n${lines.slice(from).join('\n').slice(0, 3000)}`,
    );
  }
  return markets.sort((a, b) => a.date.localeCompare(b.date));
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function locName(key) {
  return (LOCATIONS[key] || { name: key }).name;
}

// A share link when one is configured, else a search for the address.
function mapLink(key) {
  const loc = LOCATIONS[key];
  return loc.mapUrl || mapsUrl(`${loc.name}, ${loc.address}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Which market a calendar event represents, or null for events the sync
// did not create.
function eventMarket(event) {
  const props = (event.extendedProperties && event.extendedProperties.private) || {};
  return props.ccfmDate ? { date: props.ccfmDate, location: props.ccfmLocation } : null;
}

function eventBody({ date, location }) {
  const loc = LOCATIONS[location];
  return {
    summary: `${NAME} – ${loc.name}`,
    location: `${loc.name}, ${loc.address}`,
    description: [
      `${NAME}, 10:00–15:00 at ${loc.name}.`,
      `Map: ${mapLink(location)}`,
      `Schedule: ${CCFM_URL}`,
      '',
      'Managed by the n8n ccfm-sync workflow; manual edits are overwritten.',
    ].join('\n'),
    start: { dateTime: `${date}T10:00:00`, timeZone: 'Europe/London' },
    end: { dateTime: `${date}T15:00:00`, timeZone: 'Europe/London' },
    extendedProperties: { private: { ccfmDate: date, ccfmLocation: location } },
  };
}

// Diff the parsed schedule against the calendar. Only events the sync
// created (see eventMarket) dated today or later are ever touched.
function planSync({ markets, events, today, maxRemovals = MAX_REMOVALS }) {
  const wanted = new Map(markets.filter((m) => m.date >= today).map((m) => [m.date, m]));
  const update = [];
  const moved = [];
  const removed = [];
  const duplicates = [];
  const seen = new Set();

  for (const event of events) {
    const current = eventMarket(event);
    if (!current || current.date < today) continue;
    if (seen.has(current.date)) {
      duplicates.push({ eventId: event.id, ...current });
      continue;
    }
    seen.add(current.date);
    const market = wanted.get(current.date);
    if (!market) {
      removed.push({ eventId: event.id, ...current });
    } else if (market.location !== current.location) {
      update.push({ eventId: event.id, market });
      moved.push({ date: market.date, from: current.location, to: market.location });
    } else if (isStale(event, market)) {
      // Same place, older wording (a rename, a new map link): refresh quietly.
      update.push({ eventId: event.id, market });
    }
  }

  const create = [...wanted.values()].filter((m) => !seen.has(m.date));
  const capTripped = removed.length > maxRemovals;
  return {
    create,
    update,
    moved,
    remove: capTripped ? duplicates : [...removed, ...duplicates],
    removed,
    capTripped,
  };
}

function isStale(event, market) {
  const body = eventBody(market);
  return event.summary !== body.summary || event.location !== body.location || event.description !== body.description;
}

function calendarOps(plan) {
  return [
    ...plan.create.map((m) => ({ method: 'POST', path: '/events', body: eventBody(m) })),
    ...plan.update.map((u) => ({
      method: 'PUT',
      path: `/events/${encodeURIComponent(u.eventId)}`,
      body: eventBody(u.market),
    })),
    ...plan.remove.map((r) => ({ method: 'DELETE', path: `/events/${encodeURIComponent(r.eventId)}`, body: null })),
  ];
}

// Email only for surprises: a known date moved or vanished. New dates are
// added silently.
function buildChangeEmail(plan) {
  const lines = [];
  for (const m of plan.moved) {
    lines.push(`${formatDay(m.date)}: moved from ${locName(m.from)} to ${locName(m.to)}.`);
  }
  for (const r of plan.removed) {
    const outcome = plan.capTripped ? 'event NOT deleted' : 'event deleted';
    lines.push(`${formatDay(r.date)} (${locName(r.location)}): no longer listed, ${outcome}.`);
  }
  if (!lines.length) return null;

  const footer = plan.capTripped
    ? `More than ${MAX_REMOVALS} dates vanished in one run, which looks like a page or parser problem, so nothing was deleted. Check ${CCFM_URL}`
    : `Schedule: ${CCFM_URL}`;
  return {
    subject: `${NAME}: ${plan.capTripped ? 'schedule check needed' : 'schedule changed'}`,
    text: [...lines, '', footer].join('\n'),
    html: [
      `<p>The ${escapeHtml(NAME)} schedule changed:</p>`,
      `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`,
      `<p>${escapeHtml(footer)}</p>`,
    ].join('\n'),
  };
}

// The coming Sunday, or today if today is Sunday.
function nextSunday(today) {
  return addDays(today, (7 - dayOfWeek(today)) % 7);
}

function buildReminder({ sunday, events }) {
  const locationOn = (date) => {
    const market = events.map(eventMarket).find((m) => m && m.date === date);
    return market ? market.location : null;
  };
  const thisWeek = locationOn(sunday);
  const lastWeek = locationOn(addDays(sunday, -7));
  const when = formatDay(sunday);

  if (!thisWeek) {
    const text = `No market is listed at either location for ${when}.`;
    return {
      subject: `${NAME}: nothing listed for ${when}`,
      text: `${text}\nCheck ${CCFM_URL}`,
      html: `<p>${escapeHtml(text)}</p>\n<p><a href="${escapeHtml(CCFM_URL)}">Check the schedule</a></p>`,
      photo: null,
    };
  }

  const name = locName(thisWeek);
  const address = LOCATIONS[thisWeek].address;
  const map = mapLink(thisWeek);
  const moved = lastWeek !== null && lastWeek !== thisWeek;
  const lines = [`${when}, 10:00–15:00`, name, address, `Map: ${map}`];
  if (moved) lines.push('', `Note: last week it was at ${locName(lastWeek)}.`);
  lines.push('', `Schedule: ${CCFM_URL}`);

  const items = [
    ['Where', escapeHtml(name)],
    ['When', escapeHtml(`${when}, 10:00–15:00`)],
    ['Address', escapeHtml(address)],
    ['Map', `<a href="${escapeHtml(map)}">Open in Google Maps</a>`],
  ];
  if (moved) items.push(['📍 Moved', escapeHtml(`last week it was at ${locName(lastWeek)}`)]);
  const html = [
    `<h2>${escapeHtml(NAME)}</h2>`,
    `<img src="cid:${thisWeek}" alt="${escapeHtml(name)}" width="480" style="max-width:100%;height:auto;border-radius:8px">`,
    `<ul>${items.map(([label, value]) => `<li><b>${label}:</b> ${value}</li>`).join('')}</ul>`,
    `<p><a href="${escapeHtml(CCFM_URL)}">Full schedule</a></p>`,
  ].join('\n');

  return {
    subject: `${moved ? '📍 Moved! ' : ''}${NAME}: ${when} at ${name}`,
    text: lines.join('\n'),
    html,
    photo: thisWeek,
  };
}

// RFC 2822 message for the Gmail API's users.messages.send `raw` field:
// text and HTML alternatives, with images attached inline for cid: links.
function buildMime({ to, subject, text, html, images = [] }) {
  const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');
  const wrap = (data) => data.match(/.{1,76}/g).join('\r\n');
  const rel = 'ccfm-related';
  const alt = 'ccfm-alternative';
  const part = (type, data) =>
    [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap(b64(data))];
  const lines = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${rel}"`,
    '',
    `--${rel}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    ...part('text/plain', text),
    `--${alt}`,
    ...part('text/html', html),
    `--${alt}--`,
  ];
  for (const image of images) {
    const ext = image.contentType.split('/')[1].replace('jpeg', 'jpg');
    lines.push(
      `--${rel}`,
      `Content-Type: ${image.contentType}`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${image.cid}>`,
      `Content-Disposition: inline; filename="${image.cid}.${ext}"`,
      '',
      wrap(image.base64),
    );
  }
  lines.push(`--${rel}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CCFM_URL,
    LOCATIONS,
    MAX_REMOVALS,
    ScheduleError,
    addDays,
    buildChangeEmail,
    buildMime,
    buildReminder,
    calendarOps,
    dayOfWeek,
    eventBody,
    eventMarket,
    formatDay,
    htmlToText,
    locName,
    mapsUrl,
    nextSunday,
    parseSchedule,
    planSync,
  };
}

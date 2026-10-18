// Calendar sync: one event per captioned screening that fits free hours.
// Synced events carry private extended properties (cinemaManaged, cinemaKey,
// cinemaSourceId); anything else in the calendar is left alone.

const MAX_REMOVALS_PER_CINEMA = 3;
const DEFAULT_RUNTIME_MIN = 120;

// Wall-clock arithmetic on 'YYYY-MM-DDTHH:MM' (no time zone involved).
function addMinutes(start, minutes) {
  const [date, time] = start.split('T');
  const [h, m] = time.split(':').map(Number);
  const d = utcDate(date);
  d.setUTCMinutes(h * 60 + m + minutes);
  return d.toISOString().slice(0, 16);
}

// Google Calendar shows a little HTML in descriptions: links, <b>, <i>, <br>.
function eventDescription(screening, film, cinema) {
  const link = (url, text) => `<a href="${escapeHtml(url)}">${text}</a>`;
  const links = [
    screening.bookingUrl && link(screening.bookingUrl, '<b>🎟 Book tickets</b>'),
    film.trailerUrl && link(film.trailerUrl, '▶ Trailer'),
    cinema.map_url && link(cinema.map_url, '📍 Map'),
  ].filter(Boolean);
  return [
    links.join(' · '),
    film.synopsis && escapeHtml(film.synopsis),
    '<i>Managed by the n8n cinema-sync workflow; manual edits are overwritten.</i>',
  ]
    .filter(Boolean)
    .join('<br><br>');
}

function eventBody(screening, film, cinema) {
  const end = addMinutes(screening.start, film.runtimeMin || screening.runtimeMin || DEFAULT_RUNTIME_MIN);
  return {
    summary: `🎬 ${film.title} – ${cinema.name}`,
    location: `${cinema.name}, ${cinema.address}`,
    description: eventDescription(screening, film, cinema),
    start: { dateTime: `${screening.start}:00`, timeZone: 'Europe/London' },
    end: { dateTime: `${end}:00`, timeZone: 'Europe/London' },
    extendedProperties: {
      private: { cinemaManaged: 'true', cinemaKey: screening.cinemaKey, cinemaSourceId: String(screening.sourceId) },
    },
  };
}

function screeningId(cinemaKey, sourceId) {
  return `${cinemaKey}|${sourceId}`;
}

// Google lists times with the calendar's offset (2026-10-22T20:15:00+01:00);
// the calendar is in Europe/London, so the first 16 characters are local.
function localStart(event) {
  return ((event.start && event.start.dateTime) || '').slice(0, 16);
}

function isStale(event, body) {
  return (
    event.summary !== body.summary ||
    event.location !== body.location ||
    event.description !== body.description ||
    localStart(event) !== body.start.dateTime.slice(0, 16) ||
    ((event.end && event.end.dateTime) || '').slice(0, 16) !== body.end.dateTime.slice(0, 16)
  );
}

// wanted: [{screening, film, cinema}]; readCinemaKeys: cinemas whose listing
// had any screenings at all (any kind, any time).
function planSync({ wanted, events, okCinemaKeys, readCinemaKeys = [], now }) {
  // Extra copies of a screening (from a retried insert) are always deleted,
  // past ones included; the first copy is the one kept.
  const ours = new Map();
  const seenIds = new Set();
  const duplicates = [];
  for (const e of events) {
    const p = (e.extendedProperties && e.extendedProperties.private) || {};
    if (p.cinemaManaged !== 'true') continue;
    const id = screeningId(p.cinemaKey, p.cinemaSourceId);
    if (seenIds.has(id)) {
      duplicates.push({ eventId: e.id, cinemaKey: p.cinemaKey });
      continue;
    }
    seenIds.add(id);
    if (localStart(e) >= now) ours.set(id, { event: e, cinemaKey: p.cinemaKey });
  }

  const create = [];
  const update = [];
  const seen = new Set();
  for (const w of wanted) {
    if (w.screening.start < now) continue;
    const id = screeningId(w.screening.cinemaKey, w.screening.sourceId);
    seen.add(id);
    const existing = ours.get(id);
    if (!existing) create.push(w);
    else if (isStale(existing.event, eventBody(w.screening, w.film, w.cinema))) update.push({ eventId: existing.event.id, wanted: w });
  }

  const vanished = new Map();
  for (const [id, { event, cinemaKey }] of ours) {
    if (seen.has(id) || !okCinemaKeys.includes(cinemaKey)) continue;
    if (!vanished.has(cinemaKey)) vanished.set(cinemaKey, []);
    vanished.get(cinemaKey).push({ eventId: event.id, cinemaKey, summary: event.summary, start: localStart(event) });
  }
  // Hold back a cinema's removals when too many go at once, or when every
  // one of its events would go and its listing came back empty: a reader
  // that quietly finds nothing would otherwise empty it unnoticed. A cinema
  // whose listing still has other screenings loses its last event normally.
  const ourCount = new Map();
  for (const { cinemaKey } of ours.values()) ourCount.set(cinemaKey, (ourCount.get(cinemaKey) || 0) + 1);
  const remove = [];
  const capped = [];
  const held = [];
  for (const [cinemaKey, list] of vanished) {
    const emptied = list.length === ourCount.get(cinemaKey) && !readCinemaKeys.includes(cinemaKey);
    if (list.length > MAX_REMOVALS_PER_CINEMA || emptied) {
      capped.push(cinemaKey);
      held.push(...list.map(({ summary, start }) => ({ cinemaKey, summary, start })));
    } else remove.push(...list.map(({ eventId }) => ({ eventId, cinemaKey })));
  }
  return { create, update, remove, duplicates, capped, held };
}

function calendarOps(plan) {
  const body = (w) => eventBody(w.screening, w.film, w.cinema);
  return [
    ...plan.create.map((w) => ({ method: 'POST', path: '/events', body: body(w) })),
    ...plan.update.map((u) => ({ method: 'PUT', path: `/events/${encodeURIComponent(u.eventId)}`, body: body(u.wanted) })),
    ...[...plan.remove, ...(plan.duplicates || [])].map((r) => ({ method: 'DELETE', path: `/events/${encodeURIComponent(r.eventId)}`, body: null })),
  ];
}

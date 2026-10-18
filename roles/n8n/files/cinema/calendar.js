// Calendar sync: one event per captioned screening that fits free hours.
// Synced events carry private extended properties (cinemaManaged, cinemaKey,
// cinemaSourceId); anything else in the calendar is left alone.

const MAX_REMOVALS_PER_CINEMA = 3;
const DEFAULT_RUNTIME_MIN = 120;
const SYNOPSIS_CHARS = 200;

// Wall-clock arithmetic on 'YYYY-MM-DDTHH:MM' (no time zone involved).
function addMinutes(start, minutes) {
  const [date, time] = start.split('T');
  const [h, m] = time.split(':').map(Number);
  const d = utcDate(date);
  d.setUTCMinutes(h * 60 + m + minutes);
  return d.toISOString().slice(0, 16);
}

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function ratingsLine(film) {
  const parts = [];
  if (film.imdbRating) parts.push(`IMDb ${film.imdbRating}`);
  if (film.rottenTomatoes) parts.push(`Rotten Tomatoes ${film.rottenTomatoes}`);
  return parts.join(' · ');
}

function eventBody(screening, film, cinema) {
  const lines = [
    screening.bookingUrl && `Book: ${screening.bookingUrl}`,
    ratingsLine(film),
    film.trailerUrl && `Trailer: ${film.trailerUrl}`,
    truncate(film.synopsis, SYNOPSIS_CHARS),
    cinema.map_url && `Map: ${cinema.map_url}`,
  ].filter(Boolean);
  const end = addMinutes(screening.start, film.runtimeMin || screening.runtimeMin || DEFAULT_RUNTIME_MIN);
  return {
    summary: `🎬 ${film.title} – ${cinema.name}`,
    location: `${cinema.name}, ${cinema.address}`,
    description: [...lines, '', 'Managed by the n8n cinema-sync workflow; manual edits are overwritten.'].join('\n'),
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

// wanted: [{screening, film, cinema}]
function planSync({ wanted, events, okCinemaKeys, now }) {
  const ours = new Map();
  for (const e of events) {
    const p = (e.extendedProperties && e.extendedProperties.private) || {};
    if (p.cinemaManaged !== 'true' || localStart(e) < now) continue;
    ours.set(screeningId(p.cinemaKey, p.cinemaSourceId), { event: e, cinemaKey: p.cinemaKey });
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
    vanished.get(cinemaKey).push({ eventId: event.id, cinemaKey });
  }
  // Hold back a cinema's removals when too many go at once, or when every
  // one of its events would go: at a few captioned screenings per cinema, a
  // reader that quietly finds nothing would otherwise empty it unnoticed.
  const ourCount = new Map();
  for (const { cinemaKey } of ours.values()) ourCount.set(cinemaKey, (ourCount.get(cinemaKey) || 0) + 1);
  const remove = [];
  const capped = [];
  for (const [cinemaKey, list] of vanished) {
    if (list.length > MAX_REMOVALS_PER_CINEMA || list.length === ourCount.get(cinemaKey)) capped.push(cinemaKey);
    else remove.push(...list);
  }
  return { create, update, remove, capped };
}

function calendarOps(plan) {
  const body = (w) => eventBody(w.screening, w.film, w.cinema);
  return [
    ...plan.create.map((w) => ({ method: 'POST', path: '/events', body: body(w) })),
    ...plan.update.map((u) => ({ method: 'PUT', path: `/events/${encodeURIComponent(u.eventId)}`, body: body(u.wanted) })),
    ...plan.remove.map((r) => ({ method: 'DELETE', path: `/events/${encodeURIComponent(r.eventId)}`, body: null })),
  ];
}

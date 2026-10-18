const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const { eventBody, planSync, calendarOps, MAX_REMOVALS_PER_CINEMA } = load(
  ['core.js', 'films.js', 'calendar.js'],
  ['eventBody', 'planSync', 'calendarOps', 'MAX_REMOVALS_PER_CINEMA'],
);

const CINEMAS = {
  'ph-crouch-end': { key: 'ph-crouch-end', name: 'Picturehouse Crouch End', address: '165 Tottenham Lane, London N8 9BT', map_url: 'https://maps.example/ce' },
  'everyman-muswell-hill': { key: 'everyman-muswell-hill', name: 'Everyman Muswell Hill', address: 'Fortis Green Road, London N10 3HP', map_url: 'https://maps.example/mh' },
};
const NOW = '2026-10-18T07:00';

const screening = (cinemaKey, sourceId, start, title = 'Verity') => ({
  cinemaKey, sourceId, title, start, screen: null, bookingUrl: `https://book.example/${sourceId}`,
  kind: 'captioned', year: null, runtimeMin: 114, synopsis: null, image: null, chainFilmId: null,
});
const FILM = {
  tmdbId: 1, imdbId: 'tt1', title: 'Verity', year: 2026, synopsis: 'A ghostwriter finds chilling notes.', runtimeMin: 114,
  image: null, trailerUrl: 'https://www.youtube.com/watch?v=k', originalLanguage: 'en', imdbRating: '6.8', rottenTomatoes: '71%',
};
const want = (s, film = FILM) => ({ screening: s, film, cinema: CINEMAS[s.cinemaKey] });
// A synced event as Google lists it: local time with the calendar's offset.
const ev = (id, s, film = FILM) => {
  const body = eventBody(s, film, CINEMAS[s.cinemaKey]);
  return { id, ...body, start: { dateTime: `${body.start.dateTime}+01:00` }, end: { dateTime: `${body.end.dateTime}+01:00` } };
};

test('event body', () => {
  const body = eventBody(screening('everyman-muswell-hill', 'em1', '2026-10-25T23:30'), FILM, CINEMAS['everyman-muswell-hill']);
  assert.equal(body.summary, '🎬 Verity – Everyman Muswell Hill');
  assert.equal(body.location, 'Everyman Muswell Hill, Fortis Green Road, London N10 3HP');
  assert.deepEqual(body.start, { dateTime: '2026-10-25T23:30:00', timeZone: 'Europe/London' });
  assert.deepEqual(body.end, { dateTime: '2026-10-26T01:24:00', timeZone: 'Europe/London' });
  assert.deepEqual(body.extendedProperties.private, { cinemaManaged: 'true', cinemaKey: 'everyman-muswell-hill', cinemaSourceId: 'em1' });
  assert.match(body.description, /^Book: https:\/\/book\.example\/em1$/m);
  assert.match(body.description, /^IMDb 6\.8 · Rotten Tomatoes 71%$/m);
  assert.match(body.description, /^Trailer: https:\/\/www\.youtube\.com\/watch\?v=k$/m);
  assert.match(body.description, /^Map: https:\/\/maps\.example\/mh$/m);
  assert.match(body.description, /Managed by the n8n cinema-sync workflow; manual edits are overwritten\.$/);
});

test('event body without film info uses a two-hour slot and skips empty lines', () => {
  const s = { ...screening('ph-crouch-end', 'p1', '2026-10-22T20:00'), runtimeMin: null };
  const body = eventBody(s, { ...FILM, runtimeMin: null, imdbRating: null, rottenTomatoes: null, trailerUrl: null, synopsis: null }, CINEMAS['ph-crouch-end']);
  assert.equal(body.end.dateTime, '2026-10-22T22:00:00');
  assert.doesNotMatch(body.description, /IMDb|Rotten|Trailer|null|undefined/);
});

test('creates, updates and keeps', () => {
  const keep = screening('ph-crouch-end', 'p1', '2026-10-22T20:00');
  const moved = screening('ph-crouch-end', 'p2', '2026-10-23T20:00');
  const fresh = screening('ph-crouch-end', 'p3', '2026-10-24T20:00');
  const events = [ev('e1', keep), ev('e2', { ...moved, start: '2026-10-23T18:00' })];
  const plan = planSync({ wanted: [want(keep), want(moved), want(fresh)], events, okCinemaKeys: ['ph-crouch-end'], now: NOW });
  assert.deepEqual(plan.create.map((w) => w.screening.sourceId), ['p3']);
  assert.deepEqual(plan.update.map((u) => [u.eventId, u.wanted.screening.sourceId]), [['e2', 'p2']]);
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.capped, []);
});

test('removes vanished screenings', () => {
  const gone = screening('ph-crouch-end', 'p9', '2026-10-22T20:00');
  const still = screening('ph-crouch-end', 'p8', '2026-10-23T20:00');
  const plan = planSync({ wanted: [want(still)], events: [ev('e9', gone), ev('e8', still)], okCinemaKeys: ['ph-crouch-end'], now: NOW });
  assert.deepEqual(plan.remove.map((r) => r.eventId), ['e9']);
  assert.deepEqual(plan.capped, []);
});

test('a cinema that suddenly has nothing wanted keeps its events', () => {
  // e.g. a renamed captioned flag: the read succeeds but finds nothing.
  const gone = screening('ph-crouch-end', 'p9', '2026-10-22T20:00');
  const plan = planSync({ wanted: [], events: [ev('e9', gone)], okCinemaKeys: ['ph-crouch-end'], now: NOW });
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.capped, ['ph-crouch-end']);
});

test('ignores past events and events it did not create', () => {
  const past = screening('ph-crouch-end', 'p0', '2026-10-17T20:00');
  const foreign = { id: 'x1', summary: 'Dentist', start: { dateTime: '2026-10-22T10:00:00+01:00' }, end: { dateTime: '2026-10-22T11:00:00+01:00' } };
  const plan = planSync({ wanted: [], events: [ev('e0', past), foreign], okCinemaKeys: ['ph-crouch-end'], now: NOW });
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.update, []);
});

test('keeps events of failed cinemas', () => {
  const s = screening('everyman-muswell-hill', 'em1', '2026-10-22T20:15');
  const plan = planSync({ wanted: [], events: [ev('e1', s)], okCinemaKeys: ['ph-crouch-end'], now: NOW });
  assert.deepEqual(plan.remove, []);
});

test('caps removals per cinema', () => {
  assert.equal(MAX_REMOVALS_PER_CINEMA, 3);
  const ph = [1, 2, 3, 4].map((n) => ev(`p${n}`, screening('ph-crouch-end', `p${n}`, `2026-10-2${n}T20:00`)));
  const em = [1, 2].map((n) => ev(`m${n}`, screening('everyman-muswell-hill', `m${n}`, `2026-10-2${n}T20:15`)));
  const emKept = screening('everyman-muswell-hill', 'm9', '2026-10-29T20:15');
  const plan = planSync({ wanted: [want(emKept)], events: [...ph, ...em, ev('m9', emKept)], okCinemaKeys: ['ph-crouch-end', 'everyman-muswell-hill'], now: NOW });
  assert.deepEqual(plan.capped, ['ph-crouch-end']);
  assert.deepEqual(plan.remove.map((r) => r.eventId).sort(), ['m1', 'm2']);
});

test('deletes duplicate copies of a screening, past ones too, whatever the cap', () => {
  const s1 = screening('ph-crouch-end', 'p1', '2026-10-22T20:00');
  const past = screening('ph-crouch-end', 'p0', '2026-10-18T06:00');
  const copies = [1, 2, 3, 4, 5].map((n) => ev(`d${n}`, s1));
  const plan = planSync({ wanted: [want(s1)], events: [...copies, ev('o1', past), ev('o2', past)], okCinemaKeys: [], now: NOW });
  assert.deepEqual(plan.create, []);
  assert.deepEqual(plan.update, []);
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.duplicates.map((r) => r.eventId), ['d2', 'd3', 'd4', 'd5', 'o2']);
  assert.deepEqual(plan.capped, []);
  const ops = calendarOps(plan);
  assert.deepEqual(ops.map((o) => [o.method, o.path]), ['d2', 'd3', 'd4', 'd5', 'o2'].map((id) => ['DELETE', `/events/${id}`]));
});

test('calendar ops', () => {
  const s = screening('ph-crouch-end', 'p3', '2026-10-24T20:00');
  const ops = calendarOps({ create: [want(s)], update: [{ eventId: 'e/2', wanted: want(s) }], remove: [{ eventId: 'e3' }], duplicates: [], capped: [] });
  assert.deepEqual(ops.map((o) => [o.method, o.path]), [['POST', '/events'], ['PUT', '/events/e%2F2'], ['DELETE', '/events/e3']]);
  assert.equal(ops[0].body.summary, '🎬 Verity – Picturehouse Crouch End');
  assert.equal(ops[2].body, null);
});

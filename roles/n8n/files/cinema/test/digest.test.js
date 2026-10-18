const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fixture } = require('./load.js');

const { buildDigest, staleNotes, statusUpdates, buildAlert, escapeHtml, readEverymanSchedule, attachEverymanMovies } = load(
  ['core.js', 'readers/everyman.js', 'films.js', 'calendar.js', 'digest.js'],
  ['buildDigest', 'staleNotes', 'statusUpdates', 'buildAlert', 'escapeHtml', 'readEverymanSchedule', 'attachEverymanMovies'],
);

const CINEMAS = [
  { key: 'ph-crouch-end', name: 'Picturehouse Crouch End' },
  { key: 'ph-finsbury-park', name: 'Picturehouse Finsbury Park' },
  { key: 'everyman-muswell-hill', name: 'Everyman Muswell Hill', chain_id: 'X06SN' },
];
const TODAY = '2026-10-23';
const s = (cinemaKey, title, start, kind = 'captioned', extra = {}) => ({
  cinemaKey, sourceId: `${cinemaKey}-${start}`, title, start, screen: null, bookingUrl: `https://book.example/${encodeURIComponent(start)}`,
  kind, year: null, runtimeMin: null, synopsis: null, image: null, chainFilmId: null, ...extra,
});
const film = (title, extra = {}) => ({
  tmdbId: 1, imdbId: 'tt1', title, year: 2026, synopsis: `${title} synopsis.`, runtimeMin: 114, image: `https://img.example/${title}.jpg`,
  trailerUrl: `https://www.youtube.com/watch?v=${title}`, originalLanguage: 'en', imdbRating: '6.8', rottenTomatoes: '71%', ...extra,
});
const digest = (screenings, films = {}, extra = {}) => buildDigest({ today: TODAY, screenings, films, cinemas: CINEMAS, errors: [], notes: [], ...extra });

test('subject and window', () => {
  const d = digest([s('ph-crouch-end', 'Verity', '2026-11-05T20:00'), s('ph-crouch-end', 'Hope', '2026-11-06T20:00')]);
  assert.equal(d.subject, '🎬 Subtitled Cinema Screenings: 23 Oct – 5 Nov');
  assert.match(d.html, /Verity/);
  assert.doesNotMatch(d.html, /Hope/);
});

test('drops work-hours screenings', () => {
  const list = attachEverymanMovies(
    readEverymanSchedule(fixture('everyman-schedule-X06SN-2026-10-18.json'), CINEMAS[2]),
    fixture('everyman-movies-2026-10-18.json'),
  );
  const d = buildDigest({ today: '2026-10-18', screenings: list, films: {}, cinemas: CINEMAS, errors: [], notes: [] });
  assert.match(d.html, /Verity/);
  assert.doesNotMatch(d.html, /Tenzing/); // weekday mornings only
  assert.doesNotMatch(d.html, /10:45/);
});

test('captioned films have image, trailer link, ratings and booking links', () => {
  const d = digest([s('everyman-muswell-hill', 'Verity', '2026-10-25T20:15')], { 'verity|': film('Verity') });
  assert.match(d.html, /<img src="https:\/\/img\.example\/Verity\.jpg"/);
  assert.match(d.html, /<a href="https:\/\/www\.youtube\.com\/watch\?v=Verity"[^>]*>Verity<\/a>/);
  assert.match(d.html, /IMDb 6\.8 · RT 71% · 1h 54m/);
  assert.match(d.html, /Everyman Muswell Hill/);
  assert.match(d.html, /Sun 25 Oct/);
  assert.match(d.html, /<a href="https:\/\/book\.example\/2026-10-25T20%3A15"[^>]*>20:15<\/a>/);
});

test('uses the configured free hours', () => {
  const screenings = [s('ph-crouch-end', 'Early Evening', '2026-10-26T16:30')]; // Mon
  assert.doesNotMatch(digest(screenings).html, /Early Evening/);
  assert.match(digest(screenings, {}, { hours: { weekdayBefore: '09:00', weekdayFrom: '16:00' } }).html, /Early Evening/);
});

test('orders films by first screening', () => {
  const d = digest([s('ph-crouch-end', 'Later', '2026-10-30T20:00'), s('ph-crouch-end', 'Sooner', '2026-10-24T20:00')]);
  assert.ok(d.html.indexOf('Sooner') < d.html.indexOf('Later'));
});

test('foreign-language section is compact and has no images', () => {
  const d = digest(
    [s('ph-crouch-end', 'Verity', '2026-10-24T20:00'), s('ph-crouch-end', 'Fatherland', '2026-10-24T18:10', 'subtitled'), s('ph-finsbury-park', 'Fatherland - Preview', '2026-10-25T15:00', 'subtitled')],
    { 'verity|': film('Verity'), 'fatherland|': film('Fatherland', { originalLanguage: 'de' }) },
  );
  const section = d.html.slice(d.html.indexOf('Foreign-language, English subtitles'));
  assert.ok(section.length < d.html.length);
  assert.doesNotMatch(section, /<img/);
  assert.equal((section.match(/<li/g) || []).length, 1);
  assert.match(section, /Picturehouse Crouch End: Sat 24 Oct · Picturehouse Finsbury Park: Sun 25 Oct/);
});

test('renders films without info', () => {
  const d = digest([s('ph-crouch-end', 'Mystery', '2026-10-24T20:00'), s('ph-crouch-end', 'Other', '2026-10-24T18:00', 'subtitled')]);
  assert.match(d.html, /Mystery/);
  assert.doesNotMatch(d.html, /undefined|null|NaN/);
  assert.doesNotMatch(d.text, /undefined|null|NaN/);
});

test('escapes titles', () => {
  const d = digest([s('ph-crouch-end', "Pan's Labyrinth & Co", '2026-10-24T20:00')]);
  assert.match(d.html, /Pan&#39;s Labyrinth &amp; Co/);
  assert.equal(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
});

test('empty week message', () => {
  const d = digest([s('ph-crouch-end', 'Fatherland', '2026-10-24T18:10', 'subtitled')]);
  assert.match(d.html, /No captioned screenings in the next two weeks\./);
  assert.match(d.html, /Fatherland/);
});

test('error and stale notes at top', () => {
  const d = digest([s('ph-crouch-end', 'Verity', '2026-10-24T20:00')], {}, {
    errors: [{ cinemaKey: 'ph-finsbury-park', message: 'ph-finsbury-park: response is not JSON' }],
    notes: ['No captioned screenings from Everyman Muswell Hill for 4 weeks; its reader may need checking.'],
  });
  const note = d.html.indexOf("Couldn&#39;t read Picturehouse Finsbury Park");
  assert.ok(note >= 0);
  assert.ok(d.html.indexOf('for 4 weeks') >= 0);
  assert.ok(note < d.html.indexOf('Verity'));
  assert.match(d.text, /Couldn't read Picturehouse Finsbury Park/);
});

test('stale notes after 28 days', () => {
  const rows = [
    { cinema_key: 'ph-crouch-end', last_captioned: '2026-09-25' },
    { cinema_key: 'everyman-muswell-hill', last_captioned: '2026-09-26' },
  ];
  assert.deepEqual(staleNotes({ statusRows: rows, today: TODAY, cinemas: CINEMAS }), [
    'No captioned screenings from Picturehouse Crouch End for 4 weeks; its reader may need checking.',
  ]);
});

test('status updates', () => {
  const rows = [
    { cinema_key: 'ph-crouch-end', last_captioned: '2026-09-01' },
    { cinema_key: 'ph-finsbury-park', last_captioned: '2026-09-01' },
    { cinema_key: 'everyman-muswell-hill', last_captioned: '2026-09-01' },
  ];
  const screenings = [s('ph-crouch-end', 'Verity', '2026-10-24T20:00'), s('everyman-muswell-hill', 'Verity', '2026-10-24T20:00')];
  // Finsbury Park read fine but had nothing captioned; Everyman failed.
  const updates = statusUpdates({ screenings, okCinemaKeys: ['ph-crouch-end', 'ph-finsbury-park'], statusRows: rows, today: TODAY });
  assert.deepEqual(updates, [{ cinema_key: 'ph-crouch-end', last_captioned: TODAY }]);
  const fresh = statusUpdates({ screenings: [], okCinemaKeys: ['ph-crouch-end'], statusRows: [], today: TODAY });
  assert.deepEqual(fresh, [{ cinema_key: 'ph-crouch-end', last_captioned: TODAY }]);
});

test('alert lists errors and capped cinemas', () => {
  const a = buildAlert({
    errors: [{ cinemaKey: 'bfi-imax', message: 'bfi-imax: FlareSolverr failed: Timeout' }],
    capped: ['ph-crouch-end'],
    cinemas: [...CINEMAS, { key: 'bfi-imax', name: 'BFI IMAX' }],
    executionUrl: 'https://n8n.example/workflow/w/executions/9',
  });
  assert.equal(a.subject, 'Cinema sync: 2 problem(s)');
  assert.match(a.text, /BFI IMAX: bfi-imax: FlareSolverr failed: Timeout/);
  assert.match(a.text, /Over 3 screenings vanished from Picturehouse Crouch End; nothing deleted\./);
  assert.match(a.html, /href="https:\/\/n8n\.example\/workflow\/w\/executions\/9"/);
});

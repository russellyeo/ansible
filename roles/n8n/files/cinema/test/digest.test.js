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

test('captioned films have image, IMDb link, meta line with trailer, and booking links', () => {
  const d = digest([s('everyman-muswell-hill', 'Verity', '2026-10-25T20:15')], { 'verity|': film('Verity') });
  assert.match(d.html, /<img src="https:\/\/img\.example\/Verity\.jpg"/);
  assert.doesNotMatch(d.html, /<a [^>]*>\s*<img/); // the image is not a link
  assert.match(d.html, /<a href="https:\/\/www\.imdb\.com\/title\/tt1\/"[^>]*>Verity<\/a>/);
  const meta = d.html.slice(d.html.indexOf('>IMDb<'), d.html.indexOf('Verity synopsis.'));
  assert.match(meta, /71%/);
  assert.match(meta, /1h 54m/);
  assert.match(meta, /<a href="https:\/\/www\.youtube\.com\/watch\?v=Verity"[^>]*><span style="[^"]*background:#ff0000;color:#fff[^"]*">&#9654;&#xFE0E;<\/span> Watch trailer<\/a>/);
  assert.match(d.html, /Everyman Muswell Hill/);
  assert.match(d.html, /Sun 25 Oct/);
  assert.match(d.html, /<a href="https:\/\/book\.example\/2026-10-25T20%3A15"[^>]*>20:15<\/a>/);
});

test('meta line: IMDb badge, fresh or rotten tomato, bold numbers', () => {
  const html = (extra) => digest([s('ph-crouch-end', 'Verity', '2026-10-24T20:00')], { 'verity|': film('Verity', extra) }).html;
  const fresh = html({});
  assert.match(fresh, /background:#f5c518[^>]*>IMDb<\/span> <b[^>]*>6\.8<\/b>/);
  assert.match(fresh, /<img src="[^"]*Rotten_Tomatoes\.svg[^"]*" alt="Fresh"[^>]*> <b[^>]*>71%<\/b>/);
  assert.match(fresh, /⏱ 1h 54m/);
  assert.match(html({ rottenTomatoes: '59%' }), /<img src="[^"]*Rotten_Tomatoes_rotten\.svg[^"]*" alt="Rotten"/);
  assert.doesNotMatch(html({ imdbRating: null, rottenTomatoes: null }), /f5c518|Rotten_Tomatoes/);
});

test('each film is a card', () => {
  const d = digest([s('ph-crouch-end', 'Verity', '2026-10-24T20:00'), s('ph-crouch-end', 'Hope', '2026-10-25T20:00')]);
  assert.equal((d.html.match(/<div style="[^"]*border:1px solid #e6e6ec;border-radius:10px/g) || []).length, 2);
});

test('title without an IMDb ID is plain text', () => {
  const d = digest([s('ph-crouch-end', 'Verity', '2026-10-24T20:00')], { 'verity|': film('Verity', { imdbId: null }) });
  assert.doesNotMatch(d.html, /<a [^>]*>Verity<\/a>/);
});

test('full synopsis', () => {
  const long = `${'A long synopsis. '.repeat(40)}The end.`;
  const d = digest([s('ph-crouch-end', 'Verity', '2026-10-24T20:00')], { 'verity|': film('Verity', { synopsis: long }) });
  assert.ok(d.html.includes(long));
});

test('no heading in the body; summary counts films and cinemas', () => {
  const d = digest([
    s('ph-crouch-end', 'Verity', '2026-10-24T20:00'),
    s('ph-finsbury-park', 'Verity', '2026-10-25T20:00'),
    s('ph-crouch-end', 'Hope', '2026-10-26T20:00'),
    s('ph-finsbury-park', 'Fatherland', '2026-10-24T18:10', 'subtitled'),
  ]);
  assert.doesNotMatch(d.html, /<h2/);
  assert.doesNotMatch(d.html, /Subtitled Cinema Screenings:/);
  assert.match(d.html, />23 Oct – 5 Nov, 2 subtitled movies showing at 2 cinemas</);
  assert.doesNotMatch(d.html, /fit your hours/);
  assert.match(digest([s('ph-crouch-end', 'Verity', '2026-10-24T20:00')]).html, />23 Oct – 5 Nov, 1 subtitled movie showing at 1 cinema</);
});

test('section names', () => {
  const d = digest([s('ph-crouch-end', 'Verity', '2026-10-24T20:00')]);
  assert.match(d.html, />Subtitled \(Deaf\/HoH\)</);
  assert.doesNotMatch(d.html, /Captioned/);
});

test('footer notes the hours filter and has no calendar link', () => {
  const d = digest([s('ph-crouch-end', 'Verity', '2026-10-24T20:00')], {}, { hours: { weekdayBefore: '09:00', weekdayFrom: '17:30' } });
  assert.match(d.html, /Weekday screenings are only included if they start before 09:00 or from 17:30\./);
  assert.doesNotMatch(d.html, /calendar/i);
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
  assert.match(d.html, /No subtitled screenings in the next two weeks\./);
  assert.match(d.html, /Fatherland/);
});

test('error and stale notes at the bottom', () => {
  const d = digest([s('ph-crouch-end', 'Verity', '2026-10-24T20:00')], {}, {
    errors: [{ cinemaKey: 'ph-finsbury-park', message: 'ph-finsbury-park: response is not JSON' }],
    notes: ['No captioned screenings from Everyman Muswell Hill for 4 weeks; its reader may need checking.'],
  });
  const note = d.html.indexOf("Couldn&#39;t read Picturehouse Finsbury Park");
  assert.ok(note >= 0);
  assert.ok(d.html.indexOf('for 4 weeks') >= 0);
  assert.ok(note > d.html.indexOf('Verity'));
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

test('alert lists errors and capped cinemas with their held events', () => {
  const a = buildAlert({
    errors: [{ cinemaKey: 'bfi-imax', message: 'bfi-imax: FlareSolverr failed: Timeout' }],
    capped: ['ph-crouch-end'],
    held: [
      { cinemaKey: 'ph-crouch-end', summary: '🎬 Verity – Picturehouse Crouch End', start: '2026-10-22T20:00' },
      { cinemaKey: 'ph-crouch-end', summary: '🎬 Hope – Picturehouse Crouch End', start: '2026-10-24T18:30' },
    ],
    cinemas: [...CINEMAS, { key: 'bfi-imax', name: 'BFI IMAX' }],
    executionUrl: 'https://n8n.example/workflow/w/executions/9',
  });
  assert.equal(a.subject, 'Cinema sync: 2 problem(s)');
  assert.match(a.text, /BFI IMAX: bfi-imax: FlareSolverr failed: Timeout/);
  assert.match(a.text, /Picturehouse Crouch End: 2 screenings vanished at once \(more than 3, or its listing came back empty\); nothing deleted: 🎬 Verity – Picturehouse Crouch End \(Thu 22 Oct 20:00\); 🎬 Hope – Picturehouse Crouch End \(Sat 24 Oct 18:30\)\. Check its reader, or delete these by hand if they really were cancelled\./);
  assert.match(a.html, /href="https:\/\/n8n\.example\/workflow\/w\/executions\/9"/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fixture } = require('./load.js');

const { readEverymanSchedule, everymanMoviesUrl, attachEverymanMovies, ReaderError } = load(
  ['core.js', 'readers/everyman.js'],
  ['readEverymanSchedule', 'everymanMoviesUrl', 'attachEverymanMovies', 'ReaderError'],
);

const MUSWELL_HILL = { key: 'everyman-muswell-hill', chain: 'everyman', chain_id: 'X06SN' };
const schedule = fixture('everyman-schedule-X06SN-2026-10-18.json');
const movies = fixture('everyman-movies-2026-10-18.json');

test('reads captioned showtimes', () => {
  const list = readEverymanSchedule(schedule, MUSWELL_HILL);
  assert.equal(list.length, 6);
  assert.deepEqual([...new Set(list.map((s) => s.chainFilmId))].sort(), ['1000015739', '1000026622', '1000026649', '290167']);
  const s = list.find((x) => x.start === '2026-10-22T20:15');
  assert.equal(s.chainFilmId, '1000015739');
  assert.equal(s.kind, 'captioned');
  assert.equal(s.title, null);
  assert.match(s.bookingUrl, /^https:\/\/purchase\.everymancinema\.com\//);
});

test('builds the movies URL', () => {
  const url = everymanMoviesUrl(readEverymanSchedule(schedule, MUSWELL_HILL));
  assert.match(url, /^https:\/\/www\.everymancinema\.com\/api\/gatsby-source-boxofficeapi\/movies\?/);
  assert.match(url, /ids=1000015739/);
  assert.equal(url.match(/ids=/g).length, 4);
  assert.equal(everymanMoviesUrl([]), null);
});

test('attaches film details', () => {
  const list = attachEverymanMovies(readEverymanSchedule(schedule, MUSWELL_HILL), movies);
  const s = list.find((x) => x.start === '2026-10-22T20:15');
  assert.equal(s.title, 'Verity');
  assert.equal(s.runtimeMin, 114);
  assert.match(s.image, /^https:\/\/all\.web\.img\.acsta\.net\//);
  assert.match(s.synopsis, /ghostwriter/);
});

test('throws when a film is missing from the movies response', () => {
  assert.throws(() => attachEverymanMovies(readEverymanSchedule(schedule, MUSWELL_HILL), '[]'), ReaderError);
});

test('throws on a non-JSON body', () => {
  assert.throws(() => readEverymanSchedule('<html>Service unavailable</html>', MUSWELL_HILL), ReaderError);
});

test('throws when the cinema key is missing', () => {
  assert.throws(() => readEverymanSchedule('{}', MUSWELL_HILL), ReaderError);
});

test('zero captioned showtimes is not an error', () => {
  const stripped = schedule.replaceAll('"Showtime.Accessibility.ClosedCaption"', '"Showtime.Other"');
  assert.deepEqual(readEverymanSchedule(stripped, MUSWELL_HILL), []);
});

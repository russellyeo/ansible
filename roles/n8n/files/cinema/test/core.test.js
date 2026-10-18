const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const { fitsFreeHours, normaliseTitle, groupByFilm, digestWindow, cinemaRequest, formatRange, formatDay, formatTime, ReaderError } =
  load(['core.js'], ['fitsFreeHours', 'normaliseTitle', 'groupByFilm', 'digestWindow', 'cinemaRequest', 'formatRange', 'formatDay', 'formatTime', 'ReaderError']);

test('free hours boundaries', () => {
  assert.equal(fitsFreeHours('2026-10-22T17:00'), true); // Thu
  assert.equal(fitsFreeHours('2026-10-22T16:59'), false);
  assert.equal(fitsFreeHours('2026-10-22T08:59'), true);
  assert.equal(fitsFreeHours('2026-10-22T09:00'), false);
  assert.equal(fitsFreeHours('2026-10-25T12:40'), true); // Sun, clocks change
  assert.equal(fitsFreeHours('2026-10-24T13:30'), true); // Sat
});

test('normalises preview and presenter titles', () => {
  assert.equal(normaliseTitle('Fatherland - Preview').key, normaliseTitle('Fatherland').key);
  assert.equal(normaliseTitle('28 Days Later... (Re-release)').title, '28 Days Later...');
  assert.equal(normaliseTitle('BarTrash Presents: Voyage To The Bottom Of The Sea').title, 'Voyage To The Bottom Of The Sea');
  assert.equal(normaliseTitle("Pan's Labyrinth").key, 'panslabyrinth');
});

test('normalises event prefixes and HTML entities', () => {
  assert.equal(normaliseTitle('Godzilla Minus Zero&nbsp;').title, 'Godzilla Minus Zero');
  assert.equal(normaliseTitle('IMAX Preview: Godzilla Minus Zero').title, 'Godzilla Minus Zero');
  assert.equal(normaliseTitle('Special Preview: La Bola Negra').title, 'La Bola Negra');
  assert.equal(normaliseTitle('Tom &amp; Jerry &#39;Live&#39;').title, "Tom & Jerry 'Live'");
  assert.equal(normaliseTitle('Mission: Impossible').title, 'Mission: Impossible');
  assert.equal(normaliseTitle('National Theatre Live: Hay Fever').title, 'National Theatre Live: Hay Fever');
});

test('groups by film in order of first screening', () => {
  const s = (title, start) => ({ title, start, year: null });
  const groups = groupByFilm([s('B', '2026-10-23T18:00'), s('A', '2026-10-22T20:00'), s('B - Preview', '2026-10-22T19:00')]);
  assert.deepEqual(groups.map((g) => g.title), ['B', 'A']);
  assert.deepEqual(groups[0].screenings.map((x) => x.start), ['2026-10-22T19:00', '2026-10-23T18:00']);
});

test('digest window is 14 days inclusive', () => {
  assert.deepEqual(digestWindow('2026-10-23'), { from: '2026-10-23', to: '2026-11-05' });
  assert.equal(formatRange('2026-10-23', '2026-11-05'), '23 Oct – 5 Nov');
});

test('formats days and times', () => {
  assert.equal(formatDay('2026-10-22T20:15'), 'Thu 22 Oct');
  assert.equal(formatTime('2026-10-22T20:15'), '20:15');
});

test('builds chain requests', () => {
  const ph = cinemaRequest({ key: 'ph-crouch-end', chain: 'picturehouse', chain_id: '024' }, '2026-10-18');
  assert.deepEqual(ph, {
    method: 'POST',
    url: 'https://www.picturehouses.com/api/scheduled-movies-ajax',
    body: '{"cinema_id":"024"}',
  });
  const em = cinemaRequest({ key: 'everyman-muswell-hill', chain: 'everyman', chain_id: 'X06SN' }, '2026-10-18');
  assert.equal(em.method, 'GET');
  assert.equal(em.body, null); // Everyman's origin 502s on GET requests that carry a body
  assert.match(
    em.url,
    /schedule\?theaters=%7B%22id%22%3A%22X06SN%22%2C%22timeZone%22%3A%22Europe%2FLondon%22%7D&from=2026-10-18T00%3A00%3A00&to=2026-11-15T23%3A59%3A59/,
  );
  const bfi = cinemaRequest({ key: 'bfi-imax', chain: 'bfi' }, '2026-10-18');
  assert.equal(bfi.url, 'http://flaresolverr:8191/v1');
  assert.equal(JSON.parse(bfi.body).maxTimeout, 180000);
  assert.throws(() => cinemaRequest({ key: 'x', chain: 'curzon' }, '2026-10-18'), ReaderError);
});

test('ReaderError carries the cinema', () => {
  const e = new ReaderError('bfi-imax', 'no listings');
  assert.equal(e.cinemaKey, 'bfi-imax');
  assert.equal(e.message, 'bfi-imax: no listings');
});

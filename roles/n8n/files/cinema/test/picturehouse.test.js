const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fixture } = require('./load.js');

const { readPicturehouse, ReaderError } = load(['core.js', 'readers/picturehouse.js'], ['readPicturehouse', 'ReaderError']);

const CROUCH_END = { key: 'ph-crouch-end', chain: 'picturehouse', chain_id: '024' };
const FINSBURY_PARK = { key: 'ph-finsbury-park', chain: 'picturehouse', chain_id: '029' };
const ph024 = fixture('picturehouse-024-2026-10-18.json');
const count = (list, kind) => list.filter((s) => s.kind === kind).length;

test('reads captioned and subtitled sessions', () => {
  const list = readPicturehouse(ph024, CROUCH_END);
  assert.equal(count(list, 'captioned'), 9);
  assert.equal(count(list, 'subtitled'), 17);
  const s = list.find((x) => x.title === 'The Social Reckoning' && x.start === '2026-10-22T20:00');
  assert.equal(s.screen, 'Screen Three');
  assert.equal(s.cinemaKey, 'ph-crouch-end');
  assert.match(s.bookingUrl, /^https:\/\/web\.picturehouses\.com\/order\/showtimes\/024-\d+\/seats$/);
  assert.match(s.image, /width=1280&height=720/);
  assert.equal(s.runtimeMin, null);
});

test('reads Finsbury Park', () => {
  const list = readPicturehouse(fixture('picturehouse-029-2026-10-18.json'), FINSBURY_PARK);
  assert.equal(count(list, 'captioned'), 2);
  assert.equal(count(list, 'subtitled'), 29);
});

test('a session with both flags is captioned', () => {
  const d = JSON.parse(ph024);
  d.movies[0].show_times[0].SessionAttributesNames = ['HOHSub', 'Sub Cinema'];
  const s = readPicturehouse(JSON.stringify(d), CROUCH_END).find((x) => x.sourceId === d.movies[0].show_times[0].SessionId);
  assert.equal(s.kind, 'captioned');
});

test('throws on a non-JSON body', () => {
  assert.throws(() => readPicturehouse('<html><body>Oops</body></html>', CROUCH_END), ReaderError);
});

test('throws when the response is not a success', () => {
  assert.throws(() => readPicturehouse('{"response":"error"}', CROUCH_END), ReaderError);
});

test('throws when the subtitle flags disappear', () => {
  const d = JSON.parse(ph024);
  for (const m of d.movies) for (const s of m.show_times) s.SessionAttributesNames = s.SessionAttributesNames.filter((a) => a !== 'HOHSub' && a !== 'Sub Cinema');
  assert.throws(() => readPicturehouse(JSON.stringify(d), CROUCH_END), /no HOHSub or Sub Cinema/);
});

test('throws on an unreadable showtime', () => {
  const d = JSON.parse(ph024);
  const hoh = d.movies.flatMap((m) => m.show_times).find((s) => s.SessionAttributesNames.includes('HOHSub'));
  hoh.Showtime = 'soon';
  assert.throws(() => readPicturehouse(JSON.stringify(d), CROUCH_END), ReaderError);
});

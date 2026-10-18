const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fixture } = require('./load.js');

const { readBfi, ReaderError } = load(['core.js', 'readers/bfi.js'], ['readBfi', 'ReaderError']);

const BFI = { key: 'bfi-imax', chain: 'bfi', kind: 'captioned' };
const page = fixture('bfi-flaresolverr-2026-10-18.json');
const solved = (response) => JSON.stringify({ status: 'ok', message: '', solution: { status: 200, response } });

test('reads the embedded listings', () => {
  const list = readBfi(page, BFI);
  assert.equal(list.length, 30);
  const hope = list.find((s) => s.sourceId === 'AA694E82-7375-439C-AEA4-0C4E15E471E9');
  assert.equal(hope.title, 'Hope');
  assert.equal(hope.start, '2026-10-25T16:15');
  assert.equal(hope.kind, 'captioned');
  assert.equal(hope.cinemaKey, 'bfi-imax');
  assert.match(hope.bookingUrl, /^https:\/\/whatson\.bfi\.org\.uk\/imax\/Online\/default\.asp\?doWork::WScontent::loadArticle=Load/);
});

test('decodes HTML entities in titles', () => {
  const list = readBfi(page, BFI);
  assert.ok(list.every((s) => !s.title.includes('&nbsp;')));
  assert.ok(list.some((s) => s.title === 'Godzilla Minus Zero'));
});

test('uses the configured kind', () => {
  const list = readBfi(page, { ...BFI, kind: 'by-language' });
  assert.ok(list.every((s) => s.kind === 'by-language'));
});

test('throws on a Cloudflare page', () => {
  assert.throws(() => readBfi(solved('<html><head><title>Just a moment...</title></head></html>'), BFI), ReaderError);
});

test('throws when FlareSolverr failed', () => {
  const failed = JSON.stringify({ status: 'error', message: 'Error solving the challenge. Timeout after 60.0 seconds.' });
  assert.throws(() => readBfi(failed, BFI), /Timeout/);
});

test('throws when the listing data is missing', () => {
  assert.throws(() => readBfi(solved('<html><body>No events</body></html>'), BFI), ReaderError);
});

test('throws on an unreadable start date', () => {
  const broken = page.replace('Sunday 25 October 2026 16:15', 'Sunday 25 Octember 2026 16:15');
  assert.throws(() => readBfi(broken, BFI), /unreadable start/);
});

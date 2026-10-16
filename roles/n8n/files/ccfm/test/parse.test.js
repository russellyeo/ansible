const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseSchedule, ScheduleError } = require('../ccfm.js');

const TODAY = '2026-10-16';
const fixture = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'alexandra-palace-2026-10-16.html'),
  'utf8',
);

// Minimal page with the same shape as the real one. Pass null to drop a block.
function page({ park = [], campsbourne = [] } = {}) {
  const block = (heading, dates) =>
    dates === null
      ? ''
      : `<h2>${heading}</h2><p>Some address</p>` + dates.map((d) => `<p>${d}</p>`).join('');
  return (
    '<html><body><p>Every Sunday - 10 till 3</p>' +
    block('ALEXANDRA PALACE PARK LOCATION', park) +
    block('CAMPSBOURNE SCHOOL LOCATION', campsbourne) +
    '<footer>© Copyright</footer></body></html>'
  );
}

function throwsSchedule(fn, pattern) {
  assert.throws(fn, (err) => err instanceof ScheduleError && pattern.test(err.message));
}

test('parses every date on the real page', () => {
  const markets = parseSchedule(fixture, TODAY);
  assert.equal(markets.length, 16);
  assert.equal(markets.filter((m) => m.location === 'park').length, 9);
  assert.deepEqual(markets[0], { date: '2026-09-06', location: 'park' });
  assert.deepEqual(markets.find((m) => m.date === '2026-10-11'), { date: '2026-10-11', location: 'campsbourne' });
  assert.deepEqual(markets.at(-1), { date: '2026-12-20', location: 'campsbourne' });
});

test('returns markets sorted by date', () => {
  const dates = parseSchedule(fixture, TODAY).map((m) => m.date);
  assert.deepEqual(dates, [...dates].sort());
});

test('accepts ordinal and month spelling variants', () => {
  const markets = parseSchedule(
    page({ park: ['1st Nov 2026', '8 NOVEMBER 2026', '15th Nov. 2026'], campsbourne: ['3RD JAN 2027'] }),
    '2026-12-20',
  );
  assert.deepEqual(markets, [
    { date: '2026-11-01', location: 'park' },
    { date: '2026-11-08', location: 'park' },
    { date: '2026-11-15', location: 'park' },
    { date: '2027-01-03', location: 'campsbourne' },
  ]);
});

test('fails when a location heading is missing', () => {
  throwsSchedule(
    () => parseSchedule(page({ park: null, campsbourne: ['11TH OCT 2026'] }), TODAY),
    /heading not found: ALEXANDRA PALACE PARK LOCATION/,
  );
});

test('fails on a date that is not a Sunday', () => {
  throwsSchedule(() => parseSchedule(page({ park: ['7TH SEPT 2026'] }), TODAY), /not a Sunday/);
});

test('fails when a date is listed at both locations', () => {
  throwsSchedule(
    () => parseSchedule(page({ park: ['11TH OCT 2026'], campsbourne: ['11TH OCT 2026'] }), TODAY),
    /2026-10-11 listed at both locations/,
  );
});

test('fails on an unknown month', () => {
  throwsSchedule(() => parseSchedule(page({ park: ['4TH OKT 2026'] }), TODAY), /unknown month/);
});

test('fails on an impossible day', () => {
  throwsSchedule(() => parseSchedule(page({ park: ['31ST SEPT 2026'] }), TODAY), /invalid date/);
});

test('fails on an implausible year', () => {
  throwsSchedule(() => parseSchedule(page({ park: ['7TH OCT 2029'] }), TODAY), /implausible year/);
});

test('fails when no dates are found', () => {
  throwsSchedule(() => parseSchedule(page(), TODAY), /no dates found/);
});

test('error message includes the page text for debugging', () => {
  throwsSchedule(() => parseSchedule(page({ park: ['7TH SEPT 2026'] }), TODAY), /CAMPSBOURNE SCHOOL LOCATION/);
});

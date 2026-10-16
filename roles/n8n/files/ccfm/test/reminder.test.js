const test = require('node:test');
const assert = require('node:assert/strict');
const { nextSunday, buildReminder } = require('../ccfm.js');

const ev = (id, date, location) => ({
  id,
  extendedProperties: { private: { ccfmDate: date, ccfmLocation: location } },
});

test('nextSunday is tomorrow on a Saturday', () => {
  assert.equal(nextSunday('2026-10-17'), '2026-10-18');
});

test('nextSunday is today on a Sunday', () => {
  assert.equal(nextSunday('2026-10-18'), '2026-10-18');
});

test('nextSunday crosses the year boundary', () => {
  assert.equal(nextSunday('2027-01-02'), '2027-01-03');
});

test('reminder for an unchanged location', () => {
  const r = buildReminder({
    sunday: '2026-10-18',
    events: [ev('a', '2026-10-11', 'campsbourne'), ev('b', '2026-10-18', 'campsbourne')],
  });
  assert.equal(r.subject, 'Ally Pally market Sunday 18 October: Campsbourne School');
  assert.match(r.text, /Sunday 18 October, 10:00–15:00/);
  assert.match(r.text, /Nightingale Lane, N8 7AF/);
  assert.doesNotMatch(r.text, /last week/);
});

test('reminder flags a move from last week', () => {
  const r = buildReminder({
    sunday: '2026-10-18',
    events: [ev('a', '2026-10-11', 'park'), ev('b', '2026-10-18', 'campsbourne')],
  });
  assert.ok(r.subject.startsWith('📍 Moved! '));
  assert.match(r.text, /last week it was at Alexandra Palace Park/);
});

test('reminder does not claim a move when last week is unknown', () => {
  const r = buildReminder({ sunday: '2026-10-18', events: [ev('b', '2026-10-18', 'campsbourne')] });
  assert.ok(!r.subject.includes('Moved'));
});

test('reminder says nothing is listed when there is no event', () => {
  const r = buildReminder({ sunday: '2026-12-27', events: [ev('a', '2026-12-20', 'campsbourne')] });
  assert.equal(r.subject, 'Ally Pally market: nothing listed for Sunday 27 December');
  assert.match(r.text, /weareccfm\.com/);
});

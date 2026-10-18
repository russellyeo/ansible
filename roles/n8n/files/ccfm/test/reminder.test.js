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
  assert.equal(r.subject, "Ally Pally Farmers' Market: Sunday 18 October at Campsbourne School");
  assert.match(r.text, /Sunday 18 October, 10:00–15:00/);
  assert.match(r.text, /Nightingale Lane, N8 7AF/);
  assert.doesNotMatch(r.text, /last week/);
  assert.equal(r.photo, 'campsbourne');
  assert.match(r.html, /<img src="cid:campsbourne"/);
  assert.match(r.html, /<li><b>Where:<\/b> Campsbourne School<\/li>/);
  assert.match(r.html, /<li><b>When:<\/b> Sunday 18 October, 10:00–15:00<\/li>/);
  assert.match(r.html, /<li><b>Address:<\/b> Nightingale Lane, N8 7AF<\/li>/);
  assert.match(r.html, /<li><b>Map:<\/b> <a href="https:\/\/[^"]+">Open in Google Maps<\/a><\/li>/);
  assert.doesNotMatch(r.html, /Moved/);
});

test('reminder flags a move from last week', () => {
  const r = buildReminder({
    sunday: '2026-10-18',
    events: [ev('a', '2026-10-11', 'park'), ev('b', '2026-10-18', 'campsbourne')],
  });
  assert.ok(r.subject.startsWith('📍 Moved! '));
  assert.match(r.text, /last week it was at Alexandra Palace Park/);
  assert.match(r.html, /<li><b>📍 Moved:<\/b> last week it was at Alexandra Palace Park<\/li>/);
});

test('reminder does not claim a move when last week is unknown', () => {
  const r = buildReminder({ sunday: '2026-10-18', events: [ev('b', '2026-10-18', 'campsbourne')] });
  assert.ok(!r.subject.includes('Moved'));
});

test('reminder says nothing is listed when there is no event', () => {
  const r = buildReminder({ sunday: '2026-12-27', events: [ev('a', '2026-12-20', 'campsbourne')] });
  assert.equal(r.subject, "Ally Pally Farmers' Market: nothing listed for Sunday 27 December");
  assert.match(r.text, /weareccfm\.com/);
  assert.equal(r.photo, null);
  assert.match(r.html, /weareccfm\.com/);
});

test('reminder escapes HTML in location details', () => {
  const r = buildReminder({ sunday: '2026-10-18', events: [ev('b', '2026-10-18', 'campsbourne')] });
  assert.doesNotMatch(r.html, /&(?![a-z]+;|#\d+;)/);
});

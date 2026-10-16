const test = require('node:test');
const assert = require('node:assert/strict');
const { planSync, eventBody, calendarOps, buildChangeEmail } = require('../ccfm.js');

const TODAY = '2026-10-16';
const m = (date, location) => ({ date, location });
const ev = (id, date, location) => ({
  id,
  extendedProperties: { private: { ccfmDate: date, ccfmLocation: location } },
});

test('creates events for upcoming markets only', () => {
  const plan = planSync({
    markets: [m('2026-10-11', 'campsbourne'), m('2026-10-18', 'campsbourne'), m('2026-10-25', 'park')],
    events: [],
    today: TODAY,
  });
  assert.deepEqual(plan.create, [m('2026-10-18', 'campsbourne'), m('2026-10-25', 'park')]);
  assert.deepEqual(plan.update, []);
  assert.deepEqual(plan.remove, []);
});

test('treats today as upcoming', () => {
  const plan = planSync({ markets: [m('2026-10-18', 'park')], events: [], today: '2026-10-18' });
  assert.deepEqual(plan.create, [m('2026-10-18', 'park')]);

  const kept = planSync({ markets: [m('2026-10-18', 'park')], events: [ev('e1', '2026-10-18', 'park')], today: '2026-10-18' });
  assert.deepEqual(kept.remove, []);
  assert.deepEqual(kept.create, []);
});

test('leaves matching events alone', () => {
  const plan = planSync({ markets: [m('2026-10-25', 'park')], events: [ev('e1', '2026-10-25', 'park')], today: TODAY });
  assert.deepEqual(plan, { create: [], update: [], moved: [], remove: [], removed: [], capTripped: false });
});

test('updates and reports a market that moved', () => {
  const plan = planSync({ markets: [m('2026-10-25', 'campsbourne')], events: [ev('e1', '2026-10-25', 'park')], today: TODAY });
  assert.deepEqual(plan.update, [{ eventId: 'e1', market: m('2026-10-25', 'campsbourne') }]);
  assert.deepEqual(plan.moved, [{ date: '2026-10-25', from: 'park', to: 'campsbourne' }]);
});

test('deletes an event whose date is no longer listed', () => {
  const plan = planSync({ markets: [], events: [ev('e1', '2026-10-25', 'park')], today: TODAY });
  const gone = { eventId: 'e1', date: '2026-10-25', location: 'park' };
  assert.deepEqual(plan.remove, [gone]);
  assert.deepEqual(plan.removed, [gone]);
  assert.equal(plan.capTripped, false);
});

test('trips the safety cap instead of deleting more than 2 events', () => {
  const plan = planSync({
    markets: [],
    events: [ev('a', '2026-10-18', 'park'), ev('b', '2026-10-25', 'park'), ev('c', '2026-11-01', 'park')],
    today: TODAY,
  });
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.removed.length, 3);
  assert.equal(plan.capTripped, true);
});

test('ignores past events and events it did not create', () => {
  const plan = planSync({
    markets: [],
    events: [ev('old', '2026-10-11', 'park'), { id: 'mine', summary: 'Coffee with friends' }],
    today: TODAY,
  });
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.create, []);
});

test('removes duplicate events without reporting them', () => {
  const plan = planSync({
    markets: [m('2026-10-25', 'park')],
    events: [ev('a', '2026-10-25', 'park'), ev('b', '2026-10-25', 'park')],
    today: TODAY,
  });
  assert.deepEqual(plan.remove, [{ eventId: 'b', date: '2026-10-25', location: 'park' }]);
  assert.deepEqual(plan.removed, []);
  assert.equal(plan.capTripped, false);
});

test('event body pins wall-clock time in Europe/London, even on clock-change day', () => {
  const body = eventBody(m('2026-10-25', 'campsbourne'));
  assert.equal(body.summary, "Farmers' Market – Campsbourne School");
  assert.equal(body.location, 'Campsbourne School, Nightingale Lane, N8 7AF');
  assert.deepEqual(body.start, { dateTime: '2026-10-25T10:00:00', timeZone: 'Europe/London' });
  assert.deepEqual(body.end, { dateTime: '2026-10-25T15:00:00', timeZone: 'Europe/London' });
  assert.deepEqual(body.extendedProperties, { private: { ccfmDate: '2026-10-25', ccfmLocation: 'campsbourne' } });
  assert.match(body.description, /google\.com\/maps/);
});

test('calendar ops map the plan to REST calls', () => {
  const ops = calendarOps({
    create: [m('2026-10-18', 'park')],
    update: [{ eventId: 'e/1', market: m('2026-10-25', 'park') }],
    remove: [{ eventId: 'e2', date: '2026-11-01', location: 'park' }],
  });
  assert.deepEqual(
    ops.map((op) => [op.method, op.path]),
    [['POST', '/events'], ['PUT', '/events/e%2F1'], ['DELETE', '/events/e2']],
  );
  assert.equal(ops[0].body.extendedProperties.private.ccfmDate, '2026-10-18');
  assert.equal(ops[2].body, null);
});

test('change email is null when nothing surprising happened', () => {
  const plan = planSync({ markets: [m('2026-10-18', 'park')], events: [], today: TODAY });
  assert.equal(buildChangeEmail(plan), null);
});

test('change email reports moves and deletions', () => {
  const plan = planSync({
    markets: [m('2026-10-25', 'campsbourne')],
    events: [ev('e1', '2026-10-25', 'park'), ev('e2', '2026-11-01', 'park')],
    today: TODAY,
  });
  const email = buildChangeEmail(plan);
  assert.equal(email.subject, 'Ally Pally market: schedule changed');
  assert.match(email.text, /Sunday 25 October: moved from Alexandra Palace Park to Campsbourne School\./);
  assert.match(email.text, /Sunday 1 November \(Alexandra Palace Park\): no longer listed, event deleted\./);
});

test('change email warns when the safety cap trips', () => {
  const plan = planSync({
    markets: [],
    events: [ev('a', '2026-10-18', 'park'), ev('b', '2026-10-25', 'park'), ev('c', '2026-11-01', 'park')],
    today: TODAY,
  });
  const email = buildChangeEmail(plan);
  assert.equal(email.subject, 'Ally Pally market: schedule check needed');
  assert.match(email.text, /event NOT deleted/);
  assert.match(email.text, /nothing was deleted/);
});

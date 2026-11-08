// Every payload here is made up. Real payloads are health data and stay on
// the NAS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const { payloadKind, archiveFiles, planReads, buildCommit, daysSince, workoutNote, dayNote } = load(
  ['health.js'],
  ['payloadKind', 'archiveFiles', 'planReads', 'buildCommit', 'daysSince', 'workoutNote', 'dayNote'],
);

const workout = (id, extra = {}) => ({
  id,
  name: 'Traditional Strength Training',
  start: '2026-11-04 13:35:22 +0000',
  end: '2026-11-04 14:11:06 +0000',
  duration: 2144,
  source: { name: 'Hevy' },
  route: [{ lat: 0, lon: 0 }],
  ...extra,
});

const steps = (entries) => ({
  name: 'step_count',
  units: 'count',
  data: Object.entries(entries).map(([date, qty]) => ({ date: `${date} 00:00:00 +0000`, qty, source: 'Watch' })),
});

const workoutsBody = (...ws) => ({ data: { workouts: ws } });
const metricsBody = (entries) => ({ data: { metrics: [steps(entries)] } });
const blob = (path) => ({ path, type: 'blob', sha: `sha-${path}` });
const TODAY = '2026-11-08';

test('payloadKind tells the two automations apart', () => {
  assert.equal(payloadKind(workoutsBody(workout('A'))), 'workouts');
  assert.equal(payloadKind(workoutsBody()), 'workouts');
  assert.equal(payloadKind(metricsBody({ '2026-11-05': 1 })), 'metrics');
  assert.throws(() => payloadKind({ data: {} }), /payload has neither data.metrics nor data.workouts/);
  assert.throws(() => payloadKind('nonsense'), /payload has neither data.metrics nor data.workouts/);
});

test('archive keeps one file per workout, with its route', () => {
  const files = archiveFiles(workoutsBody(workout('A'), workout('B')), '2026-11-08-091500', '2026-11-08T09:15:00.000+00:00');
  assert.deepEqual(files.map((f) => f.path), ['workouts/A.json', 'workouts/B.json', 'last-payload.json']);
  assert.deepEqual(JSON.parse(files[0].content), workout('A'));
  assert.deepEqual(JSON.parse(files[2].content), { received: '2026-11-08T09:15:00.000+00:00', kind: 'workouts' });
});

test('archive keeps the whole metrics payload once', () => {
  const body = metricsBody({ '2026-11-05': 1 });
  const files = archiveFiles(body, '2026-11-08-091500', '2026-11-08T09:15:00.000+00:00');
  assert.deepEqual(files.map((f) => f.path), ['metrics/2026-11-08-091500.json', 'last-payload.json']);
  assert.deepEqual(JSON.parse(files[0].content), body);
});

test('archive refuses a workout id that could escape its folder', () => {
  assert.throws(() => archiveFiles(workoutsBody(workout('../x')), 's', 'i'), /workout id is not a plain ID/);
});

test('ledgered workouts are skipped even when their note is gone', () => {
  const body = workoutsBody(workout('A'));
  const ledger = { workouts: { A: 'workouts/2026/2026-11-04 1335 Strength.md' } };
  assert.deepEqual(planReads({ body, tree: [], ledger, today: TODAY }), []);
  const result = buildCommit({ body, tree: [], blobs: {}, ledger, today: TODAY });
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.ledger, ledger);
});

test('a new workout is created and ledgered', () => {
  const result = buildCommit({ body: workoutsBody(workout('A')), tree: [], blobs: {}, ledger: { workouts: {} }, today: TODAY });
  const note = workoutNote(workout('A'));
  assert.deepEqual(result.files, [{ path: note.path, content: note.text }]);
  assert.deepEqual(result.ledger, { workouts: { A: note.path } });
  assert.equal(result.message, 'Health Auto Export: 1 workout, 0 days');
});

test('a committed but unledgered workout is skipped and ledgered', () => {
  const note = workoutNote(workout('A'));
  const tree = [blob(note.path)];
  const body = workoutsBody(workout('A'));
  assert.deepEqual(planReads({ body, tree, ledger: {}, today: TODAY }), [{ path: note.path, sha: `sha-${note.path}` }]);
  const edited = note.text.replace('effort:', 'effort: 7');
  const result = buildCommit({ body, tree, blobs: { [note.path]: edited }, ledger: {}, today: TODAY });
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.ledger, { workouts: { A: note.path } });
});

test('another workout in the same minute gets a suffix', () => {
  const first = workoutNote(workout('A'));
  const tree = [blob(first.path)];
  const body = workoutsBody(workout('B', { source: { name: 'Watch' } }));
  const result = buildCommit({ body, tree, blobs: { [first.path]: first.text }, ledger: { workouts: { A: first.path } }, today: TODAY });
  assert.deepEqual(result.files.map((f) => f.path), ['workouts/2026/2026-11-04 1335 Strength 2.md']);
  assert.match(result.files[0].content, /^source_id: B$/m);
});

test('two new workouts in the same minute in one payload both land', () => {
  const result = buildCommit({ body: workoutsBody(workout('A'), workout('B')), tree: [], blobs: {}, ledger: {}, today: TODAY });
  assert.deepEqual(result.files.map((f) => f.path), [
    'workouts/2026/2026-11-04 1335 Strength.md',
    'workouts/2026/2026-11-04 1335 Strength 2.md',
  ]);
  assert.equal(result.message, 'Health Auto Export: 2 workouts, 0 days');
});

test('planReads asks for every existing note at a new workout path and its suffixes', () => {
  const tree = [
    blob('workouts/2026/2026-11-04 1335 Strength.md'),
    blob('workouts/2026/2026-11-04 1335 Strength 2.md'),
    blob('workouts/2026/2026-11-04 1335 Strength 20.md'),
    blob('days/2026/2026-11-05.md'),
  ];
  const reads = planReads({ body: workoutsBody(workout('C')), tree, ledger: {}, today: TODAY });
  assert.deepEqual(reads.map((r) => r.path), [
    'workouts/2026/2026-11-04 1335 Strength.md',
    'workouts/2026/2026-11-04 1335 Strength 2.md',
  ]);
});

test('a day before today is created, today is not', () => {
  const result = buildCommit({ body: metricsBody({ '2026-11-07': 4000, '2026-11-08': 300 }), tree: [], blobs: {}, ledger: {}, today: TODAY });
  assert.deepEqual(result.files, [{ path: 'days/2026/2026-11-07.md', content: dayNote('2026-11-07', { steps: 4000 }).text }]);
  assert.equal(result.message, 'Health Auto Export: 0 workouts, 1 day');
});

test('a recent day note is merged, an old one is final', () => {
  const recent = 'days/2026/2026-11-01.md';
  const old = 'days/2026/2026-10-31.md';
  const tree = [blob(recent), blob(old)];
  const body = metricsBody({ '2026-11-01': 5000, '2026-10-31': 6000 });
  assert.deepEqual(planReads({ body, tree, ledger: {}, today: TODAY }).map((r) => r.path), [recent]);
  const blobs = { [recent]: dayNote('2026-11-01', { steps: 4000 }).text.replace('## Notes', '## Notes\n\nTired.') };
  const result = buildCommit({ body, tree, blobs, ledger: {}, today: TODAY });
  assert.deepEqual(result.files.map((f) => f.path), [recent]);
  assert.match(result.files[0].content, /^steps: 5000$/m);
  assert.match(result.files[0].content, /Tired\.\n$/);
});

test('an old day with no note is still created', () => {
  const result = buildCommit({ body: metricsBody({ '2026-10-20': 6000 }), tree: [], blobs: {}, ledger: {}, today: TODAY });
  assert.deepEqual(result.files.map((f) => f.path), ['days/2026/2026-10-20.md']);
});

test('an unchanged day note commits nothing', () => {
  const path = 'days/2026/2026-11-05.md';
  const result = buildCommit({
    body: metricsBody({ '2026-11-05': 4000 }),
    tree: [blob(path)],
    blobs: { [path]: dayNote('2026-11-05', { steps: 4000 }).text },
    ledger: {},
    today: TODAY,
  });
  assert.deepEqual(result.files, []);
});

test('an empty workouts payload commits nothing', () => {
  const result = buildCommit({ body: workoutsBody(), tree: [], blobs: {}, ledger: { workouts: {} }, today: TODAY });
  assert.deepEqual(result.files, []);
  assert.equal(result.message, 'Health Auto Export: 0 workouts, 0 days');
});

test('daysSince counts whole days', () => {
  assert.equal(daysSince('2026-11-05T10:00:00Z', '2026-11-08T07:36:00Z'), 2);
  assert.equal(daysSince('2026-11-05T10:00:00Z', '2026-11-08T10:00:00Z'), 3);
});

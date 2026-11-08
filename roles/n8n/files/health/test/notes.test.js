// Every payload here is made up. Real payloads are health data and stay on
// the NAS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const { isoTimestamp, workoutNote, dayValues, metricDates, dayNote, mergeDay, DAY_FIELDS } = load(
  ['health.js'],
  ['isoTimestamp', 'workoutNote', 'dayValues', 'metricDates', 'dayNote', 'mergeDay', 'DAY_FIELDS'],
);

const run = (extra = {}) => ({
  id: 'AAAA-1111',
  name: 'Outdoor Run',
  start: '2026-11-06 07:06:20 +0000',
  end: '2026-11-06 07:40:09 +0000',
  duration: 2029,
  source: { name: 'WorkOutDoors' },
  distance: { qty: 5.0912, units: 'km' },
  elevationUp: { qty: 81.6, units: 'm' },
  avgHeartRate: { qty: 142.7, units: 'bpm' },
  maxHeartRate: { qty: 165.2, units: 'bpm' },
  activeEnergyBurned: { qty: 1807.5, units: 'kJ' },
  isIndoor: false,
  ...extra,
});

const strength = {
  id: 'BBBB-2222',
  name: 'Traditional Strength Training',
  start: '2026-11-04 13:35:22 +0000',
  end: '2026-11-04 14:11:06 +0000',
  duration: 2144,
  source: { name: 'Hevy' },
  avgHeartRate: { qty: 113.6, units: 'bpm' },
  maxHeartRate: { qty: 147, units: 'bpm' },
  activeEnergyBurned: { qty: 1008, units: 'kJ' },
};

const metric = (name, units, entries) => ({
  name,
  units,
  data: Object.entries(entries).map(([date, qty]) => ({ date: `${date} 00:00:00 +0000`, qty, source: 'Watch' })),
});

const sleep = (date, extra = {}) => ({
  date: `${date} 00:00:00 +0000`,
  sleepStart: '2026-11-04 23:37:50 +0000',
  sleepEnd: `${date} 07:00:14 +0000`,
  inBedStart: '2026-11-04 23:30:00 +0000',
  inBedEnd: `${date} 07:05:00 +0000`,
  totalSleep: 7.3166,
  deep: 0.6234,
  rem: 1.6789,
  core: 5.0143,
  awake: 0.0512,
  asleep: 0,
  inBed: 0,
  source: 'Watch',
  ...extra,
});

const metrics = [
  metric('resting_heart_rate', 'count/min', { '2026-11-05': 56.6 }),
  metric('heart_rate_variability', 'ms', { '2026-11-05': 46.94 }),
  metric('step_count', 'count', { '2026-11-05': 1665.4, '2026-11-08': 300 }),
  metric('walking_running_distance', 'km', { '2026-11-05': 1.2149 }),
  metric('active_energy', 'kJ', { '2026-11-05': 862 }),
  metric('apple_exercise_time', 'min', { '2026-11-05': 1 }),
  metric('respiratory_rate', 'count/min', { '2026-11-05': 13.26 }),
  metric('blood_oxygen_saturation', '%', { '2026-11-05': 95.42 }),
  metric('headphone_audio_exposure', 'dBASPL', { '2026-11-05': 70 }),
  { name: 'sleep_analysis', units: 'hr', data: [sleep('2026-11-05')] },
];

test('converts Health Auto Export timestamps to ISO with offset', () => {
  assert.equal(isoTimestamp('2026-11-06 07:06:20 +0000'), '2026-11-06T07:06:20+00:00');
  assert.equal(isoTimestamp('2026-06-01 00:30:00 +0100'), '2026-06-01T00:30:00+01:00');
  assert.throws(() => isoTimestamp('yesterday'), /not a Health Auto Export timestamp/);
});

test('run note matches the vault format', () => {
  const note = workoutNote(run());
  assert.equal(note.id, 'AAAA-1111');
  assert.equal(note.date, '2026-11-06');
  assert.equal(note.path, 'workouts/2026/2026-11-06 0706 Run.md');
  assert.equal(
    note.text,
    [
      '---',
      'type: workout',
      'date: 2026-11-06',
      'source: apple-health',
      'schema: 1',
      'source_id: AAAA-1111',
      'activity: run',
      'recorded_by: WorkOutDoors',
      'start: 2026-11-06T07:06:20+00:00',
      'end: 2026-11-06T07:40:09+00:00',
      'duration_min: 33.8',
      'distance_km: 5.09',
      'elevation_m: 82',
      'avg_hr: 143',
      'max_hr: 165',
      'energy_kcal: 432',
      'indoor: false',
      'effort:',
      '---',
      '',
      'Run · 5.09 km · 33.8 min · avg 143 bpm',
      '',
      '## Notes',
      '',
    ].join('\n'),
  );
});

test('strength note leaves out missing fields', () => {
  const note = workoutNote(strength);
  assert.equal(note.path, 'workouts/2026/2026-11-04 1335 Strength.md');
  assert.match(note.text, /^activity: strength$/m);
  for (const key of ['distance_km', 'elevation_m', 'indoor']) assert.doesNotMatch(note.text, new RegExp(`^${key}:`, 'm'));
  assert.match(note.text, /\n\nStrength · 35\.7 min · avg 114 bpm\n\n## Notes\n$/);
});

test('summer time dates and names locally', () => {
  const note = workoutNote(run({ start: '2026-06-01 00:30:00 +0100', end: '2026-06-01 01:00:00 +0100' }));
  assert.equal(note.date, '2026-06-01');
  assert.equal(note.path, 'workouts/2026/2026-06-01 0030 Run.md');
  assert.match(note.text, /^start: 2026-06-01T00:30:00\+01:00$/m);
});

test('indoor runs and walks map to run and walk', () => {
  assert.match(workoutNote(run({ name: 'Indoor Run', isIndoor: true })).text, /^activity: run$\n[\s\S]*^indoor: true$/m);
  assert.equal(workoutNote(run({ name: 'Outdoor Walk' })).path, 'workouts/2026/2026-11-06 0706 Walk.md');
  assert.match(workoutNote({ ...strength, name: 'Functional Strength Training' }).text, /^activity: strength$/m);
});

test('unknown activity is slugged', () => {
  const note = workoutNote(run({ name: 'Outdoor Cycle' }));
  assert.match(note.text, /^activity: outdoor-cycle$/m);
  assert.equal(note.path, 'workouts/2026/2026-11-06 0706 Outdoor Cycle.md');
  assert.equal(workoutNote(run({ name: 'Yoga/Pilates' })).path, 'workouts/2026/2026-11-06 0706 YogaPilates.md');
});

test('energy converts kJ to kcal and keeps kcal', () => {
  assert.match(workoutNote(run({ activeEnergyBurned: { qty: 1000, units: 'kJ' } })).text, /^energy_kcal: 239$/m);
  assert.match(workoutNote(run({ activeEnergyBurned: { qty: 250.4, units: 'kcal' } })).text, /^energy_kcal: 250$/m);
});

test('wrong units throw without the value', () => {
  assert.throws(
    () => workoutNote(run({ distance: { qty: 3.1634, units: 'mi' } })),
    (e) => e.message === 'distance_km: expected km, got mi' && !e.message.includes('3.16'),
  );
});

test('day values map and round', () => {
  assert.deepEqual(dayValues(metrics, '2026-11-05'), {
    sleep_start: '2026-11-04T23:37:50+00:00',
    sleep_end: '2026-11-05T07:00:14+00:00',
    sleep_total_h: 7.32,
    sleep_deep_h: 0.62,
    sleep_rem_h: 1.68,
    sleep_core_h: 5.01,
    sleep_awake_h: 0.05,
    resting_hr: 57,
    hrv_ms: 46.9,
    steps: 1665,
    walk_run_distance_km: 1.21,
    active_energy_kcal: 206,
    exercise_min: 1,
    respiratory_rate: 13.3,
    blood_oxygen_pct: 95.4,
  });
});

test('day leaves out missing metrics and in_bed 0, keeps in_bed when set', () => {
  const values = dayValues(metrics, '2026-11-05');
  assert.equal('in_bed_h' in values, false);
  assert.equal('vo2_max' in values, false);
  const withBed = [{ name: 'sleep_analysis', units: 'hr', data: [sleep('2026-11-05', { inBed: 7.5833 })] }];
  assert.equal(dayValues(withBed, '2026-11-05').in_bed_h, 7.58);
  assert.deepEqual(Object.keys(dayValues(metrics, '2026-11-05')), DAY_FIELDS.filter((f) => f in dayValues(metrics, '2026-11-05')));
});

test('sleep goes on the wake-up date', () => {
  const late = [{ name: 'sleep_analysis', units: 'hr', data: [sleep('2026-11-05', { date: '2026-11-04 00:00:00 +0000' })] }];
  assert.equal(dayValues(late, '2026-11-05').sleep_end, '2026-11-05T07:00:14+00:00');
  assert.deepEqual(dayValues(late, '2026-11-04'), {});
});

test('wrong metric units throw without the value', () => {
  const bad = [metric('walking_running_distance', 'mi', { '2026-11-05': 0.7549 })];
  assert.throws(() => dayValues(bad, '2026-11-05'), (e) => e.message === 'walk_run_distance_km: expected km, got mi');
});

test('metricDates skips today and later and days with nothing we keep', () => {
  const only = [...metrics, metric('headphone_audio_exposure', 'dBASPL', { '2026-11-03': 70 })];
  assert.deepEqual(metricDates(only, '2026-11-08'), ['2026-11-05']);
  assert.deepEqual(metricDates(metrics, '2026-11-05'), []);
});

test('day note has the values then an empty Notes section', () => {
  const note = dayNote('2026-11-05', { resting_hr: 57, steps: 1665 });
  assert.equal(note.path, 'days/2026/2026-11-05.md');
  assert.equal(
    note.text,
    '---\ntype: day\ndate: 2026-11-05\nsource: apple-health\nschema: 1\nresting_hr: 57\nsteps: 1665\n---\n\n## Notes\n',
  );
});

const existing = [
  '---',
  'type: day',
  'date: 2026-11-05',
  'source: apple-health',
  'schema: 1',
  'resting_hr: 57',
  'shoes: Pegasus',
  'steps: 1665',
  '---',
  '',
  '## Notes',
  '',
  'Slept badly: noisy street.',
  '',
].join('\n');

test('mergeDay updates owned values and keeps everything else', () => {
  const merged = mergeDay(existing, { resting_hr: 55, daylight_min: 12.5 });
  assert.equal(
    merged,
    existing.replace('resting_hr: 57', 'resting_hr: 55').replace('steps: 1665\n---', 'steps: 1665\ndaylight_min: 12.5\n---'),
  );
});

test('mergeDay never removes a value', () => {
  assert.equal(mergeDay(existing, {}), null);
  const merged = mergeDay(existing, { resting_hr: 55 });
  assert.match(merged, /^steps: 1665$/m);
});

test('mergeDay returns null when nothing changes', () => {
  assert.equal(mergeDay(existing, { resting_hr: 57, steps: 1665 }), null);
});

test('mergeDay leaves hand-written notes alone', () => {
  assert.equal(mergeDay(existing.replace('source: apple-health', 'source: manual'), { resting_hr: 50 }), null);
});

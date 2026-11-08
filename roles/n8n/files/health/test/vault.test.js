// Checks generated notes against the vault's own schema and validator
// (russellyeo/apple-health-vault, cloned at HEALTH_VAULT or
// ~/Developer/Obsidian/apple-health-vault).
// Skipped when the vault isn't there. Every payload here is made up.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { load } = require('./load.js');

const { buildCommit, dayNote } = load(['health.js'], ['buildCommit', 'dayNote']);

const VAULT = process.env.HEALTH_VAULT || path.join(os.homedir(), 'Developer/Obsidian/apple-health-vault');
const haveVault = fs.existsSync(path.join(VAULT, 'schema/v1.json'));

const q = (qty, units) => ({ qty, units });
const workouts = [
  {
    id: 'AAAA-1111', name: 'Outdoor Run', start: '2026-06-01 00:30:00 +0100', end: '2026-06-01 01:05:00 +0100',
    duration: 2100, source: { name: 'WorkOutDoors' }, distance: q(6.2, 'km'), elevationUp: q(40, 'm'),
    avgHeartRate: q(150, 'bpm'), maxHeartRate: q(171, 'bpm'), activeEnergyBurned: q(1900, 'kJ'), isIndoor: false,
  },
  {
    id: 'BBBB-2222', name: 'Traditional Strength Training', start: '2026-11-04 13:35:22 +0000',
    end: '2026-11-04 14:11:06 +0000', duration: 2144, source: { name: 'Hevy' }, avgHeartRate: q(114, 'bpm'),
  },
  { id: 'CCCC-3333', name: 'Outdoor Cycle', start: '2026-11-03 09:00:00 +0000', duration: 1800 },
];

const daily = (name, units, qty) => ({ name, units, data: [{ date: '2026-11-05 00:00:00 +0000', qty, source: 'Watch' }] });
const metrics = [
  daily('resting_heart_rate', 'count/min', 55.2),
  daily('heart_rate_variability', 'ms', 50.12),
  daily('vo2_max', 'ml/(kg·min)', 44.31),
  daily('step_count', 'count', 9000),
  daily('walking_running_distance', 'km', 6.789),
  daily('active_energy', 'kJ', 2100),
  daily('apple_exercise_time', 'min', 35),
  daily('respiratory_rate', 'count/min', 14.04),
  daily('blood_oxygen_saturation', '%', 96.3),
  daily('time_in_daylight', 'min', 42),
  daily('walking_heart_rate_average', 'count/min', 98.6),
  daily('weight_body_mass', 'kg', 72.34),
  {
    name: 'sleep_analysis', units: 'hr',
    data: [{
      date: '2026-11-05 00:00:00 +0000', sleepStart: '2026-11-04 23:10:00 +0000', sleepEnd: '2026-11-05 06:50:00 +0000',
      totalSleep: 7.4, deep: 0.8, rem: 1.7, core: 4.9, awake: 0.2, inBed: 7.9, source: 'Watch',
    }],
  },
];

function notes() {
  const today = '2026-11-08';
  const made = [
    ...buildCommit({ body: { data: { workouts } }, tree: [], blobs: {}, ledger: {}, today }).files,
    ...buildCommit({ body: { data: { metrics } }, tree: [], blobs: {}, ledger: {}, today }).files,
  ];
  const path = 'days/2026/2026-11-05.md';
  const merged = buildCommit({
    body: { data: { metrics } },
    tree: [{ path, type: 'blob', sha: 'x' }],
    blobs: { [path]: dayNote('2026-11-05', { steps: 100 }).text.replace('schema: 1', 'schema: 1\nshoes: Pegasus') },
    ledger: {},
    today,
  }).files;
  return [...made, ...merged.map((f) => ({ ...f, path: `${f.path} (merged)` }))];
}

test('generated notes pass the vault validator', { skip: !haveVault && 'vault not cloned' }, async () => {
  const { parseNote, validateNote } = await import(pathToFileURL(path.join(VAULT, 'scripts/validate.mjs')).href);
  const schema = JSON.parse(fs.readFileSync(path.join(VAULT, 'schema/v1.json'), 'utf8'));
  const all = notes();
  assert.equal(all.length, 5);
  for (const note of all) {
    const { data } = parseNote(note.content);
    assert.deepEqual(validateNote(data, schema), [], note.path);
    const allowed = new Set([...Object.keys(schema.core), ...Object.keys(schema.types[data.type].fields), 'shoes']);
    for (const key of Object.keys(data)) assert.ok(allowed.has(key), `${note.path}: ${key} isn't in the schema`);
  }
});

test('every schema field for workouts and days is written by some note', { skip: !haveVault && 'vault not cloned' }, () => {
  const schema = JSON.parse(fs.readFileSync(path.join(VAULT, 'schema/v1.json'), 'utf8'));
  const text = notes().map((n) => n.content).join('\n');
  for (const type of ['workout', 'day']) {
    for (const key of Object.keys(schema.types[type].fields)) {
      assert.match(text, new RegExp(`^${key}:`, 'm'), `${type}.${key} is never written`);
    }
  }
});

// Health vault helpers: Health Auto Export payloads in, vault notes out.
//
// Shared by the n8n Code nodes (the n8n role pastes this file into them
// verbatim) and the node:test suite in ./test. Keep it dependency-free plain
// JS: Code nodes cannot require modules. The note format is the vault's
// SCHEMA.md (russellyeo/health).
//
// Error messages name fields and units, never values: the error workflow
// emails them.

const SCHEMA_VERSION = 1;

const ACTIVITIES = {
  'Outdoor Run': ['run', 'Run'],
  'Indoor Run': ['run', 'Run'],
  Running: ['run', 'Run'],
  'Outdoor Walk': ['walk', 'Walk'],
  'Indoor Walk': ['walk', 'Walk'],
  Walking: ['walk', 'Walk'],
  'Traditional Strength Training': ['strength', 'Strength'],
  'Functional Strength Training': ['strength', 'Strength'],
};

// [field, Health Auto Export metric, expected units, decimal places].
// 'kcal' converts from kJ (or keeps kcal) and rounds to whole numbers.
const DAY_METRICS = [
  ['resting_hr', 'resting_heart_rate', 'count/min', 0],
  ['hrv_ms', 'heart_rate_variability', 'ms', 1],
  ['vo2_max', 'vo2_max', 'ml/(kg·min)', 1],
  ['steps', 'step_count', 'count', 0],
  ['walk_run_distance_km', 'walking_running_distance', 'km', 2],
  ['active_energy_kcal', 'active_energy', 'kcal', 0],
  ['exercise_min', 'apple_exercise_time', 'min', 1],
  ['respiratory_rate', 'respiratory_rate', 'count/min', 1],
  ['blood_oxygen_pct', 'blood_oxygen_saturation', '%', 1],
  ['daylight_min', 'time_in_daylight', 'min', 1],
  ['walking_hr_avg', 'walking_heart_rate_average', 'count/min', 0],
  ['weight_kg', 'weight_body_mass', 'kg', 1],
];

// [field, sleep_analysis key], all hours to 2 dp.
const SLEEP_HOURS = [
  ['sleep_total_h', 'totalSleep'],
  ['sleep_deep_h', 'deep'],
  ['sleep_rem_h', 'rem'],
  ['sleep_core_h', 'core'],
  ['sleep_awake_h', 'awake'],
  ['in_bed_h', 'inBed'],
];

const DAY_FIELDS = ['sleep_start', 'sleep_end', ...SLEEP_HOURS.map(([f]) => f), ...DAY_METRICS.map(([f]) => f)];

const HAE_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{2})(\d{2})$/;

function isoTimestamp(ts) {
  const m = String(ts).match(HAE_TIMESTAMP);
  if (!m) throw new Error('not a Health Auto Export timestamp');
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[5]}:${m[6]}`;
}

// The local date and HHMM of a Health Auto Export timestamp: it leads with
// local time, so no offset maths is needed.
function localParts(ts) {
  const m = String(ts).match(HAE_TIMESTAMP);
  if (!m) throw new Error('not a Health Auto Export timestamp');
  return { date: m[1], hhmm: `${m[2]}${m[3]}` };
}

// A quantity worth writing: 0 means "no data" and is never written.
function present(quantity) {
  return Boolean(quantity) && typeof quantity.qty === 'number' && quantity.qty > 0;
}

function round(value, dp) {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

function checkUnits(field, quantity, expected) {
  if (quantity.units !== expected) throw new Error(`${field}: expected ${expected}, got ${quantity.units}`);
}

function toKcal(field, quantity) {
  if (quantity.units === 'kJ') return Math.round(quantity.qty / 4.184);
  if (quantity.units === 'kcal') return Math.round(quantity.qty);
  throw new Error(`${field}: expected kJ or kcal, got ${quantity.units}`);
}

function renderNote(fields, body) {
  const lines = Object.entries(fields).map(([k, v]) => (v === null || v === undefined ? `${k}:` : `${k}: ${String(v)}`));
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`;
}

function activityFor(name) {
  if (ACTIVITIES[name]) return ACTIVITIES[name];
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [slug, String(name).replace(/[/\\:*?"<>|]/g, '')];
}

function workoutNote(w) {
  const [activity, label] = activityFor(w.name);
  const { date, hhmm } = localParts(w.start);
  const fields = { type: 'workout', date, source: 'apple-health', schema: SCHEMA_VERSION, source_id: w.id, activity };
  if (w.source && w.source.name) fields.recorded_by = w.source.name;
  fields.start = isoTimestamp(w.start);
  if (w.end) fields.end = isoTimestamp(w.end);
  fields.duration_min = round(w.duration / 60, 1);
  if (present(w.distance)) {
    checkUnits('distance_km', w.distance, 'km');
    fields.distance_km = round(w.distance.qty, 2);
  }
  if (present(w.elevationUp)) {
    checkUnits('elevation_m', w.elevationUp, 'm');
    fields.elevation_m = Math.round(w.elevationUp.qty);
  }
  if (present(w.avgHeartRate)) fields.avg_hr = Math.round(w.avgHeartRate.qty);
  if (present(w.maxHeartRate)) fields.max_hr = Math.round(w.maxHeartRate.qty);
  if (present(w.activeEnergyBurned)) fields.energy_kcal = toKcal('energy_kcal', w.activeEnergyBurned);
  if (typeof w.isIndoor === 'boolean') fields.indoor = w.isIndoor;
  fields.effort = null;

  const summary = [label];
  if ('distance_km' in fields) summary.push(`${fields.distance_km} km`);
  summary.push(`${fields.duration_min} min`);
  if ('avg_hr' in fields) summary.push(`avg ${fields.avg_hr} bpm`);

  return {
    id: w.id,
    date,
    path: `workouts/${date.slice(0, 4)}/${date} ${hhmm} ${label}.md`,
    text: renderNote(fields, `${summary.join(' · ')}\n\n## Notes`),
  };
}

function metricsByName(metrics) {
  return Object.fromEntries((metrics || []).map((m) => [m.name, m]));
}

// Sleep belongs to the local date of waking up.
function sleepFor(metrics, date) {
  const sleep = metricsByName(metrics).sleep_analysis;
  return ((sleep && sleep.data) || []).find((s) => s.sleepEnd && localParts(s.sleepEnd).date === date);
}

function dayValues(metrics, date) {
  const byName = metricsByName(metrics);
  const values = {};
  const s = sleepFor(metrics, date);
  if (s) {
    values.sleep_start = isoTimestamp(s.sleepStart);
    values.sleep_end = isoTimestamp(s.sleepEnd);
    for (const [field, key] of SLEEP_HOURS) {
      // 0 means "no data" (e.g. no in-bed time without a sleep schedule).
      if (typeof s[key] === 'number' && s[key] > 0) values[field] = round(s[key], 2);
    }
  }
  for (const [field, name, units, dp] of DAY_METRICS) {
    const m = byName[name];
    const entry = m && (m.data || []).find((e) => String(e.date).slice(0, 10) === date);
    if (!present(entry)) continue;
    if (units === 'kcal') {
      values[field] = toKcal(field, { qty: entry.qty, units: m.units });
    } else {
      checkUnits(field, m, units);
      values[field] = round(entry.qty, dp);
    }
  }
  return Object.fromEntries(DAY_FIELDS.filter((f) => f in values).map((f) => [f, values[f]]));
}

function metricDates(metrics, today) {
  const dates = new Set();
  for (const m of metrics || []) {
    for (const e of m.data || []) {
      if (m.name === 'sleep_analysis') {
        if (e.sleepEnd) dates.add(localParts(e.sleepEnd).date);
      } else if (e.date) {
        dates.add(String(e.date).slice(0, 10));
      }
    }
  }
  return [...dates].filter((d) => d < today && Object.keys(dayValues(metrics, d)).length > 0).sort();
}

function dayNote(date, values) {
  const fields = { type: 'day', date, source: 'apple-health', schema: SCHEMA_VERSION, ...values };
  return { path: `days/${date.slice(0, 4)}/${date}.md`, text: renderNote(fields, '## Notes') };
}

// Merges owned values into an existing day note's frontmatter. Every other
// line, and the body, stays byte for byte. Returns null when nothing changes
// or the note isn't the sync's (source: apple-health).
function mergeDay(text, values) {
  const match = text.match(/^---\n([\s\S]*?)\n---(\n[\s\S]*)?$/);
  if (!match) return null;
  const lines = match[1].split('\n');
  const keyOf = (line) => (line.match(/^([^\s:][^:]*):/) || [])[1];
  const sourceLine = lines.find((l) => keyOf(l) === 'source');
  if (!sourceLine || sourceLine.replace(/^source:\s*/, '').trim() !== 'apple-health') return null;

  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    if (!DAY_FIELDS.includes(key) || value === null || value === undefined) continue;
    const line = `${key}: ${String(value)}`;
    const i = lines.findIndex((l) => keyOf(l) === key);
    if (i === -1) {
      lines.push(line);
      changed = true;
    } else if (lines[i] !== line) {
      lines[i] = line;
      changed = true;
    }
  }
  return changed ? `---\n${lines.join('\n')}\n---${match[2] || ''}` : null;
}

// ---- Payloads, the raw archive and commits ----

// Day notes can take late values for this many days after their date.
const MERGE_DAYS = 7;

function payloadKind(body) {
  const data = body && body.data;
  if (data && Array.isArray(data.workouts)) return 'workouts';
  if (data && Array.isArray(data.metrics)) return 'metrics';
  throw new Error('payload has neither data.metrics nor data.workouts');
}

// Files for the NAS archive, relative to the health-raw directory. Each
// workout is one file named by its ID, so the 7-day lookback rewrites the
// same file instead of piling up copies of its route.
function archiveFiles(body, stamp, receivedIso) {
  const kind = payloadKind(body);
  const files = [];
  if (kind === 'workouts') {
    for (const w of body.data.workouts) {
      if (!/^[A-Za-z0-9-]+$/.test(String(w.id))) throw new Error('workout id is not a plain ID');
      files.push({ path: `workouts/${w.id}.json`, content: JSON.stringify(w) });
    }
  } else {
    files.push({ path: `metrics/${stamp}.json`, content: JSON.stringify(body) });
  }
  files.push({ path: 'last-payload.json', content: JSON.stringify({ received: receivedIso, kind }) });
  return files;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "workouts/.../X.md", then "X 2.md", "X 3.md", ...
function suffixed(path, n) {
  return n === 1 ? path : path.replace(/\.md$/, ` ${n}.md`);
}

function treeBlobs(tree) {
  return new Map((tree || []).filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));
}

function newWorkouts(body, ledger) {
  const known = (ledger && ledger.workouts) || {};
  return body.data.workouts.filter((w) => !(w.id in known));
}

function recentDayPaths(body, today) {
  return metricDates(body.data.metrics, today)
    .filter((date) => date >= addDays(today, -MERGE_DAYS))
    .map((date) => dayNote(date, {}).path);
}

// The existing notes buildCommit needs to read: notes at (or suffixed from)
// the path of each workout not in the ledger, and day notes young enough to
// take late values.
function planReads({ body, tree, ledger, today }) {
  const blobs = treeBlobs(tree);
  const reads = new Map();
  if (payloadKind(body) === 'workouts') {
    for (const w of newWorkouts(body, ledger)) {
      const base = workoutNote(w).path;
      for (let n = 1; blobs.has(suffixed(base, n)); n++) reads.set(suffixed(base, n), blobs.get(suffixed(base, n)));
    }
  } else {
    for (const path of recentDayPaths(body, today)) if (blobs.has(path)) reads.set(path, blobs.get(path));
  }
  return [...reads].map(([path, sha]) => ({ path, sha }));
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// The files to commit and the ledger to save afterwards (null for a metrics
// payload, which mustn't write a ledger it may have read before a workouts
// run updated it). `blobs` holds the text of the paths planReads asked for.
function buildCommit({ body, tree, blobs, ledger, today }) {
  const existing = treeBlobs(tree);
  const nextLedger = { workouts: { ...((ledger && ledger.workouts) || {}) } };
  const files = [];
  let workouts = 0;
  let days = 0;
  const read = (path) => {
    if (!(path in blobs)) throw new Error(`${path}: exists in the repo but wasn't read`);
    return blobs[path];
  };

  if (payloadKind(body) === 'workouts') {
    const taken = new Set();
    for (const w of newWorkouts(body, nextLedger)) {
      const note = workoutNote(w);
      for (let n = 1; ; n++) {
        const path = suffixed(note.path, n);
        if (taken.has(path)) continue;
        if (existing.has(path)) {
          if (read(path).split('\n').includes(`source_id: ${w.id}`)) {
            nextLedger.workouts[w.id] = path;
            break;
          }
          continue;
        }
        taken.add(path);
        files.push({ path, content: note.text });
        nextLedger.workouts[w.id] = path;
        workouts++;
        break;
      }
    }
  } else {
    const metrics = body.data.metrics;
    const mergeFrom = addDays(today, -MERGE_DAYS);
    for (const date of metricDates(metrics, today)) {
      const values = dayValues(metrics, date);
      const note = dayNote(date, values);
      let content = null;
      if (!existing.has(note.path)) content = note.text;
      else if (date >= mergeFrom) content = mergeDay(read(note.path), values);
      if (content === null) continue;
      files.push({ path: note.path, content });
      days++;
    }
  }
  const isWorkouts = payloadKind(body) === 'workouts';
  return { files, ledger: isWorkouts ? nextLedger : null, message: `Health Auto Export: ${plural(workouts, 'workout')}, ${plural(days, 'day')}` };
}

function daysSince(iso, nowIso) {
  return Math.floor((Date.parse(nowIso) - Date.parse(iso)) / 86400000);
}

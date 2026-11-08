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
  if (w.distance) {
    checkUnits('distance_km', w.distance, 'km');
    fields.distance_km = round(w.distance.qty, 2);
  }
  if (w.elevationUp) {
    checkUnits('elevation_m', w.elevationUp, 'm');
    fields.elevation_m = Math.round(w.elevationUp.qty);
  }
  if (w.avgHeartRate) fields.avg_hr = Math.round(w.avgHeartRate.qty);
  if (w.maxHeartRate) fields.max_hr = Math.round(w.maxHeartRate.qty);
  if (w.activeEnergyBurned) fields.energy_kcal = toKcal('energy_kcal', w.activeEnergyBurned);
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
    if (!entry || typeof entry.qty !== 'number') continue;
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

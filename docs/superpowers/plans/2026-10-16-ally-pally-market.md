# Ally Pally Farmers' Market Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a dedicated Google Calendar in sync with the CCFM Alexandra Palace market schedule, and email a reminder every Saturday at 18:00 saying where Sunday's market is.

**Architecture:** A dependency-free JS library (`ccfm.js`) holds all of the logic: parsing, sync planning and email text. It is unit-tested locally with `node:test`, and Ansible copies it verbatim into the n8n Code nodes of three workflow templates. Ansible renders those templates and imports them into n8n. n8n gets an HTTPS address from a Tailscale sidecar so that Google sign-in works. A new changedetection.io role watches the page and calls the sync webhook.

**Tech Stack:** Ansible (`community.docker`), n8n 2.43.x, Node 22 (`node:test`, local only), Google Calendar REST API v3, Gmail node, Tailscale container (`tailscale serve`), changedetection.io.

**Spec:** `docs/superpowers/specs/2026-10-16-ally-pally-market-design.md`

## Global Constraints

- Never edit `vars/vault.yml`. Ask the repo owner to add vault values by hand (CLAUDE.md rule).
- Never stage `roles/docker-daemon/*`. Those are separate uncommitted changes in progress.
- Timezone everywhere: `Europe/London`.
- Event times: 10:00–15:00 wall-clock. Title `Farmers' Market – <location name>`.
- Safety cap: at most 2 deletions per sync run (`MAX_REMOVALS = 2`).
- Sync trigger webhook path: `ccfm-sync`. Backstop schedule: cron `0 7 * * 1`. Reminder: cron `0 18 * * 6`.
- Workflow IDs (fixed): `ccfmError0000001`, `ccfmSync00000001`, `ccfmRemind000001`.
- `ccfm.js` must stay plain, dependency-free JS with top-level function and class declarations, because it is pasted into Code nodes. It may not use `require`.
- Workflow templates use `[[ ]]` as Jinja delimiters (`variable_start_string`) so n8n's `{{ }}` expressions survive.
- Role conventions: tasks carry tags `<role>` + `container`/`config`; data under `{{ config_directory }}/<name>` owned by `servarr`; containers on `{{ docker_network }}` with Traefik and Homepage labels.

## Review Focus

1. **Spelling variants on the page** (`1st`, `8 NOVEMBER`, `15th Nov.`, lower case). The parser must accept them. Pinned in Task 1 ("accepts ordinal and month spelling variants").
2. **A partial page or a missing location block.** It must throw instead of returning the dates from one location only, because the shorter list would delete the other location's events. Pinned in Task 1 ("fails when a location heading is missing").
3. **A sync or reminder run on a Sunday.** Today's event must count as current: it must not be deleted, and the reminder must target today. Pinned in Task 2 ("treats today as upcoming") and Task 3 (`nextSunday` on a Sunday).
4. **Events in the calendar that the sync didn't create.** They must never be touched. Pinned in Task 2 ("ignores past events and events it did not create").
5. **Clock changes and the turn of the year.** The event must stay 10:00 local time on the day the clocks change (25 Oct 2026), and a December run must parse `3RD JAN 2027`. Pinned in Task 2 (event body) and Task 1 (variants test with a 2027 date).

---

### Task 1: Schedule parser

**Files:**
- Create: `roles/n8n/files/ccfm/ccfm.js`
- Create: `roles/n8n/files/ccfm/test/parse.test.js`
- Existing fixture: `roles/n8n/files/ccfm/test/fixtures/alexandra-palace-2026-10-16.html` (a copy of the live page saved on 2026-10-16: 9 Park dates and 7 Campsbourne dates, 6 Sep to 20 Dec 2026)

**Interfaces:**
- Produces: `parseSchedule(html: string, today: 'YYYY-MM-DD') → Array<{date: 'YYYY-MM-DD', location: 'park'|'campsbourne'}>`, sorted by date. It throws `ScheduleError` with a message that lists every problem followed by the page text.
- Produces: `LOCATIONS[key] = {heading, name, address}`, `CCFM_URL`, `MAX_REMOVALS`, plus the helpers `addDays(iso, n)`, `dayOfWeek(iso)` and `formatDay(iso)` (e.g. `'Sunday 18 October'`), which Tasks 2 and 3 use.

- [ ] **Step 1: Write the failing tests**

`roles/n8n/files/ccfm/test/parse.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test 'roles/n8n/files/ccfm/test/*.test.js'`
Expected: FAIL with `Cannot find module '../ccfm.js'`.

- [ ] **Step 3: Write the implementation**

`roles/n8n/files/ccfm/ccfm.js`:

```js
// Ally Pally farmers' market helpers.
//
// Shared by the n8n Code nodes (the n8n role pastes this file into them
// verbatim) and the node:test suite in ./test. Keep it dependency-free plain
// JS: Code nodes cannot require modules.

const CCFM_URL = 'https://www.weareccfm.com/our-markets/alexandra-palace/';

const LOCATIONS = {
  park: {
    heading: 'ALEXANDRA PALACE PARK LOCATION',
    name: 'Alexandra Palace Park',
    address: 'Muswell Hill (bottom) entrance, N10 3TG',
  },
  campsbourne: {
    heading: 'CAMPSBOURNE SCHOOL LOCATION',
    name: 'Campsbourne School',
    address: 'Nightingale Lane, N8 7AF',
  },
};

// More vanished dates than this in one sync looks like a page or parser
// problem rather than real cancellations, so nothing gets deleted.
const MAX_REMOVALS = 2;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "6TH SEPT 2026", "1st Nov. 2026", "8 NOVEMBER 2026"
const DATE_RE = /\b(\d{1,2})(?:ST|ND|RD|TH)?\s+([A-Z]+)\.?,?\s+(\d{4})\b/gi;

class ScheduleError extends Error {}

function toIso(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIso(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(iso, days) {
  const date = parseIso(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(iso) {
  return parseIso(iso).getUTCDay();
}

function formatDay(iso) {
  const date = parseIso(iso);
  return `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, "'")
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// Returns [{date, location}] sorted by date, or throws ScheduleError listing
// every problem. All-or-nothing: a partial result would make the sync
// delete the events of whichever location failed to parse.
function parseSchedule(html, today) {
  const text = htmlToText(html).toUpperCase();
  const errors = [];

  const headings = Object.entries(LOCATIONS).map(([key, loc]) => ({ key, at: text.indexOf(loc.heading) }));
  for (const h of headings) {
    if (h.at < 0) errors.push(`heading not found: ${LOCATIONS[h.key].heading}`);
  }
  const found = headings.filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);

  const thisYear = Number(today.slice(0, 4));
  const seen = new Map();
  const markets = [];

  found.forEach((h, i) => {
    const section = text.slice(h.at, i + 1 < found.length ? found[i + 1].at : undefined);
    for (const [raw, dayText, monthText, yearText] of section.matchAll(DATE_RE)) {
      const month = MONTHS.indexOf(monthText.slice(0, 3)) + 1;
      if (month === 0) {
        errors.push(`unknown month in "${raw}"`);
        continue;
      }
      const year = Number(yearText);
      const day = Number(dayText);
      const iso = toIso(year, month, day);
      if (parseIso(iso).getUTCDate() !== day) {
        errors.push(`invalid date "${raw}"`);
        continue;
      }
      if (year < thisYear - 1 || year > thisYear + 2) {
        errors.push(`implausible year in "${raw}"`);
        continue;
      }
      if (dayOfWeek(iso) !== 0) {
        errors.push(`not a Sunday: "${raw}" (${iso})`);
        continue;
      }
      const previous = seen.get(iso);
      if (previous && previous !== h.key) {
        errors.push(`${iso} listed at both locations`);
        continue;
      }
      if (!previous) {
        seen.set(iso, h.key);
        markets.push({ date: iso, location: h.key });
      }
    }
  });

  if (!errors.length && !markets.length) errors.push('no dates found');
  if (errors.length) {
    const from = found.length ? found[0].at : 0;
    throw new ScheduleError(
      `Could not parse ${CCFM_URL}:\n- ${errors.join('\n- ')}\n\nPage text:\n${text.slice(from, from + 3000)}`,
    );
  }
  return markets.sort((a, b) => a.date.localeCompare(b.date));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CCFM_URL,
    LOCATIONS,
    MAX_REMOVALS,
    ScheduleError,
    addDays,
    dayOfWeek,
    formatDay,
    htmlToText,
    parseSchedule,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test 'roles/n8n/files/ccfm/test/*.test.js'`
Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git switch -c ally-pally-market
git add roles/n8n/files/ccfm docs/superpowers
git commit -m "Add CCFM schedule parser for the Ally Pally market automation"
```

---

### Task 2: Sync planner and change email

**Files:**
- Modify: `roles/n8n/files/ccfm/ccfm.js` (add functions above the `module.exports` block and extend it)
- Create: `roles/n8n/files/ccfm/test/sync.test.js`

**Interfaces:**
- Consumes: `LOCATIONS`, `CCFM_URL`, `MAX_REMOVALS` and `formatDay` from Task 1.
- Produces:
  - `planSync({markets, events, today, maxRemovals = MAX_REMOVALS}) → {create: Market[], update: [{eventId, market}], moved: [{date, from, to}], remove: [{eventId, date, location}], removed: [{eventId, date, location}], capTripped: boolean}`. Here `events` are Google Calendar event resources, `remove` is what to delete, and `removed` is what disappeared from the site (used for the email).
  - `eventMarket(event) → {date, location} | null`.
  - `eventBody(market) → Google Calendar event resource`.
  - `calendarOps(plan) → [{method: 'POST'|'PUT'|'DELETE', path: string, body: object|null}]`, where `path` is relative to `/calendars/<id>`.
  - `buildChangeEmail(plan) → {subject, text} | null`.
  - `mapsUrl(address)` and `locName(key)`.

- [ ] **Step 1: Write the failing tests**

`roles/n8n/files/ccfm/test/sync.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test 'roles/n8n/files/ccfm/test/*.test.js'`
Expected: parse tests PASS. Sync tests FAIL with `planSync is not a function`.

- [ ] **Step 3: Write the implementation**

Insert into `roles/n8n/files/ccfm/ccfm.js` directly above the `if (typeof module ...` block:

```js
function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function locName(key) {
  return (LOCATIONS[key] || { name: key }).name;
}

// Which market a calendar event represents, or null for events the sync
// did not create.
function eventMarket(event) {
  const props = (event.extendedProperties && event.extendedProperties.private) || {};
  return props.ccfmDate ? { date: props.ccfmDate, location: props.ccfmLocation } : null;
}

function eventBody({ date, location }) {
  const loc = LOCATIONS[location];
  return {
    summary: `Farmers' Market – ${loc.name}`,
    location: `${loc.name}, ${loc.address}`,
    description: [
      `Alexandra Palace Farmers' Market, 10:00–15:00 at ${loc.name}.`,
      `Map: ${mapsUrl(`${loc.name}, ${loc.address}`)}`,
      `Schedule: ${CCFM_URL}`,
      '',
      'Managed by the n8n ccfm-sync workflow; manual edits are overwritten.',
    ].join('\n'),
    start: { dateTime: `${date}T10:00:00`, timeZone: 'Europe/London' },
    end: { dateTime: `${date}T15:00:00`, timeZone: 'Europe/London' },
    extendedProperties: { private: { ccfmDate: date, ccfmLocation: location } },
  };
}

// Diff the parsed schedule against the calendar. Only events the sync
// created (see eventMarket) dated today or later are ever touched.
function planSync({ markets, events, today, maxRemovals = MAX_REMOVALS }) {
  const wanted = new Map(markets.filter((m) => m.date >= today).map((m) => [m.date, m]));
  const update = [];
  const moved = [];
  const removed = [];
  const duplicates = [];
  const seen = new Set();

  for (const event of events) {
    const current = eventMarket(event);
    if (!current || current.date < today) continue;
    if (seen.has(current.date)) {
      duplicates.push({ eventId: event.id, ...current });
      continue;
    }
    seen.add(current.date);
    const market = wanted.get(current.date);
    if (!market) {
      removed.push({ eventId: event.id, ...current });
    } else if (market.location !== current.location) {
      update.push({ eventId: event.id, market });
      moved.push({ date: market.date, from: current.location, to: market.location });
    }
  }

  const create = [...wanted.values()].filter((m) => !seen.has(m.date));
  const capTripped = removed.length > maxRemovals;
  return {
    create,
    update,
    moved,
    remove: capTripped ? duplicates : [...removed, ...duplicates],
    removed,
    capTripped,
  };
}

function calendarOps(plan) {
  return [
    ...plan.create.map((m) => ({ method: 'POST', path: '/events', body: eventBody(m) })),
    ...plan.update.map((u) => ({
      method: 'PUT',
      path: `/events/${encodeURIComponent(u.eventId)}`,
      body: eventBody(u.market),
    })),
    ...plan.remove.map((r) => ({ method: 'DELETE', path: `/events/${encodeURIComponent(r.eventId)}`, body: null })),
  ];
}

// Email only for surprises: a known date moved or vanished. New dates are
// added silently.
function buildChangeEmail(plan) {
  const lines = [];
  for (const m of plan.moved) {
    lines.push(`${formatDay(m.date)}: moved from ${locName(m.from)} to ${locName(m.to)}.`);
  }
  for (const r of plan.removed) {
    const outcome = plan.capTripped ? 'event NOT deleted' : 'event deleted';
    lines.push(`${formatDay(r.date)} (${locName(r.location)}): no longer listed, ${outcome}.`);
  }
  if (!lines.length) return null;

  if (plan.capTripped) {
    lines.push(
      '',
      `More than ${MAX_REMOVALS} dates vanished in one run, which looks like a page or parser problem, so nothing was deleted. Check ${CCFM_URL}`,
    );
  } else {
    lines.push('', `Schedule: ${CCFM_URL}`);
  }
  return {
    subject: plan.capTripped ? 'Ally Pally market: schedule check needed' : 'Ally Pally market: schedule changed',
    text: lines.join('\n'),
  };
}
```

Replace the `module.exports` block with:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CCFM_URL,
    LOCATIONS,
    MAX_REMOVALS,
    ScheduleError,
    addDays,
    buildChangeEmail,
    calendarOps,
    dayOfWeek,
    eventBody,
    eventMarket,
    formatDay,
    htmlToText,
    locName,
    mapsUrl,
    parseSchedule,
    planSync,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test 'roles/n8n/files/ccfm/test/*.test.js'`
Expected: all tests PASS (11 parse + 13 sync).

- [ ] **Step 5: Commit**

```bash
git add roles/n8n/files/ccfm
git commit -m "Add CCFM calendar sync planner with deletion safety cap"
```

---

### Task 3: Weekly reminder builder

**Files:**
- Modify: `roles/n8n/files/ccfm/ccfm.js`
- Create: `roles/n8n/files/ccfm/test/reminder.test.js`

**Interfaces:**
- Consumes: `addDays`, `dayOfWeek`, `formatDay`, `eventMarket`, `mapsUrl`, `locName`, `LOCATIONS` and `CCFM_URL`.
- Produces: `nextSunday(today) → 'YYYY-MM-DD'`, which returns today when today is a Sunday. Also `buildReminder({sunday, events}) → {subject, text}`, where `events` are Google Calendar event resources covering at least `sunday - 7` to `sunday`.

- [ ] **Step 1: Write the failing tests**

`roles/n8n/files/ccfm/test/reminder.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test 'roles/n8n/files/ccfm/test/*.test.js'`
Expected: reminder tests FAIL with `nextSunday is not a function`.

- [ ] **Step 3: Write the implementation**

Insert above the `module.exports` block in `ccfm.js`:

```js
// The coming Sunday, or today if today is Sunday.
function nextSunday(today) {
  return addDays(today, (7 - dayOfWeek(today)) % 7);
}

function buildReminder({ sunday, events }) {
  const locationOn = (date) => {
    const market = events.map(eventMarket).find((m) => m && m.date === date);
    return market ? market.location : null;
  };
  const thisWeek = locationOn(sunday);
  const lastWeek = locationOn(addDays(sunday, -7));
  const when = formatDay(sunday);

  if (!thisWeek) {
    return {
      subject: `Ally Pally market: nothing listed for ${when}`,
      text: `No market is listed at either location for ${when}.\nCheck ${CCFM_URL}`,
    };
  }

  const address = (LOCATIONS[thisWeek] || { address: '' }).address;
  const moved = lastWeek !== null && lastWeek !== thisWeek;
  const lines = [`${when}, 10:00–15:00`, locName(thisWeek), address, `Map: ${mapsUrl(`${locName(thisWeek)}, ${address}`)}`];
  if (moved) lines.push('', `Note: last week it was at ${locName(lastWeek)}.`);
  lines.push('', `Schedule: ${CCFM_URL}`);

  return {
    subject: `${moved ? '📍 Moved! ' : ''}Ally Pally market ${when}: ${locName(thisWeek)}`,
    text: lines.join('\n'),
  };
}
```

Add `buildReminder` and `nextSunday` to the `module.exports` object, keeping it alphabetical.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test 'roles/n8n/files/ccfm/test/*.test.js'`
Expected: all tests PASS (11 + 13 + 7).

- [ ] **Step 5: Commit**

```bash
git add roles/n8n/files/ccfm
git commit -m "Add CCFM weekly reminder builder"
```

---

### Task 4: HTTPS for n8n through a Tailscale sidecar

**Files:**
- Create: `roles/n8n/files/tailscale-serve.json`
- Create: `roles/n8n/tasks/tailscale.yml`
- Modify: `roles/n8n/tasks/main.yml`, `roles/n8n/tasks/file.yml`, `roles/n8n/tasks/container.yml`, `roles/n8n/defaults/main.yml`, `vars/main.yml`
- Also commits the n8n role created earlier in this session (`roles/n8n/*`, `playbook.yml`), which is still uncommitted.

**Interfaces:**
- Consumes: `tailnet_host` (vault-backed, e.g. `tailXXXX.ts.net`) and `tailscale_authkey` (new; vault-backed).
- Produces: `n8n_tailnet_url` = `https://n8n.{{ tailnet_host }}`, which Task 5 uses for the OAuth redirect URI.

- [ ] **Step 1: Tailnet prerequisites (manual, ask the repo owner)**

In the Tailscale admin console:
1. DNS → make sure **MagicDNS** and **HTTPS Certificates** are enabled.
2. Settings → Keys → **Generate auth key**: reusable off, ephemeral off, pre-approved on.
3. **STOP: ask the repo owner to add the key to `vars/vault.yml`** as `vault_tailscale_authkey: "tskey-auth-..."`. Do not edit the vault yourself.

Separately, the NAS's own Tailscale package is logged out. That doesn't affect this task, which uses its own container.

- [ ] **Step 2: Add the variables**

`vars/main.yml`, in the `# Vault` block after `jellyfin_api_key`:

```yaml
tailscale_authkey: "{{ vault_tailscale_authkey }}"
```

`roles/n8n/defaults/main.yml`:

```yaml
---
host_port: '5678'

# Reached over the tailnet with a real HTTPS cert; Google OAuth needs this
# for its callback (it rejects http://n8n.home.arpa).
n8n_tailnet_url: "https://n8n.{{ tailnet_host }}"
```

- [ ] **Step 3: Add the serve config**

`roles/n8n/files/tailscale-serve.json` (`${TS_CERT_DOMAIN}` is substituted by the Tailscale container at startup, not by Ansible):

```json
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": { "/": { "Proxy": "http://n8n:5678" } }
    }
  }
}
```

- [ ] **Step 4: Add directories and the sidecar**

Append to `roles/n8n/tasks/file.yml`:

```yaml
- name: Ensure Tailscale directories are present
  tags:
    - n8n
    - file
    - config
  file:
    path: '{{ config_directory }}/n8n-tailscale/{{ item }}'
    state: directory
    owner: servarr
    group: servarr
    mode: '{{ directory_mode }}'
  loop:
    - ''
    - state

- name: Create Tailscale serve config
  tags:
    - n8n
    - config
  copy:
    src: tailscale-serve.json
    dest: '{{ config_directory }}/n8n-tailscale/serve.json'
    owner: servarr
    group: servarr
    mode: '{{ file_mode }}'
```

`roles/n8n/tasks/tailscale.yml`:

```yaml
# Gives n8n its own tailnet machine with an HTTPS cert, proxying to the n8n
# container over the bridge network.
# https://tailscale.com/kb/1282/docker
---
- name: Start Tailscale sidecar container
  tags:
    - n8n
    - container
  docker_container:
    name: n8n-tailscale
    image: tailscale/tailscale:latest
    state: "{{ docker_state }}"
    restart: "{{ docker_restart }}"
    restart_policy: "{{ docker_restart_policy }}"
    recreate: "{{ docker_recreate }}"
    hostname: n8n
    volumes:
      - "{{ config_directory }}/n8n-tailscale/state:/var/lib/tailscale"
      - "{{ config_directory }}/n8n-tailscale/serve.json:/config/serve.json:ro"
    networks:
      - name: "{{ docker_network }}"
    dns_servers:
      - "{{ dns_primary }}"
      - "{{ dns_secondary }}"
    env:
      TS_AUTHKEY: "{{ tailscale_authkey }}"
      TS_HOSTNAME: "n8n"
      TS_STATE_DIR: "/var/lib/tailscale"
      TS_SERVE_CONFIG: "/config/serve.json"
      TS_USERSPACE: "true"
      TS_AUTH_ONCE: "true"
    labels:
      traefik.enable: "false"
```

`roles/n8n/tasks/main.yml`, import it after `container.yml`:

```yaml
- import_tasks: file.yml
- import_tasks: container.yml
- import_tasks: tailscale.yml
```

- [ ] **Step 5: Point n8n at its HTTPS URL**

In `roles/n8n/tasks/container.yml` `env:`, after `N8N_PROTOCOL`:

```yaml
      # Base for OAuth callbacks and links in emails. The LAN URL keeps working.
      N8N_EDITOR_BASE_URL: "{{ n8n_tailnet_url }}/"
      # Requests arrive through Traefik or tailscale serve.
      N8N_PROXY_HOPS: "1"
```

- [ ] **Step 6: Deploy**

Run: `ansible-playbook playbook.yml --tags n8n < /dev/null`
Expected: `failed=0`, with the sidecar container created and n8n recreated.

- [ ] **Step 7: Verify HTTPS and create the n8n owner account**

From a machine on the tailnet:

Run: `curl -s -w ' %{http_code}\n' https://n8n.<tailnet>.ts.net/healthz`
Expected: `{"status":"ok"} 200`. The first request can take around 10 seconds while the certificate is issued.

Run: `curl -s -w ' %{http_code}\n' http://n8n.home.arpa/healthz`
Expected: `{"status":"ok"} 200`.

Then open `https://n8n.<tailnet>.ts.net` and create the owner account. Task 6's import needs an owner.

If the HTTPS check fails, look at the sidecar's logs:
`ansible synology -b -m shell -a "/usr/local/bin/docker logs --tail 30 n8n-tailscale" < /dev/null`

- [ ] **Step 8: Commit**

```bash
git add playbook.yml vars/main.yml roles/n8n/defaults roles/n8n/tasks roles/n8n/files/tailscale-serve.json
git commit -m "Add n8n with HTTPS over a Tailscale sidecar"
```

---

### Task 5: Google sign-in, credentials and the dedicated calendar (manual, done with the repo owner)

**Files:**
- Modify: `group_vars/synology.yml`
- Modify: `vars/main.yml`
- Modify: `roles/n8n/defaults/main.yml`

**Interfaces:**
- Produces: `n8n_google_calendar_credential_id`, `n8n_gmail_credential_id` (in group_vars), `ccfm_calendar_id` and `ccfm_email_to` (vault-backed), all consumed by Task 6.

- [ ] **Step 1: Google Cloud project**

1. https://console.cloud.google.com → create a project called `n8n-northview`.
2. APIs & Services → enable **Google Calendar API** and **Gmail API**.
3. Google Auth Platform → Branding: set the app name `n8n northview` and your email address.
4. Audience: choose External, add yourself as a test user, then **Publish app → In production**. While an app is in "Testing", Google expires its refresh tokens after 7 days, which would break the sync weekly. Leaving the app unverified is fine. You'll get an "unverified app" warning once at consent; click Advanced → continue.

- [ ] **Step 2: Check the redirect URL early (this is the riskiest step)**

In n8n, go to Credentials → Add → **Google Calendar OAuth2 API**. Copy the **OAuth Redirect URL** shown. It must read `https://n8n.<tailnet>.ts.net/rest/oauth2-credential/callback`. If it shows `n8n.home.arpa`, `N8N_EDITOR_BASE_URL` didn't apply; fix Task 4 before continuing.

In Google Cloud: Clients → **Create client** → Web application → paste that URL as an authorized redirect URI.

**Fallback if Google rejects the `ts.net` URI:** temporarily deploy with `-e n8n_tailnet_url=http://localhost:5678`, use the redirect URI `http://localhost:5678/rest/oauth2-credential/callback`, connect with `ssh -L 5678:localhost:5678 <nas>`, finish Steps 3–4 at `http://localhost:5678`, and then redeploy normally. The refresh tokens keep working afterwards. Record which path was used in the role README (Task 7).

- [ ] **Step 3: Create both n8n credentials**

1. Paste the client ID and secret into the Google Calendar OAuth2 API credential, name it `Google Calendar`, then **Sign in with Google**.
2. Add a **Gmail OAuth2 API** credential with the same client ID and secret, name it `Gmail`, then sign in.
3. Copy each credential's ID from the browser URL (`/home/credentials/<id>`).

- [ ] **Step 4: Create the calendar**

Google Calendar → Settings → Add calendar → Create new calendar → name it `Ally Pally Market`. Then go to Settings for that calendar → Integrate calendar and copy its **Calendar ID** (`...@group.calendar.google.com`).

- [ ] **Step 5: Record the values**

**STOP: ask the repo owner to add the following to `vars/vault.yml`:**

```yaml
vault_ccfm_calendar_id: "<calendar id>@group.calendar.google.com"
vault_ccfm_email_to: "<address that receives reminders>"
```

`vars/main.yml`, in the `# Vault` block:

```yaml
ccfm_calendar_id: "{{ vault_ccfm_calendar_id }}"
ccfm_email_to: "{{ vault_ccfm_email_to }}"
```

`roles/n8n/defaults/main.yml`, appended:

```yaml
# n8n credential IDs (from /home/credentials/<id>), created by hand in the UI.
# Workflow import is skipped until both are set in group_vars.
n8n_google_calendar_credential_id: ""
n8n_gmail_credential_id: ""
```

`group_vars/synology.yml`, appended:

```yaml

# n8n
n8n_google_calendar_credential_id: "<id from step 3>"
n8n_gmail_credential_id: "<id from step 3>"
```

- [ ] **Step 6: Commit**

```bash
git add vars/main.yml group_vars/synology.yml roles/n8n/defaults/main.yml
git commit -m "Wire Google credential and calendar IDs for the n8n CCFM workflows"
```

---

### Task 6: Workflows imported by Ansible

**Files:**
- Create: `roles/n8n/files/ccfm/nodes/plan.js`
- Create: `roles/n8n/files/ccfm/nodes/reminder.js`
- Create: `roles/n8n/templates/workflows/ccfm-error.json.j2`
- Create: `roles/n8n/templates/workflows/ccfm-sync.json.j2`
- Create: `roles/n8n/templates/workflows/ccfm-reminder.json.j2`
- Create: `roles/n8n/tasks/workflows.yml`
- Create: `roles/n8n/handlers/main.yml`
- Modify: `roles/n8n/tasks/main.yml`, `roles/n8n/defaults/main.yml`

**Interfaces:**
- Consumes: everything in `ccfm.js` (Tasks 1–3), plus `ccfm_calendar_id`, `ccfm_email_to` and the two credential IDs (Task 5).
- Produces: workflows `ccfmError0000001`, `ccfmSync00000001` (webhook `POST /webhook/ccfm-sync`) and `ccfmRemind000001`. `ccfm_page_url` is overridable for the failure test.

- [ ] **Step 1: Write the Code node glue**

`roles/n8n/files/ccfm/nodes/plan.js` (appended after `ccfm.js` in the Plan node):

```js
// ---- ccfm-sync "Plan" node ----
const html = $('Fetch page').first().json.data;
const today = $now.setZone('Europe/London').toISODate();
const markets = parseSchedule(html, today); // throws -> error workflow emails
const events = $('List events').first().json.items || [];
const plan = planSync({ markets, events, today });
return [
  {
    json: {
      ops: calendarOps(plan),
      email: buildChangeEmail(plan),
      summary: {
        markets: markets.length,
        create: plan.create.length,
        update: plan.update.length,
        remove: plan.remove.length,
        capTripped: plan.capTripped,
      },
    },
  },
];
```

`roles/n8n/files/ccfm/nodes/reminder.js`:

```js
// ---- ccfm-reminder "Build reminder" node ----
const today = $now.setZone('Europe/London').toISODate();
const events = $('List events').first().json.items || [];
return [{ json: buildReminder({ sunday: nextSunday(today), events }) }];
```

- [ ] **Step 2: Error workflow template**

`roles/n8n/templates/workflows/ccfm-error.json.j2`:

```json
{
  "id": "ccfmError0000001",
  "name": "CCFM: email on failure",
  "active": false,
  "settings": { "executionOrder": "v1" },
  "nodes": [
    {
      "id": "error-trigger",
      "name": "On workflow error",
      "type": "n8n-nodes-base.errorTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "parameters": {}
    },
    {
      "id": "error-email",
      "name": "Email failure",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.1,
      "position": [250, 0],
      "parameters": {
        "sendTo": "[[ ccfm_email_to ]]",
        "subject": "=n8n failed: {{ $json.workflow.name }}",
        "emailType": "text",
        "message": "={{ $json.execution.error.message }}\n\nExecution: {{ $json.execution.url }}",
        "options": { "appendAttribution": false }
      },
      "credentials": { "gmailOAuth2": { "id": "[[ n8n_gmail_credential_id ]]", "name": "Gmail" } }
    }
  ],
  "connections": {
    "On workflow error": { "main": [[{ "node": "Email failure", "type": "main", "index": 0 }]] }
  }
}
```

An error workflow doesn't need to be active to run.

- [ ] **Step 3: Sync workflow template**

`roles/n8n/templates/workflows/ccfm-sync.json.j2`:

```json
{
  "id": "ccfmSync00000001",
  "name": "CCFM: sync Ally Pally market calendar",
  "active": true,
  "settings": { "executionOrder": "v1", "timezone": "Europe/London", "errorWorkflow": "ccfmError0000001" },
  "nodes": [
    {
      "id": "sync-schedule",
      "name": "Every Monday 07:00",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 0],
      "parameters": { "rule": { "interval": [{ "field": "cronExpression", "expression": "0 7 * * 1" }] } }
    },
    {
      "id": "sync-webhook",
      "name": "changedetection.io webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 200],
      "webhookId": "5f0c6a52-1b7e-4c35-9a7e-3d1c2f9b8a01",
      "parameters": { "httpMethod": "POST", "path": "ccfm-sync", "responseMode": "onReceived", "options": {} }
    },
    {
      "id": "sync-fetch",
      "name": "Fetch page",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 100],
      "parameters": {
        "url": "[[ ccfm_page_url ]]",
        "sendHeaders": true,
        "headerParameters": { "parameters": [{ "name": "User-Agent", "value": "Mozilla/5.0 (n8n ccfm-sync)" }] },
        "options": { "response": { "response": { "responseFormat": "text" } } }
      }
    },
    {
      "id": "sync-list",
      "name": "List events",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [500, 100],
      "parameters": {
        "url": "https://www.googleapis.com/calendar/v3/calendars/[[ ccfm_calendar_id | urlencode ]]/events",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "googleCalendarOAuth2Api",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            { "name": "timeMin", "value": "={{ $now.setZone('Europe/London').startOf('day').toISO() }}" },
            { "name": "singleEvents", "value": "true" },
            { "name": "maxResults", "value": "250" }
          ]
        },
        "options": {}
      },
      "credentials": { "googleCalendarOAuth2Api": { "id": "[[ n8n_google_calendar_credential_id ]]", "name": "Google Calendar" } }
    },
    {
      "id": "sync-plan",
      "name": "Plan",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [750, 100],
      "parameters": { "jsCode": [[ (lookup('file', 'ccfm/ccfm.js') ~ '\n' ~ lookup('file', 'ccfm/nodes/plan.js')) | to_json ]] }
    },
    {
      "id": "sync-split",
      "name": "One item per calendar op",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1000, 0],
      "parameters": { "jsCode": "return $input.first().json.ops.map((op) => ({ json: op }));" }
    },
    {
      "id": "sync-apply",
      "name": "Apply calendar op",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1250, 0],
      "parameters": {
        "method": "={{ $json.method }}",
        "url": "=https://www.googleapis.com/calendar/v3/calendars/[[ ccfm_calendar_id | urlencode ]]{{ $json.path }}",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "googleCalendarOAuth2Api",
        "sendBody": "={{ $json.method !== 'DELETE' }}",
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json.body) }}",
        "options": {}
      },
      "credentials": { "googleCalendarOAuth2Api": { "id": "[[ n8n_google_calendar_credential_id ]]", "name": "Google Calendar" } }
    },
    {
      "id": "sync-email-filter",
      "name": "Only if surprising",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1000, 200],
      "parameters": { "jsCode": "const { email } = $input.first().json;\nreturn email ? [{ json: email }] : [];" }
    },
    {
      "id": "sync-email",
      "name": "Email changes",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.1,
      "position": [1250, 200],
      "parameters": {
        "sendTo": "[[ ccfm_email_to ]]",
        "subject": "={{ $json.subject }}",
        "emailType": "text",
        "message": "={{ $json.text }}",
        "options": { "appendAttribution": false }
      },
      "credentials": { "gmailOAuth2": { "id": "[[ n8n_gmail_credential_id ]]", "name": "Gmail" } }
    }
  ],
  "connections": {
    "Every Monday 07:00": { "main": [[{ "node": "Fetch page", "type": "main", "index": 0 }]] },
    "changedetection.io webhook": { "main": [[{ "node": "Fetch page", "type": "main", "index": 0 }]] },
    "Fetch page": { "main": [[{ "node": "List events", "type": "main", "index": 0 }]] },
    "List events": { "main": [[{ "node": "Plan", "type": "main", "index": 0 }]] },
    "Plan": {
      "main": [[
        { "node": "One item per calendar op", "type": "main", "index": 0 },
        { "node": "Only if surprising", "type": "main", "index": 0 }
      ]]
    },
    "One item per calendar op": { "main": [[{ "node": "Apply calendar op", "type": "main", "index": 0 }]] },
    "Only if surprising": { "main": [[{ "node": "Email changes", "type": "main", "index": 0 }]] }
  }
}
```

- [ ] **Step 4: Reminder workflow template**

`roles/n8n/templates/workflows/ccfm-reminder.json.j2`:

```json
{
  "id": "ccfmRemind000001",
  "name": "CCFM: Saturday market reminder",
  "active": true,
  "settings": { "executionOrder": "v1", "timezone": "Europe/London", "errorWorkflow": "ccfmError0000001" },
  "nodes": [
    {
      "id": "remind-schedule",
      "name": "Saturday 18:00",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1.2,
      "position": [0, 0],
      "parameters": { "rule": { "interval": [{ "field": "cronExpression", "expression": "0 18 * * 6" }] } }
    },
    {
      "id": "remind-list",
      "name": "List events",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [250, 0],
      "parameters": {
        "url": "https://www.googleapis.com/calendar/v3/calendars/[[ ccfm_calendar_id | urlencode ]]/events",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "googleCalendarOAuth2Api",
        "sendQuery": true,
        "queryParameters": {
          "parameters": [
            { "name": "timeMin", "value": "={{ $now.setZone('Europe/London').startOf('day').minus({ days: 8 }).toISO() }}" },
            { "name": "timeMax", "value": "={{ $now.setZone('Europe/London').startOf('day').plus({ days: 8 }).toISO() }}" },
            { "name": "singleEvents", "value": "true" }
          ]
        },
        "options": {}
      },
      "credentials": { "googleCalendarOAuth2Api": { "id": "[[ n8n_google_calendar_credential_id ]]", "name": "Google Calendar" } }
    },
    {
      "id": "remind-build",
      "name": "Build reminder",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [500, 0],
      "parameters": { "jsCode": [[ (lookup('file', 'ccfm/ccfm.js') ~ '\n' ~ lookup('file', 'ccfm/nodes/reminder.js')) | to_json ]] }
    },
    {
      "id": "remind-email",
      "name": "Send reminder",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.1,
      "position": [750, 0],
      "parameters": {
        "sendTo": "[[ ccfm_email_to ]]",
        "subject": "={{ $json.subject }}",
        "emailType": "text",
        "message": "={{ $json.text }}",
        "options": { "appendAttribution": false }
      },
      "credentials": { "gmailOAuth2": { "id": "[[ n8n_gmail_credential_id ]]", "name": "Gmail" } }
    }
  ],
  "connections": {
    "Saturday 18:00": { "main": [[{ "node": "List events", "type": "main", "index": 0 }]] },
    "List events": { "main": [[{ "node": "Build reminder", "type": "main", "index": 0 }]] },
    "Build reminder": { "main": [[{ "node": "Send reminder", "type": "main", "index": 0 }]] }
  }
}
```

- [ ] **Step 5: Import tasks and the restart handler**

Append to `roles/n8n/defaults/main.yml`:

```yaml

# Overridable to force a fetch failure when testing the error workflow.
ccfm_page_url: "https://www.weareccfm.com/our-markets/alexandra-palace/"

# Import order matters: the error workflow must exist before the others
# reference it.
n8n_workflows:
  - ccfm-error
  - ccfm-sync
  - ccfm-reminder
```

`roles/n8n/tasks/workflows.yml`:

```yaml
# Workflows live in this repo (templates/workflows) and are imported on
# change. Edits made in the n8n UI are overwritten: export them back here.
---
- name: Import workflows
  when:
    - n8n_google_calendar_credential_id | length > 0
    - n8n_gmail_credential_id | length > 0
  block:
    - name: Ensure workflow directory is present
      tags:
        - n8n
        - workflows
      file:
        path: '{{ config_directory }}/n8n/workflows'
        state: directory
        owner: servarr
        group: servarr
        mode: '{{ directory_mode }}'

    # [[ ]] delimiters leave n8n's own {{ }} expressions alone.
    - name: Render workflows
      tags:
        - n8n
        - workflows
      template:
        src: 'workflows/{{ item }}.json.j2'
        dest: '{{ config_directory }}/n8n/workflows/{{ item }}.json'
        variable_start_string: '[['
        variable_end_string: ']]'
        owner: servarr
        group: servarr
        mode: '{{ file_mode }}'
      loop: '{{ n8n_workflows }}'
      register: n8n_rendered_workflows

    - name: Import changed workflows
      tags:
        - n8n
        - workflows
      community.docker.docker_container_exec:
        container: n8n
        argv:
          - n8n
          - import:workflow
          - --activeState=fromJson
          - '--input=/home/node/.n8n/workflows/{{ item.item }}.json'
      loop: '{{ n8n_rendered_workflows.results }}'
      loop_control:
        label: '{{ item.item }}'
      when: item.changed
      notify: Restart n8n
```

`roles/n8n/handlers/main.yml`:

```yaml
---
# Active workflows imported through the CLI are picked up on startup.
- name: Restart n8n
  community.docker.docker_container:
    name: n8n
    state: started
    restart: true
```

`roles/n8n/tasks/main.yml`:

```yaml
- import_tasks: file.yml
- import_tasks: container.yml
- import_tasks: tailscale.yml
- import_tasks: workflows.yml
```

- [ ] **Step 6: Preview the rendered workflows**

Run: `ansible-playbook playbook.yml --tags workflows --check --diff < /dev/null`
Expected: a diff for each of the three rendered `.json` files. Check that:
- `[[ ]]` placeholders are replaced by real IDs.
- n8n's `{{ $json... }}` expressions are left untouched.
- Each `jsCode` value is a single JSON string that starts with `// Ally Pally farmers' market helpers.`

Check mode skips the import task. Invalid JSON is caught at Step 7, where `import:workflow` fails loudly.

- [ ] **Step 7: Deploy and confirm the import**

Run: `ansible-playbook playbook.yml --tags n8n < /dev/null`
Expected: three `Import changed workflows` items reported as changed, the handler restarting n8n, and `failed=0`.

Run: `ansible synology -b -m shell -a "/usr/local/bin/docker exec n8n n8n list:workflow" < /dev/null`
Expected: all three IDs are listed. Then open the n8n UI and confirm:
- The sync and reminder workflows are **published/active**.
- The error workflow is the one set in each workflow's settings.
- Both triggers show the right times: Mon 07:00 and Sat 18:00, Europe/London.

If the sync or reminder workflow is not active, run `n8n publish:workflow --id=<id>` in the container and restart it. Then update the import task to run that command after each import.

- [ ] **Step 8: End-to-end sync test**

Run: `ansible synology -b -m shell -a "curl -s -X POST http://localhost:5678/webhook/ccfm-sync" < /dev/null`
Expected: `{"message":"Workflow was started"}`. In n8n → Executions, the sync run is green. The "Plan" output summary shows `markets: 16` (or the page's current count) and `create` equal to the number of upcoming dates. The **Ally Pally Market** calendar now shows those events at 10:00–15:00, each with an address.

Run the same curl again. Expected: the second execution's summary shows `create: 0, update: 0, remove: 0`, and no email arrives.

Next, exercise DELETE and the change email:
1. In the n8n editor, open the sync workflow and run it once manually.
2. On "Fetch page", **Edit output** and remove one upcoming date line from the HTML. Pin it.
3. Execute the workflow again.

Expected: the summary shows `remove: 1`, that event disappears from the calendar, and a "schedule changed" email arrives saying "no longer listed, event deleted".

Unpin the data and execute again. Expected: `create: 1`, and the event is back.

- [ ] **Step 9: Reminder test**

In the n8n UI, open "CCFM: Saturday market reminder" and click **Execute workflow**. Expected: an email for the coming Sunday with the correct location and address.

- [ ] **Step 10: Failure path test**

Run: `ansible-playbook playbook.yml --tags n8n -e ccfm_page_url=https://www.weareccfm.com/this-page-does-not-exist/ < /dev/null`, then repeat the curl from Step 8.
Expected: the sync execution fails at "Fetch page", and an "n8n failed: CCFM: sync Ally Pally market calendar" email arrives with the execution link.

Restore: `ansible-playbook playbook.yml --tags n8n < /dev/null`. Expected: the sync workflow is re-imported with the real URL.

- [ ] **Step 11: Commit**

```bash
git add roles/n8n
git commit -m "Add CCFM sync, reminder and error workflows imported by Ansible"
```

---

### Task 7: changedetection.io role and documentation

**Files:**
- Create: `roles/changedetection/defaults/main.yml`
- Create: `roles/changedetection/tasks/main.yml`
- Create: `roles/changedetection/tasks/file.yml`
- Create: `roles/changedetection/tasks/container.yml`
- Create: `roles/changedetection/README.md`
- Create: `roles/n8n/README.md`
- Modify: `playbook.yml`, `CLAUDE.md`

**Interfaces:**
- Consumes: the n8n webhook `POST http://n8n:5678/webhook/ccfm-sync` (Task 6).

- [ ] **Step 1: Pick a free host port**

Port 5000 is DSM's own web UI, so don't use it.

Run: `ansible synology -b -m shell -a "netstat -tln | grep -E ':(5080) '" < /dev/null`
Expected: no output, meaning 5080 is free. If it's taken, choose another port and use it below.

- [ ] **Step 2: Write the role**

`roles/changedetection/defaults/main.yml`:

```yaml
---
host_port: '5080'
```

`roles/changedetection/tasks/main.yml`:

```yaml
# changedetection.io watches web pages and notifies on change. It triggers
# the n8n CCFM sync when the Ally Pally market schedule changes.
#
# Documentation: https://changedetection.io
#
---
- import_tasks: file.yml
- import_tasks: container.yml
```

`roles/changedetection/tasks/file.yml`:

```yaml
---
- name: Ensure datastore directory is present
  tags:
    - changedetection
    - file
    - config
  file:
    path: '{{ config_directory }}/changedetection'
    state: directory
    owner: servarr
    group: servarr
    mode: '{{ directory_mode }}'
```

`roles/changedetection/tasks/container.yml`:

```yaml
# https://github.com/dgtlmoon/changedetection.io/wiki/Docker-installation
---
- name: Start container
  tags:
    - changedetection
    - container
  docker_container:
    name: changedetection
    image: ghcr.io/dgtlmoon/changedetection.io:latest
    state: "{{ docker_state }}"
    restart: "{{ docker_restart }}"
    restart_policy: "{{ docker_restart_policy }}"
    recreate: "{{ docker_recreate }}"
    user: "{{ servarr_uid }}:{{ servarr_gid }}"
    volumes:
      - "{{ config_directory }}/changedetection:/datastore"
    networks:
      - name: "{{ docker_network }}"
    dns_servers:
      - "{{ dns_primary }}"
      - "{{ dns_secondary }}"
    ports:
      - "{{ host_port }}:5000"
    env:
      TZ: "{{ timezone }}"
      BASE_URL: "http://changedetection.{{ home_domain }}"
    labels:
      traefik.enable: "true"
      traefik.http.routers.changedetection.rule: "Host(`changedetection.{{ home_domain }}`)"
      traefik.http.routers.changedetection.entrypoints: "web"
      traefik.http.services.changedetection.loadbalancer.server.port: "5000"
      homepage.group: "Infrastructure"
      homepage.name: "changedetection.io"
      homepage.icon: "changedetection.png"
      homepage.description: "Website change alerts"
      homepage.href: "http://changedetection.{{ home_domain }}"
```

`playbook.yml`: add `- changedetection` on the line after `- n8n`.

- [ ] **Step 3: Deploy and verify**

Run: `ansible-playbook playbook.yml --tags changedetection < /dev/null`
Expected: `failed=0`.

Run: `curl -s -o /dev/null -w '%{http_code}\n' http://changedetection.home.arpa/`
Expected: `200`. Also check `docker logs changedetection` for permission errors. If there are any, remove the `user:` line, redeploy, and note in the README that it runs as root.

- [ ] **Step 4: Configure the watch (manual, in the changedetection.io UI)**

1. Add watch: `https://www.weareccfm.com/our-markets/alexandra-palace/`, titled `Ally Pally market schedule`.
2. Edit → General: set **Recheck time** to 6 hours, and **Fetch method** to the plain HTTP fetcher (not a browser).
3. Filters & Triggers → **Extract text**, one regex per line:
   ```
   /\d{1,2}(st|nd|rd|th)?\s+[a-z]+\.?\s+\d{4}/i
   /[a-z ]+ location/i
   ```
4. Notifications → URL: `json://n8n:5678/webhook/ccfm-sync`.
5. Click **Send test notification**. Expected: a new successful ccfm-sync execution in n8n with `create: 0` (nothing changed).

- [ ] **Step 5: Write the READMEs**

`roles/changedetection/README.md` records the watch configuration from Step 4 verbatim, including the regexes and the notification URL, because the watch isn't managed by Ansible.

`roles/n8n/README.md` covers:
- The URLs: `http://n8n.home.arpa` (LAN) and `https://n8n.<tailnet>.ts.net` (OAuth base).
- That workflows are imported from `templates/workflows` and that UI edits get overwritten.
- How to run the parser tests: `node --test 'roles/n8n/files/ccfm/test/*.test.js'`.
- The Google Cloud project and the OAuth path that Task 5 actually used.
- How to refresh the test fixture when the page layout changes.

- [ ] **Step 6: Update CLAUDE.md**

Under "Playbook Execution Order", in item 9, change:

```
9. Supporting: `flaresolverr`, `adguard-home`, `ntfy`, `watchtower`
```

to:

```
9. Supporting: `flaresolverr`, `adguard-home`, `ntfy`, `n8n`, `changedetection`, `watchtower`
```

- [ ] **Step 7: Commit**

```bash
git add roles/changedetection roles/n8n/README.md playbook.yml CLAUDE.md
git commit -m "Add changedetection.io to trigger the CCFM sync on page changes"
```

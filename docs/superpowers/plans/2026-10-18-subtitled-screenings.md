# Subtitled Cinema Screenings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a "Subtitled Cinema Screenings" Google Calendar of captioned (deaf/HoH) screenings that fit the owner's free hours at four cinemas, and email a Friday 09:00 digest of the next two weeks organised by film.

**Architecture:** Dependency-free JS files under `roles/n8n/files/cinema/` hold all logic (readers per chain, film info, calendar planning, emails). They have no `require`/`module.exports`: tests load them the same way n8n does, by concatenating files and evaluating them. Three n8n workflows are rendered from Jinja templates and imported by Ansible: `cinema-collect` (a sub-workflow that fetches, reads and enriches), `cinema-sync` (daily calendar sync and alerts) and `cinema-digest` (Friday email). FlareSolverr fetches the Cloudflare-protected BFI page.

**Tech Stack:** Ansible (`community.docker`), n8n 2.43.x (Code, HTTP Request, Data table, Execute Sub-workflow, Gmail nodes), Node 22 `node:test` (local only), Google Calendar API v3, TMDB API v3, OMDb API, FlareSolverr.

**Spec:** `docs/superpowers/specs/2026-10-18-subtitled-screenings-design.md`

## Global Constraints

- Never edit `vars/vault.yml`. The owner adds `vault_tmdb_api_read_access_token` (TMDB "API Read Access Token"; `vault_tmdb_api_key` also exists but is unused), `vault_omdb_api_key` and `vault_cinema_calendar_id` by hand. Ask before any deploy that needs them.
- Never stage `roles/docker-daemon/*` (unrelated work in progress). Stage files by explicit path; never `git add -A` / `-a`.
- Ansible runs: always `< /dev/null`; use `--tags n8n` or `--tags flaresolverr`, never `--tags container` (it hits every role).
- Timezone everywhere: `Europe/London`. All cinema times are local wall-clock strings `YYYY-MM-DDTHH:MM`.
- Free hours: weekends any time; weekdays only if the start is before `09:00` or at/after `17:00`.
- Digest: cron `0 9 * * 5`; window today through today + 13 days; subject `🎬 Subtitled Cinema Screenings: <d Mon> – <d Mon>` (e.g. `🎬 Subtitled Cinema Screenings: 23 Oct – 5 Nov`).
- Sync: cron `0 7 * * *`. Event title `🎬 <film> – <cinema name>`. Safety cap `MAX_REMOVALS_PER_CINEMA = 3`.
- Workflow IDs (fixed, 16 chars): `cinemaCollect001`, `cinemaSync000001`, `cinemaDigest0001`. Error workflow: existing `ccfmError0000001`.
- Credential IDs (fixed, imported by Ansible): `cinemaTmdb000001` (type `httpBearerAuth`, name `TMDB`), `cinemaOmdb000001` (type `httpQueryAuth`, name `OMDb`, query param `apikey`).
- Data tables (referenced by name, created once by hand or through the n8n MCP): `cinema_films` (columns `key`, `data`, `override_tmdb_id`, `fetched_at`, `ratings_at`, all strings) and `cinema_status` (columns `cinema_key`, `last_captioned`, both strings).
- JS files: plain top-level `function`/`class`/`const` declarations, no `require`, no `module.exports`, no top-level `return`. Each file only uses names from files listed before it in its node's concatenation order.
- Workflow templates use `<< >>` Jinja delimiters (n8n's `{{ }}` stays literal). Every HTTP node calling an external service sets `retryOnFail: true, maxTries: 5, waitBetweenTries: 5000` unless a step says otherwise.
- Tests: `node --test 'roles/n8n/files/cinema/test/*.test.js'` and the existing `node --test 'roles/n8n/files/ccfm/test/*.test.js'` must both pass at every commit.

## Review Focus

1. **A cinema answers with an HTML error or Cloudflare page instead of data.** The reader must throw (`ReaderError`), never return `[]`. Pinned in Tasks 2, 3 and 4 ("throws on a non-JSON body" / "throws on a Cloudflare page").
2. **One cinema fails or comes back short.** Its existing events must not be deleted; more than 3 vanishing for one cinema deletes none of them. Pinned in Task 6 ("keeps events of failed cinemas", "caps removals per cinema").
3. **The same film listed under different titles** (`Fatherland - Preview`, `Fatherland`, `BarTrash Presents: …`). It must group under one film in the digest. Pinned in Task 1 ("normalises preview and presenter titles").
4. **Clock change and boundaries.** Sun 25 Oct 2026 (BST ends) at any time fits; a weekday 17:00 start fits, 16:59 does not, 08:59 does. Calendar events carry the local time plus `timeZone`. Pinned in Task 1 ("free hours boundaries") and Task 6 (event body).
5. **Film info missing or awkward text.** No TMDB match, no Rotten Tomatoes score, a title with `&` or `'`. The digest must not show `undefined`/`null`, and the text must be HTML-escaped. Pinned in Task 7 ("renders films without info", "escapes titles").

---

### Task 1: Fixtures, test loader and core helpers

**Files:**
- Create: `roles/n8n/files/cinema/core.js`
- Create: `roles/n8n/files/cinema/test/load.js`
- Create: `roles/n8n/files/cinema/test/core.test.js`
- Create fixtures in `roles/n8n/files/cinema/test/fixtures/` by copying from `/private/tmp/claude-501/-Users-russell-Developer-ansible/5a1f5f33-4b63-448a-8a87-f0cc88989748/scratchpad/cinema/`: `sched-024.json` → `picturehouse-024-2026-10-18.json`, `sched-029.json` → `picturehouse-029-2026-10-18.json`, `ems.json` → `everyman-schedule-X06SN-2026-10-18.json`, `emm.json` → `everyman-movies-2026-10-18.json`, `fs2.json` → `bfi-flaresolverr-2026-10-18.json`. If the scratchpad is gone, re-fetch with the commands in the README section of Task 11 and adjust the expected counts in Tasks 2–4 to the new data.

**Interfaces:**
- Produces `load(files: string[], names: string[]) → object` in `test/load.js` (CommonJS, test-only): reads each path relative to `roles/n8n/files/cinema/`, joins with `\n`, evaluates `new Function(code + '\nreturn {' + names.join(',') + '};')()`.
- Produces in `core.js`:
  - `class ReaderError extends Error` with `constructor(cinemaKey: string, message: string)`, `.cinemaKey`, and message prefixed `"<cinemaKey>: "`.
  - Screening shape (doc comment at the top of core.js): `{cinemaKey, sourceId, title, start: 'YYYY-MM-DDTHH:MM', screen: string|null, bookingUrl: string|null, kind: 'captioned'|'subtitled'|'by-language', year: number|null, runtimeMin: number|null, synopsis: string|null, image: string|null, chainFilmId: string|null}`.
  - `addDays(iso: 'YYYY-MM-DD', n: number) → 'YYYY-MM-DD'`, `weekday(iso) → 0..6` (0 = Sunday, computed with UTC dates).
  - `fitsFreeHours(start: string, hours = FREE_HOURS_DEFAULT) → boolean`; `FREE_HOURS_DEFAULT = {weekdayBefore: '09:00', weekdayFrom: '17:00'}`.
  - `normaliseTitle(raw: string) → {title: string, key: string}`: strips ` - Preview`, ` (Re-release)`, `(Preview)`, leading `<Anything> Presents:`, trailing ` + Q&A`, collapses whitespace; `key` is lower-case with every non-alphanumeric removed.
  - `filmKey(screening) → string` = `normaliseTitle(title).key + '|' + (year ?? '')`.
  - `digestWindow(today) → {from: today, to: addDays(today, 13)}`.
  - `groupByFilm(screenings) → Array<{filmKey, title, screenings}>`: screenings sorted by `start`, groups sorted by first screening, `title` from the first screening's normalised title.
  - `cinemaRequest(cinema, today) → {method, url, contentType, body}` for each chain (exact values in Step 3).
  - `formatDay(start) → 'Thu 22 Oct'`, `formatTime(start) → '20:15'`, `formatRange(fromIso, toIso) → '23 Oct – 5 Nov'`.

- [ ] **Step 1: Copy the fixtures and write `test/load.js`**

- [ ] **Step 2: Write the failing tests** in `test/core.test.js`:

```js
const { fitsFreeHours, normaliseTitle, groupByFilm, digestWindow, cinemaRequest, formatRange, ReaderError } =
  load(['core.js'], ['fitsFreeHours', 'normaliseTitle', 'groupByFilm', 'digestWindow', 'cinemaRequest', 'formatRange', 'ReaderError']);

test('free hours boundaries', () => {
  assert.equal(fitsFreeHours('2026-10-22T17:00'), true);   // Thu
  assert.equal(fitsFreeHours('2026-10-22T16:59'), false);
  assert.equal(fitsFreeHours('2026-10-22T08:59'), true);
  assert.equal(fitsFreeHours('2026-10-22T09:00'), false);
  assert.equal(fitsFreeHours('2026-10-25T12:40'), true);   // Sun, clocks change
  assert.equal(fitsFreeHours('2026-10-24T13:30'), true);   // Sat
});

test('normalises preview and presenter titles', () => {
  assert.equal(normaliseTitle('Fatherland - Preview').key, normaliseTitle('Fatherland').key);
  assert.equal(normaliseTitle('28 Days Later... (Re-release)').title, '28 Days Later...');
  assert.equal(normaliseTitle('BarTrash Presents: Voyage To The Bottom Of The Sea').title, 'Voyage To The Bottom Of The Sea');
  assert.equal(normaliseTitle("Pan's Labyrinth").key, 'panslabyrinth');
});

test('groups by film in order of first screening', () => {
  // inputs: B at 2026-10-23T18:00, A at 2026-10-22T20:00, "B - Preview" at 2026-10-22T19:00
  // expect: groups titled ['B', 'A']; B's screenings start ['2026-10-22T19:00', '2026-10-23T18:00']
});

test('digest window is 14 days inclusive', () => {
  assert.deepEqual(digestWindow('2026-10-23'), { from: '2026-10-23', to: '2026-11-05' });
  assert.equal(formatRange('2026-10-23', '2026-11-05'), '23 Oct – 5 Nov');
});

test('builds chain requests', () => {
  const ph = cinemaRequest({ key: 'ph-crouch-end', chain: 'picturehouse', chain_id: '024' }, '2026-10-18');
  assert.deepEqual(ph, { method: 'POST', url: 'https://www.picturehouses.com/api/scheduled-movies-ajax',
    contentType: 'application/x-www-form-urlencoded', body: 'cinema_id=024' });
  const em = cinemaRequest({ key: 'everyman-muswell-hill', chain: 'everyman', chain_id: 'X06SN' }, '2026-10-18');
  assert.equal(em.method, 'GET');
  assert.match(em.url, /schedule\?theaters=%7B%22id%22%3A%22X06SN%22%2C%22timeZone%22%3A%22Europe%2FLondon%22%7D&from=2026-10-18T00%3A00%3A00&to=2026-12-17T23%3A59%3A59/);
  const bfi = cinemaRequest({ key: 'bfi-imax', chain: 'bfi' }, '2026-10-18');
  assert.equal(bfi.url, 'http://flaresolverr:8191/v1');
  assert.equal(JSON.parse(bfi.body).maxTimeout, 180000);
});

test('ReaderError carries the cinema', () => {
  const e = new ReaderError('bfi-imax', 'no listings');
  assert.equal(e.cinemaKey, 'bfi-imax');
  assert.equal(e.message, 'bfi-imax: no listings');
});
```

Write the grouping test body from its comment (minimal screenings with only `title` and `start`).

- [ ] **Step 3: Run** `node --test roles/n8n/files/cinema/test/core.test.js`. Expected: FAIL (core.js missing).

- [ ] **Step 4: Implement `core.js`.** `cinemaRequest` values:
  - picturehouse: as in the test.
  - everyman: `GET https://www.everymancinema.com/api/gatsby-source-boxofficeapi/schedule?theaters=<encodeURIComponent(JSON.stringify({id, timeZone:'Europe/London'}))>&from=<today>T00:00:00&to=<today+60>T23:59:59` (encode the `from`/`to` values with `encodeURIComponent`), `contentType: null`, `body: null`.
  - bfi: `POST http://flaresolverr:8191/v1`, `contentType: 'application/json'`, body `JSON.stringify({cmd: 'request.get', url: BFI_URL, maxTimeout: 180000})`, where `BFI_URL` is the spec's subtitles URL as a `const`.
  - unknown chain: throw `ReaderError(cinema.key, 'unknown chain <chain>')`.

- [ ] **Step 5: Run tests.** Expected: PASS.
- [ ] **Step 6: Commit** `git add roles/n8n/files/cinema/core.js roles/n8n/files/cinema/test/ && git commit -m "Add cinema core helpers, fixtures and test loader"`

### Task 2: Picturehouse reader

**Files:** Create `roles/n8n/files/cinema/readers/picturehouse.js`, `roles/n8n/files/cinema/test/picturehouse.test.js`.

**Interfaces:**
- Consumes: `ReaderError`, screening shape (Task 1).
- Produces: `readPicturehouse(text: string, cinema: {key, chain_id}) → Screening[]` with only `HOHSub` (kind `captioned`) and `Sub Cinema` (kind `subtitled`) sessions. If both are present it is `captioned`. Fields: `sourceId = SessionId`, `title = Title` (raw), `start = Showtime.slice(0, 16)`, `screen = ScreenName`, `bookingUrl = https://web.picturehouses.com/order/showtimes/<CinemaId>-<SessionId>/seats`, `image = image_url` with `width=640&height=360` replaced by `width=1280&height=720`, `chainFilmId = ScheduledFilmId`, other fields `null`.

- [ ] **Step 1: Write failing tests:**
  - "reads captioned and subtitled sessions": fixture 024 gives 9 `captioned` and 17 `subtitled`; the `The Social Reckoning` screening at `2026-10-22T20:00` has `screen: 'Screen Three'` and a `bookingUrl` starting `https://web.picturehouses.com/order/showtimes/024-`.
  - "reads Finsbury Park": fixture 029 gives 2 `captioned` and 29 `subtitled`.
  - "throws on a non-JSON body": `readPicturehouse('<html>…</html>', cinema)` throws `ReaderError`.
  - "throws when the response is not a success": `'{"response":"error"}'` throws.
  - "throws when the subtitle flags disappear": the 024 fixture with every `HOHSub` and `Sub Cinema` attribute removed throws, with a message containing `no HOHSub or Sub Cinema`.
  - "throws on an unreadable showtime": one session with `Showtime: 'soon'` throws.
- [ ] **Step 2: Run** `node --test roles/n8n/files/cinema/test/picturehouse.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** A `Showtime` that doesn't match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/` throws.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** (`readers/picturehouse.js`, its test): "Add Picturehouse reader".

### Task 3: Everyman reader

**Files:** Create `roles/n8n/files/cinema/readers/everyman.js`, `roles/n8n/files/cinema/test/everyman.test.js`.

**Interfaces:**
- Produces: `readEverymanSchedule(text, cinema) → Screening[]`: only showtimes tagged `Showtime.Accessibility.ClosedCaption`, `kind: 'captioned'`, `sourceId = id`, `title: null`, `chainFilmId = <movieId key>`, `start = startsAt.slice(0,16)`, `screen = data.screen?.name ?? null`, `bookingUrl` = first URL of the `data.ticketing` entry with `provider === 'default'`.
- Produces: `everymanMoviesUrl(screenings) → string|null`: `https://www.everymancinema.com/api/gatsby-source-boxofficeapi/movies?ids=<id>&ids=<id>` for the unique `chainFilmId`s of Everyman screenings; `null` if there are none.
- Produces: `attachEverymanMovies(screenings, moviesText) → Screening[]`: fills `title` (`title`), `runtimeMin` (`Math.round(runtime / 60)`), `synopsis` (`locale.synopsis`), `image` (first `images[].url`, else `poster`) for Everyman screenings. Throws `ReaderError` if an Everyman screening's film is missing from the response.

- [ ] **Step 1: Write failing tests:**
  - "reads captioned showtimes": the schedule fixture gives 6 screenings for 4 films (`1000015739`, `1000026622`, `1000026649`, `290167`); the one at `2026-10-22T20:15` has film `1000015739` and a `bookingUrl` starting `https://purchase.everymancinema.com/`.
  - "builds the movies URL": it contains `ids=1000015739` and has exactly 4 `ids=` parameters.
  - "attaches film details": after `attachEverymanMovies` with the movies fixture, the 20:15 screening has `title: 'Verity'`, `runtimeMin: 114`, and an `image` starting `https://all.web.img.acsta.net/`.
  - "throws on a non-JSON body" and "throws when the cinema key is missing" (`'{}'`).
  - "zero captioned showtimes is not an error": the fixture with every `ClosedCaption` tag removed returns `[]`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: "Add Everyman reader".

### Task 4: BFI IMAX reader

**Files:** Create `roles/n8n/files/cinema/readers/bfi.js`, `roles/n8n/files/cinema/test/bfi.test.js`.

**Interfaces:**
- Produces: `readBfi(text: string, cinema) → Screening[]`. `text` is the FlareSolverr JSON response. Throws if `status !== 'ok'` (message includes FlareSolverr's `message`), if `solution.response` contains `<title>Just a moment...</title>`, or if either array is missing or doesn't parse. Extract the `searchNames : [` and `searchResults : [` array literals by bracket matching that respects quoted strings, remove trailing commas before `]`, then `JSON.parse`. Map each row through the names:
  - `sourceId = id`, `title = description`
  - `start` parsed from `start_date` (`'Sunday 25 October 2026 16:15'` → `'2026-10-25T16:15'`; an unreadable value throws)
  - `screen = null`, `bookingUrl = 'https://whatson.bfi.org.uk/imax/Online/' + additional_info`
  - `kind = cinema.kind ?? 'captioned'`
  - other fields `null`

- [ ] **Step 1: Write failing tests:**
  - "reads the embedded listings": the fixture gives 30 screenings. Row `AA694E82-7375-439C-AEA4-0C4E15E471E9` is `title: 'Hope'`, `start: '2026-10-25T16:15'`, with a `bookingUrl` starting `https://whatson.bfi.org.uk/imax/Online/default.asp?doWork::WScontent::loadArticle=Load`.
  - "uses the configured kind": with `{kind: 'by-language'}` every screening has `kind: 'by-language'`.
  - "throws on a Cloudflare page": `{"status":"ok","solution":{"response":"<html><head><title>Just a moment...</title>"}}` throws.
  - "throws when FlareSolverr failed": `{"status":"error","message":"Error solving the challenge. Timeout after 60.0 seconds."}` throws, and the message contains `Timeout`.
  - "throws when the listing data is missing": a page without `searchResults` throws.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: "Add BFI IMAX reader".

### Task 5: Film info, cache and classification

**Files:** Create `roles/n8n/files/cinema/films.js`, `roles/n8n/files/cinema/test/films.test.js`, and small hand-written fixtures `test/fixtures/tmdb-search-verity.json`, `tmdb-movie-verity.json` and `omdb-verity.json` that follow the documented API shapes below.

**Interfaces:**
- Consumes: `normaliseTitle`, `filmKey`, `addDays` (Task 1).
- Film shape: `{tmdbId: number|null, imdbId: string|null, title, year: number|null, synopsis: string|null, runtimeMin: number|null, image: string|null, trailerUrl: string|null, originalLanguage: string|null, imdbRating: string|null, rottenTomatoes: string|null}`.
- Produces:
  - `tmdbSearchUrl(title, year) → string`: `https://api.themoviedb.org/3/search/movie?query=<enc>&include_adult=false&language=en-GB&region=GB` plus `&year=<year>` when known.
  - `tmdbMovieUrl(id) → string`: `https://api.themoviedb.org/3/movie/<id>?append_to_response=videos,external_ids&language=en-GB`.
  - `omdbUrl(imdbId) → string`: `https://www.omdbapi.com/?i=<imdbId>`. The key comes from the n8n credential.
  - `pickTmdbMatch(searchJson, {title, year}) → number|null`. Candidates are results whose `normaliseTitle(title).key` or `normaliseTitle(original_title).key` equals the wanted key. Prefer a `release_date` year matching `year` (when known), else the most popular. Return `null` if nothing matches.
  - `filmFromTmdb(movieJson) → Film`:
    - `image`: `https://image.tmdb.org/t/p/w1280<backdrop_path>`, else `w780<poster_path>`, else `null`.
    - `trailerUrl`: the first `videos.results` entry with `site === 'YouTube' && type === 'Trailer'`, as `https://www.youtube.com/watch?v=<key>`.
    - `imdbId`: from `external_ids.imdb_id`.
  - `ratingsFromOmdb(json) → {imdbRating, rottenTomatoes}`. `'N/A'` and missing values become `null`; Rotten Tomatoes comes from `Ratings[].Source === 'Rotten Tomatoes'`.
  - `lookupPlan(keys: string[], cacheRows, today) → Array<{key, title, year, tmdbId: number|null, need: 'full'|'ratings'}>`. Films with no row get `full`. So does a row whose `override_tmdb_id` differs from the cached `tmdbId`, using the override. Rows whose `ratings_at` is 7 or more days old get `ratings`. Fresh rows are left out.
  - `mergeFilm(screening, film|null) → Film`. Missing TMDB values are filled from the screening (`title`, `runtimeMin`, `synopsis`, `image`, `year`).
  - `classify(screening, film) → 'captioned'|'subtitled'`. For `by-language`, it is `subtitled` only when `film.originalLanguage` is set and not `'en'`. Otherwise it is the screening's own kind.

- [ ] **Step 1: Write failing tests** covering each function:
  - picks the year match among two same-title results
  - returns `null` for no title match
  - builds the image, trailer and IMDb ID from the movie fixture
  - maps `N/A` to `null`
  - plans `full` for unknown, `ratings` for a row whose `ratings_at` is 8 days old, nothing for a fresh row, and `full` with the override ID when `override_tmdb_id` is set
  - `mergeFilm(screening, null)` keeps the cinema's title and image
  - `classify` handles `by-language`
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: "Add film info lookups and classification".

### Task 6: Calendar planning

**Files:** Create `roles/n8n/files/cinema/calendar.js`, `roles/n8n/files/cinema/test/calendar.test.js`.

**Interfaces:**
- Consumes: Screening and Film shapes, `fitsFreeHours`, `filmKey`.
- Produces:
  - `MAX_REMOVALS_PER_CINEMA = 3`.
  - `eventBody(screening, film, cinema) → object`:
    - `summary`: `🎬 <film.title> – <cinema.name>`.
    - `location`: `<cinema.name>, <cinema.address>`.
    - `description`: lines for the booking link, ratings (`IMDb 7.4 · Rotten Tomatoes 94%`, leaving out whichever is missing), trailer, a synopsis cut to 200 characters with `…`, `Map: <cinema.map_url>`, a blank line, then `Managed by the n8n cinema-sync workflow; manual edits are overwritten.`
    - `start`: `{dateTime: '<start>:00', timeZone: 'Europe/London'}`.
    - `end`: start plus `runtimeMin ?? 120` minutes, computed as wall-clock time.
    - `extendedProperties.private`: `{cinemaManaged: 'true', cinemaKey, cinemaSourceId}`.
  - `planSync({wanted: Array<{screening, film, cinema}>, events, okCinemaKeys: string[], now: 'YYYY-MM-DDTHH:MM'}) → {create, update, remove, capped: string[]}`. Matching uses `cinemaKey + '|' + cinemaSourceId`. Only events with `cinemaManaged === 'true'` that start at or after `now` are considered. An event is updated when its `summary`, `location`, `description`, `start.dateTime` or `end.dateTime` differ from `eventBody`. An event is removed only when its cinema is in `okCinemaKeys`. If more than `MAX_REMOVALS_PER_CINEMA` removals fall on one cinema, that cinema's removals are dropped and its key is added to `capped`.
  - `calendarOps(plan) → Array<{method, path, body}>`, in the same shape as the CCFM `calendarOps` (POST `/events`, PUT/DELETE `/events/<id>`).

- [ ] **Step 1: Write failing tests:**
  - "event body": `eventBody` for a Verity screening (`2026-10-25T23:30`, runtime 114) ends at `2026-10-26T01:24:00`.
  - "creates, updates and keeps".
  - "ignores events it did not create".
  - "keeps events of failed cinemas": a missing screening whose cinema is not in `okCinemaKeys` is not removed.
  - "caps removals per cinema": 4 vanished events at one cinema give `remove: []` and `capped: ['ph-crouch-end']`, while 2 vanished at another cinema are still removed.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: "Add cinema calendar planning".

### Task 7: Digest and alert emails

**Files:** Create `roles/n8n/files/cinema/digest.js`, `roles/n8n/files/cinema/test/digest.test.js`.

**Interfaces:**
- Consumes: `groupByFilm`, `formatDay`, `formatTime`, `formatRange`, `digestWindow`, `classify`, `fitsFreeHours`, `filmKey`, Film shape.
- Produces:
  - `escapeHtml(s)`.
  - `buildDigest({today, screenings, films: {[filmKey]: Film}, cinemas, errors: Array<{cinemaKey, message}>, notes: string[]}) → {subject, html, text}`. Keeps screenings inside `digestWindow(today)` that fit free hours, splits them by `classify`, and groups each part by film.
    - Captioned section, layout B (from the mockup): a 600px-max table layout with inline styles, as the CCFM emails use. Each film has:
      - an `<img>` when there is an image
      - the title linked to the trailer when there is one
      - a meta line of `IMDb x · RT y · 1h 54m`, leaving out the parts that are missing
      - the synopsis cut to 300 characters
      - a table of cinema / `formatDay` / times, with each time linking to `bookingUrl`
    - Subtitled section, headed `Foreign-language, English subtitles`: one `<li>` per film with the title (linked to the trailer), ratings, then `<cinema name>: <days>` joined with ` · `.
    - An empty captioned part renders `No captioned screenings in the next two weeks.`
    - `errors` and `notes` render as a box at the top. Each error is `Couldn't read <cinema name>: <message>`.
    - The footer links the calendar (`https://calendar.google.com/calendar/u/0/r`) and lists the source cinemas.
  - `staleNotes({statusRows, today, cinemas}) → string[]`: `No captioned screenings from <name> for 4 weeks; its reader may need checking.` when `last_captioned` is 28 or more days before `today`.
  - `statusUpdates({screenings, okCinemaKeys, statusRows, today}) → Array<{cinema_key, last_captioned}>`. A cinema that read successfully and has at least one captioned screening gets `today`. A cinema with no row gets `today`, so a new cinema starts unflagged.
  - `buildAlert({errors, capped, cinemas, executionUrl}) → {subject, html, text}`. Subject: `Cinema sync: <n> problem(s)`. Each error gets a line, and each capped cinema gets `Over 3 screenings vanished from <name>; nothing deleted.` The email ends with the execution link.

- [ ] **Step 1: Write failing tests:**
  - "subject and window": `today: '2026-10-23'` gives `🎬 Subtitled Cinema Screenings: 23 Oct – 5 Nov`, and a screening on `2026-11-06` is not shown.
  - "drops work-hours screenings": the Everyman fixture's weekday 10:45 screening is absent.
  - "orders films by first screening".
  - "foreign-language section is compact and has no images".
  - "renders films without info": with `films: {}`, the HTML contains no `undefined`, `null` or `NaN`.
  - "escapes titles": `Pan's Labyrinth & Co` appears escaped.
  - "empty week message".
  - "error and stale notes at top": the note box comes before the first film.
  - `staleNotes` at exactly 28 days old.
  - `statusUpdates` for a cinema that failed (it is not touched).
  - `buildAlert` lists errors and capped cinemas.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit**: "Add cinema digest and alert emails".

### Task 8: Config, FlareSolverr network and credentials

**Files:**
- Modify: `roles/n8n/defaults/main.yml`. Add `cinemas`, `cinema_free_hours`, and three `n8n_workflows` entries after `ccfm-reminder`, in this order: `{ name: cinema-collect, id: cinemaCollect001, publish: true }`, `{ name: cinema-sync, id: cinemaSync000001, publish: true }`, `{ name: cinema-digest, id: cinemaDigest0001, publish: true }`.
- Modify: `vars/main.yml`. Add `cinema_calendar_id: "{{ vault_cinema_calendar_id }}"`, `cinema_email_to: "{{ vault_ccfm_email_to }}"`, `tmdb_api_key: "{{ vault_tmdb_api_read_access_token }}"` and `omdb_api_key: "{{ vault_omdb_api_key }}"` after the `ccfm_*` lines.
- Modify: `roles/flaresolverr/tasks/container.yml`. Add `networks: [{ name: "{{ docker_network }}" }]`, matching the n8n container's form. The uncommitted `state: "{{ docker_state }}"` change is already there; commit it with this task.
- Create: `roles/n8n/templates/credentials.json.j2`. Create: `roles/n8n/tasks/credentials.yml`, imported in `tasks/main.yml` before `workflows.yml`.

`cinemas` (addresses and map links: the builder looks up each cinema's postal address and a `https://www.google.com/maps/search/?api=1&query=<enc name + address>` link):

```yaml
cinemas:
  - { key: ph-crouch-end, name: Picturehouse Crouch End, chain: picturehouse, chain_id: "024", address: "…", map_url: "…" }
  - { key: ph-finsbury-park, name: Picturehouse Finsbury Park, chain: picturehouse, chain_id: "029", address: "…", map_url: "…" }
  - { key: everyman-muswell-hill, name: Everyman Muswell Hill, chain: everyman, chain_id: X06SN, address: "…", map_url: "…" }
  - { key: bfi-imax, name: BFI IMAX, chain: bfi, kind: captioned, address: "1 Charlie Chaplin Walk, London SE1 8XR", map_url: "…" }
cinema_free_hours: { weekdayBefore: "09:00", weekdayFrom: "17:00" }
```

**Credentials task:**
1. Render `credentials.json.j2` to `{{ config_directory }}/n8n/cinema-credentials.json` (mode `0600`, `no_log: true`). It holds two entries:
   - `{"id": "cinemaTmdb000001", "name": "TMDB", "type": "httpBearerAuth", "data": {"token": tmdb_api_key}}`
   - `{"id": "cinemaOmdb000001", "name": "OMDb", "type": "httpQueryAuth", "data": {"name": "apikey", "value": omdb_api_key}}`
2. When the render changed, run `n8n import:credentials --input=/home/node/.n8n/cinema-credentials.json` with `docker_container_exec`, using the same `until`/retries as the workflow imports.
3. Tag the tasks `n8n` and `credentials`. Don't delete the rendered file: an unchanged render is what skips re-import.

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Verify the plain-text import.** First confirm the owner has added the three vault values. Then run `ansible-playbook playbook.yml --tags flaresolverr < /dev/null` and `ansible-playbook playbook.yml --tags n8n < /dev/null`. Expected: both PLAY RECAPs show `failed=0`.
  - Use the n8n MCP `list_credentials` and expect `TMDB` and `OMDb`.
  - From inside the n8n container, check the network: `docker exec n8n wget -qO- --post-data='{"cmd":"sessions.list"}' --header='Content-Type: application/json' http://flaresolverr:8191/v1`. Expected: JSON containing `"status": "ok"`.
  - If `import:credentials` rejects plain-text `data`, stop and tell the owner. The fallback is creating the two credentials by hand with the fixed names, then putting their IDs in `group_vars/synology.yml` as `n8n_tmdb_credential_id` / `n8n_omdb_credential_id`.
- [ ] **Step 3: Create the data tables** `cinema_films` and `cinema_status` with the Global Constraints columns, through the n8n MCP `create_data_table`. Confirm with `search_data_tables`.
- [ ] **Step 4: Commit** the four files above with the message "Configure cinemas, FlareSolverr network and TMDB/OMDb credentials". Don't stage `vars/vault.yml` or `roles/docker-daemon/*`.

### Task 9: `cinema-collect` workflow

**Files:**
- Create: `roles/n8n/templates/workflows/cinema-collect.json.j2`
- Create glue in `roles/n8n/files/cinema/nodes/`: `requests.js`, `read.js`, `lookups.js`, `assemble.js`

**Interfaces:**
- Consumes: everything from Tasks 1–5 and 7 (`statusUpdates`).
- Produces: the workflow returns one item, `{screenings: Screening[], films: {[filmKey]: Film}, errors: Array<{cinemaKey, message}>, okCinemaKeys: string[], statusRows}`, which Tasks 10 and 11 consume.

Every Code node's `jsCode` is the concatenation of `core.js`, `readers/*.js`, `films.js`, `digest.js` and then its glue file. Prefix it with `const CINEMAS = <<cinemas|to_json>>; const FREE_HOURS = <<cinema_free_hours|to_json>>;`. Settings: `executionOrder v1`, `availableInMCP true`, `timezone Europe/London`, `errorWorkflow ccfmError0000001`.

**Rule for zero items:** a node with no input items stops the branch, so every lookup and fetch stage keeps one output item per input item. A skipped item gets `url: ''`. Its HTTP node uses `onError: continueRegularOutput`, so the skipped item comes out as an error item, and later Code nodes ignore it by index. Every list a stage emits has at least one item; if there's nothing to do it is a single `{skip: true}` item.

**Nodes, in order:**
1. `When called` (`executeWorkflowTrigger` v1.1, `inputSource: passthrough`).
2. `Requests` (Code, `requests.js`): one item per cinema, `{cinema, request: cinemaRequest(cinema, today)}`.
3. `Fetch` (HTTP v4.2): `method`, `url`, `contentType` and `body` come from `$json.request`. Use `sendBody` (literal `true`) with `contentType: raw`, `rawContentType ={{ $json.request.contentType ?? 'text/plain' }}` and `body ={{ $json.request.body ?? '' }}`. Set `User-Agent: Mozilla/5.0 (Macintosh) Chrome/130`, response format text, timeout `200000`, `onError: continueRegularOutput`, `retryOnFail: true, maxTries: 3, waitBetweenTries: 10000`.
4. `Retry list` (Code): for each index, if `Fetch` item `i` has `json.error`, re-emit `Requests` item `i`; otherwise emit it with `request.url = ''`.
5. `Fetch again` (same as `Fetch`).
6. `Read` (Code, `read.js`): for each cinema, use the first successful response (`Fetch`, then `Fetch again`). Run its chain's reader inside `try`/`catch`, and turn a fetch error or a `ReaderError` into `errors[]`. Output one item: `{screenings, errors, okCinemaKeys, everymanUrl: everymanMoviesUrl(screenings) ?? ''}`.
7. `Everyman films` (HTTP GET `={{ $json.everymanUrl }}`, text, `onError: continueRegularOutput`).
8. `Load film cache` (Data table `get`, `dataTableId {mode: 'name', value: 'cinema_films'}`, `returnAll: true`, `alwaysOutputData: true`).
9. `Load status` (Data table `get` on `cinema_status`, `returnAll: true`, `alwaysOutputData: true`).
10. `Plan lookups` (Code, `lookups.js`):
    - Call `attachEverymanMovies` when `Everyman films` succeeded. If it failed or throws, add an error for each Everyman cinema, drop its screenings and remove it from `okCinemaKeys`.
    - Compute `lookupPlan` over the unique film keys.
    - Emit one item per planned film: `{key, title, year, tmdbId, need, searchUrl: tmdbId ? '' : tmdbSearchUrl(...)}`, or a single `{skip: true}` item.
11. `TMDB search` (HTTP GET `={{ $json.searchUrl }}`, `authentication: genericCredentialType`, `genericAuthType: httpBearerAuth`, credential `cinemaTmdb000001`, JSON response, `onError: continueRegularOutput`).
12. `Pick match` (Code): per index, `tmdbId = plan.tmdbId ?? pickTmdbMatch(search, plan)`; emit `{...plan, tmdbId, movieUrl: (need === 'full' && tmdbId) ? tmdbMovieUrl(tmdbId) : ''}`.
13. `TMDB movie` (HTTP GET `={{ $json.movieUrl }}`, TMDB credential, `onError: continueRegularOutput`).
14. `Pick IMDb` (Code): per index, `imdbId` from the movie response, else from the cached row; emit `{..., omdbUrl: imdbId ? omdbUrl(imdbId) : ''}`.
15. `OMDb` (HTTP GET `={{ $json.omdbUrl }}`, `genericAuthType: httpQueryAuth`, credential `cinemaOmdb000001`, `onError: continueRegularOutput`).
16. `Assemble` (Code, `assemble.js`):
    - Build `films` from the cache plus the fresh lookups, then `mergeFilm` per film key.
    - Build the cache rows to upsert: `{key, data: JSON.stringify(film), override_tmdb_id, fetched_at, ratings_at}`.
    - Compute `statusUpdates`.
    - Output the single item described in Produces, plus `cacheRows` and `statusRowsToSave`.
17. `Rows to save` (Code): emit `cacheRows` and `statusRowsToSave` as separate items tagged `table`, then two `Data table upsert` nodes, behind an IF node on `table`, matching on `key` / `cinema_key`. This is a side branch: the workflow's return value is the `Assemble` output, so set `Assemble` as the last node on the main path and connect the save branch from it in parallel.

- [ ] **Step 1: Write the glue files and the template.** Validate the rendered JSON locally with Ansible's own Python (it has `jinja2` and `yaml`):

```sh
"$(brew --prefix ansible)/libexec/bin/python" - <<'EOF'
import json, jinja2, yaml
env = jinja2.Environment(variable_start_string='<<', variable_end_string='>>', loader=jinja2.FileSystemLoader('roles/n8n/templates'))
env.globals['lookup'] = lambda kind, path: open('roles/n8n/files/' + path).read()
d = yaml.safe_load(open('roles/n8n/defaults/main.yml'))
out = env.get_template('workflows/cinema-collect.json.j2').render(cinemas=d['cinemas'], cinema_free_hours=d['cinema_free_hours'])
json.loads(out); print('ok')
EOF
```

Expected: `ok`. Check each Code node's `jsCode` with `node --check`: write it to a temp file wrapped in `(async function(){ … })`.

- [ ] **Step 2: Run the n8n MCP `validate_workflow`** on the rendered JSON. Expected: no errors.
- [ ] **Step 3: Deploy** with `ansible-playbook playbook.yml --tags n8n < /dev/null`. Expected: `failed=0`.
- [ ] **Step 4: Live-test** with MCP `execute_workflow` on `cinemaCollect001`, then `get_workflow_execution`.
  - Expected: the four cinemas are in `okCinemaKeys`, `errors` is empty, `screenings` includes BFI rows, and `films` has entries with `imdbRating`.
  - Check the `cinema_films` table has rows.
  - Then check retries: temporarily change the BFI URL to an unknown host in the rendered workflow through MCP `update_workflow`, run it again, and confirm `errors` names `bfi-imax` while the other cinemas still read. Re-import from the repo afterwards to restore it.
- [ ] **Step 5: Commit** the template and the `nodes/*.js` glue: "Add cinema-collect workflow".

### Task 10: `cinema-sync` workflow

**Files:** Create `roles/n8n/templates/workflows/cinema-sync.json.j2` and `roles/n8n/files/cinema/nodes/sync.js`.

**Interfaces:**
- Consumes: the `cinema-collect` output (Task 9), `eventBody`, `planSync`, `calendarOps` (Task 6), `buildAlert` (Task 7).

**Nodes:**
1. `Every day 07:00` (schedule, cron `0 7 * * *`).
2. `Collect` (`executeWorkflow` v1.2, `workflowId {__rl: true, mode: 'id', value: 'cinemaCollect001'}`, `options.waitForSubWorkflow: true`).
3. `List events` (HTTP GET `https://www.googleapis.com/calendar/v3/calendars/<< cinema_calendar_id | urlencode >>/events`, query `timeMin ={{ $now.toISO() }}`, `singleEvents=true`, `maxResults=2500`, `privateExtendedProperty=cinemaManaged=true`, Google Calendar credential as in `ccfm-sync`).
4. `Plan` (Code, `sync.js`):
    - `wanted` = captioned screenings (`classify`) that fit free hours, joined to film and cinema.
    - `now` = London time as `YYYY-MM-DDTHH:MM`.
    - Outputs `{ops: calendarOps(plan), alert: (errors.length || capped.length) ? buildAlert(...) : null}`.
    - `executionUrl` = `<< n8n_tailnet_url >>/workflow/{{$workflow.id}}/executions/{{$execution.id}}`, built in JS from `$workflow.id` and `$execution.id`.
5. `One item per op` → `Apply op` (copy the CCFM `sync-split` / `sync-apply` nodes, using `cinema_calendar_id`).
6. `Only if problems` → `Email alert` (Gmail, HTML, to `<< cinema_email_to >>`).

- [ ] **Step 1: Write the template and `sync.js`; render-check and `validate_workflow`** as in Task 9.
- [ ] **Step 2: Deploy and run it once** through MCP. Expected: the calendar gains the captioned, fitting screenings (on 18 Oct data: The Uprising, The Social Reckoning, The Lost Children of Tuam, Verity and the BFI rows that fit), with no alert email. Run it again and confirm the second run has 0 ops.
- [ ] **Step 3: Commit**: "Add cinema-sync workflow".

### Task 11: `cinema-digest` workflow and docs

**Files:**
- Create: `roles/n8n/templates/workflows/cinema-digest.json.j2`, `roles/n8n/files/cinema/nodes/digest.js`
- Modify: `roles/n8n/README.md` (new "Cinema workflows" section)

**Nodes:**
1. `Fridays 09:00` (cron `0 9 * * 5`).
2. `Collect` (as in Task 10).
3. `Build digest` (Code, `nodes/digest.js`): `buildDigest({today, screenings, films, cinemas: CINEMAS, errors, notes: staleNotes({statusRows, today, cinemas: CINEMAS})})`.
4. `Send digest` (Gmail, `emailType html`, `message ={{ $json.html }}`, subject `={{ $json.subject }}`, to `<< cinema_email_to >>`, `appendAttribution: false`).

- [ ] **Step 1: Write the template, glue, render-check, `validate_workflow` and deploy.**
- [ ] **Step 2: Run it once** through MCP. Expected: one email arrives with subject `🎬 Subtitled Cinema Screenings: <today> – <today+13>`. Ask the owner to check:
  - the images
  - the ratings
  - the links: trailer, booking and calendar
  - the foreign-language section
- [ ] **Step 3: Update the README.** Cover:
  - the workflows table
  - the hand-made pieces: the "Subtitled Cinema Screenings" calendar and its vault ID, and the TMDB/OMDb vault keys
  - how to add a cinema (one `cinemas` entry; a new chain needs a reader in `readers/` plus a branch in `cinemaRequest` and `read.js`)
  - the data tables and fixing a wrong film match with `override_tmdb_id`
  - the BFI `kind` switch
  - FlareSolverr
  - the tests command
  - how to refresh each fixture:
    - Picturehouse: `curl -s -X POST https://www.picturehouses.com/api/scheduled-movies-ajax -d cinema_id=024`
    - Everyman: the schedule and movies URLs from Task 3
    - BFI: the FlareSolverr POST through `ansible synology -m shell`
- [ ] **Step 4: Run both test suites**; expected: all pass.
- [ ] **Step 5: Commit**: "Add cinema-digest workflow and document the cinema automation".

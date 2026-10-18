# Subtitled Screenings Automation: Design

Russell is deaf and only goes to screenings with subtitles. Today they check
each cinema's "subtitled" page by hand and picks films they're interested in.
This design gathers the deaf/HoH captioned screenings from their regular
cinemas into a Google Calendar, and emails a Friday digest of the next two
weeks so they can decide what to see without visiting four websites.

It is built in n8n next to the Ally Pally market automation
(`docs/superpowers/specs/2026-10-16-ally-pally-market-design.md`) and follows
the same patterns: logic in plain JS files with Node tests, workflows as
Jinja templates rendered and imported by Ansible, Google credentials shared.

## Goals

- A Google Calendar of every **deaf/HoH captioned** screening at their cinemas
  that fits their free hours.
- A **Friday 09:00 digest** email of the next two weeks, organised by film,
  pleasant to read: big image, ratings, synopsis, trailer, booking links.
- The digest also lists **foreign-language films with English subtitles** in a
  compact section at the bottom (these are not in the calendar).
- **Loud failure** when a site changes or can't be read, so they can fix the
  reader. A broken cinema must never look like a quiet week.
- The cinema list is **central config** and will grow. Adding another branch
  of a supported chain is one config entry.

## Non-goals

- Choosing films for them, or any "interested" / watchlist filtering.
- Booking tickets.
- Bank holidays: treated as ordinary weekdays (builder's call).
- Showing other accessible formats (audio description, relaxed screenings).

## Anti-goals

- Missing a captioned screening because a reader silently returned nothing.
- Deleting calendar events because a cinema's fetch failed.
- Foreign-language subtitled screenings appearing in the calendar (they only
  want captioned ones there; they'd crowd it, e.g. one film had ~15 showings
  in a fortnight).
- An unreadable, image-heavy digest where the captioned films are buried.

## Decisions (agreed 2026-10-18)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Free hours | Weekends any time. Weekdays only if the screening **starts** before 09:00 or at/after 17:00. Configurable. |
| D2 | Calendar contents | Captioned (deaf/HoH) screenings that fit D1, every cinema, as far ahead as each site lists. |
| D3 | Calendar | A new dedicated Google calendar named "Subtitled Cinema Screenings", created by hand; ID in the vault. |
| D4 | Digest timing | Fridays 09:00 Europe/London. Window: that Friday through the Thursday 13 days later. Only screenings fitting D1. |
| D5 | Digest layout | Subject and heading `🎬 Subtitled Cinema Screenings: <Fri date> – <Thu date>`. "Layout B" (mockup chosen): per film, a wide image, title linked to the trailer, IMDb and Rotten Tomatoes ratings, runtime, short synopsis, then a small table of cinema / day / times with each time a booking link. Films ordered by their first screening. |
| D6 | Foreign-language section | Bottom of the digest, compact: one line per film with title, ratings, cinemas and dates. No images. |
| D7 | Film info | TMDB for image, synopsis, runtime, trailer, IMDb ID and original language. OMDb (by IMDb ID) for the IMDb rating and Rotten Tomatoes score. Missing values are simply left out. Unmatched films fall back to whatever the cinema provides. |
| D8 | Empty weeks | The digest still sends and says there are no captioned screenings. |
| D9 | Breakage | A cinema that can't be fetched or parsed fails on its own: the others still sync, its calendar events are left untouched, an alert email names the cinema and the error, and the digest carries a note at the top. |
| D10 | BFI IMAX | Fetched through FlareSolverr on the NAS (re-enabled in this branch). |
| D11 | Sync frequency | Daily. (My call: cinemas add screenings through the week, so page-change triggers don't fit.) |
| D12 | Repo | Source of truth, as with CCFM. UI edits are overwritten on import. |

## Cinemas (observed 2026-10-18)

| Cinema | Chain | Chain ID | How to read it |
|---|---|---|---|
| Picturehouse Crouch End | picturehouse | `024` | JSON API, plain HTTP |
| Picturehouse Finsbury Park | picturehouse | `029` | JSON API, plain HTTP |
| Everyman Muswell Hill | everyman | `X06SN` | JSON API, plain HTTP |
| BFI IMAX | bfi | (one page) | HTML behind a Cloudflare check, via FlareSolverr |

Over 18 Oct – 1 Nov 2026: 45 subtitled/captioned screenings, 26 fitting their
hours, of which only 4 were captioned (deaf/HoH) plus BFI's. Expect small
numbers; zero for one cinema in a fortnight is normal.

### Picturehouse

- `POST https://www.picturehouses.com/api/scheduled-movies-ajax` with form
  body `cinema_id=024`. No token or cookie needed. Returns
  `{response:"success", movies:[{ScheduledFilmId, Title, image_url,
  show_times:[{Showtime (local ISO), SessionId, ScreenName, SeatsAvailable,
  SessionAttributesNames:[...]}]}]}`.
- `SessionAttributesNames` contains **`HOHSub`** ("Subtitled (Captioned)",
  category "HOH Subtitled") for deaf/HoH screenings and **`Sub Cinema`**
  ("Subtitled") for foreign-language films with English subtitles. The
  site's `subtitled_captioned` filter mixes both.
- `image_url` works at larger sizes (`width=1280&height=720`) but quality
  varies. Titles carry suffixes such as `- Preview`, `(Re-release)` and
  prefixes such as `BarTrash Presents:`.
- The booking link format still needs finding (from the site's session
  links). `SessionId` is stable per screening.

### Everyman

- Gatsby site on the Webedia/Boxoffice platform. Same-origin API:
  - `GET https://www.everymancinema.com/api/gatsby-source-boxofficeapi/schedule?theaters={"id":"X06SN","timeZone":"Europe/London"}&from=<ISO>&to=<ISO>`
    (URL-encoded JSON). Returns
    `{X06SN:{schedule:{<movieId>:{<date>:[{id, startsAt, tags:[...], data:{ticketing:[{type,provider,urls}]}}]}}}}`.
  - Captioned screenings have the tag **`Showtime.Accessibility.ClosedCaption`**.
    There is no foreign-language flag.
  - Booking link: `data.ticketing` entry with `provider:"default"`.
  - `GET /api/gatsby-source-boxofficeapi/movies?ids=<id>&ids=<id>` gives
    title, runtime (seconds), genres, poster, stills and synopsis.
- Theatre IDs come from the site's static query data (Muswell Hill is
  `X06SN`, `timeZone` `Europe/London`).

### BFI IMAX

- `https://whatson.bfi.org.uk/imax/Online/default.asp?BOparam::WScontent::loadArticle::permalink=screenings-subtitles&BOparam::WScontent::loadArticle::context_id=`
- Plain requests get Cloudflare's 403 "Just a moment…" page. FlareSolverr
  (`POST /v1 {"cmd":"request.get","url":...,"maxTimeout":180000}`) solved it
  in 25s on the second attempt; the first timed out at 60s. Use a long
  timeout and retries.
- Every listing on this page is captioned ("descriptive subtitles of
  non-dialogue audio"). Each entry: title, `Sunday 25 October 2026 16:15`,
  venue, and a Buy link. No images or synopsis, so TMDB matters most here.
- (Found while planning.) The page embeds its listings as JS arrays,
  `searchNames : [...]` (98 column names) and `searchResults : [[...], ...]`,
  which parse as JSON. Each row has a GUID `id` (stable screening identity),
  `description` (title), `start_date` (`Sunday 25 October 2026 16:15`),
  `keywords` (`English subtitles,IMAX (with laser)`) and `additional_info`
  (the relative Buy link, under `https://whatson.bfi.org.uk/imax/Online/`).
  Read these instead of the visible HTML.
- (Found while planning.) The films listed on 18 Oct were all
  foreign-language (Hope, Godzilla Minus Zero, Pan's Labyrinth), and the
  rows only say "English subtitles". Whether they are true deaf/HoH
  subtitles is unclear, so BFI screenings are classified per cinema config
  (`kind: captioned` by default; `by-language` would use TMDB's original
  language).

## Components

1. **FlareSolverr** (`roles/flaresolverr`): already re-enabled (`state:
   "{{ docker_state }}"`). Join it to `docker_network` so n8n reaches
   `http://flaresolverr:8191`.
2. **Cinema library** (`roles/n8n/files/cinema/`), dependency-free JS like
   `ccfm.js`, split by job. Proposed layout (the builder may adjust names):
   ```
   cinema/
     core.js            normalised screening shape, free-hours filter, title
                        normalisation, grouping by film, date helpers
     readers/
       picturehouse.js  JSON → screenings; throws on unexpected shape
       everyman.js
       bfi.js           HTML → screenings
     films.js           TMDB/OMDb result → film info; cache row shape
     calendar.js        screening → event body; sync plan (create/update/delete)
     digest.js          screenings + films → {subject, html, text}
     nodes/*.js         thin per-Code-node glue
     test/*.test.js     node --test, with fixtures/ of real responses
   ```
   Ansible concatenates the needed files into each Code node's `jsCode`
   (n8n Code nodes can't import files), as the CCFM templates do.
3. **Cinema config** in `roles/n8n/defaults/main.yml`:
   ```yaml
   cinemas:
     - key: ph-crouch-end
       name: Picturehouse Crouch End
       chain: picturehouse
       chain_id: "024"
       address: …
       map_url: …
   cinema_free_hours: { weekday_before: "09:00", weekday_from: "17:00" }
   ```
   A new branch of a supported chain is one entry. A new chain needs a new
   reader.
4. **`cinema-collect` workflow** (sub-workflow, my call): fetches every
   cinema, runs its reader, enriches films through TMDB/OMDb with a cache, and
   returns `{screenings, films, errors}`. Each cinema's fetch/parse failure
   is caught and reported in `errors` rather than failing the run.
5. **`cinema-sync` workflow**: daily schedule → collect → plan calendar ops
   for captioned, fitting screenings → apply → alert email if `errors` is
   non-empty.
6. **`cinema-digest` workflow**: Friday 09:00 → collect → build digest →
   Gmail (HTML). Remote image URLs are fine here (TMDB/Everyman are public),
   so no inline MIME is needed.
7. **Error workflow**: reuse `ccfm-error`; its email is already generic
   (`n8n failed: <workflow name>`). The builder may rename its display name.

## Film info and cache

- Match on normalised title, using year where available (TMDB search).
  Store results in an n8n data table, one row per normalised title plus
  year when known (my call, so remakes don't share a row): TMDB ID,
  IMDb ID, image, synopsis, runtime, trailer URL, original language, IMDb
  rating, RT score, fetched date, and a manual-override column so a wrong
  match can be fixed in the table instead of in code.
- Ratings refresh weekly (they change for new releases); the rest is kept.
- Keys: `vault_tmdb_api_key`, `vault_omdb_api_key`, added to the vault by
  Russell. Free tiers are ample.

## Calendar events

- Title `🎬 <film> – <cinema name>` (agreed; the calendar only holds captioned screenings). Start at the screening
  time, end after the TMDB/cinema runtime (fallback: 2 hours).
- Location: cinema address. Description: booking link, ratings, trailer
  link, one-line synopsis, map link.
- Identity: private extended properties holding the cinema key and the
  chain's screening ID (BFI: the row GUID). The sync only touches its own
  future events.
- Screenings that vanish are deleted, but only for cinemas that read
  successfully this run. Changed details are updated silently.
- Safety cap, as in CCFM (my call): if more than 3 future events for one
  cinema vanish in one run, delete none of that cinema's events and send an
  alert instead. This catches a partial but parseable page.
- Calendar ID: `vault_cinema_calendar_id`. Email recipient reuses
  `vault_ccfm_email_to` (my call), exposed as `cinema_email_to`.

## Breakage detection

Each reader throws (rather than returning `[]`) when:
- the fetch fails after retries (BFI: 3 tries, 180s FlareSolverr timeout);
- the response is not the expected shape (missing keys, unexpected JSON,
  BFI page without its listing markup, a Cloudflare page);
- a recognisable field can't be parsed (for example an unreadable date).

Zero captioned screenings is **not** an error; it is normal for these
cinemas. The alert email names the cinema, the error and the execution link.
It is sent on every run that has errors, so a cinema that stays broken
sends a daily reminder until it is fixed (agreed).

Renamed flags (for example Picturehouse dropping `HOHSub`) would read as
zero captioned screenings without throwing. Two guards (my call):
- Picturehouse: throw if neither `HOHSub` nor `Sub Cinema` appears anywhere
  in a cinema's response (`Sub Cinema` is always present in practice).
- Every cinema: track the date of its last captioned screening in a data
  table. If a cinema has had none for 4 weeks, the Friday digest carries a
  note ("No captioned screenings from Everyman Muswell Hill for 4 weeks; its
  reader may need checking"). A note, not an alert, because a quiet month is
  possible.

## Classification

- Picturehouse: `HOHSub` means captioned (calendar and main digest section),
  even if `Sub Cinema` is also present (my call). `Sub Cinema` alone means
  the foreign-language section.
- Everyman: only captioned screenings are read; Everyman contributes
  nothing to the foreign-language section (my call; it has no such flag and
  the source page is captioned-only).
- BFI: every listing is captioned.

## Left to the builder

- Exact node layout of the workflows, and how per-cinema failures are
  caught in n8n.
- Picturehouse booking link format; BFI Buy link extraction.
- Title normalisation rules beyond the examples above.
- Digest HTML details, within the agreed layout.
- Sync time of day (suggest 07:00).

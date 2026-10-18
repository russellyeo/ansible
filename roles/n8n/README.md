# n8n

Workflow automation. Runs the Ally Pally farmers' market (CCFM) calendar
sync and Saturday reminder, and the subtitled cinema screenings calendar and
Friday digest.

## URLs

- `http://n8n.home.arpa`: LAN, through Traefik. Keeps working when the
  internet connection drops.
- `https://n8n.<tailnet>.ts.net`: tailnet only, through the `n8n-tailscale`
  sidecar (`tailscale serve`, not Funnel). This is `N8N_EDITOR_BASE_URL`, so
  OAuth callbacks and links in emails use it.

The sidecar's auth key is `vault_tailscale_authkey`; it is only used on first
start (`TS_AUTH_ONCE`), after which the node identity lives in
`{{ config_directory }}/n8n-tailscale/state`.

## CCFM workflows

| Workflow | Trigger | Does |
|---|---|---|
| `CCFM: sync Ally Pally market calendar` | Mon 07:00, and `POST /webhook/ccfm-sync` from changedetection.io | Parses the schedule page and creates, moves or deletes events in the Ally Pally Market calendar. Emails only for surprises (a date moved or vanished). |
| `CCFM: Saturday market reminder` | Sat 18:00 | Emails where Sunday's market is. |
| `CCFM: email on failure` | Error workflow of the other two | Emails the error and an execution link. |

The workflows are defined in `templates/workflows/*.json.j2` and the logic in
`files/ccfm/ccfm.js`, which is pasted into the Code nodes. Ansible renders the
templates (with `<< >>` delimiters, leaving n8n's `{{ }}` alone) and imports
and publishes any that changed. **Edits made in the n8n UI are overwritten on
the next import**: make changes here instead. To force a re-import, delete the
rendered file in `{{ config_directory }}/n8n/workflows/` and re-run
`ansible-playbook playbook.yml --tags n8n`.

Import is skipped until both credential IDs are set in `group_vars/synology.yml`.

### Emails

The reminder is an HTML email with a photo of that week's location
(`files/ccfm/photos/<location>.jpg`, about 60 KB each). Gmail can't fetch
images from the NAS, so the photo is attached inline (`cid:`): Ansible
base64-encodes the photos into the "Build reminder" Code node, `buildMime` in
`ccfm.js` builds the MIME message, and "Send reminder" posts it to the Gmail
API (`users.messages.send`) with the `Gmail` credential. The n8n Gmail node
can't send inline images. To change a photo, replace the JPEG (keep it small)
and redeploy.

The change email is HTML through the Gmail node; the failure email is plain
text. Synced events whose title, location or description no longer match
`eventBody` (after a rename or a new map link) are updated on the next sync
without an email. A synced event deleted by hand in Google Calendar is
recreated on the next sync.

### Tests

```sh
node --test 'roles/n8n/files/ccfm/test/*.test.js'
```

When the page layout changes, refresh the fixture and update the expected
dates in `test/parse.test.js`:

```sh
curl -s -A 'Mozilla/5.0' https://www.weareccfm.com/our-markets/alexandra-palace/ \
  -o roles/n8n/files/ccfm/test/fixtures/alexandra-palace-$(date +%F).html
```

## Cinema workflows

Captioned (deaf/HoH) screenings at the cinemas in `cinemas`
(`defaults/main.yml`) go into the **Subtitled Cinema Screenings** calendar,
and a Friday digest covers the next two weeks. Weekday screenings count only
if they start before 09:00 or at/after 17:00 (`cinema_free_hours`).

| Workflow | Trigger | Does |
|---|---|---|
| `Cinema: collect subtitled screenings` | Called by the other two (or "Run manually") | Fetches and reads every cinema, looks films up on TMDB/OMDb, returns `{screenings, films, errors, okCinemaKeys, statusRows}` |
| `Cinema: sync Subtitled Cinema Screenings calendar` | Daily 07:00 | Creates, updates and deletes calendar events; emails an alert when a cinema can't be read, or holds back deletions when more than 3 (or all) of a cinema's screenings vanish at once |
| `Cinema: Friday digest of subtitled screenings` | Fri 09:00 | Emails the next two weeks by film: captioned first, then foreign-language films with English subtitles |

Logic lives in `files/cinema/` (`core.js`, `readers/*.js`, `films.js`,
`calendar.js`, `digest.js`), concatenated into the Code nodes with the
per-node glue in `files/cinema/nodes/`. As with CCFM, edit here, not in the
UI.

### Cinemas

| Chain | How it's read | `chain_id` |
|---|---|---|
| `picturehouse` | `POST /api/scheduled-movies-ajax`; `HOHSub` = captioned, `Sub Cinema` = foreign-language | Picturehouse cinema number (`024` Crouch End) |
| `everyman` | Boxoffice API `schedule` + `movies`; tag `Showtime.Accessibility.ClosedCaption` | Theatre ID (`X06SN` Muswell Hill), from the site's `page-data/sq/d/*.json` |
| `bfi` | The subtitles page through FlareSolverr (Cloudflare), embedded `searchResults` data | none |

Another branch of a supported chain is one more `cinemas` entry. A new
chain needs a reader in `readers/`, a branch in `cinemaRequest` (`core.js`)
and an entry in `READERS` (`nodes/read.js`).

BFI labels its screenings only "English subtitles", so `kind` on the BFI
entry decides where they go: `captioned` (calendar and main section) or
`by-language` (foreign-language films go to the digest's bottom section,
using TMDB's original language).

A cinema that can't be fetched or read is retried once after 60 s, then
reported in the alert and at the top of the digest; its calendar events are
left alone. Everyman's API intermittently answers n8n with a Cloudflare 502,
so expect the odd Everyman alert. If a cinema shows no captioned screenings
for 4 weeks, the digest says its reader may need checking.

### Film info

TMDB (`TMDB` credential, the API Read Access Token) and OMDb (`OMDb`
credential) keys come from `vault_tmdb_api_read_access_token` and
`vault_omdb_api_key`; `tasks/credentials.yml` imports them. Results are
cached in the `cinema_films` data table, one row per normalised title (plus
year when known); ratings refresh weekly. To fix a wrong match, put the
right TMDB ID in that row's `override_tmdb_id`. `cinema_status` holds each
cinema's last captioned date. Both tables were created by hand (n8n MCP
`create_data_table`, string columns) and are referenced by name.

### Tests

```sh
node --test 'roles/n8n/files/cinema/test/*.test.js'
```

To refresh fixtures (then update expected counts in the tests):

```sh
curl -s -X POST https://www.picturehouses.com/api/scheduled-movies-ajax \
  -H 'Content-Type: application/json' -d '{"cinema_id":"024"}' \
  -o roles/n8n/files/cinema/test/fixtures/picturehouse-024-$(date +%F).json
# Everyman: the schedule URL from cinemaRequest, and the movies URL from
# everymanMoviesUrl, fetched with curl.
# BFI: from the NAS, POST {"cmd":"request.get","url":<BFI_URL>,"maxTimeout":180000}
# to http://localhost:8191/v1, and strip solution.cookies before committing.
```

## Google setup

Done once, by hand:

- Google Cloud project `n8n-northview` with the Google Calendar API and Gmail
  API enabled.
- Google Auth Platform: External, **In production** (a "Testing" app's
  refresh tokens expire after 7 days). Unverified is fine.
- A Web application OAuth client whose redirect URI is
  `https://n8n.<tailnet>.ts.net/rest/oauth2-credential/callback`. Google
  accepted the `ts.net` URI directly; no localhost fallback was needed.
- n8n credentials `Google Calendar` (Google Calendar OAuth2 API) and `Gmail`
  (Gmail OAuth2 API), sharing that client. Their IDs are in
  `group_vars/synology.yml`.
- A calendar named `Ally Pally Market`; its ID is `vault_ccfm_calendar_id`.
- A calendar named `Subtitled Cinema Screenings` (Europe/London); its ID is
  `vault_cinema_calendar_id`.

## Gotchas

- n8n runs as `servarr_uid`, which has no passwd entry, hence
  `N8N_USER_FOLDER` and the `n8n-cache` mount for `~/.cache`.
- `import:workflow --activeState=fromJson` only works in queue mode, so
  workflows are published with `n8n publish:workflow --id=...` after import.
- n8n 2.x only calls a published error workflow.
- `n8n execute` cannot run alongside the server (task broker port clash). Run
  workflows from the editor or through the n8n MCP server instead.
- `/healthz` answers before webhooks are registered; after a restart, wait
  for `/webhook/ccfm-sync` to stop returning 404.

# n8n

Workflow automation. It runs two sets of workflows:

- **CCFM**: keeps a calendar of where the Ally Pally farmers' market is each
  Sunday, and sends a Saturday reminder.
- **Cinema**: keeps a calendar of subtitled cinema screenings, and sends a
  Friday digest.

## URLs

| URL | Reached from | Through |
|---|---|---|
| `http://n8n.home.arpa` | LAN | Traefik. Works even when the internet is down. |
| `https://n8n.<tailnet>.ts.net` | Tailnet only | The `n8n-tailscale` sidecar (`tailscale serve`, not Funnel) |

### Why the Tailscale sidecar exists

Google sign-in needs an HTTPS callback URL, and it rejects
`http://n8n.home.arpa`. The sidecar gives n8n a real HTTPS address on the
tailnet, so that address is n8n's `N8N_EDITOR_BASE_URL`. n8n uses it for:

- **The Google OAuth callback.** The Google Calendar and Gmail credentials are
  tied to it (see [Google setup](#google-setup)).
- **Links in emails.** Execution links in the failure and cinema alert emails
  only open on a device that's on the tailnet.

Remote access to the editor is a bonus. **Don't remove the sidecar.** The
Google credentials keep working without it, but you couldn't reconnect them
when they next need it.

Webhooks don't go through the sidecar. `WEBHOOK_URL` is the LAN address.

The sidecar's auth key is `vault_tailscale_authkey`. It's only used on first
start (`TS_AUTH_ONCE`). After that, the node identity lives in
`{{ config_directory }}/n8n-tailscale/state`.

## Editing workflows

Every workflow lives in this repo:

- The workflow itself is a template in `templates/workflows/*.json.j2`.
- Its code is in `files/ccfm/` or `files/cinema/`, pasted into the Code nodes.

Ansible renders the templates and imports and publishes any that changed. The
templates use `<< >>` delimiters, so n8n's own `{{ }}` expressions are left
alone.

**Edits made in the n8n UI are overwritten on the next import.** Make changes
here instead.

To force a re-import, delete the rendered file in
`{{ config_directory }}/n8n/workflows/` and run:

```sh
ansible-playbook playbook.yml --tags n8n
```

Nothing is imported until both Google credential IDs are set in
`group_vars/synology.yml`.

## CCFM workflows

| Workflow | Runs | Does |
|---|---|---|
| `CCFM: sync Ally Pally market calendar` | Mon 07:00, and when changedetection.io posts to `/webhook/ccfm-sync` | Reads the market's schedule page and creates, moves or deletes events in the Ally Pally Market calendar. Emails only when something surprising happens: a date moved or vanished. |
| `CCFM: Saturday market reminder` | Sat 18:00 | Emails where Sunday's market is |
| `CCFM: email on failure` | When either of the others fails | Emails the error and an execution link |

The logic is in `files/ccfm/ccfm.js`.

### Emails

- **Reminder**: HTML, with a photo of that week's location
  (`files/ccfm/photos/<location>.jpg`, about 60 KB each).
- **Change email**: HTML, sent with the Gmail node.
- **Failure email**: plain text.

Gmail can't fetch images from the NAS, and the n8n Gmail node can't send
inline images. So the reminder is built by hand:

1. Ansible base64-encodes the photos into the "Build reminder" Code node.
2. `buildMime` in `ccfm.js` builds the MIME message with the photo inline
   (`cid:`).
3. "Send reminder" posts it to the Gmail API (`users.messages.send`) using the
   `Gmail` credential.

To change a photo, replace the JPEG (keep it small) and redeploy.

### How the sync treats existing events

- An event whose title, location or description is out of date (after a
  rename or a new map link) is updated quietly on the next sync.
- An event you delete by hand in Google Calendar comes back on the next sync.

### Tests

```sh
node --test 'roles/n8n/files/ccfm/test/*.test.js'
```

When the page layout changes, save a new copy of the page, then update the
expected dates in `test/parse.test.js`:

```sh
curl -s -A 'Mozilla/5.0' https://www.weareccfm.com/our-markets/alexandra-palace/ \
  -o roles/n8n/files/ccfm/test/fixtures/alexandra-palace-$(date +%F).html
```

## Cinema workflows

These find captioned screenings (for deaf and hard-of-hearing viewers) at the
cinemas listed in `cinemas` (`defaults/main.yml`). Screenings go into the
**Subtitled Cinema Screenings** calendar, and a Friday digest covers the next
two weeks.

On weekdays, only screenings that start before 09:00 or at 17:00 or later
count (`cinema_free_hours`).

| Workflow | Runs | Does |
|---|---|---|
| `Cinema: collect subtitled screenings` | When the other two call it, or by hand | Reads every cinema, looks films up on TMDB and OMDb, and returns `{screenings, films, errors, okCinemaKeys, statusRows}` |
| `Cinema: sync Subtitled Cinema Screenings calendar` | Daily 07:00 | Creates, updates and deletes calendar events, and emails an alert when something needs a look (see [Safety checks](#safety-checks)) |
| `Cinema: Friday digest of subtitled screenings` | Fri 09:00 | Emails the next two weeks, grouped by film: captioned first, then foreign-language films with English subtitles |

The logic is in `files/cinema/`: `core.js`, `readers/*.js`, `films.js`,
`calendar.js` and `digest.js`. These are joined together in each Code node,
with that node's own code from `files/cinema/nodes/`.

### Cinemas

| Chain | How it's read | `chain_id` |
|---|---|---|
| `picturehouse` | `POST /api/scheduled-movies-ajax`. `HOHSub` means captioned and `Sub Cinema` means foreign-language. | Picturehouse cinema number (`024` is Crouch End) |
| `everyman` | Boxoffice API `schedule` and `movies`, tag `Showtime.Accessibility.ClosedCaption` | Theatre ID (`X06SN` is Muswell Hill), found in the site's `page-data/sq/d/*.json` |
| `bfi` | The subtitles page, fetched through FlareSolverr to get past Cloudflare, then its embedded `searchResults` data | None |

- **Adding another branch** of a supported chain takes one more `cinemas`
  entry.
- **Adding a new chain** needs a reader in `readers/`, a branch in
  `cinemaRequest` (`core.js`) and an entry in `READERS` (`nodes/read.js`).

BFI labels every screening "English subtitles", so the `kind` on the BFI
entry decides where they go:

- `captioned`: into the calendar and the digest's main section.
- `by-language`: foreign-language films (by TMDB's original language) go to
  the digest's bottom section.

### Safety checks

- **A cinema can't be read.** It's retried once after 60 seconds. If it still
  fails, it's named in the alert email and at the top of the digest, and its
  calendar events are left alone.
- **Screenings vanish.** If more than 3 of a cinema's screenings disappear at
  once, or all of them while its listing comes back empty, the deletions are
  held back and the alert email names them.
- **A cinema goes quiet.** If it shows no captioned screenings for 4 weeks,
  the digest says its reader may need checking.
- **Duplicate events.** Extra copies of a screening (same `cinemaKey` and
  `cinemaSourceId`) are deleted.

### Why some nodes look odd

- **GET and POST use separate fetch nodes.** n8n's shared HTTP node sends a
  body even with GET, and Everyman's API answers that with a Cloudflare 502.
- **"Apply calendar op" never retries.** A node retry re-sends every
  operation, and one rate-limited insert once left five copies of each event.
  A failed operation is picked up by the next day's sync instead.

### Film info

- **API keys**: TMDB (the `TMDB` credential, using the API Read Access Token)
  and OMDb (the `OMDb` credential). The keys come from
  `vault_tmdb_api_read_access_token` and `vault_omdb_api_key`, and
  `tasks/credentials.yml` imports them.
- **`cinema_films` data table**: caches film info, one row per normalised
  title (plus the year when known). Ratings refresh weekly. To fix a wrong
  match, put the right TMDB ID in that row's `override_tmdb_id`.
- **`cinema_status` data table**: holds the date each cinema last showed a
  captioned screening.

Both tables were created by hand (n8n MCP `create_data_table`, string
columns) and the workflows find them by name.

### Tests

```sh
node --test 'roles/n8n/files/cinema/test/*.test.js'
```

To refresh the saved responses (then update the expected counts in the
tests):

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

- **Google Cloud project** `n8n-northview`, with the Google Calendar API and
  Gmail API turned on.
- **Google Auth Platform**: External and **In production**. Unverified is
  fine. Don't leave it in "Testing": its refresh tokens expire after 7 days.
- **OAuth client** (Web application) with the redirect URI
  `https://n8n.<tailnet>.ts.net/rest/oauth2-credential/callback`. Google
  accepted the `ts.net` address as it is. This is why the
  [Tailscale sidecar](#why-the-tailscale-sidecar-exists) exists.
- **n8n credentials** `Google Calendar` (Google Calendar OAuth2 API) and
  `Gmail` (Gmail OAuth2 API), both using that client. Their IDs are in
  `group_vars/synology.yml`.
- **Calendars**:
  - `Ally Pally Market`. Its ID is `vault_ccfm_calendar_id`.
  - `Subtitled Cinema Screenings` (Europe/London). Its ID is
    `vault_cinema_calendar_id`.

## Gotchas

- **n8n runs as `servarr_uid`, which has no home directory.** That's why
  `N8N_USER_FOLDER` is set and `~/.cache` is mounted from `n8n-cache`.
- **Workflows are published in a separate step.** `import:workflow
  --activeState=fromJson` only works in queue mode, so each import is
  followed by `n8n publish:workflow --id=...`.
- **The error workflow must be published.** n8n 2.x won't call it otherwise.
- **`n8n execute` doesn't work while the server is running**, because both
  want the task broker port. Run workflows from the editor or through the
  n8n MCP server.
- **`/healthz` is ready before the webhooks are.** After a restart, wait until
  `/webhook/ccfm-sync` stops returning 404.

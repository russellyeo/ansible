# n8n

Workflow automation. Runs the Ally Pally farmers' market (CCFM) calendar
sync and Saturday reminder.

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

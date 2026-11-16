# Tautulli

Monitors Plex: who's watching what right now, play history, and statistics.

`http://tautulli.home.arpa` / `https://tautulli.russellyeo.dev`. It has no
login (Traefik is only reachable from the LAN and the tailnet, as for the
*arrs).

## What the role sets

`tasks/config.yml` writes these keys into `config.ini`:

| Setting | Value |
|---|---|
| Plex server | The bridge gateway (`docker_bridge_gateway:32400`), with `plex_api_key`, set as a manual URL so Tautulli doesn't swap in one from plex.tv |
| Plex identifier | Read from Plex's `/identity` on each run |
| Setup wizard | Marked done (`first_run_complete`) |

Tautulli writes its settings back to `config.ini` when it shuts down, so an
edit made while it runs would be lost. The role checks the keys first and only
when one differs does it stop Tautulli, edit the file, and start it again.
On the first run Tautulli creates `config.ini`, and the role then sets these.

Everything else (notifications, history, users) is set in the UI.

## Not set up

- **Homepage widget**: needs Tautulli's API key (Settings → Web Interface →
  API). Add it to the vault as `vault_tautulli_api_key` and the widget labels
  can be added to `tasks/container.yml`.
- **Plex logs**: Tautulli can show Plex's logs if they're mounted; they aren't.

# Maintainerr

Clears out media nobody watches. A rule picks titles (for example, movies
nobody has watched in a year), and Maintainerr puts them in a Plex collection.
After a grace period it deletes them from Plex, Sonarr, Radarr and Seerr.

`http://maintainerr.home.arpa` / `https://maintainerr.russellyeo.dev`. It has
no login.

## What the role sets

Maintainerr stores its settings in SQLite. `tasks/config.yml` sets them
through its API:

| Setting | Value |
|---|---|
| Media server | Plex, at the bridge gateway (`docker_bridge_gateway:32400`), with `plex_api_key` |
| Seerr | `http://seerr:5055` with `seerr_api_key` |
| Sonarr / Radarr | `http://sonarr:8989` / `http://radarr:7878` with their API keys |
| Telemetry | Off |

A setting is only written when it differs from what the API reports. The API
masks the Plex token and the Seerr key, so a new one isn't noticed once one is
set. Update it in the UI, or clear it there and rerun the role.

## Set up in the UI

Rules and their collections. Each rule says which library, what counts as
stale, how long the grace period is, and what to do in Sonarr/Radarr (delete,
unmonitor). Start with **Delete after days** set and nothing acting on the
*arrs, check the collection in Plex, then turn the action on.

## Not set up

- **Leftover-folder cleanup**: needs the media library mounted at the path the
  *arrs report (`/data`). Not mounted, so Maintainerr can't delete files
  directly.
- **Download client**: Transmission already removes finished torrents (ratio 2
  or 3 days idle).

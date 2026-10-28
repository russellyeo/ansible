# Beszel

Records CPU, memory, disk, network and temperature history for the NAS and
other hosts. The hub is the web UI at `http://beszel.home.arpa` (container
port 8090, host port 8090). The agent runs on each monitored host and listens
on port 45876.

## Adding the NAS to the hub

The hub's systems live in its database, not in Ansible. After creating the
admin account, add the NAS under **Add System**:

| Setting | Value |
|---|---|
| Name | `northview` |
| Host / IP | `172.18.0.1` (the docker bridge gateway) |
| Port | `45876` |

Ignore the key shown in the dialog. The role already gives the agent the
hub's public key, read from `hub/id_ed25519` in the hub's data directory. If
the hub's data is lost, it creates a new key pair on its next start. Re-run
the role so the agent picks up the new public key.

The hub sits on the bridge network and the agent uses host networking, so
the hub dials the host through the bridge gateway. The NAS LAN IP also works
from the hub. Only Traefik, which is on the macvlan, can't reach the LAN IP.

## Why the NAS agent has no Docker access

Beszel can show per-container CPU and memory, but the NAS agent runs with
`DOCKER_HOST: ""`, which turns Docker monitoring off. Uptime Kuma already
alerts when a container stops, so the agent only reports host stats.

To draw container graphs, Beszel only needs to list containers and read
their stats. Docker can't grant access that narrowly:

- Anything that can reach the Docker socket gets the whole API. That
  includes `inspect`, which returns each container's environment (VPN
  credentials, API keys), and creating or exec'ing into containers, which is
  root on the NAS. Mounting the socket `:ro` only stops writes to the socket
  file. API calls still go through.
- `docker-socket-proxy` blocks every write (`POST=0`), but `CONTAINERS=1`
  allows every read under `/containers/`, including `inspect`. Homepage and
  Traefik already have this access.
- Beszel uses `inspect` itself: the hub's container details view shows
  inspect output and logs. `CONTAINER_DETAILS=false` hides that view, but the
  agent could still make the call.

This follows on from commit 2b07659, which stopped publishing the proxy's
port so that host-network containers such as Plex couldn't read container
environments.

### Options considered

| Option | Stats | Docker access |
|---|---|---|
| **Host network, Docker off (chosen)** | Accurate host CPU, memory, disk, network, temperature. No per-container stats. | None |
| Bridge network, through `docker-socket-proxy` with `CONTAINER_DETAILS=false` on the hub | Per-container CPU and memory. The network graph shows only the agent container's own traffic, not the NAS's. | Read-only, including `inspect` (container environments), same as Homepage and Traefik |
| Host network, `docker.sock` mounted, as in the Beszel docs | Everything | Full API from a host-network container: environments, plus create and exec |

To switch to the proxy option, move the agent onto `{{ docker_network }}`,
set `DOCKER_HOST: "tcp://docker-socket-proxy:{{ docker_socket_proxy_port }}"`,
add `CONTAINER_DETAILS: "false"` to the hub, and point the hub's system entry
at `beszel-agent:45876`.

## Disks

The agent reports volume3 as its root disk, because the container's
filesystem lives on that volume. Mounting a folder from volume3 under
`/extra-filesystems` is ignored as a duplicate, so the role doesn't. DSM's
system partition (`/dev/md0`) isn't shown.

# Architecture: networking

How a request gets from a phone or laptop to a container on the Synology NAS.
Diagrams are [Mermaid](https://mermaid.js.org/), so GitHub, VS Code and
Obsidian draw them, and they're edited as text next to the code they describe.

## The big picture

```mermaid
flowchart TB
    subgraph away["Away from home"]
        phone["iPhone / Mac<br/>(Tailscale on)"]
    end

    subgraph internet["Internet"]
        cf["Cloudflare DNS<br/>*.russellyeo.dev → 192.168.1.167<br/>(DNS only, never proxied)"]
        le["Let's Encrypt"]
        google["Google OAuth"]
        ts["Tailscale coordination<br/>+ DERP relays"]
    end

    subgraph lan["Home LAN 192.168.1.0/24"]
        router["Linksys router 192.168.1.1<br/>DHCP .10–.159"]
        homedev["Devices at home"]

        subgraph nas["Synology NAS 192.168.1.165"]
            subgraph macvlan["macvlan adguard_network (own LAN IPs)"]
                adguard["adguard-home<br/>192.168.1.166<br/>LAN DNS"]
                traefik["traefik<br/>192.168.1.167<br/>:80 · :443 · :8080"]
                tsr["tailscale-router<br/>192.168.1.168<br/>shares .167/32 only"]
            end

            subgraph bridge["bridge docker_network_synology 172.18.0.0/16"]
                apps["sonarr · radarr · prowlarr · bazarr<br/>seerr · homepage · ntfy · uptime-kuma<br/>beszel · changedetection · n8n …"]
                n8nts["n8n-tailscale<br/>(sidecar)"]
                proxy["docker-socket-proxy :2375"]
            end

            subgraph hostnet["host network"]
                plex["plex :32400"]
                agent["beszel-agent"]
            end
        end
    end

    homedev -- "DNS" --> adguard
    homedev -- "HTTP/HTTPS" --> traefik
    phone -. "WireGuard via tailnet" .-> tsr
    phone -. "WireGuard via tailnet" .-> n8nts
    tsr --> traefik
    traefik --> apps
    traefik -- "via bridge gateway 172.18.0.1" --> plex
    traefik -- "discovers containers" --> proxy
    n8nts -- "http://n8n:5678" --> apps
    traefik -. "DNS-01 challenge (API token)" .-> cf
    traefik -. "ACME" .-> le
    google -. "OAuth redirect to n8n.kite-hoki.ts.net" .-> phone
```

## Addresses

| What | Address | Notes |
|---|---|---|
| Router | `192.168.1.1` | DHCP hands out `.10`–`.159`. `.160`–`.254` is for fixed addresses. DNS 1 is AdGuard, DNS 2 is `1.1.1.1`. |
| NAS | `192.168.1.165` | Host ports for Transmission (`9091`, `9191`, `9291`, `9391`) and direct app ports |
| AdGuard Home | `192.168.1.166` | macvlan. LAN DNS for every device. |
| Traefik | `192.168.1.167` | macvlan + bridge. `:80` HTTP, `:443` HTTPS, `:8080` dashboard API |
| tailscale-router | `192.168.1.168` | macvlan. Tailscale subnet router for `192.168.1.167/32` only |
| Docker bridge | `172.18.0.0/16` | Gateway `172.18.0.1` is how bridge containers reach host-network ones |

## Names

Every service behind Traefik answers on two names:

| Name | Protocol | Resolved by | Works |
|---|---|---|---|
| `http://<service>.home.arpa` | HTTP | AdGuard rewrite | At home, even offline |
| `https://<service>.russellyeo.dev` | HTTPS (redirects from HTTP) | Cloudflare wildcard record, and an AdGuard rewrite | At home (even offline), and away with Tailscale on |
| `https://n8n.kite-hoki.ts.net` | HTTPS | Tailscale MagicDNS | On the tailnet. n8n's Google OAuth callback and email links. |

```mermaid
flowchart LR
    q{"Which name?"}
    q -- "*.home.arpa" --> ag1["AdGuard rewrite<br/>→ 192.168.1.167"]
    q -- "*.russellyeo.dev" --> where{"Device uses<br/>AdGuard?"}
    where -- "yes (at home)" --> ag2["AdGuard rewrite<br/>→ 192.168.1.167"]
    where -- "no (away)" --> cfd["Cloudflare wildcard A<br/>→ 192.168.1.167"]
    q -- "*.kite-hoki.ts.net" --> magic["Tailscale MagicDNS<br/>→ 100.x tailnet IP"]
```

Both AdGuard rewrites are set by the `adguard-home` role (`adguard_rewrites`).
The Cloudflare record was added by hand.

## A request from away

`https://sonarr.russellyeo.dev` on the phone, on mobile data:

```mermaid
sequenceDiagram
    participant P as iPhone (Tailscale on)
    participant C as Cloudflare DNS
    participant R as tailscale-router (.168)
    participant T as Traefik (.167)
    participant S as sonarr (bridge)

    P->>C: sonarr.russellyeo.dev?
    C-->>P: 192.168.1.167
    Note over P: 192.168.1.167/32 is a tailnet route,<br/>so the packet goes into WireGuard
    P->>R: TLS to 192.168.1.167:443 (inside WireGuard)
    R->>T: forwards on the macvlan
    T-->>P: *.russellyeo.dev certificate
    T->>S: Host: sonarr.russellyeo.dev → sonarr:8989
    S-->>P: page
```

At home the same request goes from the device straight to Traefik, or through
`tailscale-router` over the LAN when Tailscale is on.

## Certificates

Traefik holds one Let's Encrypt certificate for `*.russellyeo.dev`, stored in
`{{ config_directory }}/traefik/acme/acme.json`. Wildcards need the DNS-01
challenge, so nothing has to be open to the internet:

```mermaid
sequenceDiagram
    participant T as Traefik
    participant LE as Let's Encrypt
    participant CF as Cloudflare API

    T->>LE: order *.russellyeo.dev
    LE-->>T: prove it: put a code in _acme-challenge.russellyeo.dev
    T->>CF: create TXT record (CF_DNS_API_TOKEN, DNS edit on russellyeo.dev only)
    LE->>CF: look up the TXT record
    LE-->>T: certificate (90 days)
    T->>CF: delete TXT record
    Note over T: Renews about 30 days before expiry
```

If the Cloudflare token stops working, renewals fail, and the certificate
lapses about 30 days later. Traefik logs the failure.

## Why it's shaped like this

- **Traefik and AdGuard are on a macvlan** so they get their own LAN IPs and
  ports `53`, `80` and `443` without clashing with DSM.
- **A macvlan container can't reach its own host, and the host can't reach
  it.** Three things follow:
  - Traefik reaches host-network Plex through the bridge gateway
    `172.18.0.1` (`roles/traefik/templates/dynamic/plex.toml.j2`).
  - The NAS's own Tailscale can't route to Traefik, so `tailscale-router`
    sits on the macvlan beside it.
  - Debug Traefik backends from inside the Traefik container, not from a
    laptop.
- **`tailscale-router` shares one address, not the LAN.** Tailnet devices can
  reach Traefik's services, but not DSM, the router or other devices.
- **n8n keeps its own Tailscale sidecar.** Google OAuth needs an HTTPS
  callback, and `https://n8n.kite-hoki.ts.net` is registered with Google. See
  `roles/n8n/README.md`.
- **Nothing is reachable from the internet.** No router ports are forwarded,
  the Cloudflare record is "DNS only" to a private IP, and there's no
  Cloudflare tunnel.
- **Some apps check the hostname.** Sonarr only answers to names in its
  `<AllowedHosts>`, which the `sonarr` role sets, and Homepage only answers
  names in `HOMEPAGE_ALLOWED_HOSTS`. A new name for those needs adding there
  too.

## Adding a service

1. Put it on `{{ docker_network }}`.
2. Give it Traefik labels for both names and both entrypoints:
   ```yaml
   traefik.enable: "true"
   traefik.http.routers.<name>.rule: "Host(`<name>.{{ home_domain }}`) || Host(`<name>.{{ public_domain }}`)"
   traefik.http.routers.<name>.entrypoints: "web,websecure"
   traefik.http.services.<name>.loadbalancer.server.port: "<port>"
   homepage.href: "https://<name>.{{ public_domain }}"
   ```
3. Nothing else: the wildcard DNS records, the certificate and the tailnet
   route already cover every `*.russellyeo.dev` name.

## Manual pieces (not in Ansible)

| Piece | Where |
|---|---|
| `*.russellyeo.dev` A record → `192.168.1.167`, DNS only | Cloudflare dashboard |
| Cloudflare API token (Zone → DNS → Edit, `russellyeo.dev`) | Cloudflare, then `vault_cloudflare_dns_api_token` |
| `192.168.1.167/32` route approval, key expiry disabled for `tailscale-router` and `n8n` | Tailscale admin console |
| DHCP range `.10`–`.159`, DNS servers | Linksys router |
| Everything in `AdGuardHome.yaml` except the rewrites | AdGuard web UI |

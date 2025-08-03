# Network Architecture Documentation

This document describes the complete networking stack for the Synology-based home media server infrastructure.

## Overview

The infrastructure uses a layered networking approach combining:
- **Tailscale** for secure remote access
- **CoreDNS** for subdomain resolution 
- **Traefik** for reverse proxy and SSL termination
- **Docker** for container networking
- **Synology DSM** as the host platform

## Network Stack Components

### 1. Physical Network Layer

**Synology NAS Host:**
- IP Address: `{{ network_localhost }}`
- SSH Port: `{{ ansible_port }}`
- Platform: Synology DSM

**Network Access:**
- Local network: Private RFC1918 subnet
- Internet access via router/gateway

### 2. Tailscale Network Layer

**Purpose:** Secure mesh networking for remote access

**Configuration:**
- Tailnet domain: `{{ tailnet_host }}`
- Machine name: `{{ tailnet_synology_machine }}`
- Full hostname: `{{ tailnet_synology_machine }}.{{ tailnet_host }}`
- Tailscale IP: Assigned by Tailscale (100.x.x.x range)

**DNS Integration:**
- MagicDNS enabled for automatic hostname resolution
- Custom nameserver: `{{ network_localhost }}` for `{{ tailnet_synology_machine }}.{{ tailnet_host }}` domain
- Forwards subdomain queries to local CoreDNS instance

### 3. DNS Resolution Layer (CoreDNS)

**Purpose:** Handles subdomain resolution for service routing

**Container Configuration:**
- Docker image: `coredns/coredns:{{ docker_image_version }}`
- Port mapping: `{{ host_port }}:53/tcp,udp`
- Config location: `{{ coredns_config_directory }}`

**DNS Zones:**
- Primary domain: `{{ tailnet_synology_machine }}.{{ tailnet_host }}`
- Subdomain pattern: `{service}.{{ tailnet_synology_machine }}.{{ tailnet_host }}`
- All subdomains resolve to: `{{ network_localhost }}`

**Supported Subdomains:**
- `traefik.{{ tailnet_synology_machine }}.{{ tailnet_host }}` → Traefik dashboard
- `sonarr.{{ tailnet_synology_machine }}.{{ tailnet_host }}` → TV show management
- `radarr.{{ tailnet_synology_machine }}.{{ tailnet_host }}` → Movie management
- `overseerr.{{ tailnet_synology_machine }}.{{ tailnet_host }}` → Media requests
- `prowlarr.{{ tailnet_synology_machine }}.{{ tailnet_host }}` → Indexer management
- `bazarr.{{ tailnet_synology_machine }}.{{ tailnet_host }}` → Subtitle management
- `homepage.{{ tailnet_synology_machine }}.{{ tailnet_host }}` → Dashboard

**DNS Flow:**
```
Client Query → Tailscale DNS → CoreDNS ({{ network_localhost }}:53) → Response
```

**Upstream DNS:**
- Primary: `{{ dns_primary }}` (Cloudflare)
- Secondary: `{{ dns_secondary }}` (Cloudflare)

### 4. Reverse Proxy Layer (Traefik)

**Purpose:** HTTP/HTTPS routing and SSL termination

**Container Configuration:**
- Docker image: `traefik:{{ docker_image_version }}`
- HTTP port: `{{ traefik_web_port }}:80`
- HTTPS port: `{{ traefik_websecure_port }}:443`
- Config location: `{{ traefik_config_directory }}`

**Routing Rules:**
- Host-based routing using `Host()` matchers
- Automatic service discovery via Docker labels
- TLS termination with self-signed certificates

**Entry Points:**
- `web` (port 80): Redirects to HTTPS
- `websecure` (port 443): Main HTTPS entry point

**Example Route Configuration:**
```yaml
labels:
  traefik.enable: "true"
  traefik.http.routers.service.rule: "Host(`service.{{ tailnet_synology_machine }}.{{ tailnet_host }}`)"
  traefik.http.routers.service.entrypoints: "websecure"
  traefik.http.routers.service.tls: "true"
```

### 5. Container Network Layer

**Docker Network:**
- Network name: `docker_network_synology`
- Network type: Bridge
- Subnet: Managed by Docker

**Container Communication:**
- All media services run on the shared Docker network
- Internal service-to-service communication via container names
- External access routed through Traefik

**Service Ports:**
- Traefik: `{{ traefik_web_port }}` (HTTP), `{{ traefik_websecure_port }}` (HTTPS)
- CoreDNS: `{{ host_port }}` (DNS)
- Services expose their standard application ports internally
- External access routed through Traefik reverse proxy

### 6. Service Discovery

**Docker Labels:**
Services use Docker labels for automatic discovery by Traefik and Homepage:

```yaml
# Traefik routing
traefik.enable: "true"
traefik.http.routers.{service}.rule: "Host(`{service}.{{ tailnet_synology_machine }}.{{ tailnet_host }}`)"

# Homepage dashboard
homepage.group: "Media"
homepage.name: "Service Name"
homepage.href: "https://{service}.{{ tailnet_synology_machine }}.{{ tailnet_host }}"
```

## Network Flow Examples

### External HTTPS Request Flow

```
1. Client → DNS Query: traefik.{{ tailnet_synology_machine }}.{{ tailnet_host }}
2. Tailscale DNS → CoreDNS ({{ network_localhost }}:53)
3. CoreDNS → Response: {{ network_localhost }}
4. Client → HTTPS Request: {{ network_localhost }}:{{ traefik_websecure_port }}
5. Traefik → Route based on Host header
6. Traefik → Forward to backend service
7. Service → Response back through Traefik
8. Client receives response
```

### Internal Container Communication

```
1. Homepage → HTTP Request: service_name:service_port
2. Docker network → Direct container-to-container
3. Service → Response
```

## Security Considerations

### Network Isolation
- Services isolated within Docker network
- External access only through Traefik reverse proxy
- SSH access restricted to custom port

### TLS/SSL
- All external HTTPS traffic terminated at Traefik
- Self-signed certificates for internal services
- HTTP automatically redirected to HTTPS

### Access Control
- Tailscale provides network-level authentication
- No direct internet exposure of services
- All access requires Tailscale VPN connection

## Configuration Management

### Ansible Variables
Key networking variables defined in:
- `group_vars/synology.yml`: Network-specific settings
- `vars/main.yml`: Global networking configuration

```yaml
# Network configuration
network_localhost: "{{ network_localhost }}"
docker_network: "{{ docker_network }}"
tailnet_host: "{{ tailnet_host }}"
tailnet_synology_machine: "{{ tailnet_synology_machine }}"

# DNS servers
dns_primary: "{{ dns_primary }}"
dns_secondary: "{{ dns_secondary }}"
```

### Service Deployment
All networking components deployed via Ansible:
- `docker-network` role: Creates Docker bridge network
- `coredns` role: Deploys DNS server
- `traefik` role: Deploys reverse proxy
- Individual service roles: Configure routing labels

## Troubleshooting

### DNS Resolution Issues
```bash
# Test CoreDNS directly
dig @{{ network_localhost }} traefik.{{ tailnet_synology_machine }}.{{ tailnet_host }}

# Check Tailscale DNS
nslookup traefik.{{ tailnet_synology_machine }}.{{ tailnet_host }}

# Verify Tailscale status
tailscale status
```

### Routing Issues
```bash
# Test with host header
curl -k https://{{ network_localhost }}:{{ traefik_websecure_port }}/ -H "Host: traefik.{{ tailnet_synology_machine }}.{{ tailnet_host }}"

# Check Traefik logs
docker logs traefik

# Verify container labels
docker inspect {service} --format '{{ .Config.Labels }}'
```

### Container Network Issues
```bash
# Check Docker network
docker network ls
docker network inspect docker_network_synology

# Verify container connectivity
docker exec {service} ping traefik
```

## Maintenance

### DNS Cache Management
- Tailscale DNS changes propagate within 5-10 minutes
- Local DNS cache may need flushing after changes
- CoreDNS configuration updates require container restart

### Certificate Management
- Traefik generates self-signed certificates automatically
- Certificates are ephemeral and regenerated on restart
- Consider implementing Let's Encrypt for production use

### Service Updates
- Container updates managed by Watchtower
- Network configuration managed by Ansible
- DNS configuration changes require CoreDNS restart
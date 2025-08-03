# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Ansible infrastructure as code repository for managing a personal home media server setup on a Synology NAS. It deploys a complete media stack including Plex, Sonarr, Radarr, Transmission, and supporting services via Docker containers.

## Common Commands

### Ansible Operations
```bash
# Test connectivity to all hosts
ansible all -m ping

# Test connectivity to specific host
ansible <server> -m ping -u <username>

# List inventory
ansible-inventory --list -y

# Run main playbook
ansible-playbook playbook.yml

# Run with specific tags
ansible-playbook playbook.yml --tags container

# Run with extra variables
ansible-playbook playbook.yml --extra-vars "docker_recreate=yes"
```

### Docker Management
```bash
# List all containers
docker ps -a

# Stop container
docker stop <container>

# Remove container
docker rm <container>

# View container logs
docker logs -f <container>

# Execute shell in container
docker exec -it <container> /bin/bash
```

## Architecture

### Inventory Structure
- **synology**: Main production environment running on Synology NAS

### Core Components

**Infrastructure Roles:**
- `docker-network`: Creates bridge network for container communication
- `docker-socket-proxy`: Secure Docker API proxy for homepage dashboard
- `docker`: Installs Docker on Debian systems

**Media Stack Roles:**
- `plex`: Media server for streaming
- `sonarr`: TV show management
- `radarr`: Movie management  
- `prowlarr`: Indexer management
- `bazarr`: Subtitle management
- `transmission`: BitTorrent client (standard)
- `transmission-openvpn`: BitTorrent client with VPN
- `overseerr`: Media request management

**Supporting Services:**
- `homepage`: Dashboard with service monitoring
- `traefik`: Reverse proxy and load balancer
- `cloudflared`: Cloudflare tunnel client
- `watchtower`: Automatic container updates
- `flaresolverr`: Cloudflare solver for indexers
- `pihole`: Network-wide ad blocking

### Configuration Structure

**Variable Hierarchy:**
1. `vars/main.yml` - Global variables
2. `group_vars/synology.yml` - Synology-specific variables (paths, network, UIDs)
3. `vars/vault.yml` - Encrypted secrets (passwords, API keys, tokens)

**Role Structure:**
Each role follows Ansible best practices:
- `defaults/main.yml` - Default variables
- `tasks/main.yml` - Main task orchestration
- `tasks/file.yml` - Directory and file creation
- `tasks/container.yml` - Docker container deployment
- `templates/` - Jinja2 templates for configuration files

### Network Architecture

**Synology Setup:**
- Bridge network: `docker_network_synology`
- Docker socket proxy on port 2375
- Tailscale integration for remote access
- Cloudflare tunnels for external access

**Service Communication:**
- All containers run on shared Docker bridge network
- Homepage connects to Docker socket proxy for monitoring
- Traefik handles routing and SSL termination

## Development Workflow

### Adding New Services
1. Create role directory: `roles/<service-name>/`
2. Follow existing role structure (defaults, tasks, templates)
3. Add role to appropriate playbook
4. Update group variables if needed
5. Test with `--tags <service-name>`

### Managing Secrets
- All sensitive data goes in `vars/vault.yml`
- Reference vault variables in `vars/main.yml`
- Use descriptive vault variable names: `vault_<service>_<credential_type>`

### Testing Changes
- Use `--check` flag for dry runs
- Use specific tags to limit scope: `--tags container`
- Force recreation with `--extra-vars "docker_recreate=yes"`

## Host Setup Requirements

### Synology NAS
- Use the `ansible` user to interface with Synology DSM
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Ansible infrastructure as code repository for managing a personal home media server setup on a Synology NAS. It deploys a complete media stack including Plex, Sonarr, Radarr, Transmission, and supporting services via Docker containers.

## Common Commands

### Running the Playbook
```sh
# Run entire playbook
ansible-playbook playbook.yml

# Run with specific tags
ansible-playbook playbook.yml --tags container
ansible-playbook playbook.yml --tags <service-name>

# Force container recreation
ansible-playbook playbook.yml --extra-vars "docker_recreate=yes"

# Dry run (check mode)
ansible-playbook playbook.yml --check
```

### Managing Ansible Vault

Always ask me before editing the vault.yml file. This file contains sensitive information such as passwords and API keys.

I will manually edit the vault.yml when needed.

### Inventory Management
```sh
# List inventory
ansible-inventory --list -y

# Ping all hosts
ansible all -m ping

# Ping specific host
ansible synology -m ping
```

### Docker Commands (on remote host)
```sh
# List containers
docker ps -a

# View logs
docker logs -f <container>

# Execute shell in container
docker exec -it <container> /bin/bash

# Stop/remove container
docker stop <container>
docker rm <container>

# Clean up unused resources
docker system prune --all --volumes
```

## Architecture

### Configuration Hierarchy

**Variable precedence (lowest to highest):**
1. `roles/*/defaults/main.yml` - Role default variables
2. `vars/main.yml` - Global variables (timezone, DNS, Docker defaults)
3. `group_vars/synology.yml` - Host-specific variables (UIDs, paths, network)
4. `vars/vault.yml` - Encrypted secrets (passwords, API keys, tokens)

**Critical variables in `group_vars/synology.yml`:**
- `servarr_uid` / `servarr_gid` - User/group IDs for containers
- `config_directory` - Base path for container configs (`/volume3/homes/servarr/config`)
- `data_directory` - Base path for media data (`/volume3/servarr`)
- `docker_network` - Bridge network name (`docker_network_synology`)
- `network_localhost` - Synology NAS IP address

**Global variables in `vars/main.yml`:**
- `docker_recreate` - Controls container recreation (default: `"no"`)
- `docker_restart_policy` - Container restart policy (default: `"unless-stopped"`)
- All vault variable references use pattern: `{{ vault_<service>_<credential> }}`

### Role Task Patterns

Most roles follow a standard three-step pattern in `tasks/main.yml`:
1. `import_tasks: file.yml` - Create directories and config files
2. `import_tasks: container.yml` - Deploy Docker container
3. Optional additional tasks (e.g., `config.yml` for homepage, `unrar_completed.yml` for transmission-openvpn)

### Network Architecture

**Synology Setup:**
- Bridge network: `docker_network_synology`
- Docker socket proxy on port 2375 for secure API access
- Tailscale integration for remote access
- Cloudflare tunnels for external access

**Service Communication:**
- All containers run on shared Docker bridge network
- Homepage connects to Docker socket proxy for monitoring
- Traefik handles routing and SSL termination

### Playbook Execution Order

The main `playbook.yml` runs roles in this order:
1. `docker-network` - Creates bridge network
2. `docker-socket-proxy` - Secure Docker API access
3. `coredns` / `traefik` - DNS and reverse proxy
4. `homepage` - Dashboard
5. `cloudflared` - External access tunnel
6. Download clients: `transmission`, `transmission-openvpn`
7. Media servers: `plex`
8. Media management: `sonarr`, `radarr`, `prowlarr`, `bazarr`, `overseerr`
9. Supporting: `flaresolverr`, `watchtower`

## Development Workflow

### Adding New Services
1. Create role directory: `roles/<service-name>/`
2. Follow standard task pattern: `file.yml`, `container.yml`
3. Add default variables in `defaults/main.yml`
4. Add role to `playbook.yml` in appropriate order
5. Test with `ansible-playbook playbook.yml --tags <service-name>`

### Managing Secrets
- All sensitive data goes in `vars/vault.yml`
- Reference in `vars/main.yml` using pattern: `vault_<service>_<credential_type>`
- Never commit unencrypted secrets

### Initial Host Setup

The control node requires:
- Ansible inventory at `/etc/ansible/hosts` with `synology` group
- Ansible config at `/etc/ansible/ansible.cfg` with vault password file
- SSH key authentication to Synology NAS

The Synology NAS requires:
- User `ansible` in `administrators` group with SSH access
- Passwordless sudo configured in `/etc/sudoers.d/ansible`
- SSH authorized_keys properly configured
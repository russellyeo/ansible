# Ansible

## macOS Setup

### Install

```sh
brew install ansible
```

### Local config files

Ansible inventory file `/etc/ansible/hosts`

```toml
[synology]
home ansible_host=<host-ip-address> ansible_port=<host-ssh-port>

[all:vars]
ansible_python_interpreter=/usr/bin/python3
```

Ansible configuration file `/etc/ansible/ansible.cfg`

```toml
[defaults]
vault_password_file = ~/.vault_pass

[ssh_connection]
pipelining = True
```

### Run Playbook

```sh
# list inventory on control node
ansible-inventory --list -y

# ping hosts in inventory
ansible all -m ping
ansible <server> -m ping -u <username>

# run playbook
ansible-playbook playbook.yml

# run playbook extra arguments
--tags container
--extra-vars "docker_recreate=yes"
```

### Set up Radarr/Sonarr

#### Download client

Settings > Download Clients > Add

* Name: `Transmission VPN`
* Host: Host IP address
* Port: Host port

Settings > Download Clients > Remote Path Mappings

* Host: Host IP address
* Remote Path: `/data/completed/`
* Local Path: `/data/torrents/completed/`

## Ansible Vault
```sh
# create a new vault file
ansible-vault create vars/vault.yml

# view vault vars
ansible-vault view vars/vault.yml

# edit vault vars (close editor to re-encrypt)
ansible-vault edit vars/vault.yml

# rekey vault file(s) 
# (comment out vault_password_file in /etc/ansible/ansible.cfg before command)
ansible-vault rekey vars/vault.yml
```

## Docker
```sh
# list all docker containers
docker ps -a

# stop a container
docker stop <container>

# remove a container
docker rm <container>

# view logs for a container
docker logs -f <container>

# run a shell process inside a container
docker exec -it <container> /bin/bash

# remove unused containers, networks, volumes, images and build cache
docker system prune --all --volumes
```
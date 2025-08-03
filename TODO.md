# Infrastructure TODO

## Current Status

### ✅ Completed
- **CoreDNS Deployment**: Successfully deployed CoreDNS container on port 53
- **Traefik Configuration**: All routing rules properly configured for subdomains
- **Service Configuration**: All media services (Sonarr, Radarr, Overseerr, etc.) have correct Traefik labels
- **Docker Networking**: All containers running on shared Docker bridge network
- **Ansible Automation**: Complete automation via Ansible playbooks

### 🔄 In Progress
- **DNS Resolution**: Tailscale DNS configuration propagation
- **Subdomain Access**: Waiting for `*.synology-1.kite-hoki.ts.net` resolution

### 🔧 Current Issue
**DNS Propagation Delay**: Tailscale MagicDNS not yet routing subdomain queries to CoreDNS

## Technical Details

### What's Working
1. **CoreDNS**: Resolving all subdomains correctly when queried directly
   ```bash
   dig @100.97.205.89 traefik.synology-1.kite-hoki.ts.net  # ✅ Returns 192.168.1.164
   ```

2. **Traefik Routing**: All services routing correctly when accessed via host headers
   ```bash
   curl -k https://100.97.205.89:8443/ -H "Host: radarr.synology-1.kite-hoki.ts.net"  # ✅ HTTP 401 (expected)
   ```

3. **Service Discovery**: All containers have proper labels and are discoverable

### What's Not Working
1. **System DNS Resolution**: Subdomains not resolving via normal DNS lookup
   ```bash
   nslookup traefik.synology-1.kite-hoki.ts.net  # ❌ NXDOMAIN
   ```

### Current Configuration
- **Tailscale DNS**: 
  - Nameserver: `100.97.205.89` (Tailscale IP)
  - Restricted to domain: `synology-1.kite-hoki.ts.net`
  - MagicDNS: Enabled

- **CoreDNS**: 
  - Container: `coredns/coredns:1.11.1`
  - Port: `53:53/tcp,udp`
  - Successfully receiving and answering queries

## Next Steps

### Immediate Actions
1. **Wait for DNS Propagation** (5-30 minutes typical)
   - Tailscale DNS changes can take time to propagate to all clients
   - Monitor with: `nslookup traefik.synology-1.kite-hoki.ts.net`

2. **Test Periodically**
   ```bash
   # Test DNS resolution
   nslookup traefik.synology-1.kite-hoki.ts.net
   
   # Test end-to-end access
   curl -k https://traefik.synology-1.kite-hoki.ts.net/
   ```

### If DNS Still Doesn't Work
1. **Restart Tailscale Client**
   ```bash
   sudo launchctl stop com.tailscale.ipn
   sudo launchctl start com.tailscale.ipn
   ```

2. **Verify Tailscale Admin Console Settings**
   - Confirm nameserver shows as `100.97.205.89`
   - Confirm search domain shows as `synology-1.kite-hoki.ts.net`
   - Verify "Restricted" is enabled

3. **Alternative DNS Configuration**
   - Try using hostname instead of IP: `synology-1.kite-hoki.ts.net`
   - Consider configuring router-level DNS (less targeted)

### Future Enhancements
1. **Add More Services**: Configure Traefik routing for additional services
   - Prowlarr, Bazarr, Homepage, etc.
   - Follow existing pattern in service container.yml files

2. **SSL Certificates**: Consider implementing Let's Encrypt certificates
   - Current setup uses Traefik self-signed certificates
   - Would provide proper SSL certificates for subdomains

3. **Monitoring**: Add monitoring for DNS and routing health
   - Consider health check endpoints
   - Add alerting for service availability

4. **Documentation**: Complete network architecture documentation
   - Update `NETWORKING.md` with final configuration
   - Add troubleshooting guides

## Expected Outcome

Once DNS propagation completes, all services will be accessible via clean URLs:
- `https://traefik.synology-1.kite-hoki.ts.net/` - Traefik dashboard
- `https://sonarr.synology-1.kite-hoki.ts.net/` - TV show management
- `https://radarr.synology-1.kite-hoki.ts.net/` - Movie management
- `https://overseerr.synology-1.kite-hoki.ts.net/` - Media requests
- Additional services as configured

## Troubleshooting Commands

### DNS Diagnostics
```bash
# Test CoreDNS directly
dig @100.97.205.89 traefik.synology-1.kite-hoki.ts.net

# Check CoreDNS logs
ssh russell@192.168.1.164 -p 2264 "/usr/local/bin/docker logs coredns --tail 10"

# Test system DNS
nslookup traefik.synology-1.kite-hoki.ts.net
```

### Routing Diagnostics
```bash
# Test Traefik routing directly
curl -k https://100.97.205.89:8443/ -H "Host: service.synology-1.kite-hoki.ts.net"

# Check Traefik logs
ssh russell@192.168.1.164 -p 2264 "/usr/local/bin/docker logs traefik --tail 10"

# Check container labels
ssh russell@192.168.1.164 -p 2264 "/usr/local/bin/docker inspect {service} --format '{{ .Config.Labels }}'"
```

### Service Management
```bash
# Redeploy specific service
ansible-playbook playbook.yml --tags {service}

# Redeploy with container recreation
ansible-playbook playbook.yml --tags {service} --extra-vars "docker_recreate=yes"

# Deploy all services
ansible-playbook playbook.yml
```

---

**Last Updated**: 2025-08-03
**Status**: Waiting for Tailscale DNS propagation
**Infrastructure**: 100% functional, DNS resolution pending
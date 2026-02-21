# Nginx Proxy Manager Setup Guide

This guide explains how to configure Nginx Proxy Manager (NPM) to expose WebRelay services securely.

## Architecture Overview

```
Internet
    ↓
Nginx Proxy Manager (Port 80/443)
    ↓
┌─────────────────────────────────────────┐
│  nginx-proxy-manager network (external) │
│  ┌───────────────────────────────────┐  │
│  │ relay-server (Port 3000)          │  │
│  │ realtime-service (Port 3004)      │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  relay-network (internal)              │
│  ┌───────────────────────────────────┐  │
│  │ redis (Port 6379)                 │  │
│  │ relay-client                      │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Prerequisites

1. **Nginx Proxy Manager** installed and running
2. **Docker** and **Docker Compose** installed
3. **Domain name** pointing to your server's IP address

## Step 1: Create NPM Network

If Nginx Proxy Manager is already running, you need to find its network name:

```bash
docker network ls
```

Look for a network that NPM containers are connected to. Common names:
- `nginx-proxy-manager`
- `npm_network`
- `npm_default`

If you need to create a new network:

```bash
docker network create nginx-proxy-manager
```

## Step 2: Update Docker Compose Network Name

Edit your `docker-compose.full.yml` or `docker-compose.server.yml` and update the network name to match your NPM network:

```yaml
networks:
  relay-network:
    driver: bridge
    internal: true
  nginx-proxy-manager:
    external: true
    name: YOUR_NPM_NETWORK_NAME  # Change this!
```

## Step 3: Start WebRelay Services

```bash
# Generate secure secrets first
chmod +x generate-secrets.sh
./generate-secrets.sh

# Start services
docker compose -f docker-compose.full.yml up -d
```

## Step 4: Configure Nginx Proxy Manager

### 4.1 Access NPM Dashboard

Open your browser and navigate to:
- `http://your-server-ip:81` (default NPM port)
- Default credentials: `admin@example.com` / `changeme`

### 4.2 Add Proxy Host for Relay Server

1. Go to **Hosts** → **Proxy Hosts**
2. Click **Add Proxy Host**
3. Configure:
   - **Domain Names**: `webrelay.yourdomain.com`
   - **Scheme**: `http`
   - **Forward Hostname**: `relay-server` (container name)
   - **Forward Port**: `3000`
4. **SSL** tab:
   - Enable SSL
   - Select "Request a new SSL Certificate"
   - Force SSL: ✅
   - HTTP/2 Support: ✅
5. Click **Save**

### 4.3 Add Proxy Host for Realtime Service (WebSocket)

1. Go to **Hosts** → **Proxy Hosts**
2. Click **Add Proxy Host**
3. Configure:
   - **Domain Names**: `webrelay-ws.yourdomain.com` (or use subpath)
   - **Scheme**: `http`
   - **Forward Hostname**: `realtime-service` (container name)
   - **Forward Port**: `3004`
4. **Advanced** tab:
   - Add custom Nginx configuration:
   ```nginx
   # WebSocket support
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   proxy_http_version 1.1;
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   proxy_set_header X-Forwarded-Proto $scheme;
   proxy_read_timeout 86400;
   ```
5. **SSL** tab:
   - Enable SSL
   - Select "Request a new SSL Certificate"
   - Force SSL: ✅
   - HTTP/2 Support: ✅
6. Click **Save**

### Alternative: Use Subpath for WebSocket

If you prefer using a single domain with subpaths:

1. Configure the main proxy host for `webrelay.yourdomain.com` as above
2. In **Advanced** tab, add:
   ```nginx
   # WebSocket proxy for /socket.io path
   location /socket.io/ {
       proxy_pass http://realtime-service:3004;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 86400;
   }
   ```

## Step 5: Update Frontend Configuration

Update your `.env` file to use the public domain:

```env
NEXT_PUBLIC_APP_URL=https://webrelay.yourdomain.com
NEXTAUTH_URL=https://webrelay.yourdomain.com
```

If using subpath for WebSocket, you may need to update the frontend to connect to the correct WebSocket URL.

## Step 6: Restart Services

```bash
docker compose -f docker-compose.full.yml restart
```

## Security Recommendations

1. **Change NPM default password** immediately after first login
2. **Enable 2FA** in NPM settings
3. **Use strong passwords** for all services
4. **Enable firewall** to only allow ports 80, 443, and 81 (NPM)
5. **Regular updates** for NPM and WebRelay
6. **Monitor logs** for suspicious activity

## Troubleshooting

### WebSocket Connection Issues

If WebSocket connections fail:

1. Check NPM proxy host configuration includes WebSocket headers
2. Verify the domain/subpath matches frontend configuration
3. Check browser console for connection errors
4. Test WebSocket connection directly:
   ```bash
   wscat -c https://webrelay-ws.yourdomain.com
   ```

### SSL Certificate Issues

If SSL certificates fail:

1. Verify DNS records point to correct IP
2. Check port 80 is accessible from internet
3. Review NPM logs for certificate errors
4. Try "Force Renew" in NPM SSL settings

### Container Network Issues

If containers can't communicate:

```bash
# Check network connectivity
docker network inspect nginx-proxy-manager
docker network inspect relay-network

# Verify containers are on correct networks
docker inspect relay-server | grep Networks
docker inspect realtime-service | grep Networks
```

## Port Summary

| Service | Internal Port | Exposed via NPM | Purpose |
|---------|--------------|-----------------|---------|
| relay-server | 3000 | 443 (HTTPS) | Main web application |
| realtime-service | 3004 | 443 (HTTPS) | WebSocket connections |
| redis | 6379 | No | Internal only |
| relay-client | 3003 | No | Internal only |
| NPM Dashboard | 81 | 81 | NPM management UI |

## Additional Resources

- [Nginx Proxy Manager Documentation](https://nginxproxymanager.com/)
- [WebSocket Proxy Configuration](https://nginx.org/en/docs/http/websocket.html)
- [Docker Networking](https://docs.docker.com/network/)

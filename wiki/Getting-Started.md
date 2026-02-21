# Getting Started with WebRelay

Welcome to WebRelay! This guide will help you get up and running quickly.

## What is WebRelay?

WebRelay is a webhook relay system that allows you to:
- Receive webhooks on a public server
- Forward them to internal/private services
- Monitor and manage everything through a beautiful dashboard

## Architecture Overview

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  External        │     │  Public Server   │     │  Internal        │
│  Services        │────►│  (WebRelay)      │────►│  Services        │
│  (Stripe, etc.)  │     │                  │     │  (CRM, etc.)     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                                │
                                ▼
                         ┌──────────────────┐
                         │  Redis Server    │
                         │  (Message Queue) │
                         └──────────────────┘
```

## Key Components

1. **Relay Server** - Public-facing Next.js app that receives webhooks
2. **Realtime Service** - WebSocket server for live dashboard updates
3. **Relay Client** - Runs on your internal network, forwards to local services
4. **Redis** - Message broker using Redis Streams

## Quick Start

### Prerequisites
- Redis server (any host)
- Docker (recommended) or Node.js/Bun

### Step 1: Set Up Redis

If you don't have Redis, you can use:
- Redis Cloud (free tier available)
- Railway, Upstash, or any managed Redis
- Self-hosted Redis server

### Step 2: Deploy Public Server

```bash
# Create environment file
cat > .env << EOF
REDIS_URL=your-redis-host:6379
REDIS_PASSWORD=your-redis-password
ADMIN_PASSWORD=your-secure-password
EOF

# Run with Docker
docker compose -f docker-compose.server.yml up -d
```

### Step 3: Access Dashboard

Navigate to `http://your-server:3000` and log in with:
- Username: `admin`
- Password: Your `ADMIN_PASSWORD`

### Step 4: Create Your First Endpoint

1. Click "New Endpoint" in the dashboard
2. Fill in the details:
   - Name: e.g., "Stripe Webhooks"
   - Platform: e.g., "stripe"
   - Enable "Require Authentication" for security
   - Set "Target URL" for your internal service
3. Click Create
4. Copy the webhook URL and API key

### Step 5: Configure External Service

Use the webhook URL in your external service (Stripe, Slack, etc.):

```
https://your-server.com/relay/{endpoint-id}
```

Include the API key in the header:
```
X-API-Key: rk_your-api-key
```

### Step 6: Deploy Relay Client (Optional)

If forwarding to internal services, deploy the client on your internal network:

```bash
# On your internal server
cat > .env << EOF
REDIS_URL=your-redis-host:6379
REDIS_PASSWORD=your-redis-password
CONSUMER_NAME=relay-office
REALTIME_URL=https://your-server.com
EOF

docker compose -f docker-compose.client.yml up -d
```

## Next Steps

- Read the [Configuration Guide](./Configuration-Guide)
- Learn about [Authentication Methods](./Authentication-Methods)
- Understand [Mappings and Forwarding](./Mappings-and-Forwarding)
- Set up [Monitoring and Alerts](./Monitoring)

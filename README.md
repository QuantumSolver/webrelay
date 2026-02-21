# ⚡ EXN Web Relay

A modern webhook relay system with Redis Streams for distributing webhooks across multiple internal services. Features a beautiful admin dashboard, real-time updates, and enterprise-grade reliability.

![EXN Web Relay Dashboard](https://via.placeholder.com/800x400?text=EXN+Web+Relay+Dashboard)

## ✨ Features

- **🚀 High Performance** - Redis Streams for reliable message queuing
- **🔄 Real-time Dashboard** - WebSocket-powered live updates
- **🔐 Secure Authentication** - bcrypt password hashing with session management
- **🌐 Distributed Architecture** - Public server + local client deployment
- **📦 Multi-arch Docker Images** - AMD64 and ARM64 support
- **⚡ Circuit Breaker** - Automatic fault tolerance and retry
- **📊 Dead Letter Queue** - Never lose failed webhooks
- **🎨 Modern UI** - Beautiful dashboard with dark mode support

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      PUBLIC CLOUD SERVER                         │
│  ┌─────────────────┐   ┌─────────────────┐                      │
│  │  Relay Server   │   │ Realtime Service │                      │
│  │  (Next.js:3000) │   │ (Socket.io:3004) │                      │
│  │                 │   │                  │                      │
│  │ • Receives      │   │ • Real-time      │                      │
│  │   webhooks      │◄──┤   updates        │                      │
│  │ • Validates     │   │ • Metrics        │                      │
│  │   API keys      │   │                  │                      │
│  │ • Publishes to  │   │                  │                      │
│  │   Redis Stream  │───┼──────────────────┼────┐                 │
│  └─────────────────┘   └─────────────────┘    │                │
└────────────────────────────────────────────────│────────────────┘
                                                 │
                                    ┌────────────┘
                                    ▼ Redis Streams
┌─────────────────────────────────────────────────────────────────┐
│                      LOCAL/INTERNAL SERVER                       │
│  ┌─────────────────┐                    ┌─────────────────────┐ │
│  │  Relay Client   │                    │ Internal Services   │ │
│  │  (Bun:3003)     │                    │                     │ │
│  │                 │   Forwards to      │ • CRM API           │ │
│  │ • Consumes from │───────────────────►│ • Billing System    │ │
│  │   Redis Stream  │                    │ • Webhook Handlers  │ │
│  │ • Retries on    │                    │                     │ │
│  │   failure       │                    │                     │ │
│  └─────────────────┘                    └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Option 1: Docker (Recommended)

#### 1. Deploy Public Server

```bash
# Create environment file
cat > .env << EOF
REDIS_URL=your-redis-host:6379
REDIS_PASSWORD=your-redis-password
ADMIN_PASSWORD=your-secure-admin-password
EOF

# Run with Docker Compose
docker compose -f docker-compose.server.yml up -d
```

#### 2. Deploy Local Client

```bash
# On your local/internal server
cat > .env << EOF
REDIS_URL=your-redis-host:6379
REDIS_PASSWORD=your-redis-password
CONSUMER_NAME=relay-client-office
REALTIME_URL=https://your-server.com
EOF

# Run with Docker Compose
docker compose -f docker-compose.client.yml up -d
```

### Option 2: From Source

```bash
# Clone the repository
git clone https://github.com/QuantumSolver/webrelay.git
cd webrelay

# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Initialize database
bun run db:push

# Start development server
bun run dev
```

## 📋 Prerequisites

- **Redis Server** - Any Redis instance (local, cloud, or managed)
- **Docker** - For containerized deployment
- **Bun** - For local development

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `REDIS_URL` | Redis host:port | ✅ |
| `REDIS_PASSWORD` | Redis password | ✅ |
| `REDIS_DB` | Redis database number (default: 0) | |
| `ADMIN_PASSWORD` | Dashboard login password | ✅ |
| `STREAM_NAME` | Redis stream name | |
| `CONSUMER_GROUP` | Consumer group name | |
| `DEAD_LETTER_QUEUE` | DLQ stream name | |

### Relay Client Only

| Variable | Description | Required |
|----------|-------------|----------|
| `CONSUMER_NAME` | Unique client identifier | |
| `REALTIME_URL` | Public realtime service URL | |
| `WORKER_COUNT` | Number of workers (default: 5) | |

## 📖 Usage

### 1. Access Dashboard

Navigate to `http://your-server:3000` and log in with:
- **Username**: `admin`
- **Password**: Your `ADMIN_PASSWORD`

### 2. Create Endpoint

Click "New Endpoint" and configure:
- **Name**: Descriptive name (e.g., "Stripe Webhooks")
- **Platform**: Source identifier (e.g., "stripe")
- **Auth Required**: Enable for API key validation
- **Target URL**: Your internal service URL

### 3. Configure Webhook

Use the generated webhook URL in your external service:
```
https://your-server.com/relay/{endpoint-id}
```

### 4. Monitor

- View real-time metrics on the dashboard
- Check logs for webhook history
- Monitor DLQ for failed webhooks

## 🐳 Docker Images

Images are available on GitHub Container Registry:

```bash
# Server
docker pull ghcr.io/quantumsolver/webrelay-server:latest

# Client
docker pull ghcr.io/quantumsolver/webrelay-client:latest

# Realtime
docker pull ghcr.io/quantumsolver/webrelay-realtime:latest
```

## 🔧 API Reference

### Webhook Endpoint

```http
POST /relay/{endpoint-id}
X-API-Key: your-api-key
Content-Type: application/json

{
  "event": "user.created",
  "data": { ... }
}
```

### Health Check

```http
GET /api/health

Response:
{
  "status": "healthy",
  "service": "relay-server",
  "redis": "connected"
}
```

## 🛡️ Security

- **API Keys**: Stored as bcrypt hashes, shown only once
- **Sessions**: Secure token-based authentication
- **No Defaults**: All sensitive values require configuration
- **CORS**: Configurable origins for WebSocket

## 📊 Monitoring

### Health Endpoints

| Service | Endpoint |
|---------|----------|
| Server | `GET /api/health` |
| Client | `GET /health` |
| Client Metrics | `GET /metrics` |

### Metrics Available

- Webhooks received
- Webhooks forwarded
- Webhooks failed
- DLQ size
- Connected clients

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) file.

## 🙏 Acknowledgments

Built with:
- [Next.js](https://nextjs.org/)
- [Bun](https://bun.sh/)
- [Redis](https://redis.io/)
- [Socket.io](https://socket.io/)
- [shadcn/ui](https://ui.shadcn.com/)

---

Made with ❤️ by [Marcques](mailto:marcques@exn1.uk) | [EXN](https://relay.exn1.uk)

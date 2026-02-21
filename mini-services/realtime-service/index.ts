import { Server } from 'socket.io';
import Redis from 'ioredis';

// Configuration from environment - NO DEFAULTS for sensitive data
const REDIS_URL = process.env.REDIS_URL;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10);
const STREAM_NAME = process.env.STREAM_NAME || 'webhook-stream';
const DEAD_LETTER_QUEUE = process.env.DEAD_LETTER_QUEUE || 'webhook-dlq';
const CLIENT_PORT = process.env.CLIENT_PORT || '3003';
const PORT = parseInt(process.env.PORT || '3004', 10);

if (!REDIS_URL || !REDIS_PASSWORD) {
  console.error('[Realtime] ERROR: REDIS_URL and REDIS_PASSWORD must be set');
  process.exit(1);
}

// Redis key prefixes
const REDIS_KEYS = {
  ENDPOINTS_LIST: 'endpoints:list',
  LOCAL_MAPPINGS_LIST: 'local_mappings:list',
  METRICS_WEBHOOKS_RECEIVED: 'metrics:server:webhooks_received',
  METRICS_WEBHOOKS_FORWARDED: 'metrics:client:webhooks_forwarded',
  METRICS_WEBHOOKS_FAILED: 'metrics:client:webhooks_failed',
  METRICS_DLQ_SIZE: 'metrics:client:dlq_size',
};

// Connected clients tracking
const connectedClients = new Map<string, {
  id: string;
  consumerName: string;
  connectedAt: Date;
  lastHeartbeat: Date;
}>();

// Redis subscriber
let redisSubscriber: Redis;
let redisClient: Redis;

function getRedisSubscriber(): Redis {
  if (!redisSubscriber) {
    const [host, port] = REDIS_URL.split(':');
    redisSubscriber = new Redis({
      host: host,
      port: parseInt(port || '6379', 10),
      password: REDIS_PASSWORD,
      db: REDIS_DB,
    });
  }
  return redisSubscriber;
}

function getRedisClient(): Redis {
  if (!redisClient) {
    const [host, port] = REDIS_URL.split(':');
    redisClient = new Redis({
      host: host,
      port: parseInt(port || '6379', 10),
      password: REDIS_PASSWORD,
      db: REDIS_DB,
    });
  }
  return redisClient;
}

// Get metrics from Redis
async function getMetrics() {
  const client = getRedisClient();
  
  const [
    webhooksReceived,
    webhooksForwarded,
    webhooksFailed,
    dlqSize,
    endpointsCount,
    mappingsCount,
  ] = await Promise.all([
    client.get(REDIS_KEYS.METRICS_WEBHOOKS_RECEIVED),
    client.get(REDIS_KEYS.METRICS_WEBHOOKS_FORWARDED),
    client.get(REDIS_KEYS.METRICS_WEBHOOKS_FAILED),
    client.get(REDIS_KEYS.METRICS_DLQ_SIZE),
    client.scard(REDIS_KEYS.ENDPOINTS_LIST),
    client.scard(REDIS_KEYS.LOCAL_MAPPINGS_LIST),
  ]);

  return {
    webhooksReceived: parseInt(webhooksReceived || '0', 10),
    webhooksForwarded: parseInt(webhooksForwarded || '0', 10),
    webhooksFailed: parseInt(webhooksFailed || '0', 10),
    dlqSize: parseInt(dlqSize || '0', 10),
    endpointsCount,
    mappingsCount,
    connectedClients: connectedClients.size,
    timestamp: new Date().toISOString(),
  };
}

// Get relay client status
async function getRelayClientStatus() {
  try {
    const response = await fetch(`http://localhost:${CLIENT_PORT}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    
    if (response.ok) {
      return await response.json();
    }
  } catch {
    // Client not available
  }
  return { status: 'disconnected' };
}

// Create Socket.io server
const io = new Server(PORT, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

console.log(`[Realtime] WebSocket server running on port ${PORT}`);

// Handle connections
io.on('connection', async (socket) => {
  console.log(`[Realtime] Client connected: ${socket.id}`);
  
  // Send initial data
  const metrics = await getMetrics();
  const clientStatus = await getRelayClientStatus();
  
  socket.emit('metrics', metrics);
  socket.emit('client-status', {
    connected: clientStatus.status === 'healthy',
    ...clientStatus,
  });
  
  // Handle heartbeat from relay clients
  socket.on('heartbeat', (data: { consumerName: string }) => {
    connectedClients.set(socket.id, {
      id: socket.id,
      consumerName: data.consumerName,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
    });
    
    // Broadcast updated client list
    io.emit('relay-clients', Array.from(connectedClients.values()));
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`[Realtime] Client disconnected: ${socket.id}`);
    connectedClients.delete(socket.id);
    io.emit('relay-clients', Array.from(connectedClients.values()));
  });
  
  // Handle manual refresh request
  socket.on('request-metrics', async () => {
    const metrics = await getMetrics();
    socket.emit('metrics', metrics);
  });
  
  socket.on('request-client-status', async () => {
    const clientStatus = await getRelayClientStatus();
    socket.emit('client-status', {
      connected: clientStatus.status === 'healthy',
      ...clientStatus,
    });
  });
});

// Periodic metrics broadcast
setInterval(async () => {
  const metrics = await getMetrics();
  io.emit('metrics', metrics);
}, 3000);

// Periodic client status check
setInterval(async () => {
  const clientStatus = await getRelayClientStatus();
  io.emit('client-status', {
    connected: clientStatus.status === 'healthy',
    ...clientStatus,
  });
}, 5000);

// Clean up stale clients every 30 seconds
setInterval(() => {
  const now = new Date();
  for (const [id, client] of connectedClients) {
    const diff = now.getTime() - client.lastHeartbeat.getTime();
    if (diff > 30000) {
      connectedClients.delete(id);
    }
  }
  io.emit('relay-clients', Array.from(connectedClients.values()));
}, 30000);

console.log('[Realtime] Service started');
console.log(`[Realtime] WebSocket: ws://localhost:${PORT}`);
console.log(`[Realtime] Monitoring Relay Client on port ${CLIENT_PORT}`);

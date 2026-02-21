import Redis from 'ioredis';
import { io } from 'socket.io-client';

// Configuration from environment - NO DEFAULTS for sensitive data
const REDIS_URL = process.env.REDIS_URL;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10);

if (!REDIS_URL || !REDIS_PASSWORD) {
  console.error('[Relay Client] ERROR: REDIS_URL and REDIS_PASSWORD must be set');
  process.exit(1);
}

const STREAM_NAME = process.env.STREAM_NAME || 'webhook-stream';
const CONSUMER_GROUP = process.env.CONSUMER_GROUP || 'relay-group';
const CONSUMER_NAME = process.env.CONSUMER_NAME || 'relay-client-' + Math.random().toString(36).substring(7);
const DEAD_LETTER_QUEUE = process.env.DEAD_LETTER_QUEUE || 'webhook-dlq';

const CLIENT_PORT = parseInt(process.env.CLIENT_PORT || '3003', 10);
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '5', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
const BLOCK_TIMEOUT = parseInt(process.env.BLOCK_TIMEOUT || '5000', 10);
const REALTIME_URL = process.env.REALTIME_URL;

if (!REALTIME_URL) {
  console.warn('[Relay Client] WARNING: REALTIME_URL not set. Real-time updates disabled.');
}

// Redis key prefixes
const REDIS_KEYS = {
  LOCAL_MAPPING: 'local_mapping:',
  METRICS_WEBHOOKS_FORWARDED: 'metrics:client:webhooks_forwarded',
  METRICS_WEBHOOKS_FAILED: 'metrics:client:webhooks_failed',
  METRICS_DLQ_SIZE: 'metrics:client:dlq_size',
};

// Types
interface LocalMapping {
  id: string;
  serverEndpointId: string;
  localTargetUrl: string;
  authConfig: {
    type: string;
    username?: string;
    password?: string;
    token?: string;
    keyName?: string;
    keyValue?: string;
    keyIn?: string;
    hmacSecret?: string;
    hmacAlgo?: string;
  } | null;
  retryOverride: {
    maxRetries: number;
    initialDelayMs: number;
    backoffFactor: number;
    maxDelayMs: number;
  } | null;
  addHeaders: Record<string, string>;
  removeHeaders: string[];
  isActive: boolean;
}

interface WebhookMessage {
  id: string;
  data: {
    webhookId: string;
    endpointId: string;
    method: string;
    headers: string;
    body: string;
    query: string;
    timestamp: string;
    platform?: string;
    defaultTarget?: string;
    retryConfig?: string;
  };
}

// Circuit Breaker
class CircuitBreaker {
  private failures: Map<string, number> = new Map();
  private lastFailure: Map<string, number> = new Map();
  private readonly threshold = 5;
  private readonly timeout = 30000; // 30 seconds

  isOpen(key: string): boolean {
    const failures = this.failures.get(key) || 0;
    const lastFail = this.lastFailure.get(key) || 0;
    
    if (failures >= this.threshold) {
      if (Date.now() - lastFail > this.timeout) {
        // Half-open state - allow one attempt
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
    this.lastFailure.delete(key);
  }

  recordFailure(key: string): void {
    this.failures.set(key, (this.failures.get(key) || 0) + 1);
    this.lastFailure.set(key, Date.now());
  }
}

// Redis Client
let redis: Redis;

function getRedis(): Redis {
  if (!redis) {
    const [host, port] = REDIS_URL.split(':');
    redis = new Redis({
      host: host,
      port: parseInt(port || '6379', 10),
      password: REDIS_PASSWORD,
      db: REDIS_DB,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('[Redis] Connection failed after 3 retries');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });
    
    redis.on('connect', () => console.log('[Redis] Connected'));
    redis.on('error', (err) => console.error('[Redis] Error:', err));
  }
  return redis;
}

// Socket.io connection to realtime service
let socket: ReturnType<typeof io>;

function connectToRealtime(): void {
  if (!REALTIME_URL) {
    console.log('[Realtime] Skipping realtime connection - REALTIME_URL not configured');
    return;
  }
  
  socket = io(REALTIME_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('[Realtime] Connected to realtime service');
  });

  socket.on('disconnect', () => {
    console.log('[Realtime] Disconnected from realtime service');
  });

  // Send heartbeat every 5 seconds
  setInterval(() => {
    if (socket.connected) {
      socket.emit('heartbeat', { consumerName: CONSUMER_NAME });
    }
  }, 5000);
}

// Create consumer group
async function createConsumerGroup(): Promise<void> {
  const client = getRedis();
  try {
    await client.xgroup('CREATE', STREAM_NAME, CONSUMER_GROUP, '$', 'MKSTREAM');
    console.log(`[Consumer] Created group ${CONSUMER_GROUP} for stream ${STREAM_NAME}`);
  } catch (err: unknown) {
    const error = err as { message?: string };
    if (error.message?.includes('BUSYGROUP')) {
      console.log(`[Consumer] Group ${CONSUMER_GROUP} already exists`);
    } else {
      throw err;
    }
  }
}

// Get local mapping
async function getLocalMapping(endpointId: string): Promise<LocalMapping | null> {
  const client = getRedis();
  const key = REDIS_KEYS.LOCAL_MAPPING + endpointId;
  const data = await client.hgetall(key);
  
  if (!data || Object.keys(data).length === 0) {
    return null;
  }
  
  return {
    id: data.id,
    serverEndpointId: data.serverEndpointId,
    localTargetUrl: data.localTargetUrl,
    authConfig: data.authConfig && data.authConfig !== 'null' ? JSON.parse(data.authConfig) : null,
    retryOverride: data.retryOverride && data.retryOverride !== 'null' ? JSON.parse(data.retryOverride) : null,
    addHeaders: JSON.parse(data.addHeaders || '{}'),
    removeHeaders: JSON.parse(data.removeHeaders || '[]'),
    isActive: data.isActive === '1',
  };
}

// Read messages from stream
async function readMessages(): Promise<WebhookMessage[]> {
  const client = getRedis();
  
  try {
    const result = await client.xreadgroup(
      'GROUP',
      CONSUMER_GROUP,
      CONSUMER_NAME,
      'COUNT',
      BATCH_SIZE.toString(),
      'BLOCK',
      BLOCK_TIMEOUT.toString(),
      'STREAMS',
      STREAM_NAME,
      '>'
    );
    
    if (!result) {
      return [];
    }
    
    const messages: WebhookMessage[] = [];
    
    for (const [stream, entries] of result) {
      for (const [id, fields] of entries) {
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          data[fields[i]] = fields[i + 1];
        }
        messages.push({ id, data: data as WebhookMessage['data'] });
      }
    }
    
    return messages;
  } catch (err) {
    console.error('[Consumer] Error reading messages:', err);
    return [];
  }
}

// Acknowledge message
async function ackMessage(messageId: string): Promise<void> {
  const client = getRedis();
  await client.xack(STREAM_NAME, CONSUMER_GROUP, messageId);
}

// Send to DLQ
async function sendToDLQ(
  message: WebhookMessage,
  error: string
): Promise<void> {
  const client = getRedis();
  
  const dlqData: Record<string, string> = {
    ...message.data,
    error,
    failedAt: new Date().toISOString(),
    originalStream: STREAM_NAME,
  };
  
  const args: string[] = [];
  for (const [key, value] of Object.entries(dlqData)) {
    args.push(key, value);
  }
  
  await client.xadd(DEAD_LETTER_QUEUE, '*', ...args);
  await client.incr(REDIS_KEYS.METRICS_DLQ_SIZE);
}

// Increment metric
async function incrementMetric(key: string): Promise<void> {
  const client = getRedis();
  await client.incr(key);
}

// Apply authentication to request
function applyAuth(
  headers: Record<string, string>,
  auth: LocalMapping['authConfig']
): Record<string, string> {
  if (!auth || auth.type === 'none') {
    return headers;
  }
  
  const result = { ...headers };
  
  switch (auth.type) {
    case 'basic':
      const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      result['Authorization'] = `Basic ${credentials}`;
      break;
    case 'bearer':
      result['Authorization'] = `Bearer ${auth.token}`;
      break;
    case 'api_key':
      if (auth.keyIn === 'header') {
        result[auth.keyName || 'X-API-Key'] = auth.keyValue || '';
      }
      break;
  }
  
  return result;
}

// Forward webhook with retry
async function forwardWebhook(
  message: WebhookMessage,
  mapping: LocalMapping,
  circuitBreaker: CircuitBreaker
): Promise<{ success: boolean; error?: string }> {
  const targetUrl = mapping.localTargetUrl;
  
  // Check circuit breaker
  if (circuitBreaker.isOpen(targetUrl)) {
    return { success: false, error: 'Circuit breaker open' };
  }
  
  // Parse body
  let body: string;
  try {
    body = Buffer.from(message.data.body, 'base64').toString('utf-8');
  } catch {
    body = message.data.body;
  }
  
  // Parse headers
  let headers: Record<string, string> = {};
  try {
    const parsedHeaders = JSON.parse(message.data.headers);
    // Filter out headers marked for removal
    for (const [key, value] of Object.entries(parsedHeaders)) {
      if (!mapping.removeHeaders.includes(key.toLowerCase())) {
        headers[key] = value as string;
      }
    }
  } catch {
    headers = {};
  }
  
  // Add custom headers
  headers = { ...headers, ...mapping.addHeaders };
  
  // Apply authentication
  headers = applyAuth(headers, mapping.authConfig);
  
  // Get retry config
  const retryConfig = mapping.retryOverride || {
    maxRetries: 3,
    initialDelayMs: 100,
    backoffFactor: 2,
    maxDelayMs: 10000,
  };
  
  let lastError: string | undefined;
  
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(
        retryConfig.initialDelayMs * Math.pow(retryConfig.backoffFactor, attempt - 1),
        retryConfig.maxDelayMs
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      console.log(`[Forwarder] Retry attempt ${attempt} for webhook ${message.data.webhookId}`);
    }
    
    try {
      const response = await fetch(targetUrl, {
        method: message.data.method || 'POST',
        headers,
        body: ['GET', 'HEAD'].includes(message.data.method || 'POST') ? undefined : body,
      });
      
      if (response.ok) {
        circuitBreaker.recordSuccess(targetUrl);
        return { success: true };
      }
      
      // Client error - don't retry
      if (response.status >= 400 && response.status < 500) {
        circuitBreaker.recordSuccess(targetUrl);
        return { success: false, error: `Client error: ${response.status}` };
      }
      
      // Server error - retry
      lastError = `Server error: ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Unknown error';
      circuitBreaker.recordFailure(targetUrl);
    }
  }
  
  return { success: false, error: lastError };
}

// Process a single message
async function processMessage(
  message: WebhookMessage,
  circuitBreaker: CircuitBreaker
): Promise<void> {
  const { data } = message;
  console.log(`[Processor] Processing webhook ${data.webhookId} for endpoint ${data.endpointId}`);
  
  try {
    // Get local mapping
    const mapping = await getLocalMapping(data.endpointId);
    
    if (!mapping) {
      console.warn(`[Processor] No mapping found for endpoint ${data.endpointId}`);
      // Acknowledge to remove from stream (no mapping = nowhere to forward)
      await ackMessage(message.id);
      return;
    }
    
    if (!mapping.isActive) {
      console.warn(`[Processor] Mapping for ${data.endpointId} is disabled`);
      await ackMessage(message.id);
      return;
    }
    
    if (!mapping.localTargetUrl) {
      console.warn(`[Processor] No target URL for endpoint ${data.endpointId}`);
      await ackMessage(message.id);
      return;
    }
    
    // Forward the webhook
    const result = await forwardWebhook(message, mapping, circuitBreaker);
    
    if (result.success) {
      console.log(`[Processor] Webhook ${data.webhookId} forwarded successfully`);
      await ackMessage(message.id);
      await incrementMetric(REDIS_KEYS.METRICS_WEBHOOKS_FORWARDED);
    } else {
      console.error(`[Processor] Webhook ${data.webhookId} failed: ${result.error}`);
      
      // Send to DLQ
      await sendToDLQ(message, result.error || 'Unknown error');
      await ackMessage(message.id);
      await incrementMetric(REDIS_KEYS.METRICS_WEBHOOKS_FAILED);
    }
  } catch (err) {
    console.error(`[Processor] Error processing webhook ${data.webhookId}:`, err);
    
    // Send to DLQ
    await sendToDLQ(message, err instanceof Error ? err.message : 'Unknown error');
    await ackMessage(message.id);
    await incrementMetric(REDIS_KEYS.METRICS_WEBHOOKS_FAILED);
  }
}

// Worker
async function worker(
  id: number,
  jobs: AsyncIterable<WebhookMessage>,
  circuitBreaker: CircuitBreaker
): Promise<void> {
  console.log(`[Worker ${id}] Started`);
  
  for await (const message of jobs) {
    await processMessage(message, circuitBreaker);
  }
}

// Create async iterator for jobs
async function* jobGenerator(): AsyncGenerator<WebhookMessage> {
  while (true) {
    const messages = await readMessages();
    for (const message of messages) {
      yield message;
    }
    // Small delay between batches
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// Main consumer loop
async function startConsumer(): Promise<void> {
  console.log('[Relay Client] Starting...');
  console.log(`[Relay Client] Consumer name: ${CONSUMER_NAME}`);
  console.log(`[Relay Client] Stream: ${STREAM_NAME}`);
  console.log(`[Relay Client] Group: ${CONSUMER_GROUP}`);
  console.log(`[Relay Client] Workers: ${WORKER_COUNT}`);
  console.log(`[Relay Client] Realtime URL: ${REALTIME_URL}`);
  
  // Create consumer group
  await createConsumerGroup();
  
  // Connect to realtime service
  connectToRealtime();
  
  const circuitBreaker = new CircuitBreaker();
  
  // Start workers
  const jobs = jobGenerator();
  
  const workers = [];
  for (let i = 0; i < WORKER_COUNT; i++) {
    workers.push(worker(i, jobs, circuitBreaker));
  }
  
  // Start HTTP server for health checks
  const server = Bun.serve({
    port: CLIENT_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({
          status: 'healthy',
          consumerName: CONSUMER_NAME,
          stream: STREAM_NAME,
          group: CONSUMER_GROUP,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      if (url.pathname === '/metrics') {
        const client = getRedis();
        const forwarded = await client.get(REDIS_KEYS.METRICS_WEBHOOKS_FORWARDED);
        const failed = await client.get(REDIS_KEYS.METRICS_WEBHOOKS_FAILED);
        const dlqSize = await client.get(REDIS_KEYS.METRICS_DLQ_SIZE);
        
        return new Response(JSON.stringify({
          forwarded: parseInt(forwarded || '0', 10),
          failed: parseInt(failed || '0', 10),
          dlqSize: parseInt(dlqSize || '0', 10),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      return new Response('Not found', { status: 404 });
    },
  });
  
  console.log(`[Relay Client] HTTP server running on port ${CLIENT_PORT}`);
  console.log(`[Relay Client] Health: http://localhost:${CLIENT_PORT}/health`);
  
  // Wait for workers (they run forever)
  await Promise.race(workers);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[Relay Client] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Relay Client] Shutting down...');
  process.exit(0);
});

// Start
startConsumer().catch((err) => {
  console.error('[Relay Client] Fatal error:', err);
  process.exit(1);
});

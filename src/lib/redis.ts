import Redis from 'ioredis';

// Redis configuration from environment - NO DEFAULTS for security
const REDIS_URL = process.env.REDIS_URL;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;
const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10);

if (!REDIS_URL || !REDIS_PASSWORD) {
  console.warn('[Redis] WARNING: REDIS_URL or REDIS_PASSWORD not set. Redis operations will fail.');
}

// Stream configuration
export const STREAM_NAME = process.env.STREAM_NAME || 'webhook-stream';
export const CONSUMER_GROUP = process.env.CONSUMER_GROUP || 'relay-group';
export const CONSUMER_NAME = process.env.CONSUMER_NAME || 'relay-client';
export const DEAD_LETTER_QUEUE = process.env.DEAD_LETTER_QUEUE || 'webhook-dlq';
export const MESSAGE_TTL = parseInt(process.env.MESSAGE_TTL || '86400', 10);

// Redis key prefixes
export const REDIS_KEYS = {
  ENDPOINT: 'endpoint:',
  ENDPOINTS_LIST: 'endpoints:list',
  API_KEY: 'api_key:',
  API_KEYS_LIST: 'api_keys:list',
  API_KEY_LOOKUP: 'api_key_lookup:',
  USER: 'user:',
  LOCAL_MAPPING: 'local_mapping:',
  LOCAL_MAPPINGS_LIST: 'local_mappings:list',
  METRICS_WEBHOOKS_RECEIVED: 'metrics:server:webhooks_received',
  METRICS_WEBHOOKS_FORWARDED: 'metrics:client:webhooks_forwarded',
  METRICS_WEBHOOKS_FAILED: 'metrics:client:webhooks_failed',
  METRICS_DLQ_SIZE: 'metrics:client:dlq_size',
};

// Global Redis client for server-side operations
let redisClient: Redis | null = null;
let publisherClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    if (!REDIS_URL || !REDIS_PASSWORD) {
      throw new Error('[Redis] REDIS_URL and REDIS_PASSWORD must be set in environment');
    }
    const [host, port] = REDIS_URL.split(':');
    redisClient = new Redis({
      host: host,
      port: parseInt(port || '6379', 10),
      password: REDIS_PASSWORD,
      db: REDIS_DB,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('Redis connection failed after 3 retries');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 3,
    });

    redisClient.on('connect', () => {
      console.log('Redis client connected');
    });

    redisClient.on('error', (err) => {
      console.error('Redis client error:', err);
    });
  }
  return redisClient;
}

export function getPublisherClient(): Redis {
  if (!publisherClient) {
    if (!REDIS_URL || !REDIS_PASSWORD) {
      throw new Error('[Redis] REDIS_URL and REDIS_PASSWORD must be set in environment');
    }
    const [host, port] = REDIS_URL.split(':');
    publisherClient = new Redis({
      host: host,
      port: parseInt(port || '6379', 10),
      password: REDIS_PASSWORD,
      db: REDIS_DB,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('Redis publisher connection failed after 3 retries');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });
  }
  return publisherClient;
}

// Stream operations
export async function createConsumerGroup(
  streamName: string = STREAM_NAME,
  groupName: string = CONSUMER_GROUP
): Promise<void> {
  const client = getRedisClient();
  try {
    await client.xgroup('CREATE', streamName, groupName, '$', 'MKSTREAM');
    console.log(`Created consumer group ${groupName} for stream ${streamName}`);
  } catch (err: unknown) {
    const error = err as { message?: string };
    if (error.message?.includes('BUSYGROUP')) {
      console.log(`Consumer group ${groupName} already exists`);
    } else {
      throw err;
    }
  }
}

export async function publishToStream(
  data: Record<string, string>,
  streamName: string = STREAM_NAME
): Promise<string> {
  const client = getRedisClient();
  
  // Convert data to flat array for Redis
  const args: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    args.push(key, value);
  }
  
  const messageId = await client.xadd(streamName, '*', ...args);
  
  // Trim stream to keep it manageable
  await client.xtrim(streamName, 'MAXLEN', '~', 10000);
  
  return messageId;
}

export async function readFromStream(
  streamName: string = STREAM_NAME,
  groupName: string = CONSUMER_GROUP,
  consumerName: string = CONSUMER_NAME,
  count: number = 10,
  block: number = 5000
): Promise<Array<{ id: string; data: Record<string, string> }>> {
  const client = getRedisClient();
  
  const result = await client.xreadgroup(
    'GROUP',
    groupName,
    consumerName,
    'COUNT',
    count.toString(),
    'BLOCK',
    block.toString(),
    'STREAMS',
    streamName,
    '>'
  );
  
  if (!result) {
    return [];
  }
  
  const messages: Array<{ id: string; data: Record<string, string> }> = [];
  
  for (const [stream, entries] of result) {
    for (const [id, fields] of entries) {
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1];
      }
      messages.push({ id, data });
    }
  }
  
  return messages;
}

export async function acknowledgeMessage(
  streamName: string = STREAM_NAME,
  groupName: string = CONSUMER_GROUP,
  messageId: string
): Promise<void> {
  const client = getRedisClient();
  await client.xack(streamName, groupName, messageId);
}

export async function sendToDLQ(
  data: Record<string, string>,
  error: string
): Promise<string> {
  const dlqData = {
    ...data,
    error,
    failedAt: new Date().toISOString(),
    originalStream: STREAM_NAME,
  };
  return publishToStream(dlqData, DEAD_LETTER_QUEUE);
}

// Endpoint operations (stored in Redis)
export interface Endpoint {
  id: string;
  name: string;
  platform: string;
  path: string;
  authRequired: boolean;
  authMethods: string[];
  apiKeyRequired: boolean;
  defaultTarget: string;
  headers: Record<string, string>;
  httpMethod: string;
  retryConfig: {
    maxRetries: number;
    initialDelayMs: number;
    backoffFactor: number;
    maxDelayMs: number;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export async function saveEndpoint(endpoint: Endpoint): Promise<void> {
  const client = getRedisClient();
  const key = REDIS_KEYS.ENDPOINT + endpoint.id;
  
  await client.hset(key, {
    id: endpoint.id,
    name: endpoint.name,
    platform: endpoint.platform,
    path: endpoint.path,
    authRequired: endpoint.authRequired ? '1' : '0',
    authMethods: JSON.stringify(endpoint.authMethods),
    apiKeyRequired: endpoint.apiKeyRequired ? '1' : '0',
    defaultTarget: endpoint.defaultTarget || '',
    headers: JSON.stringify(endpoint.headers),
    httpMethod: endpoint.httpMethod,
    retryConfig: JSON.stringify(endpoint.retryConfig),
    isActive: endpoint.isActive ? '1' : '0',
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
    createdBy: endpoint.createdBy,
  });
  
  await client.sadd(REDIS_KEYS.ENDPOINTS_LIST, endpoint.id);
}

export async function getEndpoint(endpointId: string): Promise<Endpoint | null> {
  const client = getRedisClient();
  const key = REDIS_KEYS.ENDPOINT + endpointId;
  
  const data = await client.hgetall(key);
  if (!data || Object.keys(data).length === 0) {
    return null;
  }
  
  return {
    id: data.id,
    name: data.name,
    platform: data.platform,
    path: data.path,
    authRequired: data.authRequired === '1',
    authMethods: JSON.parse(data.authMethods || '[]'),
    apiKeyRequired: data.apiKeyRequired === '1',
    defaultTarget: data.defaultTarget,
    headers: JSON.parse(data.headers || '{}'),
    httpMethod: data.httpMethod || 'POST',
    retryConfig: JSON.parse(data.retryConfig || '{"maxRetries":3,"initialDelayMs":100,"backoffFactor":2,"maxDelayMs":10000}'),
    isActive: data.isActive === '1',
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdBy: data.createdBy,
  };
}

export async function listEndpoints(): Promise<Endpoint[]> {
  const client = getRedisClient();
  const endpointIds = await client.smembers(REDIS_KEYS.ENDPOINTS_LIST);
  
  const endpoints: Endpoint[] = [];
  for (const id of endpointIds) {
    const endpoint = await getEndpoint(id);
    if (endpoint) {
      endpoints.push(endpoint);
    }
  }
  
  return endpoints;
}

export async function deleteEndpoint(endpointId: string): Promise<void> {
  const client = getRedisClient();
  const key = REDIS_KEYS.ENDPOINT + endpointId;
  
  await client.del(key);
  await client.srem(REDIS_KEYS.ENDPOINTS_LIST, endpointId);
}

// Local mapping operations
export interface LocalMapping {
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
  createdAt: string;
  updatedAt: string;
}

export async function saveLocalMapping(mapping: LocalMapping): Promise<void> {
  const client = getRedisClient();
  const key = REDIS_KEYS.LOCAL_MAPPING + mapping.serverEndpointId;
  
  await client.hset(key, {
    id: mapping.id,
    serverEndpointId: mapping.serverEndpointId,
    localTargetUrl: mapping.localTargetUrl,
    authConfig: JSON.stringify(mapping.authConfig || null),
    retryOverride: JSON.stringify(mapping.retryOverride || null),
    addHeaders: JSON.stringify(mapping.addHeaders),
    removeHeaders: JSON.stringify(mapping.removeHeaders),
    isActive: mapping.isActive ? '1' : '0',
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
  });
  
  await client.sadd(REDIS_KEYS.LOCAL_MAPPINGS_LIST, mapping.serverEndpointId);
}

export async function getLocalMapping(serverEndpointId: string): Promise<LocalMapping | null> {
  const client = getRedisClient();
  const key = REDIS_KEYS.LOCAL_MAPPING + serverEndpointId;
  
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
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function listLocalMappings(): Promise<LocalMapping[]> {
  const client = getRedisClient();
  const mappingIds = await client.smembers(REDIS_KEYS.LOCAL_MAPPINGS_LIST);
  
  const mappings: LocalMapping[] = [];
  for (const id of mappingIds) {
    const mapping = await getLocalMapping(id);
    if (mapping) {
      mappings.push(mapping);
    }
  }
  
  return mappings;
}

export async function deleteLocalMapping(serverEndpointId: string): Promise<void> {
  const client = getRedisClient();
  const key = REDIS_KEYS.LOCAL_MAPPING + serverEndpointId;
  
  await client.del(key);
  await client.srem(REDIS_KEYS.LOCAL_MAPPINGS_LIST, serverEndpointId);
}

// Metrics operations
export async function incrementMetric(key: string, value: number = 1): Promise<void> {
  const client = getRedisClient();
  await client.incrby(key, value);
}

export async function getMetric(key: string): Promise<number> {
  const client = getRedisClient();
  const value = await client.get(key);
  return parseInt(value || '0', 10);
}

export async function getAllMetrics(): Promise<{
  webhooksReceived: number;
  webhooksForwarded: number;
  webhooksFailed: number;
  dlqSize: number;
}> {
  return {
    webhooksReceived: await getMetric(REDIS_KEYS.METRICS_WEBHOOKS_RECEIVED),
    webhooksForwarded: await getMetric(REDIS_KEYS.METRICS_WEBHOOKS_FORWARDED),
    webhooksFailed: await getMetric(REDIS_KEYS.METRICS_WEBHOOKS_FAILED),
    dlqSize: await getMetric(REDIS_KEYS.METRICS_DLQ_SIZE),
  };
}

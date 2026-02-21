# Mappings and Forwarding

Mappings define how webhooks are forwarded from the public server to your internal services.

## What are Mappings?

A mapping connects an endpoint (public webhook URL) to an internal service URL. When a webhook is received:

1. The endpoint validates the request
2. The webhook is published to Redis Stream
3. The Relay Client picks it up
4. The mapping determines where to forward it

## Creating a Mapping

### From Dashboard

1. Go to the "Mappings" tab
2. Click "Add Mapping"
3. Select the endpoint
4. Enter the target URL
5. Configure authentication (if needed)
6. Save

### During Endpoint Creation

When creating a new endpoint, you can automatically create a mapping:

1. Enable "Forward to Local Service"
2. Enter the Target URL
3. Configure authentication
4. Create the endpoint

## Mapping Configuration

### Basic Mapping

```json
{
  "serverEndpointId": "endpoint-id",
  "localTargetUrl": "http://localhost:3000/webhook",
  "isActive": true
}
```

### With Authentication

```json
{
  "serverEndpointId": "endpoint-id",
  "localTargetUrl": "http://crm.internal:8080/api/webhook",
  "authConfig": {
    "type": "bearer",
    "token": "internal-api-token"
  },
  "isActive": true
}
```

### With Custom Headers

Add or remove headers during forwarding:

```json
{
  "serverEndpointId": "endpoint-id",
  "localTargetUrl": "http://localhost:3000/webhook",
  "addHeaders": {
    "X-Source": "webrelay",
    "X-Environment": "production"
  },
  "removeHeaders": ["X-API-Key", "Authorization"],
  "isActive": true
}
```

### With Retry Override

Customize retry behavior per mapping:

```json
{
  "serverEndpointId": "endpoint-id",
  "localTargetUrl": "http://localhost:3000/webhook",
  "retryOverride": {
    "maxRetries": 5,
    "initialDelayMs": 100,
    "backoffFactor": 2,
    "maxDelayMs": 30000
  },
  "isActive": true
}
```

## Forwarding Flow

```
External Service
       │
       ▼
   Webhook POST
       │
       ▼
  Relay Server
       │
       ▼
  Redis Stream
       │
       ▼
  Relay Client
       │
       ▼
    Mapping
       │
       ▼
 Internal Service
```

## Retry Behavior

When forwarding fails, WebRelay automatically retries:

1. **Initial attempt**: Try immediately
2. **First retry**: After 100ms
3. **Second retry**: After 200ms
4. **Third retry**: After 400ms
5. **Final failure**: Send to DLQ

The delay doubles with each retry (exponential backoff).

## Client Errors vs Server Errors

- **4xx errors** (client errors): Not retried - problem with the request
- **5xx errors** (server errors): Retried - temporary issue
- **Network errors**: Retried - connection issue

## Multiple Clients

You can run multiple relay clients for:

- **High availability**: If one client fails, others continue
- **Load balancing**: Redis distributes messages across consumers
- **Geographic distribution**: Different clients for different regions

Each client must have a unique `CONSUMER_NAME`.

## Circuit Breaker

The relay client includes a circuit breaker:

- Opens after 5 consecutive failures to a URL
- Stays open for 30 seconds
- Allows one retry (half-open state)
- Closes if successful, reopens if failed

This prevents cascading failures and allows recovery.

## Troubleshooting

### Webhook not forwarded

1. Check if mapping exists for the endpoint
2. Verify the target URL is accessible from the client
3. Check client logs for errors
4. Verify authentication configuration

### Forwarding fails

1. Check if the target service is running
2. Verify network connectivity
3. Check authentication credentials
4. Review retry settings

### Messages in DLQ

1. Check the error message in DLQ
2. Fix the underlying issue
3. Replay the message from dashboard

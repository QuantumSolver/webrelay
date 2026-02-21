# Authentication Methods

WebRelay supports multiple authentication methods for both incoming webhooks and forwarding to internal services.

## Incoming Webhook Authentication

When creating an endpoint, you can require authentication. WebRelay supports:

### API Key Authentication

The simplest method - include an API key in the request header:

```http
POST /relay/{endpoint-id}
X-API-Key: rk_your-api-key-here
Content-Type: application/json

{"event": "user.created", "data": {...}}
```

### Bearer Token Authentication

Include a Bearer token in the Authorization header:

```http
POST /relay/{endpoint-id}
Authorization: Bearer your-token-here
Content-Type: application/json

{"event": "user.created", "data": {...}}
```

### Basic Authentication

Use HTTP Basic Auth:

```http
POST /relay/{endpoint-id}
Authorization: Basic base64(username:password)
Content-Type: application/json

{"event": "user.created", "data": {...}}
```

## Managing API Keys

### Creating API Keys

1. Go to the dashboard
2. Create a new endpoint with "Require Authentication" enabled
3. Check "Generate API Key"
4. Copy the key immediately (it won't be shown again)

### Key Security

- Keys are stored as bcrypt hashes in the database
- The full key is only shown once when created
- You can revoke keys at any time from the dashboard
- Each key can be linked to a specific endpoint

### Key Format

API keys follow the format: `rk_xxxxxxxxx`

The `rk_` prefix helps identify them as relay keys.

## Forwarding Authentication

When forwarding webhooks to internal services, you can configure authentication in the mapping:

### No Authentication

For internal services that don't require auth:

```json
{
  "authConfig": null
}
```

### Basic Auth

```json
{
  "authConfig": {
    "type": "basic",
    "username": "internal-user",
    "password": "internal-password"
  }
}
```

### Bearer Token

```json
{
  "authConfig": {
    "type": "bearer",
    "token": "your-internal-token"
  }
}
```

### API Key (Custom Header)

```json
{
  "authConfig": {
    "type": "api_key",
    "keyName": "X-Internal-Key",
    "keyValue": "your-key-value",
    "keyIn": "header"
  }
}
```

## Best Practices

1. **Use Different Keys**: Create separate API keys for each integration
2. **Rotate Keys**: Periodically revoke and regenerate keys
3. **Restrict Access**: Only enable authentication for public endpoints
4. **Internal Auth**: Keep internal authentication simple since it's on your private network
5. **Monitor Usage**: Check the logs regularly for unauthorized access attempts

## Rate Limiting

Each API key can have a rate limit configured (requests per minute). This helps prevent abuse:

- Default: 60 requests/minute
- Can be customized per key
- Excess requests receive 429 responses

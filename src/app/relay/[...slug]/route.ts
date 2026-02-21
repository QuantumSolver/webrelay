import { NextRequest, NextResponse } from 'next/server';
import {
  getEndpoint,
  publishToStream,
  incrementMetric,
  REDIS_KEYS,
} from '@/lib/redis';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

// Webhook receiver endpoint - handles /relay/[...slug]
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  return handleWebhook(request, params);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  return handleWebhook(request, params);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  return handleWebhook(request, params);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  return handleWebhook(request, params);
}

async function handleWebhook(
  request: NextRequest,
  params: Promise<{ slug: string[] }>
) {
  const { slug } = await params;
  const endpointId = slug.join('/');
  
  try {
    // Lookup endpoint configuration
    const endpoint = await getEndpoint(endpointId);
    
    if (!endpoint) {
      return NextResponse.json(
        { error: 'Endpoint not found', endpointId },
        { status: 404 }
      );
    }
    
    if (!endpoint.isActive) {
      return NextResponse.json(
        { error: 'Endpoint is disabled' },
        { status: 503 }
      );
    }
    
    // Validate authentication if required
    if (endpoint.authRequired) {
      const authResult = await validateAuth(request, endpoint);
      if (!authResult.valid) {
        return NextResponse.json(
          { error: authResult.error },
          { status: 401 }
        );
      }
    }
    
    // Read request body
    const body = await request.text();
    const bodyBase64 = Buffer.from(body).toString('base64');
    
    // Extract headers
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    // Extract query params
    const query: Record<string, string> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    
    // Create webhook ID
    const webhookId = uuidv4();
    
    // Log webhook to database
    await db.webhookLog.create({
      data: {
        id: uuidv4(),
        webhookId,
        endpointId,
        method: request.method,
        headers: JSON.stringify(headers),
        body: bodyBase64,
        query: JSON.stringify(query),
        sourceIp: request.headers.get('x-forwarded-for') || 
                  request.headers.get('x-real-ip') || 
                  'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
        status: 'pending',
        attempts: 0,
      },
    });
    
    // Publish to Redis Stream
    const messageData: Record<string, string> = {
      webhookId,
      endpointId,
      method: request.method,
      headers: JSON.stringify(headers),
      body: bodyBase64,
      query: JSON.stringify(query),
      sourceIp: headers['x-forwarded-for'] || headers['x-real-ip'] || 'unknown',
      timestamp: new Date().toISOString(),
      platform: endpoint.platform,
      defaultTarget: endpoint.defaultTarget,
      retryConfig: JSON.stringify(endpoint.retryConfig),
    };
    
    const messageId = await publishToStream(messageData);
    
    // Increment metrics
    await incrementMetric(REDIS_KEYS.METRICS_WEBHOOKS_RECEIVED);
    
    return NextResponse.json({
      status: 'accepted',
      webhookId,
      messageId,
      endpointId,
      timestamp: new Date().toISOString(),
    }, { status: 202 });
    
  } catch (error) {
    console.error('Error handling webhook:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function validateAuth(
  request: NextRequest,
  endpoint: {
    authMethods: string[];
    apiKeyRequired: boolean;
  }
): Promise<{ valid: boolean; error?: string }> {
  // Try API Key authentication
  if (endpoint.authMethods.includes('api_key')) {
    const apiKey = request.headers.get('x-api-key') || 
                   request.nextUrl.searchParams.get('api_key');
    
    if (apiKey) {
      const keyRecord = await db.apiKey.findFirst({
        where: {
          key: apiKey,
          isActive: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      });
      
      if (keyRecord) {
        // Update last used
        await db.apiKey.update({
          where: { id: keyRecord.id },
          data: { lastUsedAt: new Date() },
        });
        return { valid: true };
      }
    }
  }
  
  // Try Bearer token authentication
  if (endpoint.authMethods.includes('jwt')) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      // For now, accept any Bearer token (in production, validate JWT)
      const token = authHeader.substring(7);
      if (token.length > 0) {
        return { valid: true };
      }
    }
  }
  
  // Try Basic authentication
  if (endpoint.authMethods.includes('basic')) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Basic ')) {
      // For now, accept any Basic auth (in production, validate credentials)
      const credentials = authHeader.substring(6);
      if (credentials.length > 0) {
        return { valid: true };
      }
    }
  }
  
  // Allow anonymous if configured
  if (endpoint.authMethods.includes('anonymous')) {
    return { valid: true };
  }
  
  return { valid: false, error: 'Authentication required' };
}

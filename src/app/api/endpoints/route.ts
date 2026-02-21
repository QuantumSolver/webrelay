import { NextRequest, NextResponse } from 'next/server';
import {
  saveEndpoint,
  listEndpoints,
  deleteEndpoint as deleteEndpointFromRedis,
  getEndpoint,
  deleteLocalMapping,
  type Endpoint,
} from '@/lib/redis';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

// GET /api/endpoints - List all endpoints
export async function GET() {
  try {
    const endpoints = await listEndpoints();
    return NextResponse.json({ endpoints });
  } catch (error) {
    console.error('Error listing endpoints:', error);
    return NextResponse.json(
      { error: 'Failed to list endpoints' },
      { status: 500 }
    );
  }
}

// POST /api/endpoints - Create a new endpoint
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Check for duplicate name
    const existingEndpoints = await listEndpoints();
    const duplicateName = existingEndpoints.find(
      (ep) => ep.name.toLowerCase() === (body.name || '').toLowerCase()
    );
    
    if (duplicateName) {
      return NextResponse.json(
        { error: `An endpoint with name "${body.name}" already exists` },
        { status: 400 }
      );
    }
    
    const id = body.id || uuidv4();
    const now = new Date().toISOString();
    
    const endpoint: Endpoint = {
      id,
      name: body.name,
      platform: body.platform || 'custom',
      path: body.path || `/relay/${id}`,
      authRequired: body.authRequired ?? false,
      authMethods: body.authMethods || ['api_key', 'anonymous'],
      apiKeyRequired: body.apiKeyRequired ?? false,
      defaultTarget: body.defaultTarget || '',
      headers: body.headers || {},
      httpMethod: body.httpMethod || 'POST',
      retryConfig: body.retryConfig || {
        maxRetries: 3,
        initialDelayMs: 100,
        backoffFactor: 2,
        maxDelayMs: 10000,
      },
      isActive: body.isActive ?? true,
      createdAt: now,
      updatedAt: now,
      createdBy: body.createdBy || 'system',
    };
    
    await saveEndpoint(endpoint);
    
    return NextResponse.json({ success: true, endpoint });
  } catch (error) {
    console.error('Error creating endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to create endpoint' },
      { status: 500 }
    );
  }
}

// DELETE /api/endpoints - Delete an endpoint and all linked resources
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { error: 'Endpoint ID is required' },
        { status: 400 }
      );
    }
    
    // 1. Delete associated mapping from Redis
    try {
      await deleteLocalMapping(id);
    } catch {
      // Mapping might not exist, that's okay
    }
    
    // 2. Delete associated API keys from database
    try {
      await db.apiKey.deleteMany({
        where: { endpointId: id },
      });
    } catch (err) {
      console.error('Error deleting associated API keys:', err);
    }
    
    // 3. Delete endpoint from Redis
    await deleteEndpointFromRedis(id);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to delete endpoint' },
      { status: 500 }
    );
  }
}

// PUT /api/endpoints - Update an endpoint
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: 'Endpoint ID is required' },
        { status: 400 }
      );
    }
    
    // Check for duplicate name if name is being updated
    if (updates.name) {
      const existingEndpoints = await listEndpoints();
      const duplicateName = existingEndpoints.find(
        (ep) => ep.id !== id && ep.name.toLowerCase() === updates.name.toLowerCase()
      );
      
      if (duplicateName) {
        return NextResponse.json(
          { error: `An endpoint with name "${updates.name}" already exists` },
          { status: 400 }
        );
      }
    }
    
    const existing = await getEndpoint(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Endpoint not found' },
        { status: 404 }
      );
    }
    
    const updated: Endpoint = {
      ...existing,
      ...updates,
      id, // Ensure ID doesn't change
      updatedAt: new Date().toISOString(),
    };
    
    await saveEndpoint(updated);
    
    return NextResponse.json({ success: true, endpoint: updated });
  } catch (error) {
    console.error('Error updating endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to update endpoint' },
      { status: 500 }
    );
  }
}

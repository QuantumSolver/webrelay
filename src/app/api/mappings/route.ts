import { NextRequest, NextResponse } from 'next/server';
import {
  saveLocalMapping,
  listLocalMappings,
  deleteLocalMapping,
  getLocalMapping,
  listEndpoints,
  type LocalMapping,
} from '@/lib/redis';
import { v4 as uuidv4 } from 'uuid';

// GET /api/mappings - List all local mappings
export async function GET() {
  try {
    const mappings = await listLocalMappings();
    const endpoints = await listEndpoints();
    
    // Enrich mappings with endpoint info
    const enrichedMappings = mappings.map((mapping) => {
      const endpoint = endpoints.find((e) => e.id === mapping.serverEndpointId);
      return {
        ...mapping,
        endpointName: endpoint?.name || 'Unknown',
        endpointPlatform: endpoint?.platform || 'unknown',
      };
    });
    
    return NextResponse.json({ mappings: enrichedMappings, endpoints });
  } catch (error) {
    console.error('Error listing mappings:', error);
    return NextResponse.json(
      { error: 'Failed to list mappings' },
      { status: 500 }
    );
  }
}

// POST /api/mappings - Create a new local mapping
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const now = new Date().toISOString();
    
    const mapping: LocalMapping = {
      id: uuidv4(),
      serverEndpointId: body.serverEndpointId,
      localTargetUrl: body.localTargetUrl,
      authConfig: body.authConfig || null,
      retryOverride: body.retryOverride || null,
      addHeaders: body.addHeaders || {},
      removeHeaders: body.removeHeaders || [],
      isActive: body.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    
    await saveLocalMapping(mapping);
    
    return NextResponse.json({ success: true, mapping });
  } catch (error) {
    console.error('Error creating mapping:', error);
    return NextResponse.json(
      { error: 'Failed to create mapping' },
      { status: 500 }
    );
  }
}

// DELETE /api/mappings - Delete a local mapping
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serverEndpointId = searchParams.get('serverEndpointId');
    
    if (!serverEndpointId) {
      return NextResponse.json(
        { error: 'Server endpoint ID is required' },
        { status: 400 }
      );
    }
    
    await deleteLocalMapping(serverEndpointId);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting mapping:', error);
    return NextResponse.json(
      { error: 'Failed to delete mapping' },
      { status: 500 }
    );
  }
}

// PUT /api/mappings - Update a local mapping
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { serverEndpointId, ...updates } = body;
    
    if (!serverEndpointId) {
      return NextResponse.json(
        { error: 'Server endpoint ID is required' },
        { status: 400 }
      );
    }
    
    const existing = await getLocalMapping(serverEndpointId);
    if (!existing) {
      return NextResponse.json(
        { error: 'Mapping not found' },
        { status: 404 }
      );
    }
    
    const updated: LocalMapping = {
      ...existing,
      ...updates,
      serverEndpointId, // Ensure ID doesn't change
      updatedAt: new Date().toISOString(),
    };
    
    await saveLocalMapping(updated);
    
    return NextResponse.json({ success: true, mapping: updated });
  } catch (error) {
    console.error('Error updating mapping:', error);
    return NextResponse.json(
      { error: 'Failed to update mapping' },
      { status: 500 }
    );
  }
}

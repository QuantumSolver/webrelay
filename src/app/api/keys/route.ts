import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// GET /api/keys - List all API keys
export async function GET() {
  try {
    const keys = await db.apiKey.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
    
    // Mask the actual key value for security
    const maskedKeys = keys.map((k) => ({
      ...k,
      key: k.key.substring(0, 8) + '...' + k.key.substring(k.key.length - 4),
    }));
    
    return NextResponse.json({ keys: maskedKeys });
  } catch (error) {
    console.error('Error listing API keys:', error);
    return NextResponse.json(
      { error: 'Failed to list API keys' },
      { status: 500 }
    );
  }
}

// POST /api/keys - Create a new API key
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Generate a secure API key
    const keyValue = `rk_${crypto.randomBytes(32).toString('hex')}`;
    
    const key = await db.apiKey.create({
      data: {
        id: uuidv4(),
        name: body.name || 'API Key',
        key: keyValue,
        platform: body.platform || null,
        permissions: JSON.stringify(body.permissions || ['read']),
        rateLimit: body.rateLimit || 60,
        isActive: body.isActive ?? true,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        endpointId: body.endpointId || null,
      },
    });
    
    console.log('Created API key:', key.id, 'keyValue length:', keyValue.length);
    
    return NextResponse.json({ 
      success: true,
      keyValue, // Return the full key at top level for easy access
      key: {
        id: key.id,
        name: key.name,
        platform: key.platform,
        rateLimit: key.rateLimit,
        isActive: key.isActive,
        createdAt: key.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    return NextResponse.json(
      { error: 'Failed to create API key', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// DELETE /api/keys - Delete an API key
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { error: 'API key ID is required' },
        { status: 400 }
      );
    }
    
    await db.apiKey.delete({
      where: { id },
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting API key:', error);
    return NextResponse.json(
      { error: 'Failed to delete API key' },
      { status: 500 }
    );
  }
}

// PUT /api/keys - Update an API key
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: 'API key ID is required' },
        { status: 400 }
      );
    }
    
    const key = await db.apiKey.update({
      where: { id },
      data: {
        ...updates,
        permissions: updates.permissions ? JSON.stringify(updates.permissions) : undefined,
        expiresAt: updates.expiresAt ? new Date(updates.expiresAt) : undefined,
        updatedAt: new Date(),
      },
    });
    
    return NextResponse.json({ success: true, key });
  } catch (error) {
    console.error('Error updating API key:', error);
    return NextResponse.json(
      { error: 'Failed to update API key' },
      { status: 500 }
    );
  }
}

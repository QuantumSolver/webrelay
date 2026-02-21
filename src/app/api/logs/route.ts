import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/logs - List webhook logs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const status = searchParams.get('status');
    const endpointId = searchParams.get('endpointId');
    
    const where: {
      status?: string;
      endpointId?: string;
    } = {};
    
    if (status) {
      where.status = status;
    }
    
    if (endpointId) {
      where.endpointId = endpointId;
    }
    
    const logs = await db.webhookLog.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
    });
    
    const total = await db.webhookLog.count({ where });
    
    return NextResponse.json({
      logs,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + logs.length < total,
      },
    });
  } catch (error) {
    console.error('Error listing webhook logs:', error);
    return NextResponse.json(
      { error: 'Failed to list webhook logs' },
      { status: 500 }
    );
  }
}

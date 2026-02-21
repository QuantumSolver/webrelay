import { NextResponse } from 'next/server';
import { getAllMetrics, getRedisClient, STREAM_NAME, DEAD_LETTER_QUEUE } from '@/lib/redis';
import { db } from '@/lib/db';

// GET /api/metrics - Get system metrics
export async function GET() {
  try {
    const client = getRedisClient();
    
    // Get basic metrics
    const metrics = await getAllMetrics();
    
    // Get stream info
    let streamLength = 0;
    let consumerGroupInfo: { pending: number; consumers: number } | null = null;
    
    try {
      const streamInfo = await client.xinfo('STREAM', STREAM_NAME);
      streamLength = typeof streamInfo === 'object' && 'length' in streamInfo 
        ? (streamInfo as unknown as { length: number }).length 
        : 0;
    } catch {
      // Stream doesn't exist yet
    }
    
    // Get DLQ length
    let dlqLength = 0;
    try {
      const dlqInfo = await client.xinfo('STREAM', DEAD_LETTER_QUEUE);
      dlqLength = typeof dlqInfo === 'object' && 'length' in dlqInfo 
        ? (dlqInfo as unknown as { length: number }).length 
        : 0;
    } catch {
      // DLQ doesn't exist yet
    }
    
    // Get endpoint count
    const endpointsCount = await client.scard('endpoints:list');
    
    // Get API keys count from database
    const apiKeysCount = await db.apiKey.count({
      where: { isActive: true },
    });
    
    // Get webhook logs stats
    const webhookLogsCount = await db.webhookLog.count();
    const pendingWebhooks = await db.webhookLog.count({
      where: { status: 'pending' },
    });
    const failedWebhooks = await db.webhookLog.count({
      where: { status: 'failed' },
    });
    
    return NextResponse.json({
      ...metrics,
      streamLength,
      dlqLength,
      consumerGroupInfo,
      endpointsCount,
      apiKeysCount,
      webhookLogsCount,
      pendingWebhooks,
      failedWebhooks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting metrics:', error);
    return NextResponse.json(
      { error: 'Failed to get metrics' },
      { status: 500 }
    );
  }
}

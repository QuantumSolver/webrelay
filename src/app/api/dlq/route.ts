import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient, DEAD_LETTER_QUEUE, STREAM_NAME, publishToStream } from '@/lib/redis';

// GET /api/dlq - List dead letter queue messages
export async function GET(request: NextRequest) {
  try {
    const client = getRedisClient();
    const { searchParams } = new URL(request.url);
    const count = parseInt(searchParams.get('count') || '50', 10);
    
    // Read from DLQ stream
    const result = await client.xrange(DEAD_LETTER_QUEUE, '-', '+', 'COUNT', count);
    
    const messages = result.map(([id, fields]) => {
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1];
      }
      return {
        id,
        data,
        timestamp: new Date(parseInt(id.split('-')[0])).toISOString(),
      };
    });
    
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Error reading DLQ:', error);
    // Return empty array if DLQ doesn't exist
    return NextResponse.json({ messages: [] });
  }
}

// POST /api/dlq - Replay a message from DLQ
export async function POST(request: NextRequest) {
  try {
    const client = getRedisClient();
    const body = await request.json();
    const { messageId } = body;
    
    if (!messageId) {
      return NextResponse.json(
        { error: 'Message ID is required' },
        { status: 400 }
      );
    }
    
    // Get the message from DLQ
    const result = await client.xrange(DEAD_LETTER_QUEUE, messageId, messageId);
    
    if (!result || result.length === 0) {
      return NextResponse.json(
        { error: 'Message not found in DLQ' },
        { status: 404 }
      );
    }
    
    const [, fields] = result[0];
    const data: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      data[fields[i]] = fields[i + 1];
    }
    
    // Remove error fields before replaying
    const replayData: Record<string, string> = { ...data };
    delete replayData.error;
    delete replayData.failedAt;
    delete replayData.originalStream;
    
    // Publish to main stream
    const newMessageId = await publishToStream(replayData, STREAM_NAME);
    
    // Delete from DLQ
    await client.xdel(DEAD_LETTER_QUEUE, messageId);
    
    return NextResponse.json({
      success: true,
      newMessageId,
      replayedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error replaying DLQ message:', error);
    return NextResponse.json(
      { error: 'Failed to replay message' },
      { status: 500 }
    );
  }
}

// DELETE /api/dlq - Delete a message from DLQ
export async function DELETE(request: NextRequest) {
  try {
    const client = getRedisClient();
    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('messageId');
    
    if (!messageId) {
      return NextResponse.json(
        { error: 'Message ID is required' },
        { status: 400 }
      );
    }
    
    await client.xdel(DEAD_LETTER_QUEUE, messageId);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting DLQ message:', error);
    return NextResponse.json(
      { error: 'Failed to delete message' },
      { status: 500 }
    );
  }
}

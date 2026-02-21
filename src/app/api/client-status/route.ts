import { NextResponse } from 'next/server';

// GET /api/client-status - Get relay client status
export async function GET() {
  try {
    // Try to connect to the relay client health endpoint
    const clientPort = process.env.CLIENT_PORT || '3003';
    
    const response = await fetch(`http://localhost:${clientPort}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    
    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        connected: true,
        consumerName: data.consumerName,
        stream: data.stream,
        group: data.group,
        lastChecked: new Date().toISOString(),
      });
    } else {
      return NextResponse.json({
        connected: false,
        error: 'Client returned non-OK status',
        lastChecked: new Date().toISOString(),
      });
    }
  } catch (error) {
    return NextResponse.json({
      connected: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date().toISOString(),
    });
  }
}

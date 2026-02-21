import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

export async function GET() {
  try {
    // Check Redis connection
    const redis = getRedisClient();
    await redis.ping();
    
    return NextResponse.json({ 
      status: "healthy",
      service: "relay-server",
      redis: "connected",
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    return NextResponse.json({ 
      status: "unhealthy",
      service: "relay-server",
      redis: "disconnected",
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString() 
    }, { status: 503 });
  }
}

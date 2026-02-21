import { NextResponse } from "next/server";
import { getRedisClient } from "@/lib/redis";

export async function GET() {
  return NextResponse.json({ 
    status: "ok", 
    service: "relay-server",
    timestamp: new Date().toISOString() 
  });
}
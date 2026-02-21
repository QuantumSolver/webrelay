import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import bcrypt from 'bcryptjs';

// Simple session store (in production, use Redis or database)
const sessions = new Map<string, { userId: string; expires: number }>();

// Get admin credentials from environment or create default
const getAdminCredentials = async () => {
  let admin = await db.user.findFirst({
    where: { role: 'admin' }
  });
  
  if (!admin) {
    // Create default admin on first run
    const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    
    admin = await db.user.create({
      data: {
        username: 'admin',
        password: hashedPassword,
        role: 'admin',
      }
    });
    
    console.log('[Auth] Created default admin user');
    console.log('[Auth] Username: admin');
    console.log('[Auth] Password: (from ADMIN_PASSWORD env or "admin123")');
  }
  
  return admin;
};

// Generate session token
const generateToken = () => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

// POST - Login
export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();
    
    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password required' },
        { status: 400 }
      );
    }
    
    // Get or create admin user
    const admin = await getAdminCredentials();
    
    // Check if user exists with this username
    let user = await db.user.findFirst({
      where: { username }
    });
    
    // If no user exists and this is the first login attempt with admin credentials
    if (!user && username === 'admin') {
      user = admin;
    }
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }
    
    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }
    
    // Create session
    const token = generateToken();
    const expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    
    sessions.set(token, { userId: user.id, expires });
    
    // Update last login
    await db.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });
    
    return NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      }
    });
    
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET - Verify session
export async function GET(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  }
  
  const session = sessions.get(token);
  
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  }
  
  const user = await db.user.findFirst({
    where: { id: session.userId }
  });
  
  if (!user) {
    sessions.delete(token);
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  }
  
  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    }
  });
}

// DELETE - Logout
export async function DELETE(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  
  if (token) {
    sessions.delete(token);
  }
  
  return NextResponse.json({ success: true });
}

// Export for use in other routes
export const validateSession = (token: string): { userId: string } | null => {
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { userId: session.userId };
};

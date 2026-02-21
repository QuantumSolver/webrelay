'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Activity,
  Webhook,
  Key,
  Settings,
  Trash2,
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
  Shield,
  Copy,
  Play,
  Sparkles,
  ArrowRight,
  Server,
  TrendingUp,
  XCircle,
  Loader2,
  Pencil,
  LogIn,
  LogOut,
  RotateCcw,
} from 'lucide-react';

// Types
interface Endpoint {
  id: string;
  name: string;
  platform: string;
  path: string;
  authRequired: boolean;
  authMethods: string[];
  apiKeyRequired: boolean;
  defaultTarget: string;
  headers: Record<string, string>;
  httpMethod: string;
  retryConfig: {
    maxRetries: number;
    initialDelayMs: number;
    backoffFactor: number;
    maxDelayMs: number;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

interface ApiKey {
  id: string;
  name: string;
  key: string;
  keyValue?: string; // Full key value (only shown on creation)
  platform: string | null;
  permissions: string;
  rateLimit: number;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  user?: {
    name: string;
    email: string;
  };
}

interface WebhookLog {
  id: string;
  webhookId: string;
  endpointId: string;
  method: string;
  headers: string;
  body: string;
  query: string | null;
  sourceIp: string;
  userAgent: string;
  status: string;
  attempts: number;
  lastError: string | null;
  forwardedAt: string | null;
  createdAt: string;
}

interface LocalMapping {
  id: string;
  serverEndpointId: string;
  localTargetUrl: string;
  authConfig: {
    type: string;
    username?: string;
    password?: string;
    token?: string;
    keyName?: string;
    keyValue?: string;
    keyIn?: string;
  } | null;
  retryOverride: {
    maxRetries: number;
    initialDelayMs: number;
    backoffFactor: number;
    maxDelayMs: number;
  } | null;
  addHeaders: Record<string, string>;
  removeHeaders: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  endpointName?: string;
  endpointPlatform?: string;
}

interface DLQMessage {
  id: string;
  data: Record<string, string>;
  timestamp: string;
}

interface Metrics {
  webhooksReceived: number;
  webhooksForwarded: number;
  webhooksFailed: number;
  dlqLength: number;
  streamLength: number;
  endpointsCount: number;
  apiKeysCount: number;
  webhookLogsCount: number;
  pendingWebhooks: number;
  failedWebhooks: number;
}

// Auth state
interface AuthState {
  isLoggedIn: boolean;
  username: string;
  token: string | null;
}

// Realtime metrics from WebSocket
interface RealtimeMetrics {
  webhooksReceived: number;
  webhooksForwarded: number;
  webhooksFailed: number;
  dlqSize: number;
  endpointsCount: number;
  mappingsCount: number;
  connectedClients: number;
  timestamp: string;
}

// Relay client info from WebSocket
interface RelayClientInfo {
  id: string;
  consumerName: string;
  connectedAt: string;
  lastHeartbeat: string;
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [realtimeMetrics, setRealtimeMetrics] = useState<RealtimeMetrics | null>(null);
  const [realtimeClientStatus, setRealtimeClientStatus] = useState<{
    connected: boolean;
    consumerName?: string;
    stream?: string;
    group?: string;
  } | null>(null);
  const [relayClients, setRelayClients] = useState<RelayClientInfo[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [mappings, setMappings] = useState<LocalMapping[]>([]);
  const [dlqMessages, setDlqMessages] = useState<DLQMessage[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clientStatus, setClientStatus] = useState<{
    connected: boolean;
    consumerName?: string;
    stream?: string;
    group?: string;
    error?: string;
    lastChecked: string;
  } | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  
  // Socket.io reference
  const socketRef = useRef<Socket | null>(null);
  
  // Auth state
  const [auth, setAuth] = useState<AuthState>({ isLoggedIn: false, username: '', token: null });
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [showLogin, setShowLogin] = useState(false);
  
  // Dialog states
  const [createDialog, setCreateDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [mappingDialog, setMappingDialog] = useState(false);
  const [keyViewDialog, setKeyViewDialog] = useState(false);
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);
  
  // Success state
  const [createdData, setCreatedData] = useState<{
    endpoint: Endpoint | null;
    apiKey: string | null;
  }>({ endpoint: null, apiKey: null });
  
  // Edit form
  const [editForm, setEditForm] = useState<Endpoint | null>(null);
  
  // Unified form for endpoint + api key + mapping
  const [unifiedForm, setUnifiedForm] = useState({
    name: '',
    platform: '',
    authRequired: false,
    isActive: true,
    generateApiKey: true,
    keyName: '',
    rateLimit: 60,
    createMapping: true,
    localTargetUrl: '',
    authType: 'none',
    authUsername: '',
    authPassword: '',
    authToken: '',
    mappingActive: true,
  });

  // Mapping form (standalone)
  const [mappingForm, setMappingForm] = useState({
    serverEndpointId: '',
    localTargetUrl: '',
    authType: 'none',
    authUsername: '',
    authPassword: '',
    authToken: '',
    isActive: true,
  });

  // Check auth on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('relay_token');
    const savedUsername = localStorage.getItem('relay_username');
    
    if (savedToken && savedUsername) {
      // Verify token with server
      fetch('/api/auth', {
        headers: { 'Authorization': `Bearer ${savedToken}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.authenticated) {
            setAuth({ isLoggedIn: true, username: savedUsername, token: savedToken });
          } else {
            localStorage.removeItem('relay_token');
            localStorage.removeItem('relay_username');
            setShowLogin(true);
          }
        })
        .catch(() => {
          setShowLogin(true);
        });
    } else {
      setShowLogin(true);
    }
  }, []);

  // Handle login
  const handleLogin = async () => {
    if (!loginForm.username || !loginForm.password) {
      toast.error('Please enter username and password');
      return;
    }
    
    setLoginLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      
      const data = await res.json();
      
      if (data.success) {
        localStorage.setItem('relay_token', data.token);
        localStorage.setItem('relay_username', data.user.username);
        setAuth({ isLoggedIn: true, username: data.user.username, token: data.token });
        setShowLogin(false);
        toast.success(`Welcome, ${data.user.username}!`);
      } else {
        toast.error(data.error || 'Login failed');
      }
    } catch {
      toast.error('Login failed. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    if (auth.token) {
      try {
        await fetch('/api/auth', {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${auth.token}` }
        });
      } catch {
        // Ignore logout errors
      }
    }
    
    localStorage.removeItem('relay_token');
    localStorage.removeItem('relay_username');
    setAuth({ isLoggedIn: false, username: '', token: null });
    setShowLogin(true);
    setLoginForm({ username: '', password: '' });
    toast.info('Logged out successfully');
  };

  // Fetch data
  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/metrics');
      const data = await res.json();
      setMetrics(data);
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    }
  }, []);

  const fetchEndpoints = useCallback(async () => {
    setLoading((prev) => ({ ...prev, endpoints: true }));
    try {
      const res = await fetch('/api/endpoints');
      const data = await res.json();
      setEndpoints(data.endpoints || []);
    } catch (error) {
      console.error('Failed to fetch endpoints:', error);
    } finally {
      setLoading((prev) => ({ ...prev, endpoints: false }));
    }
  }, []);

  const fetchApiKeys = useCallback(async () => {
    setLoading((prev) => ({ ...prev, apiKeys: true }));
    try {
      const res = await fetch('/api/keys');
      const data = await res.json();
      setApiKeys(data.keys || []);
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setLoading((prev) => ({ ...prev, apiKeys: false }));
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoading((prev) => ({ ...prev, logs: true }));
    try {
      const res = await fetch('/api/logs?limit=100');
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading((prev) => ({ ...prev, logs: false }));
    }
  }, []);

  const fetchMappings = useCallback(async () => {
    setLoading((prev) => ({ ...prev, mappings: true }));
    try {
      const res = await fetch('/api/mappings');
      const data = await res.json();
      setMappings(data.mappings || []);
    } catch (error) {
      console.error('Failed to fetch mappings:', error);
    } finally {
      setLoading((prev) => ({ ...prev, mappings: false }));
    }
  }, []);

  const fetchDLQ = useCallback(async () => {
    setLoading((prev) => ({ ...prev, dlq: true }));
    try {
      const res = await fetch('/api/dlq');
      const data = await res.json();
      setDlqMessages(data.messages || []);
    } catch (error) {
      console.error('Failed to fetch DLQ:', error);
    } finally {
      setLoading((prev) => ({ ...prev, dlq: false }));
    }
  }, []);

  const fetchClientStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/client-status');
      const data = await res.json();
      setClientStatus(data);
    } catch (error) {
      console.error('Failed to fetch client status:', error);
      setClientStatus({
        connected: false,
        error: 'Failed to connect',
        lastChecked: new Date().toISOString(),
      });
    }
  }, []);

  // Initial fetch and WebSocket connection
  useEffect(() => {
    if (auth.isLoggedIn) {
      // Initial fetch
      fetchEndpoints();
      fetchApiKeys();
      fetchLogs();
      fetchMappings();
      fetchDLQ();
      
      // Connect to realtime service via WebSocket
      const realtimeUrl = process.env.NEXT_PUBLIC_REALTIME_URL || 'http://localhost:3004';
      socketRef.current = io(realtimeUrl, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
      });
      
      socketRef.current.on('connect', () => {
        console.log('[WebSocket] Connected to realtime service');
      });
      
      socketRef.current.on('disconnect', () => {
        console.log('[WebSocket] Disconnected from realtime service');
      });
      
      // Receive real-time metrics
      socketRef.current.on('metrics', (data: RealtimeMetrics) => {
        setRealtimeMetrics(data);
      });
      
      // Receive relay client status
      socketRef.current.on('client-status', (data: {
        connected: boolean;
        consumerName?: string;
        stream?: string;
        group?: string;
      }) => {
        setRealtimeClientStatus(data);
      });
      
      // Receive connected relay clients list
      socketRef.current.on('relay-clients', (clients: RelayClientInfo[]) => {
        setRelayClients(clients);
      });
      
      // Cleanup on unmount
      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
      };
    }
  }, [auth.isLoggedIn, fetchEndpoints, fetchApiKeys, fetchLogs, fetchMappings, fetchDLQ]);

  // Create unified (endpoint + api key + mapping)
  const createUnified = async () => {
    setActionLoading('create');
    try {
      // Step 1: Create endpoint
      const endpointRes = await fetch('/api/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: unifiedForm.name,
          platform: unifiedForm.platform || 'custom',
          authRequired: unifiedForm.authRequired,
          isActive: unifiedForm.isActive,
        }),
      });
      const endpointData = await endpointRes.json();
      
      if (!endpointData.success) {
        toast.error(endpointData.error || 'Failed to create endpoint');
        setActionLoading(null);
        return;
      }

      const endpoint = endpointData.endpoint as Endpoint;
      let generatedApiKey: string | null = null;

      // Step 2: Create API key if requested (only when auth is required)
      if (unifiedForm.authRequired && unifiedForm.generateApiKey) {
        try {
          const keyRes = await fetch('/api/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: unifiedForm.keyName || `Key for ${unifiedForm.name}`,
              platform: unifiedForm.platform || null,
              rateLimit: unifiedForm.rateLimit,
              endpointId: endpoint.id, // Link key to endpoint
            }),
          });
          const keyData = await keyRes.json();
          console.log('API Key response:', keyData);
          if (keyData.success && keyData.keyValue) {
            generatedApiKey = keyData.keyValue;
          } else {
            console.error('Failed to create API key:', keyData);
          }
        } catch (keyError) {
          console.error('Error creating API key:', keyError);
        }
      }

      // Step 3: Create mapping if requested
      if (unifiedForm.createMapping && unifiedForm.localTargetUrl) {
        const authConfig = unifiedForm.authType === 'none' ? null : {
          type: unifiedForm.authType,
          ...(unifiedForm.authType === 'basic' && {
            username: unifiedForm.authUsername,
            password: unifiedForm.authPassword,
          }),
          ...(unifiedForm.authType === 'bearer' && {
            token: unifiedForm.authToken,
          }),
          ...(unifiedForm.authType === 'api_key' && {
            keyName: 'X-API-Key',
            keyValue: unifiedForm.authToken,
            keyIn: 'header',
          }),
        };

        await fetch('/api/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverEndpointId: endpoint.id,
            localTargetUrl: unifiedForm.localTargetUrl,
            authConfig,
            isActive: unifiedForm.mappingActive,
          }),
        });
      }

      // Set success state
      setCreatedData({ endpoint, apiKey: generatedApiKey });
      
      toast.success('Endpoint created successfully!');
      fetchEndpoints();
      fetchApiKeys();
      fetchMappings();
      fetchMetrics();
    } catch (error) {
      console.error('Create error:', error);
      toast.error('Failed to create endpoint');
    } finally {
      setActionLoading(null);
    }
  };

  // Update endpoint
  const updateEndpoint = async () => {
    if (!editForm) return;
    setActionLoading('update');
    try {
      const res = await fetch('/api/endpoints', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Endpoint updated');
        setEditDialog(false);
        setEditForm(null);
        fetchEndpoints();
      } else {
        toast.error(data.error || 'Failed to update');
      }
    } catch {
      toast.error('Failed to update endpoint');
    } finally {
      setActionLoading(null);
    }
  };

  // Delete endpoint
  const deleteEndpoint = async (id: string) => {
    setActionLoading(`delete-${id}`);
    try {
      const res = await fetch(`/api/endpoints?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Endpoint and linked resources deleted');
        // Refresh all related data
        fetchEndpoints();
        fetchApiKeys();
        fetchMappings();
        fetchMetrics();
      }
    } catch {
      toast.error('Failed to delete endpoint');
    } finally {
      setActionLoading(null);
    }
  };

  // Delete API key
  const deleteApiKey = async (id: string) => {
    setActionLoading(`delete-key-${id}`);
    try {
      const res = await fetch(`/api/keys?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('API key revoked');
        fetchApiKeys();
        fetchMetrics();
      }
    } catch {
      toast.error('Failed to revoke key');
    } finally {
      setActionLoading(null);
    }
  };

  // Create mapping (standalone)
  const createMapping = async () => {
    setActionLoading('create-mapping');
    try {
      const authConfig = mappingForm.authType === 'none' ? null : {
        type: mappingForm.authType,
        ...(mappingForm.authType === 'basic' && {
          username: mappingForm.authUsername,
          password: mappingForm.authPassword,
        }),
        ...(mappingForm.authType === 'bearer' && {
          token: mappingForm.authToken,
        }),
        ...(mappingForm.authType === 'api_key' && {
          keyName: 'X-API-Key',
          keyValue: mappingForm.authToken,
          keyIn: 'header',
        }),
      };

      const res = await fetch('/api/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverEndpointId: mappingForm.serverEndpointId,
          localTargetUrl: mappingForm.localTargetUrl,
          authConfig,
          isActive: mappingForm.isActive,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Mapping created');
        setMappingDialog(false);
        setMappingForm({
          serverEndpointId: '',
          localTargetUrl: '',
          authType: 'none',
          authUsername: '',
          authPassword: '',
          authToken: '',
          isActive: true,
        });
        fetchMappings();
      }
    } catch {
      toast.error('Failed to create mapping');
    } finally {
      setActionLoading(null);
    }
  };

  // Delete mapping
  const deleteMapping = async (serverEndpointId: string) => {
    setActionLoading(`delete-mapping-${serverEndpointId}`);
    try {
      const res = await fetch(`/api/mappings?serverEndpointId=${serverEndpointId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Mapping removed');
        fetchMappings();
      }
    } catch {
      toast.error('Failed to remove mapping');
    } finally {
      setActionLoading(null);
    }
  };

  // Replay DLQ message
  const replayDLQMessage = async (messageId: string) => {
    setActionLoading(`replay-${messageId}`);
    try {
      const res = await fetch('/api/dlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Message replayed');
        fetchDLQ();
        fetchMetrics();
      }
    } catch {
      toast.error('Failed to replay message');
    } finally {
      setActionLoading(null);
    }
  };

  // Delete DLQ message
  const deleteDLQMessage = async (messageId: string) => {
    setActionLoading(`delete-dlq-${messageId}`);
    try {
      const res = await fetch(`/api/dlq?messageId=${messageId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Message discarded');
        fetchDLQ();
        fetchMetrics();
      }
    } catch {
      toast.error('Failed to discard message');
    } finally {
      setActionLoading(null);
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text: string, label: string = 'Copied') => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  // Reset forms
  const resetUnifiedForm = () => {
    setUnifiedForm({
      name: '',
      platform: '',
      authRequired: false,
      isActive: true,
      generateApiKey: true,
      keyName: '',
      rateLimit: 60,
      createMapping: true,
      localTargetUrl: '',
      authType: 'none',
      authUsername: '',
      authPassword: '',
      authToken: '',
      mappingActive: true,
    });
    setCreatedData({ endpoint: null, apiKey: null });
  };

  // Status badge
  const StatusBadge = ({ status }: { status: string }) => {
    const config: Record<string, { bg: string; icon: React.ReactNode }> = {
      pending: { bg: 'bg-amber-500/10 text-amber-600 border-amber-500/20', icon: <Clock className="h-3 w-3" /> },
      forwarded: { bg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', icon: <CheckCircle className="h-3 w-3" /> },
      failed: { bg: 'bg-red-500/10 text-red-600 border-red-500/20', icon: <XCircle className="h-3 w-3" /> },
      dlq: { bg: 'bg-red-700/10 text-red-700 border-red-700/20', icon: <AlertCircle className="h-3 w-3" /> },
    };
    const c = config[status] || config.pending;
    return (
      <Badge variant="outline" className={`${c.bg} gap-1 font-medium`}>
        {c.icon}
        {status}
      </Badge>
    );
  };

  // Login screen
  if (!auth.isLoggedIn || showLogin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
        <Card className="w-full max-w-md border-0 shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg shadow-violet-500/25">
              <Zap className="h-7 w-7 text-white" />
            </div>
            <CardTitle className="text-2xl">WebRelay</CardTitle>
            <CardDescription>Enter your credentials to continue</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                placeholder="admin"
                className="mt-1.5"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                disabled={loginLoading}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                placeholder="••••••••"
                className="mt-1.5"
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                disabled={loginLoading}
              />
            </div>
            <Button 
              className="w-full bg-gradient-to-r from-violet-500 to-purple-600" 
              onClick={handleLogin}
              disabled={!loginForm.username || !loginForm.password || loginLoading}
            >
              {loginLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4 mr-2" />
              )}
              {loginLoading ? 'Signing in...' : 'Sign In'}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Use <code className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">admin</code> as username and your configured <code className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">ADMIN_PASSWORD</code>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-xl dark:bg-slate-900/80">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">
                <Zap className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
                  WebRelay
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">Webhook relay with Redis Streams</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-medium mr-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Connected
              </div>
              <span className="text-sm text-muted-foreground hidden md:block">Hi, {auth.username}</span>
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-2"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    await Promise.all([
                      fetchMetrics(),
                      fetchEndpoints(),
                      fetchApiKeys(),
                      fetchLogs(),
                      fetchMappings(),
                      fetchDLQ(),
                      fetchClientStatus(),
                    ]);
                    toast.success('Data refreshed');
                  } finally {
                    setRefreshing(false);
                  }
                }}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <TabsList className="bg-slate-100 dark:bg-slate-800/50 p-1">
              <TabsTrigger value="overview" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
                <Activity className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Overview</span>
              </TabsTrigger>
              <TabsTrigger value="endpoints" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
                <Webhook className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Endpoints</span>
              </TabsTrigger>
              <TabsTrigger value="mappings" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
                <ArrowRight className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Mappings</span>
              </TabsTrigger>
              <TabsTrigger value="logs" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
                <Clock className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Logs</span>
              </TabsTrigger>
              <TabsTrigger value="dlq" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800">
                <AlertCircle className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">DLQ</span>
                {dlqMessages.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">
                    {dlqMessages.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <Dialog open={createDialog} onOpenChange={(open) => {
              setCreateDialog(open);
              if (!open) resetUnifiedForm();
            }}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 shadow-lg shadow-violet-500/25">
                  <Plus className="h-4 w-4 mr-2" />
                  New Endpoint
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="text-xl flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-violet-500" />
                    {createdData.endpoint ? 'Endpoint Created!' : 'Create New Endpoint'}
                  </DialogTitle>
                  <DialogDescription>
                    {createdData.endpoint 
                      ? 'Your endpoint is ready to receive webhooks'
                      : 'Configure endpoint, API key, and forwarding'}
                  </DialogDescription>
                </DialogHeader>

                {!createdData.endpoint ? (
                  <div className="space-y-4 py-2">
                    {/* Endpoint Section */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                        <Webhook className="h-4 w-4 text-violet-500" />
                        Endpoint Configuration
                      </div>
                      
                      <div>
                        <Label htmlFor="name">Name *</Label>
                        <Input
                          id="name"
                          value={unifiedForm.name}
                          onChange={(e) => setUnifiedForm({ ...unifiedForm, name: e.target.value })}
                          placeholder="e.g., Stripe Webhooks"
                          className="mt-1"
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="platform">Platform / Source</Label>
                        <Input
                          id="platform"
                          value={unifiedForm.platform}
                          onChange={(e) => setUnifiedForm({ ...unifiedForm, platform: e.target.value })}
                          placeholder="e.g., stripe, slack, meta"
                          className="mt-1"
                        />
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                        <div>
                          <p className="text-sm font-medium">Require Authentication</p>
                          <p className="text-xs text-muted-foreground">Webhooks must include valid auth</p>
                        </div>
                        <Switch
                          checked={unifiedForm.authRequired}
                          onCheckedChange={(checked) => setUnifiedForm({ 
                            ...unifiedForm, 
                            authRequired: checked,
                            generateApiKey: checked // Auto-enable key generation when auth required
                          })}
                        />
                      </div>
                    </div>

                    {unifiedForm.authRequired && (
                      <>
                        <Separator />
                        {/* API Key Section - Only show when auth is required */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                              <Key className="h-4 w-4 text-amber-500" />
                              Generate API Key
                            </div>
                            <Switch
                              checked={unifiedForm.generateApiKey}
                              onCheckedChange={(checked) => setUnifiedForm({ ...unifiedForm, generateApiKey: checked })}
                            />
                          </div>

                          {unifiedForm.generateApiKey && (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label>Key Name</Label>
                                <Input
                                  value={unifiedForm.keyName}
                                  onChange={(e) => setUnifiedForm({ ...unifiedForm, keyName: e.target.value })}
                                  placeholder="Auto if empty"
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label>Rate Limit/min</Label>
                                <Input
                                  type="number"
                                  value={unifiedForm.rateLimit}
                                  onChange={(e) => setUnifiedForm({ ...unifiedForm, rateLimit: parseInt(e.target.value) || 60 })}
                                  className="mt-1"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}

                    <Separator />

                    {/* Mapping Section */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                          <ArrowRight className="h-4 w-4 text-emerald-500" />
                          Forward to Local Service
                        </div>
                        <Switch
                          checked={unifiedForm.createMapping}
                          onCheckedChange={(checked) => setUnifiedForm({ ...unifiedForm, createMapping: checked })}
                        />
                      </div>

                      {unifiedForm.createMapping && (
                        <>
                          <div>
                            <Label>Target URL *</Label>
                            <Input
                              value={unifiedForm.localTargetUrl}
                              onChange={(e) => setUnifiedForm({ ...unifiedForm, localTargetUrl: e.target.value })}
                              placeholder="http://localhost:3000/webhook"
                              className="mt-1 font-mono text-sm"
                            />
                          </div>

                          <div>
                            <Label>Auth Type</Label>
                            <Select
                              value={unifiedForm.authType}
                              onValueChange={(value) => setUnifiedForm({ ...unifiedForm, authType: value })}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                <SelectItem value="basic">Basic Auth</SelectItem>
                                <SelectItem value="bearer">Bearer Token</SelectItem>
                                <SelectItem value="api_key">API Key</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {unifiedForm.authType === 'basic' && (
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label>Username</Label>
                                <Input value={unifiedForm.authUsername} onChange={(e) => setUnifiedForm({ ...unifiedForm, authUsername: e.target.value })} className="mt-1" />
                              </div>
                              <div>
                                <Label>Password</Label>
                                <Input type="password" value={unifiedForm.authPassword} onChange={(e) => setUnifiedForm({ ...unifiedForm, authPassword: e.target.value })} className="mt-1" />
                              </div>
                            </div>
                          )}

                          {(unifiedForm.authType === 'bearer' || unifiedForm.authType === 'api_key') && (
                            <div>
                              <Label>{unifiedForm.authType === 'bearer' ? 'Token' : 'API Key'}</Label>
                              <Input type="password" value={unifiedForm.authToken} onChange={(e) => setUnifiedForm({ ...unifiedForm, authToken: e.target.value })} className="mt-1" />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Success State */
                  <div className="py-4 space-y-4">
                    <div className="flex items-center justify-center">
                      <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <CheckCircle className="h-7 w-7 text-emerald-500" />
                      </div>
                    </div>

                    {/* Webhook URL */}
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Webhook URL</Label>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-6 text-xs"
                          onClick={() => copyToClipboard(`${typeof window !== 'undefined' ? window.location.origin : ''}/relay/${createdData.endpoint?.id}`, 'URL')}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy
                        </Button>
                      </div>
                      <code className="block p-2 bg-white dark:bg-slate-900 rounded text-xs font-mono break-all border">
                        {typeof window !== 'undefined' ? window.location.origin : ''}/relay/{createdData.endpoint?.id}
                      </code>
                    </div>

                    {/* API Key */}
                    {createdData.apiKey && (
                      <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium text-amber-600 uppercase tracking-wide">API Key (Save this!)</Label>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            className="h-6 text-xs"
                            onClick={() => copyToClipboard(createdData.apiKey!, 'API Key')}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <code className="block p-2 bg-white dark:bg-slate-900 rounded text-xs font-mono break-all border">
                          {createdData.apiKey}
                        </code>
                      </div>
                    )}

                    {/* cURL Example */}
                    <div className="p-3 rounded-lg bg-slate-900 text-slate-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Test Command</Label>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-6 text-xs text-slate-400 hover:text-white"
                          onClick={() => copyToClipboard(`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/relay/${createdData.endpoint?.id} -H "Content-Type: application/json" -H "X-API-Key: ${createdData.apiKey || 'YOUR_KEY'}" -d '{"test": true}'`, 'cURL')}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy
                        </Button>
                      </div>
                      <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                        {`curl -X POST ${typeof window !== 'undefined' ? window.location.origin : ''}/relay/${createdData.endpoint?.id} \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${createdData.apiKey || 'YOUR_KEY'}" \\
  -d '{"test": true}'`}
                      </pre>
                    </div>
                  </div>
                )}

                <DialogFooter>
                  {!createdData.endpoint ? (
                    <>
                      <Button variant="outline" onClick={() => setCreateDialog(false)}>Cancel</Button>
                      <Button 
                        onClick={createUnified} 
                        disabled={!unifiedForm.name || actionLoading === 'create'}
                        className="bg-gradient-to-r from-violet-500 to-purple-600"
                      >
                        {actionLoading === 'create' ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : null}
                        Create
                      </Button>
                    </>
                  ) : (
                    <Button 
                      onClick={() => {
                        setCreateDialog(false);
                        resetUnifiedForm();
                      }}
                      className="w-full"
                    >
                      Done
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Metrics Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="relative overflow-hidden border-0 shadow-md">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-purple-500/5" />
                <CardHeader className="relative pb-2 pt-4">
                  <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Received</CardTitle>
                </CardHeader>
                <CardContent className="relative pb-4">
                  <div className="text-3xl font-bold tabular-nums">{realtimeMetrics?.webhooksReceived ?? metrics?.webhooksReceived ?? 0}</div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                    <TrendingUp className="h-3 w-3" />
                    webhooks received
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden border-0 shadow-md">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-green-500/5" />
                <CardHeader className="relative pb-2 pt-4">
                  <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Forwarded</CardTitle>
                </CardHeader>
                <CardContent className="relative pb-4">
                  <div className="text-3xl font-bold tabular-nums text-emerald-600">{realtimeMetrics?.webhooksForwarded ?? metrics?.webhooksForwarded ?? 0}</div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-emerald-600">
                    <CheckCircle className="h-3 w-3" />
                    successfully delivered
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden border-0 shadow-md">
                <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-rose-500/5" />
                <CardHeader className="relative pb-2 pt-4">
                  <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">Failed</CardTitle>
                </CardHeader>
                <CardContent className="relative pb-4">
                  <div className="text-3xl font-bold tabular-nums text-red-600">{realtimeMetrics?.webhooksFailed ?? metrics?.webhooksFailed ?? 0}</div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-red-600">
                    <XCircle className="h-3 w-3" />
                    after retries
                  </div>
                </CardContent>
              </Card>

              <Card className="relative overflow-hidden border-0 shadow-md">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-orange-500/5" />
                <CardHeader className="relative pb-2 pt-4">
                  <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-400">DLQ</CardTitle>
                </CardHeader>
                <CardContent className="relative pb-4">
                  <div className="text-3xl font-bold tabular-nums">{realtimeMetrics?.dlqSize ?? metrics?.dlqLength ?? 0}</div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                    <AlertCircle className="h-3 w-3" />
                    failed messages
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Bottom Section */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* System Status */}
              <Card className="border-0 shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Server className="h-4 w-4 text-violet-500" />
                    System Status
                    {realtimeMetrics && (
                      <span className="ml-auto text-xs font-normal text-slate-500">
                        Live
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 ml-1 animate-pulse" />
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-sm py-1">
                    <span className="text-slate-600 dark:text-slate-400">Relay Clients</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${realtimeClientStatus?.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className={`font-medium ${realtimeClientStatus?.connected ? 'text-emerald-600' : 'text-red-600'}`}>
                        {relayClients.length > 0 ? relayClients.length : (realtimeClientStatus?.connected ? '1' : '0')} connected
                      </span>
                    </div>
                  </div>
                  {relayClients.map((client) => (
                    <div key={client.id} className="flex items-center justify-between text-sm py-1 pl-4">
                      <span className="text-slate-500 dark:text-slate-500 text-xs">{client.consumerName}</span>
                      <span className="text-xs text-emerald-600">Active</span>
                    </div>
                  ))}
                  <Separator className="my-2" />
                  <div className="flex items-center justify-between text-sm py-1">
                    <span className="text-slate-600 dark:text-slate-400">Endpoints</span>
                    <span className="font-semibold tabular-nums">{realtimeMetrics?.endpointsCount ?? metrics?.endpointsCount ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm py-1">
                    <span className="text-slate-600 dark:text-slate-400">Mappings</span>
                    <span className="font-semibold tabular-nums">{realtimeMetrics?.mappingsCount ?? mappings.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm py-1">
                    <span className="text-slate-600 dark:text-slate-400">API Keys</span>
                    <span className="font-semibold tabular-nums">{metrics?.apiKeysCount || apiKeys.length}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Recent Activity */}
              <Card className="border-0 shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="h-4 w-4 text-violet-500" />
                    Recent Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-40">
                    {logs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center">
                        <Webhook className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
                        <p className="text-sm text-slate-500">No activity yet</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {logs.slice(0, 6).map((log) => (
                          <div key={log.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <StatusBadge status={log.status} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{log.endpointId}</div>
                            </div>
                            <span className="text-xs text-slate-500">{formatDate(log.createdAt).split(',')[0]}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Endpoints Tab */}
          <TabsContent value="endpoints">
            <Card className="border-0 shadow-md">
              <CardContent className="p-0">
                {loading.endpoints ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  </div>
                ) : endpoints.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="h-14 w-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                      <Webhook className="h-7 w-7 text-slate-400" />
                    </div>
                    <h3 className="font-semibold">No endpoints yet</h3>
                    <p className="text-sm text-slate-500 mt-1 mb-4">Create your first endpoint</p>
                    <Button onClick={() => setCreateDialog(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Endpoint
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y">
                    {endpoints.map((endpoint) => (
                      <div key={endpoint.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold">{endpoint.name}</h3>
                              {endpoint.isActive ? (
                                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs">Active</Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">Disabled</Badge>
                              )}
                              {endpoint.platform && (
                                <Badge variant="outline" className="text-xs">{endpoint.platform}</Badge>
                              )}
                              {endpoint.authRequired && (
                                <Badge variant="outline" className="text-xs gap-1">
                                  <Shield className="h-3 w-3" />
                                  Auth
                                </Badge>
                              )}
                            </div>
                            <code className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono">
                              POST /relay/{endpoint.id}
                            </code>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8"
                              onClick={() => {
                                setEditForm(endpoint);
                                setEditDialog(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 text-slate-400 hover:text-red-500">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete endpoint?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will delete &quot;{endpoint.name}&quot; permanently.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-red-500 hover:bg-red-600"
                                    onClick={() => deleteEndpoint(endpoint.id)}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* API Keys */}
            {apiKeys.length > 0 && (
              <Card className="border-0 shadow-md mt-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="h-4 w-4 text-amber-500" />
                    API Keys ({apiKeys.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {apiKeys.map((key) => (
                      <div key={key.id} className="p-4 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{key.name}</span>
                            {key.isActive ? (
                              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs">Active</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Revoked</Badge>
                            )}
                            {key.platform && <Badge variant="outline" className="text-xs">{key.platform}</Badge>}
                          </div>
                          <code className="text-xs text-slate-500 font-mono">{key.key}</code>
                        </div>
                        <div className="flex items-center gap-1">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 text-slate-400 hover:text-red-500">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
                                <AlertDialogDescription>This will revoke access for &quot;{key.name}&quot;.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-red-500 hover:bg-red-600"
                                  onClick={() => deleteApiKey(key.id)}
                                >
                                  Revoke
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Mappings Tab */}
          <TabsContent value="mappings">
            <div className="flex items-center justify-end mb-4">
              <Dialog open={mappingDialog} onOpenChange={setMappingDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Mapping
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Mapping</DialogTitle>
                    <DialogDescription>Map an endpoint to a local service URL</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <Label>Endpoint</Label>
                      <Select
                        value={mappingForm.serverEndpointId}
                        onValueChange={(value) => setMappingForm({ ...mappingForm, serverEndpointId: value })}
                      >
                        <SelectTrigger className="mt-1.5">
                          <SelectValue placeholder="Select endpoint" />
                        </SelectTrigger>
                        <SelectContent>
                          {endpoints.map((ep) => (
                            <SelectItem key={ep.id} value={ep.id}>{ep.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Target URL</Label>
                      <Input
                        value={mappingForm.localTargetUrl}
                        onChange={(e) => setMappingForm({ ...mappingForm, localTargetUrl: e.target.value })}
                        placeholder="http://localhost:3000/webhook"
                        className="mt-1.5 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <Label>Auth Type</Label>
                      <Select value={mappingForm.authType} onValueChange={(value) => setMappingForm({ ...mappingForm, authType: value })}>
                        <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="basic">Basic Auth</SelectItem>
                          <SelectItem value="bearer">Bearer Token</SelectItem>
                          <SelectItem value="api_key">API Key</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {mappingForm.authType === 'basic' && (
                      <div className="grid grid-cols-2 gap-4">
                        <div><Label>Username</Label><Input value={mappingForm.authUsername} onChange={(e) => setMappingForm({ ...mappingForm, authUsername: e.target.value })} className="mt-1.5" /></div>
                        <div><Label>Password</Label><Input type="password" value={mappingForm.authPassword} onChange={(e) => setMappingForm({ ...mappingForm, authPassword: e.target.value })} className="mt-1.5" /></div>
                      </div>
                    )}
                    {(mappingForm.authType === 'bearer' || mappingForm.authType === 'api_key') && (
                      <div><Label>{mappingForm.authType === 'bearer' ? 'Token' : 'API Key'}</Label><Input type="password" value={mappingForm.authToken} onChange={(e) => setMappingForm({ ...mappingForm, authToken: e.target.value })} className="mt-1.5" /></div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setMappingDialog(false)}>Cancel</Button>
                    <Button onClick={createMapping} disabled={!mappingForm.serverEndpointId || !mappingForm.localTargetUrl || actionLoading === 'create-mapping'}>
                      {actionLoading === 'create-mapping' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Create
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <Card className="border-0 shadow-md">
              <CardContent className="p-0">
                {loading.mappings ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  </div>
                ) : mappings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="h-14 w-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                      <ArrowRight className="h-7 w-7 text-slate-400" />
                    </div>
                    <h3 className="font-semibold">No mappings configured</h3>
                    <p className="text-sm text-slate-500 mt-1">Add mappings to forward webhooks</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {mappings.map((mapping) => (
                      <div key={mapping.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{mapping.endpointName || mapping.serverEndpointId}</h3>
                              {mapping.isActive ? (
                                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs">Active</Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">Disabled</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono">
                                {mapping.localTargetUrl}
                              </code>
                              {mapping.authConfig && mapping.authConfig.type !== 'none' && (
                                <Badge variant="outline" className="text-xs gap-1">
                                  <Shield className="h-3 w-3" />
                                  {mapping.authConfig.type}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 text-slate-400 hover:text-red-500">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete mapping?</AlertDialogTitle>
                                <AlertDialogDescription>Webhooks will no longer be forwarded.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={() => deleteMapping(mapping.serverEndpointId)}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs">
            <Card className="border-0 shadow-md">
              <CardContent className="p-0">
                <ScrollArea className="h-[500px]">
                  {loading.logs ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                  ) : logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <div className="h-14 w-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                        <Clock className="h-7 w-7 text-slate-400" />
                      </div>
                      <h3 className="font-semibold">No logs yet</h3>
                      <p className="text-sm text-slate-500 mt-1">Activity will appear here</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {logs.map((log) => (
                        <div key={log.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <StatusBadge status={log.status} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{log.endpointId}</span>
                                <Badge variant="outline" className="text-xs">{log.method}</Badge>
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                                <span>{formatDate(log.createdAt)}</span>
                                <span>•</span>
                                <span>{log.sourceIp}</span>
                                {log.attempts > 0 && <><span>•</span><span>{log.attempts} attempts</span></>}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* DLQ Tab */}
          <TabsContent value="dlq">
            {dlqMessages.length > 0 && (
              <div className="flex items-center justify-end gap-2 mb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setActionLoading('retry-all');
                    try {
                      let successCount = 0;
                      for (const msg of dlqMessages) {
                        const res = await fetch('/api/dlq', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ messageId: msg.id }),
                        });
                        if ((await res.json()).success) {
                          successCount++;
                        }
                      }
                      toast.success(`Replayed ${successCount} message(s)`);
                      fetchDLQ();
                    } finally {
                      setActionLoading(null);
                    }
                  }}
                  disabled={actionLoading === 'retry-all'}
                >
                  {actionLoading === 'retry-all' ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-2" />
                  )}
                  Retry All
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Clear All
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear all DLQ messages?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete all {dlqMessages.length} failed message(s). This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-500 hover:bg-red-600"
                        onClick={async () => {
                          setActionLoading('clear-all');
                          try {
                            for (const msg of dlqMessages) {
                              await fetch(`/api/dlq?messageId=${msg.id}`, { method: 'DELETE' });
                            }
                            toast.success('DLQ cleared');
                            fetchDLQ();
                          } finally {
                            setActionLoading(null);
                          }
                        }}
                      >
                        Clear All
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
            <Card className="border-0 shadow-md">
              <CardContent className="p-0">
                {loading.dlq ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  </div>
                ) : dlqMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-3">
                      <CheckCircle className="h-7 w-7 text-emerald-500" />
                    </div>
                    <h3 className="font-semibold">All clear!</h3>
                    <p className="text-sm text-slate-500 mt-1">No failed messages</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {dlqMessages.map((msg) => (
                      <div key={msg.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-2 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-red-500/10 text-red-600 border-red-500/20 text-xs">
                                <XCircle className="h-3 w-3 mr-1" />
                                Failed
                              </Badge>
                              <span className="text-sm font-medium">{msg.data.endpointId}</span>
                            </div>
                            <div className="text-sm text-red-600 bg-red-500/5 p-2 rounded border border-red-500/10 break-all">
                              {msg.data.error}
                            </div>
                            <div className="text-xs text-slate-500">{msg.timestamp}</div>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => replayDLQMessage(msg.id)}
                              disabled={actionLoading === `replay-${msg.id}`}
                            >
                              {actionLoading === `replay-${msg.id}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="ghost" className="text-red-500">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Discard message?</AlertDialogTitle>
                                  <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={() => deleteDLQMessage(msg.id)}>
                                    Discard
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Edit Endpoint Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Endpoint</DialogTitle>
          </DialogHeader>
          {editForm && (
            <div className="space-y-4 py-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Platform</Label>
                <Input
                  value={editForm.platform}
                  onChange={(e) => setEditForm({ ...editForm, platform: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <div>
                  <p className="text-sm font-medium">Require Authentication</p>
                </div>
                <Switch
                  checked={editForm.authRequired}
                  onCheckedChange={(checked) => setEditForm({ ...editForm, authRequired: checked })}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <div>
                  <p className="text-sm font-medium">Active</p>
                </div>
                <Switch
                  checked={editForm.isActive}
                  onCheckedChange={(checked) => setEditForm({ ...editForm, isActive: checked })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>Cancel</Button>
            <Button onClick={updateEndpoint} disabled={actionLoading === 'update'}>
              {actionLoading === 'update' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Footer - Sticky */}
      <footer className="sticky bottom-0 mt-auto border-t bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>CRM Relay v1.0</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Redis Streams
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                Port 3000
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

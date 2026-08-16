'use client';

import { Network, Plus, Trash2, RefreshCw, Plug, Unplug, Wrench, Shield, FileText, MessageSquare, Activity, Compass } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface McpServerView {
  id: string;
  name?: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: readonly string[];
  url?: string;
  enabled: boolean;
  connected: boolean;
  health: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'DISCONNECTED';
  latencyMs?: number;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  defaultSecurityLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  errorCount?: number;
  lastError?: string;
}

interface McpToolView {
  name: string;
  description: string;
  serverId: string;
  securityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  capabilities?: string[];
}

interface McpResourceView {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverId: string;
}

interface McpPromptView {
  name: string;
  description?: string;
  serverId: string;
}

export default function McpPage() {
  const { data: serversData, mutate: mutateServers, isLoading } = useSWR<{ servers: McpServerView[] }>(
    '/api/v1/mcp/servers',
    fetcher,
  );
  const { data: toolsData, mutate: mutateTools } = useSWR<{ tools: McpToolView[] }>(
    '/api/v1/mcp/tools',
    fetcher,
  );
  const { data: resourcesData, mutate: mutateResources } = useSWR<{ resources: McpResourceView[] }>(
    '/api/v1/mcp/resources',
    fetcher,
  );
  const { data: promptsData, mutate: mutatePrompts } = useSWR<{ prompts: McpPromptView[] }>(
    '/api/v1/mcp/prompts',
    fetcher,
  );

  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [id, setId] = useState('');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [securityLevel, setSecurityLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('LOW');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const servers = serversData?.servers ?? [];
  const tools = toolsData?.tools ?? [];
  const resources = resourcesData?.resources ?? [];
  const prompts = promptsData?.prompts ?? [];

  const refresh = () => {
    mutateServers();
    mutateTools();
    mutateResources();
    mutatePrompts();
  };

  const addServer = async () => {
    setError(null);
    if (!id) return setError('Server id is required');
    const body: Record<string, unknown> = { id, transport, enabled: true, defaultSecurityLevel: securityLevel };
    if (transport === 'stdio') {
      if (!command) return setError('stdio transport requires a command');
      body.command = command;
    } else {
      if (!url) return setError('http transport requires a url');
      body.url = url;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? `Failed (${res.status})`);
      }
      refresh();
      setId('');
      setCommand('');
      setUrl('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: McpServerView, action: 'connect' | 'disconnect') => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/mcp/servers/${encodeURIComponent(s.id)}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? `Failed (${res.status})`);
      }
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const triggerDiscovery = async (s: McpServerView) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/mcp/servers/${encodeURIComponent(s.id)}/discover`, { method: 'POST' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? `Discovery Failed (${res.status})`);
      }
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const checkHealth = async (s: McpServerView) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/mcp/servers/${encodeURIComponent(s.id)}/health`, { method: 'POST' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? `Health check failed (${res.status})`);
      }
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: McpServerView) => {
    setError(null);
    setBusy(true);
    try {
      await fetch(`/api/v1/mcp/servers/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const badgeColor = (level: string) => {
    switch (level) {
      case 'CRITICAL': return 'border-rose-500/30 bg-rose-500/10 text-rose-400';
      case 'HIGH': return 'border-amber-500/30 bg-amber-500/10 text-amber-400';
      case 'MEDIUM': return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300';
      default: return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#070a12] to-[#0a0e1a] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <Network className="h-7 w-7 text-nexus-400" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">MCP — Universal Tool & Context Fabric</h1>
              <p className="text-xs sm:text-sm text-white/50">
                Connect stdio and HTTP MCP servers, discover capabilities, and expose normalized tools, resources, and prompts to agents.
              </p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm hover:bg-white/10"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </header>

        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">{error}</div>
        )}

        {/* Add server */}
        <section className="rounded-2xl border border-nexus-500/20 bg-white/[0.02] p-5 backdrop-blur-xl">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80">
            <Plus className="h-4 w-4 text-nexus-400" /> Register MCP Server
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs">
              <span className="mb-1 block text-white/50">Transport</span>
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as 'stdio' | 'http')}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs"
              >
                <option value="stdio">stdio (subprocess)</option>
                <option value="http">http (remote JSON-RPC)</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-white/50">Server ID</span>
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="github-mcp"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs"
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-white/50">Default Security Level</span>
              <select
                value={securityLevel}
                onChange={(e) => setSecurityLevel(e.target.value as any)}
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs"
              >
                <option value="LOW">LOW (Read-only)</option>
                <option value="MEDIUM">MEDIUM (FS / Mutating)</option>
                <option value="HIGH">HIGH (Deploy / Destructive)</option>
                <option value="CRITICAL">CRITICAL (Infrastructure)</option>
              </select>
            </label>
            {transport === 'stdio' ? (
              <label className="text-xs">
                <span className="mb-1 block text-white/50">Command</span>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem ."
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs"
                />
              </label>
            ) : (
              <label className="text-xs">
                <span className="mb-1 block text-white/50">URL</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://127.0.0.1:3001/mcp"
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs"
                />
              </label>
            )}
          </div>
          <button
            onClick={addServer}
            disabled={busy}
            className="mt-4 rounded-xl bg-nexus-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-50 hover:bg-nexus-400 transition"
          >
            {busy ? 'Working…' : 'Register & Discover'}
          </button>
        </section>

        {/* Servers Matrix */}
        <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-xl">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80">
            <Network className="h-4 w-4 text-nexus-400" /> Active MCP Servers ({servers.length})
          </h2>
          {isLoading ? (
            <p className="text-xs text-white/40">Loading server topology…</p>
          ) : servers.length === 0 ? (
            <p className="text-xs text-white/40">No MCP servers registered yet.</p>
          ) : (
            <div className="space-y-3">
              {servers.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/40 p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{s.name ?? s.id}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${s.connected ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-white/10 bg-white/5 text-white/40'}`}>
                        {s.connected ? s.health : 'DISCONNECTED'}
                      </span>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60 font-mono">{s.transport}</span>
                      {s.latencyMs !== undefined && (
                        <span className="text-[10px] text-white/40 font-mono">{s.latencyMs}ms</span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-white/40">{s.transport === 'stdio' ? s.command : s.url}</div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-white/60">
                      <span>Tools: <strong className="text-nexus-300">{s.toolCount}</strong></span>
                      <span>Resources: <strong className="text-cyan-300">{s.resourceCount}</strong></span>
                      <span>Prompts: <strong className="text-purple-300">{s.promptCount}</strong></span>
                      {s.lastError && <span className="text-rose-400 text-[10px]">Error: {s.lastError}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => triggerDiscovery(s)} className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10 text-white/80" title="Re-discover capabilities">
                      <Compass className="h-3.5 w-3.5 text-nexus-400" /> Discover
                    </button>
                    <button onClick={() => checkHealth(s)} className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10 text-white/80" title="Ping health">
                      <Activity className="h-3.5 w-3.5 text-cyan-400" /> Ping
                    </button>
                    {s.connected ? (
                      <button onClick={() => toggle(s, 'disconnect')} className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10">
                        <Unplug className="h-3.5 w-3.5 text-amber-400" /> Disconnect
                      </button>
                    ) : (
                      <button onClick={() => toggle(s, 'connect')} className="flex items-center gap-1 rounded-xl border border-nexus-500/30 bg-nexus-500/10 px-2.5 py-1.5 text-xs text-nexus-300 hover:bg-nexus-500/20">
                        <Plug className="h-3.5 w-3.5" /> Connect
                      </button>
                    )}
                    <button onClick={() => remove(s)} className="flex items-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/20">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Aggregated Tools */}
        <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-xl">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80">
            <Wrench className="h-4 w-4 text-nexus-400" /> Aggregated MCP Tools ({tools.length})
          </h2>
          {tools.length === 0 ? (
            <p className="text-xs text-white/40">No tools discovered yet. Connect a server to see its tools.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((t) => (
                <div key={`${t.serverId}:${t.name}`} className="rounded-xl border border-white/5 bg-black/40 p-3.5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-nexus-300 truncate">{t.name}</span>
                      <span className={`rounded-full border px-2 py-0.2 text-[9px] font-bold ${badgeColor(t.securityLevel)}`}>
                        <Shield className="inline h-2.5 w-2.5 mr-0.5" />{t.securityLevel}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/50 line-clamp-2">{t.description || 'No description provided.'}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-white/40">
                    <span>Server: <strong className="text-white/70">{t.serverId}</strong></span>
                    {t.capabilities && <span>{t.capabilities.slice(0, 2).join(', ')}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Aggregated Resources & Prompts */}
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-xl">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80">
              <FileText className="h-4 w-4 text-cyan-400" /> Discovered Resources ({resources.length})
            </h2>
            {resources.length === 0 ? (
              <p className="text-xs text-white/40">No resources exposed by connected MCP servers.</p>
            ) : (
              <div className="space-y-2">
                {resources.map((r) => (
                  <div key={r.uri} className="rounded-lg border border-white/5 bg-black/40 p-2.5 text-xs">
                    <div className="font-mono text-cyan-300 truncate">{r.name || r.uri}</div>
                    <div className="text-[10px] text-white/40 font-mono truncate">{r.uri}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-xl">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-white/80">
              <MessageSquare className="h-4 w-4 text-purple-400" /> Discovered Prompts ({prompts.length})
            </h2>
            {prompts.length === 0 ? (
              <p className="text-xs text-white/40">No prompts exposed by connected MCP servers.</p>
            ) : (
              <div className="space-y-2">
                {prompts.map((p) => (
                  <div key={`${p.serverId}:${p.name}`} className="rounded-lg border border-white/5 bg-black/40 p-2.5 text-xs">
                    <div className="font-bold text-purple-300">{p.name}</div>
                    <div className="text-[10px] text-white/50">{p.description || 'No description provided.'}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

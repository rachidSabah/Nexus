'use client';

import { Network, Plus, Trash2, RefreshCw, Plug, Unplug, Wrench } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface McpServerView {
  id: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: readonly string[];
  url?: string;
  enabled: boolean;
  connected: boolean;
}
interface McpToolView {
  name: string;
  description: string;
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

  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [id, setId] = useState('');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const servers = serversData?.servers ?? [];
  const tools = toolsData?.tools ?? [];

  const refresh = () => {
    mutateServers();
    mutateTools();
  };

  const addServer = async () => {
    setError(null);
    if (!id) return setError('Server id is required');
    const body: Record<string, unknown> = { id, transport, enabled: true };
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

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#070a12] to-[#0a0e1a] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Network className="h-7 w-7 text-nexus-400" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">MCP — Model Context Protocol</h1>
              <p className="text-sm text-white/50">
                Connect external tool servers (stdio / HTTP) and expose their tools to Nexus.
              </p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </header>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>
        )}

        {/* Add server */}
        <section className="rounded-2xl border border-nexus-500/20 bg-white/[0.02] p-5 backdrop-blur-xl">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
            <Plus className="h-5 w-5 text-nexus-400" /> Add MCP Server
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block text-white/50">Transport</span>
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as 'stdio' | 'http')}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2"
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-white/50">Server ID</span>
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="filesystem"
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2"
              />
            </label>
            {transport === 'stdio' ? (
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-white/50">Command</span>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem ."
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2"
                />
              </label>
            ) : (
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-white/50">URL</span>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:3001/mcp"
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2"
                />
              </label>
            )}
          </div>
          <button
            onClick={addServer}
            disabled={busy}
            className="mt-4 rounded-lg bg-nexus-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Add & Connect'}
          </button>
        </section>

        {/* Servers */}
        <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-xl">
          <h2 className="mb-3 text-lg font-medium">Servers ({servers.length})</h2>
          {isLoading ? (
            <p className="text-white/40">Loading…</p>
          ) : servers.length === 0 ? (
            <p className="text-white/40">No MCP servers configured. Add one above.</p>
          ) : (
            <div className="space-y-3">
              {servers.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-black/40 p-3.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.id}</span>
                      <span className={`rounded px-2 py-0.5 text-xs ${s.connected ? 'bg-green-500/20 text-green-300' : 'bg-white/10 text-white/50'}`}>
                        {s.connected ? 'CONNECTED' : 'DISCONNECTED'}
                      </span>
                      <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/50">{s.transport}</span>
                    </div>
                    <div className="mt-1 text-xs text-white/40">{s.transport === 'stdio' ? s.command : s.url}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.connected ? (
                      <button onClick={() => toggle(s, 'disconnect')} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10">
                        <Unplug className="h-4 w-4" /> Disconnect
                      </button>
                    ) : (
                      <button onClick={() => toggle(s, 'connect')} className="flex items-center gap-1 rounded-lg border border-nexus-500/30 bg-nexus-500/10 px-3 py-1.5 text-sm text-nexus-300 hover:bg-nexus-500/20">
                        <Plug className="h-4 w-4" /> Connect
                      </button>
                    )}
                    <button onClick={() => remove(s)} className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/20">
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Tools */}
        <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-xl">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-medium">
            <Wrench className="h-5 w-5 text-nexus-400" /> Aggregated Tools ({tools.length})
          </h2>
          {tools.length === 0 ? (
            <p className="text-white/40">No tools discovered yet. Connect a server to see its tools.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((t) => (
                <div key={`${t.serverId}:${t.name}`} className="rounded-lg border border-white/5 bg-black/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-nexus-300">{t.name}</span>
                    <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/50">{t.serverId}</span>
                  </div>
                  <p className="mt-1 text-xs text-white/40">{t.description}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

'use client';

import { Network, Globe, Activity, RefreshCw, Server, ShieldCheck, CheckCircle2, AlertTriangle, Zap, Plug, Wifi } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface NetworkDiagnostics {
  dns: { resolver: string; ok: boolean; latencyMs: number };
  ipv4: { ok: boolean; latencyMs: number; status?: string };
  ipv6: { ok: boolean; latencyMs: number; status?: string };
  directHttps?: { ok: boolean; latencyMs: number; status?: string };
  egressMode?: 'DIRECT' | 'PROXY_PREFERRED' | 'PROXY_ONLY' | 'AUTO';
  activeEgress?: 'DIRECT' | 'PROXY';
  proxies: Array<{ id: string; url: string; ok: boolean; latencyMs: number }>;
  proxyPool?: unknown[];
  poolSummary?: {
    discovered: number;
    testing: number;
    healthy: number;
    degraded: number;
    dead: number;
    quarantined: number;
    disabled: number;
  };
}

interface ProviderConnectivity {
  id: string;
  providerId: string;
  displayName: string;
  health: string;
  capabilities?: { embeddings?: boolean; vision?: boolean; [k: string]: unknown };
}

function StatusPill({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
        ok
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
          : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
      }`}
    >
      {label ?? (ok ? 'HEALTHY' : 'CHECK')}
    </span>
  );
}

export default function NetworkPage() {
  const { data, isLoading, mutate } = useSWR<NetworkDiagnostics>('/api/v1/network/diagnostics', fetcher, {
    refreshInterval: 8000,
  });
  const { data: providers } = useSWR<ProviderConnectivity[]>('/api/v1/providers', fetcher, {
    refreshInterval: 10000,
  });
  const [customProxyUrl, setCustomProxyUrl] = useState('');
  const [msg, setMsg] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);
  const [adding, setAdding] = useState(false);

  const d = data;
  const directMode = (d?.activeEgress ?? 'DIRECT') === 'DIRECT' && (d?.egressMode ?? 'DIRECT') === 'DIRECT';
  const hasCustomProxy = (d?.poolSummary?.healthy ?? 0) > 0 || (d?.poolSummary?.discovered ?? 0) > 0;

  async function addCustomProxy() {
    if (!customProxyUrl) return;
    setAdding(true);
    setMsg({ text: 'Registering custom proxy (optional transport)...', type: 'info' });
    try {
      const r = await fetch('/api/v1/network/proxy-pool/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: customProxyUrl }),
      });
      if (r.ok) {
        setCustomProxyUrl('');
        setMsg({ text: 'Custom proxy registered. It will only be used if you switch the egress mode to PROXY_PREFERRED/PROXY_ONLY.', type: 'success' });
        await mutate();
      } else {
        const body = await r.json().catch(() => ({}));
        setMsg({ text: 'Failed to add proxy: ' + (body.error?.message ?? 'Invalid URL'), type: 'error' });
      }
    } catch (err) {
      setMsg({ text: 'Error: ' + (err as Error).message, type: 'error' });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-8 relative pb-12 w-full max-w-full overflow-x-hidden">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <ShieldCheck className="h-3.5 w-3.5 animate-pulse text-emerald-400" /> Nexus Transport
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Network className="h-8 w-8 text-nexus-400" />
            Network &amp; Transport
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Nexus connects directly to provider APIs. It does <span className="text-emerald-400 font-semibold">not require public proxy servers</span>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold backdrop-blur-md ${
              directMode
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
            }`}
          >
            <Wifi className={`h-4 w-4 ${directMode ? 'animate-pulse' : ''}`} />
            {directMode ? 'DIRECT MODE' : 'PROXY MODE'}
          </span>
          <button
            onClick={() => mutate()}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 border border-white/10 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-white/20 active:scale-95"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-xl border p-4 text-xs font-mono backdrop-blur-md ${
            msg.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : msg.type === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
              : 'border-nexus-500/30 bg-nexus-500/10 text-nexus-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Transport Mode Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-white/[0.02] p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">Transport Mode</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-3 font-mono text-2xl font-black text-emerald-300">{d?.egressMode ?? 'DIRECT'}</div>
          <div className="mt-2 text-[11px] text-white/50">Default production path — direct to provider APIs.</div>
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-cyan-950/20 to-white/[0.02] p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400/80">Proxy Dependency</span>
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-3 font-mono text-2xl font-black text-cyan-300">{hasCustomProxy ? 'CUSTOM ONLY' : 'NONE'}</div>
          <div className="mt-2 text-[11px] text-white/50">No public proxy pool is scraped or required.</div>
        </div>
        <div className="rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-950/20 to-white/[0.02] p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-nexus-300/80">Active Egress</span>
            <Zap className="h-4 w-4 text-nexus-400" />
          </div>
          <div className="mt-3 font-mono text-2xl font-black text-nexus-300">{d?.activeEgress ?? 'DIRECT'}</div>
          <div className="mt-2 text-[11px] text-white/50">Requests route straight to providers.</div>
        </div>
      </div>

      {/* Connectivity Diagnostics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="relative overflow-hidden rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-nexus-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-nexus-300/80">DNS Resolver</span>
            <Globe className="h-4 w-4 text-nexus-400" />
          </div>
          <div className="mt-3 font-mono text-sm font-bold text-nexus-300 truncate">{d?.dns.resolver ?? 'system'}</div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <StatusPill ok={d?.dns.ok !== false} />
            <span className="font-mono text-white/50">{d && d.dns.latencyMs > 0 ? `${d.dns.latencyMs}ms` : '—'}</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nexus-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-emerald-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">IPv4 Socket</span>
            <Activity className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-3 font-mono text-sm font-bold text-white">{d?.ipv4.status ?? (d?.ipv4.ok ? 'OK' : 'UNREACHABLE')}</div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <StatusPill ok={d?.ipv4.ok === true} />
            <span className="font-mono text-white/50">{d && d.ipv4.latencyMs > 0 ? `${d.ipv4.latencyMs}ms` : '—'}</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-b from-sky-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-sky-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-400/80">IPv6 Socket</span>
            <Activity className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-3 font-mono text-sm font-bold text-white">{d?.ipv6.status ?? 'UNAVAILABLE'}</div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <StatusPill ok={d?.ipv6.ok === true} />
            <span className="font-mono text-white/50">{d && d.ipv6.latencyMs > 0 ? `${d.ipv6.latencyMs}ms` : '—'}</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-cyan-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-cyan-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400/80">Direct HTTPS</span>
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-3 font-mono text-sm font-bold text-white">{d?.directHttps?.status ?? (d?.directHttps?.ok ? 'OK' : 'UNREACHABLE')}</div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <StatusPill ok={d?.directHttps?.ok !== false} />
            <span className="font-mono text-white/50">{d && d.directHttps?.latencyMs ? `${d.directHttps.latencyMs}ms` : '—'}</span>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500" />
        </div>
      </div>

      {/* Provider Connectivity */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-6 backdrop-blur-xl">
        <h2 className="text-base font-bold text-white mb-1">Provider Connectivity</h2>
        <p className="text-[11px] text-white/50 mb-4">
          Each configured provider endpoint and its live health. Model discovery runs directly against these endpoints — no proxy in the path.
        </p>
        {!providers ? (
          <div className="py-8 text-center text-xs text-white/40 font-mono">Loading providers…</div>
        ) : providers.length === 0 ? (
          <div className="py-8 text-center text-xs text-white/40 font-mono">No providers configured.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-white/40 uppercase tracking-wider font-mono text-[10px]">
                  <th className="pb-3">Provider</th>
                  <th className="pb-3">Endpoint ID</th>
                  <th className="pb-3">Connectivity</th>
                  <th className="pb-3">Capabilities</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {providers.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 font-semibold text-white">{p.displayName}</td>
                    <td className="py-3 font-mono text-white/60">{p.id}</td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          p.health === 'healthy'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : p.health === 'degraded'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {p.health === 'healthy' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {p.health.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 font-mono text-white/50">
                      {p.capabilities
                        ? Object.entries(p.capabilities)
                            .filter(([, v]) => v === true)
                            .map(([k]) => k)
                            .join(', ') || '—'
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Optional Custom Proxy */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-6 backdrop-blur-xl">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Plug className="h-4 w-4 text-nexus-400" /> Optional Custom Proxy
        </h3>
        <p className="text-[11px] text-white/50 mb-3">
          Only used when the egress mode is set to <span className="font-mono text-white/70">PROXY_PREFERRED</span> or{' '}
          <span className="font-mono text-white/70">PROXY_ONLY</span>. Nexus operates normally with no proxy configured.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="http://proxy.your-corp.com:8080"
            value={customProxyUrl}
            onChange={(e) => setCustomProxyUrl(e.target.value)}
            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-2 text-xs font-mono text-white focus:border-nexus-500 focus:outline-none"
          />
          <button
            onClick={addCustomProxy}
            disabled={adding || !customProxyUrl}
            className="inline-flex items-center gap-2 rounded-xl bg-nexus-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-nexus-500 active:scale-95 disabled:opacity-50"
          >
            <Server className="h-4 w-4" /> Register Proxy
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-2xl border border-white/10 bg-black/40 py-6 text-center text-xs text-white/40 font-mono">
          Executing DNS resolution and direct-connectivity checks…
        </div>
      )}
    </div>
  );
}

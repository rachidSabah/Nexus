'use client';

import { Activity, Zap, Cpu, RefreshCw, BarChart2, ShieldCheck } from 'lucide-react';
import useSWR from 'swr';

import { etagFetcher } from '@/lib/etagFetcher';

interface ObservabilitySnapshot {
  requestsTotal: number;
  requestsSuccess: number;
  requestsFailed: number;
  activeRequests: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  tokensInput: number;
  tokensOutput: number;
  tokensSaved: number;
  tokenSavingsPercent: number;
  activeAgents: number;
  activeWorkflows: number;
  activeApplications: number;
  circuitOpenCount: number;
  uptime: number;
  catalogVersion: number;
}

interface ProviderMetric {
  providerId: string;
  healthy: boolean;
  endpointsCount: number;
  keysCount: number;
  activeKeys: number;
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  avgLatencyMs: number;
}

interface AgentHealthInfo {
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_INSTALLED' | 'NOT_CONFIGURED';
  gateway: string;
  models: number;
  detected: boolean;
  runnable: boolean;
  liveVerified: boolean;
  protocol: string;
  lastCheck: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ObservabilityPage() {
  const { data: obs, mutate: mutateObs } = useSWR<ObservabilitySnapshot>(
    '/api/v1/debug/observability',
    etagFetcher,
    { refreshInterval: 5000 }
  );

  const { data: providersData, mutate: mutateProviders } = useSWR<{ providers: ProviderMetric[] }>(
    '/api/v1/metrics/providers',
    etagFetcher,
    { refreshInterval: 5000 }
  );

  const { data: agentHealth, mutate: mutateAgents } = useSWR<Record<string, AgentHealthInfo>>(
    '/api/v1/runtime-agents/health',
    etagFetcher,
    { refreshInterval: 5000 }
  );

  const refreshAll = () => {
    void mutateObs();
    void mutateProviders();
    void mutateAgents();
  };

  const providers = providersData?.providers ?? [];
  const agents = Object.entries(agentHealth ?? {});

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-sky-400 mb-2">
            <Activity className="h-3.5 w-3.5 animate-pulse text-sky-400" /> Real-Time Telemetry
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            Observability Fabric
          </h1>
          <p className="mt-1 text-sm text-white/60">
            Real-time gateway throughput, latency percentiles, token economics, and multi-agent health matrix.
          </p>
        </div>
        <div>
          <button
            onClick={refreshAll}
            className="pill bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/20"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Latency & Throughput Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <span className="stat-label">Total Requests</span>
            <Activity className="h-4 w-4 text-sky-400" />
          </div>
          <div className="stat-value text-sky-300 mt-2">{obs?.requestsTotal ?? 0}</div>
          <div className="text-xs text-white/40 mt-1">
            {obs?.requestsSuccess ?? 0} success · {obs?.requestsFailed ?? 0} errors
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <span className="stat-label">Latency p50 / p95 / p99</span>
            <BarChart2 className="h-4 w-4 text-amber-400" />
          </div>
          <div className="stat-value text-amber-300 mt-2">
            {obs?.p50Ms ?? 0} <span className="text-sm font-normal text-white/40">/ {obs?.p95Ms ?? 0} / {obs?.p99Ms ?? 0} ms</span>
          </div>
          <div className="text-xs text-white/40 mt-1">
            Avg: {obs?.avgLatencyMs ?? 0} ms
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <span className="stat-label">Tokens Saved</span>
            <Zap className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="stat-value text-emerald-300 mt-2">{obs?.tokensSaved ?? 0}</div>
          <div className="text-xs text-white/40 mt-1">
            {obs?.tokenSavingsPercent ?? 0}% overall optimization
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <span className="stat-label">System Uptime</span>
            <ShieldCheck className="h-4 w-4 text-fuchsia-400" />
          </div>
          <div className="stat-value text-fuchsia-300 mt-2">{formatUptime(obs?.uptime ?? 0)}</div>
          <div className="text-xs text-white/40 mt-1">
            Catalog v{obs?.catalogVersion ?? 1024}
          </div>
        </div>
      </div>

      {/* Provider Observability Matrix */}
      <div className="card">
        <h2 className="text-lg font-semibold tracking-tight text-white mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5 text-emerald-400" /> Active Provider Performance Matrix
        </h2>
        {providers.length === 0 ? (
          <p className="text-sm text-white/40">No provider metrics collected yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs font-semibold uppercase tracking-wider text-white/40">
                <tr>
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4">Health</th>
                  <th className="py-3 px-4">Endpoints</th>
                  <th className="py-3 px-4">Active Keys</th>
                  <th className="py-3 px-4">Requests</th>
                  <th className="py-3 px-4">Tokens</th>
                  <th className="py-3 px-4">Errors</th>
                  <th className="py-3 px-4">Avg Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {providers.map((p, idx) => (
                  <tr key={`${idx}-${p.providerId}`} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4 font-mono font-medium text-white">{p.providerId}</td>
                    <td className="py-3 px-4">
                      <span className={p.healthy ? 'pill pill-healthy' : 'pill pill-unhealthy'}>
                        {p.healthy ? 'Healthy' : 'Degraded'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-white/60">{p.endpointsCount}</td>
                    <td className="py-3 px-4 font-mono text-white/60">{p.activeKeys} / {p.keysCount}</td>
                    <td className="py-3 px-4 font-mono text-white/80">{p.totalRequests}</td>
                    <td className="py-3 px-4 font-mono text-white/80">{p.totalTokens}</td>
                    <td className="py-3 px-4 font-mono text-rose-400">{p.totalErrors}</td>
                    <td className="py-3 px-4 font-mono text-amber-300">{p.avgLatencyMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Universal Agent Health Matrix */}
      <div className="card">
        <h2 className="text-lg font-semibold tracking-tight text-white mb-4 flex items-center gap-2">
          <Cpu className="h-5 w-5 text-sky-400" /> Universal Agent Proxy Health Matrix
        </h2>
        {agents.length === 0 ? (
          <p className="text-sm text-white/40">No agent telemetry recorded yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(([agentId, a], idx) => (
              <div key={`${idx}-${agentId}`} className="rounded-lg border border-white/5 bg-white/[0.02] p-4 flex flex-col justify-between gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-semibold text-white">{agentId}</span>
                  <span className={
                    a.status === 'HEALTHY' ? 'pill pill-healthy' :
                    a.status === 'DEGRADED' ? 'pill pill-degraded' :
                    a.status === 'NOT_CONFIGURED' ? 'pill bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/30' :
                    'pill bg-white/5 text-white/40 ring-1 ring-white/10'
                  }>
                    {a.status}
                  </span>
                </div>
                <div className="text-xs text-white/60 space-y-1">
                  <div>Protocol: <span className="font-mono text-white/80">{a.protocol}</span></div>
                  <div>Compatible Models: <span className="font-mono text-white/80">{a.models}</span></div>
                  <div>Gateway: <span className="font-mono text-emerald-400">{a.gateway}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

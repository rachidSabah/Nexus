'use client';

import { Activity, DollarSign, Zap, Clock, Cpu, Radio } from 'lucide-react';

import { EventFeed } from '@/components/EventFeed';
import { LatencyChart } from '@/components/LatencyChart';
import { ProviderTable } from '@/components/ProviderTable';
import { TokenUsageChart } from '@/components/TokenUsageChart';
import { useHealth, useProviders, useLiveEvents } from '@/hooks/api';

export default function OverviewPage() {
  const { data: health } = useHealth();
  const { data: providers } = useProviders();
  const events = useLiveEvents();

  const totalRequests = events.filter((e) => e.type === 'request.received').length;
  const successCount = events.filter((e) => e.type === 'provider.request.succeeded').length;
  const failoverCount = events.filter((e) => e.type === 'failover.triggered').length;
  const totalCost = events
    .filter((e) => e.type === 'provider.request.succeeded')
    .reduce((sum, e) => sum + (e.payload?.costUsd ?? 0), 0);

  return (
    <div className="space-y-8 relative pb-12">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Radio className="h-3.5 w-3.5 animate-pulse text-emerald-400" /> Gateway Live Command Telemetry
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Cpu className="h-8 w-8 text-nexus-400" />
            Agent Nexus System Command
          </h1>
          <p className="mt-1 text-sm text-white/60 max-w-2xl">
            Real-time proxy routing telemetry, live token consumption, rate-limit failovers, and active provider matrix.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-mono text-white/70 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Port 3000 / 8787 Active</span>
          </div>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-emerald-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">Active Providers</span>
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
              <Zap className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-emerald-300">{health?.endpoints.healthy ?? 0}</div>
          <div className="mt-1 text-[11px] text-white/40">{health?.endpoints.total ?? 0} endpoints · {health?.endpoints.open ?? 0} circuit-open</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-nexus-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-nexus-300/80">Requests (Live Session)</span>
            <div className="rounded-lg bg-nexus-500/10 p-2 text-nexus-400 border border-nexus-500/20">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-nexus-300">{totalRequests}</div>
          <div className="mt-1 text-[11px] text-nexus-400/60">{successCount} succeeded · {failoverCount} failovers</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nexus-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-amber-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/80">Est. API Token Spend</span>
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400 border border-amber-500/20">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-amber-300">${totalCost.toFixed(4)}</div>
          <div className="mt-1 text-[11px] text-amber-400/60">Aggregated real-time token tracking</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-fuchsia-500/20 bg-gradient-to-b from-fuchsia-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-fuchsia-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-fuchsia-400/80">System Uptime</span>
            <div className="rounded-lg bg-fuchsia-500/10 p-2 text-fuchsia-400 border border-fuchsia-500/20">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-fuchsia-300">{formatUptime(health?.uptime ?? 0)}</div>
          <div className="mt-1 text-[11px] text-fuchsia-400/60">Core engine v{health?.version ?? '0.4.0'}</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-fuchsia-500" />
        </div>
      </div>

      {/* Latency & Token Usage Analytics Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
            <Activity className="h-4 w-4 text-nexus-400" /> Latency Matrix (ms, last 50 requests)
          </h2>
          <LatencyChart events={events} />
        </div>
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-400" /> Token Usage Stream (last 50 requests)
          </h2>
          <TokenUsageChart events={events} />
        </div>
      </div>

      {/* Provider Mesh Table Matrix */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Zap className="h-4 w-4 text-emerald-400" /> Active Provider Endpoints & Rotation Mesh
        </h2>
        <ProviderTable providers={providers ?? []} />
      </div>

      {/* Real-time Event Log Feed */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Radio className="h-4 w-4 text-amber-400" /> Live Event & Failover Stream
        </h2>
        <EventFeed events={events} />
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}


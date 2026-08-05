'use client';

import { useHealth, useProviders, useLiveEvents } from '@/hooks/api';
import { MetricCard } from '@/components/MetricCard';
import { ProviderTable } from '@/components/ProviderTable';
import { EventFeed } from '@/components/EventFeed';
import { LatencyChart } from '@/components/LatencyChart';
import { TokenUsageChart } from '@/components/TokenUsageChart';
import { Activity, DollarSign, Zap, Clock } from 'lucide-react';

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-white/50">
          Real-time view of your Agent Nexus Gateway
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active Providers"
          value={health?.endpoints.healthy ?? 0}
          subtext={`${health?.endpoints.total ?? 0} total · ${health?.endpoints.open ?? 0} circuit-open`}
          icon={<Zap className="h-4 w-4" />}
          tone="emerald"
        />
        <MetricCard
          label="Requests (live)"
          value={totalRequests}
          subtext={`${successCount} succeeded · ${failoverCount} failovers`}
          icon={<Activity className="h-4 w-4" />}
          tone="nexus"
        />
        <MetricCard
          label="Est. Spend"
          value={`$${totalCost.toFixed(4)}`}
          subtext="aggregated from events"
          icon={<DollarSign className="h-4 w-4" />}
          tone="amber"
        />
        <MetricCard
          label="Uptime"
          value={formatUptime(health?.uptime ?? 0)}
          subtext={`v${health?.version ?? '0.0.0'}`}
          icon={<Clock className="h-4 w-4" />}
          tone="fuchsia"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-sm font-medium text-white/80">Latency (ms, last 50 requests)</h2>
          <LatencyChart events={events} />
        </div>
        <div className="card">
          <h2 className="mb-4 text-sm font-medium text-white/80">Token Usage (last 50 requests)</h2>
          <TokenUsageChart events={events} />
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-sm font-medium text-white/80">Providers</h2>
        <ProviderTable providers={providers ?? []} />
      </div>

      <div className="card">
        <h2 className="mb-4 text-sm font-medium text-white/80">Live Event Feed</h2>
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

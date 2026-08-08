'use client';

import { Activity, Database, Zap } from 'lucide-react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

export default function SettingsPage() {
  const { data: cacheStats } = useSWR<CacheStats>('/api/v1/cache/stats', fetcher, { refreshInterval: 3000 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-white/50">Gateway configuration, runtime parameters, and observability stats.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <Database className="h-4 w-4 text-nexus-400" />
            <span className="text-sm font-medium">Cache size</span>
          </div>
          <div className="stat-value mt-2">{cacheStats?.size ?? '—'}</div>
          <div className="text-xs text-white/40">entries in cache</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <Activity className="h-4 w-4 text-nexus-400" />
            <span className="text-sm font-medium">Hit rate</span>
          </div>
          <div className="stat-value mt-2">{cacheStats ? `${(cacheStats.hitRate * 100).toFixed(1)}%` : '—'}</div>
          <div className="text-xs text-white/40">{cacheStats ? `${cacheStats.hits} hits / ${cacheStats.misses} misses` : 'no data'}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <Zap className="h-4 w-4 text-nexus-400" />
            <span className="text-sm font-medium">Configuration</span>
          </div>
          <div className="mt-2 text-xs text-white/60">
            Edit <code className="rounded bg-white/5 px-1">agent-nexus.config.json</code> at the gateway and restart,
            or use the CLI <code className="rounded bg-white/5 px-1">anx config init</code> command.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="text-sm text-white/60">
          For production deployments, set the following environment variables before starting the gateway:
          <ul className="mt-3 space-y-1 text-xs text-white/40">
            <li><code className="rounded bg-white/5 px-1">AGENT_NEXUS_VAULT_KEY</code> — required when <code className="rounded bg-white/5 px-1">security.vaultPath</code> is set (persistent encrypted credentials)</li>
            <li><code className="rounded bg-white/5 px-1">ANX_ADMIN_API_KEY</code> — bootstraps an admin principal with full access</li>
            <li><code className="rounded bg-white/5 px-1">OPENAI_API_KEY</code>, <code className="rounded bg-white/5 px-1">ANTHROPIC_API_KEY</code>, etc. — auto-registers providers from env when no endpoints are configured</li>
            <li><code className="rounded bg-white/5 px-1">NEXUS_BASE_URL</code>, <code className="rounded bg-white/5 px-1">NEXUS_API_KEY</code> — used by the CLI (<code className="rounded bg-white/5 px-1">anx</code>) to talk to the gateway</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

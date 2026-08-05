'use client';

import useSWR from 'swr';
import { Bot, Activity, CheckCircle2, XCircle } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AgentRecord {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  tools: string[];
  models: string[];
  permissions: string[];
  status: 'online' | 'offline' | 'busy';
  lastHeartbeatAt: string;
  currentTaskCount: number;
  concurrencyLimit?: number;
  costMultiplier?: number;
  tags?: string[];
}

export default function AgentsPage() {
  const { data, isLoading } = useSWR<{ total: number; online: number; offline: number; busy: number; byCapability: Record<string, number> }>(
    '/api/v1/agents/stats',
    fetcher,
    { refreshInterval: 5000 },
  );
  const { data: agents } = useSWR<readonly AgentRecord[]>('/api/v1/agents', fetcher, { refreshInterval: 5000 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Bot className="h-6 w-6 text-nexus-400" />
          Agents
        </h1>
        <p className="text-sm text-white/50">Registered AI agents and their current status.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <MetricCard label="Total" value={data?.total ?? 0} />
        <MetricCard label="Online" value={data?.online ?? 0} tone="emerald" />
        <MetricCard label="Busy" value={data?.busy ?? 0} tone="amber" />
        <MetricCard label="Offline" value={data?.offline ?? 0} tone="rose" />
      </div>

      <div className="card">
        <h2 className="mb-4 text-sm font-medium text-white/80">Agent Registry</h2>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-white/40">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wider text-white/40">
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Capabilities</th>
                  <th className="px-3 py-2">Models</th>
                  <th className="px-3 py-2">Tasks</th>
                  <th className="px-3 py-2">Cost ×</th>
                </tr>
              </thead>
              <tbody>
                {(agents ?? []).map((a) => (
                  <tr key={a.id} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{a.id}</div>
                      <div className="text-xs text-white/50">{a.name}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`pill pill-${a.status}`}>{a.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {a.capabilities.slice(0, 4).map((c) => (
                          <span key={c} className="pill bg-white/5 text-white/60">{c}</span>
                        ))}
                        {a.capabilities.length > 4 && (
                          <span className="text-xs text-white/40">+{a.capabilities.length - 4}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-white/60">
                      {a.models.slice(0, 2).join(', ')}
                      {a.models.length > 2 && <span className="text-white/40"> +{a.models.length - 2}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {a.currentTaskCount}/{a.concurrencyLimit ?? 1}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{a.costMultiplier ?? 1.0}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone = 'nexus' }: { label: string; value: number; tone?: string }) {
  const colors: Record<string, string> = {
    nexus: 'text-nexus-400',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
  };
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`mt-2 stat-value ${colors[tone]}`}>{value}</div>
    </div>
  );
}

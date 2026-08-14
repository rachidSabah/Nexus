'use client';

import { Cpu, RefreshCw, Sparkles, Zap, CircleDollarSign, AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { ContextWindowEditor } from '@/components/ContextWindowEditor';
import { etagFetcher } from '@/lib/etagFetcher';

const fetcher = etagFetcher;

interface DiscoveredModel {
  id: string;
  providerId: string;
  nativeModelId?: string;
  isFree?: boolean;
  freeTier?: string;
  pricingSource?: string;
  availability?: string;
  contextWindow?: number;
  pricing?: { inputPer1K?: number; outputPer1K?: number; isFree?: boolean; freeTier?: string };
  capabilities?: Record<string, unknown>;
  stale?: boolean;
}

interface DiscoverResponse {
  models: DiscoveredModel[];
}

interface StatsResponse {
  totalModels?: number;
  freeModels?: number;
  staleModels?: number;
  byProvider?: Record<string, number>;
  lastRefreshAt?: number;
  refreshing?: boolean;
}

export default function ModelsPage() {
  const [filter, setFilter] = useState<'all' | 'free' | 'paid' | 'stale'>('all');
  const [query, setQuery] = useState('');
  const { data: discover, isLoading, mutate } = useSWR<DiscoverResponse>('/api/v1/models/discover', fetcher, {
    refreshInterval: 15000,
  });
  const { data: stats } = useSWR<StatsResponse>('/api/v1/models/stats', fetcher, { refreshInterval: 15000 });

  const models = useMemo(() => {
    const all = discover?.models ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((m) => {
      if (filter === 'free') return m.isFree === true || m.freeTier === 'FREE' || m.pricing?.isFree === true;
      if (filter === 'paid') return m.freeTier === 'PAID' || (m.isFree !== true && m.pricing?.isFree !== true);
      if (filter === 'stale') return m.stale === true;
      return true;
    }).filter((m) => {
      if (!q) return true;
      const caps = Object.keys(m.capabilities ?? {}).join(' ').toLowerCase();
      return (
        m.id.toLowerCase().includes(q) ||
        (m.nativeModelId ?? '').toLowerCase().includes(q) ||
        m.providerId.toLowerCase().includes(q) ||
        caps.includes(q)
      );
    });
  }, [discover, filter, query]);

  const freeCount = useMemo(
    () => (discover?.models ?? []).filter((m) => m.isFree === true || m.freeTier === 'FREE' || m.pricing?.isFree === true).length,
    [discover],
  );
  const paidCount = (discover?.models ?? []).length - freeCount;

  const byProvider = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of discover?.models ?? []) map[m.providerId] = (map[m.providerId] ?? 0) + 1;
    return map;
  }, [discover]);

  const statTotal = stats?.totalModels ?? (discover?.models ?? []).length;
  const statFree = stats?.freeModels ?? freeCount;
  const statStale = stats?.staleModels ?? (discover?.models ?? []).filter((m) => m.stale).length;

  const triggerRefresh = async () => {
    try {
      await fetch('/api/v1/models/refresh', { method: 'POST' });
      await mutate();
    } catch {
      // gateway may be mid-refresh; the next poll picks it up
    }
  };

  return (
    <div className="space-y-8 relative pb-12">
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Universal Model Catalog
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Cpu className="h-8 w-8 text-nexus-400" />
            Discovered Models
          </h1>
          <p className="mt-1 text-sm text-white/60 max-w-2xl">
            Every model discovered across configured providers (OpenCode Zen, Nvidia NIM, Ollama, OpenAI, Anthropic...).
            Filter by free tier, check pricing, capabilities and availability. Sources: <span className="text-white/80">/v1/models/discover</span> + <span className="text-white/80">/v1/models/stats</span>.
          </p>
        </div>

        <button
          onClick={triggerRefresh}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-nexus-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:scale-[1.02] active:scale-95"
        >
          <RefreshCw className="h-4 w-4 animate-pulse text-emerald-300" /> Refresh Discovery
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/40 p-5 backdrop-blur-xl">
          <div className="text-xs text-white/40 font-medium">Total models</div>
          <div className="mt-1 text-3xl font-extrabold text-white">{isLoading ? '…' : statTotal}</div>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/10 to-black/40 p-5 backdrop-blur-xl">
          <div className="text-xs text-emerald-400/70 font-medium flex items-center gap-1"><Zap className="h-3 w-3" /> Free-tier</div>
          <div className="mt-1 text-3xl font-extrabold text-emerald-300">{isLoading ? '…' : statFree}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/40 p-5 backdrop-blur-xl">
          <div className="text-xs text-white/40 font-medium flex items-center gap-1"><CircleDollarSign className="h-3 w-3" /> Paid</div>
          <div className="mt-1 text-3xl font-extrabold text-white">{isLoading ? '…' : paidCount}</div>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/10 to-black/40 p-5 backdrop-blur-xl">
          <div className="text-xs text-amber-400/70 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Stale</div>
          <div className="mt-1 text-3xl font-extrabold text-amber-300">{isLoading ? '…' : statStale}</div>
        </div>
      </div>

      {/* Filter chips + provider breakdown */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'free', 'paid', 'stale'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition ${
                filter === f
                  ? 'border-nexus-500/50 bg-nexus-500/20 text-nexus-200'
                  : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
              }`}
            >
              {f === 'all' ? 'All' : f === 'free' ? `Free (${freeCount})` : f === 'paid' ? `Paid (${paidCount})` : `Stale (${statStale})`}
            </button>
          ))}
          <div className="relative ml-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models, providers, capabilities…"
              className="w-56 rounded-full border border-white/10 bg-black/40 py-1.5 pl-8 pr-3 text-xs text-white placeholder-white/30 outline-none transition focus:border-nexus-500/50 focus:bg-black/60"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-white/50">
          {Object.entries(byProvider).map(([provider, count]) => (
            <span key={provider} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono">
              {provider}: <span className="text-white/80 font-semibold">{count}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Model table */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl">
        {isLoading ? (
          <div className="py-8 text-center text-xs text-white/40">Querying model registry...</div>
        ) : models.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-xs text-white/40">
            No models match this filter. Trigger a refresh to run provider discovery.
          </div>
        ) : (
          <div className="w-full">
            <table className="w-full text-left text-sm table-fixed">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/50">
                  <th className="w-[30%] pb-3 pr-4 font-semibold">Model</th>
                  <th className="w-[15%] pb-3 pr-4 font-semibold">Provider</th>
                  <th className="w-[10%] pb-3 pr-4 font-semibold">Tier</th>
                  <th className="w-[12%] pb-3 pr-4 font-semibold">Context</th>
                  <th className="w-[18%] pb-3 pr-4 font-semibold">Capabilities</th>
                  <th className="w-[15%] pb-3 font-semibold">Pricing / Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {models.map((m, index) => {
                  const isFree = m.isFree === true || m.freeTier === 'FREE' || m.pricing?.isFree === true;
                  const caps = m.capabilities ?? {};
                  const capsList = Object.entries(caps)
                    .filter(([, v]) => v === true)
                    .map(([k]) => k)
                    .slice(0, 3);
                  const input = m.pricing?.inputPer1K ?? undefined;
                  const output = m.pricing?.outputPer1K ?? undefined;
                  return (
                    <tr key={`${m.providerId}-${m.id}-${index}`} className="transition hover:bg-white/[0.03]">
                      <td className="py-3 pr-4 overflow-hidden">
                        <div className="font-mono text-xs text-white truncate" title={m.id}>{m.id}</div>
                        {m.nativeModelId && m.nativeModelId !== m.id && (
                          <div className="font-mono text-[10px] text-white/35 truncate" title={m.nativeModelId}>{m.nativeModelId}</div>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-nexus-300 truncate" title={m.providerId}>{m.providerId}</td>
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                          isFree
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : m.freeTier === 'PAID'
                              ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                              : 'border-white/10 bg-white/5 text-white/50'
                        }`}>
                          {isFree ? <Zap className="h-2.5 w-2.5" /> : <CircleDollarSign className="h-2.5 w-2.5" />}
                          {isFree ? 'FREE' : m.freeTier ?? (m.pricing?.freeTier ?? 'PAID')}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <ContextWindowEditor
                          provider={m.providerId}
                          modelId={m.nativeModelId ?? m.id}
                          contextWindow={m.contextWindow}
                          onChanged={() => mutate()}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-1">
                          {capsList.map((c) => (
                            <span key={c} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300/80">{c}</span>
                          ))}
                          {capsList.length === 0 && <span className="text-[10px] text-white/30">—</span>}
                        </div>
                      </td>
                      <td className="py-3 font-mono text-[11px] text-white/60">
                        <div className="flex flex-col gap-0.5">
                          <span>
                            {isFree
                              ? 'free'
                              : input !== undefined && output !== undefined
                                ? `$${input}/${output}`
                                : '—'}
                          </span>
                          <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                            m.stale ? 'text-amber-400' : 'text-emerald-400'
                          }`}>
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            {m.stale ? 'stale' : m.availability ?? 'available'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

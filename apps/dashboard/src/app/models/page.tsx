'use client';

import { Cpu, RefreshCw, Sparkles, Zap, CircleDollarSign, AlertTriangle, Search, Eye, Brain, Wrench, Copy, Check, Terminal, X, Layers, Activity } from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import useSWR from 'swr';

import { ContextWindowEditor } from '@/components/ContextWindowEditor';
import { etagFetcher } from '@/lib/etagFetcher';

const fetcher = etagFetcher;

interface DiscoveredModel {
  id: string;
  providerId: string;
  nativeModelId?: string;
  displayName?: string;
  isFree?: boolean;
  freeTier?: string;
  pricingSource?: string;
  availability?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: { inputPer1K?: number; outputPer1K?: number; isFree?: boolean; freeTier?: string };
  capabilities?: Record<string, unknown>;
  stale?: boolean;
  discoveredAt?: number;
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

function PerModelProbe({ model }: { model: DiscoveredModel }) {
  const [status, setStatus] = useState<'idle' | 'probing' | 'ok' | 'fail'>('idle');
  const [detail, setDetail] = useState<{ latencyMs?: number; error?: string; ok?: boolean } | null>(null);

  async function runProbe() {
    setStatus('probing');
    setDetail(null);
    const start = Date.now();
    try {
      const r = await fetch('/api/v1/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: model.providerId,
          model: model.id,
          tests: ['chat', 'streaming'],
        }),
      });
      const raw = (await r.json()) as Record<string, unknown>;
      // The gateway returns per-test results nested under `tests`
      // ({ tests: { chat: {...}, streaming: {...} } }). Read from there,
      // but fall back to a flat shape so we don't break either contract.
      const results = (raw['tests'] ?? raw) as Record<string, { ok?: boolean; latencyMs?: number; error?: string }>;
      const chat = results['chat'];
      const streaming = results['streaming'];
      const ok = chat?.ok === true || streaming?.ok === true;
      setStatus(ok ? 'ok' : 'fail');
      const latencyMs = chat?.latencyMs ?? streaming?.latencyMs ?? Date.now() - start;
      setDetail({
        ok,
        latencyMs,
        error: chat?.error ?? streaming?.error,
      });
    } catch (err) {
      setStatus('fail');
      setDetail({ ok: false, error: (err as Error).message || 'Probe failed' });
    }
  }

  const badge =
    status === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      : status === 'fail'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
        : 'border-white/10 bg-white/5 text-white/50';

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-nexus-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-white/70">Live Probe</span>
        </div>
        <button
          onClick={runProbe}
          disabled={status === 'probing'}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${
            status === 'probing' ? 'bg-nexus-700 opacity-80 cursor-wait' : 'bg-nexus-600 hover:bg-nexus-500 active:scale-95'
          }`}
        >
          {status === 'probing' ? 'Probing…' : 'Probe Model'}
        </button>
      </div>
      {detail && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs font-mono ${badge}`}>
          {status === 'ok' ? (
            <span>✓ Reachable — {detail.latencyMs ? `${detail.latencyMs}ms` : 'ok'}</span>
          ) : (
            <span>✗ {detail.error ?? 'Unreachable'}</span>
          )}
        </div>
      )}
      {status === 'idle' && (
        <p className="mt-2 text-[11px] text-white/40">
          Sends a 1-token request to the real upstream to confirm the model is live (200 / 401 / 402 / timeout).
        </p>
      )}
    </div>
  );
}

interface FallbackCandidate {
  id: string;
  providerId: string;
  displayName?: string;
  contextWindow?: number;
  similarity: number;
  pricing?: { inputPer1M?: number; outputPer1M?: number; isFree?: boolean };
  capabilities?: Record<string, unknown>;
}

interface FallbackConfig {
  modelId: string;
  providerId: string;
  current: string[];
  candidates: FallbackCandidate[];
}

function ModelFalloverEditor({ model }: { model: DiscoveredModel }) {
  const [config, setConfig] = useState<FallbackConfig | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setStatus('loading');
    try {
      const r = await fetch(`/api/v1/fallbacks?providerId=${encodeURIComponent(model.providerId)}&modelId=${encodeURIComponent(model.id)}`);
      if (!r.ok) throw new Error(`Failed to load fallbacks (${r.status})`);
      const data = (await r.json()) as FallbackConfig;
      setConfig(data);
      setSelected(data.current ?? []);
      setStatus('idle');
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  }

  // Load on mount.
  useEffect(() => { load(); }, [model.id, model.providerId]);

  const candidates = useMemo(() => {
    const all = config?.candidates ?? [];
    const q = filter.trim().toLowerCase();
    return all.filter((c) => !q || c.id.toLowerCase().includes(q) || c.providerId.toLowerCase().includes(q));
  }, [config, filter]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function move(id: string, dir: -1 | 1) {
    setSelected((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const a = next[idx];
      const b = next[j];
      if (a === undefined || b === undefined) return prev;
      next[idx] = b;
      next[j] = a;
      return next;
    });
  }

  async function save() {
    setStatus('saving');
    setError(null);
    try {
      const r = await fetch('/api/v1/fallbacks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: model.providerId, modelId: model.id, fallbacks: selected }),
      });
      const raw = (await r.json()) as { ok?: boolean; error?: { message?: string } };
      if (!r.ok || !raw.ok) throw new Error(raw.error?.message ?? `Save failed (${r.status})`);
      setStatus('saved');
      await load();
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-nexus-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-white/70">Manual Failover Models</span>
        </div>
        <span className="text-[11px] text-white/40">
          {selected.length} selected · automatic failover still applies after these
        </span>
      </div>

      <p className="text-[11px] text-white/45">
        Pin an ordered list of fallback models (similar benchmark tier) tried <span className="text-white/70">first</span> when this model fails — complemented by automatic failover. Pick at least 5 for broad coverage.
      </p>

      {/* Selected (ordered) */}
      {selected.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Failover order (top = tried first)</div>
          {selected.map((id, i) => (
            <div key={id} className="flex items-center justify-between rounded-lg border border-nexus-500/20 bg-nexus-500/5 px-3 py-1.5">
              <span className="font-mono text-[11px] text-white/80 truncate">{i + 1}. {id}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => move(id, -1)} disabled={i === 0} className="px-1.5 text-white/40 hover:text-white disabled:opacity-30">↑</button>
                <button onClick={() => move(id, 1)} disabled={i === selected.length - 1} className="px-1.5 text-white/40 hover:text-white disabled:opacity-30">↓</button>
                <button onClick={() => toggle(id)} className="px-1.5 text-rose-400 hover:text-rose-300">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Candidate picker */}
      <div className="space-y-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter similar-tier candidates…"
          className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs text-white placeholder-white/40 outline-none focus:border-nexus-400"
        />
        <div className="max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-1.5 space-y-1">
          {status === 'loading' && <div className="py-3 text-center text-[11px] text-white/40">Loading candidates…</div>}
          {status !== 'loading' && candidates.length === 0 && (
            <div className="py-3 text-center text-[11px] text-white/40">No matching candidates.</div>
          )}
          {candidates.map((c) => (
            <label
              key={c.id}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition hover:bg-white/5 ${selectedSet.has(c.id) ? 'bg-nexus-500/10' : ''}`}
            >
              <input type="checkbox" checked={selectedSet.has(c.id)} onChange={() => toggle(c.id)} className="accent-nexus-500" />
              <span className="font-mono text-white/80 truncate flex-1" title={c.id}>{c.id}</span>
              <span className="text-white/35 font-mono">{Math.round(c.similarity * 100)}%</span>
            </label>
          ))}
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-mono text-rose-300">{error}</div>}

      <div className="flex items-center justify-end gap-2">
        {status === 'saved' && <span className="text-[11px] text-emerald-400">✓ Saved</span>}
        <button
          onClick={save}
          disabled={status === 'saving'}
          className={`rounded-lg px-4 py-2 text-xs font-semibold text-white transition ${status === 'saving' ? 'bg-nexus-700 opacity-80 cursor-wait' : 'bg-nexus-600 hover:bg-nexus-500 active:scale-95'}`}
        >
          {status === 'saving' ? 'Saving…' : 'Apply & Save'}
        </button>
      </div>
    </div>
  );
}

export default function ModelsPage() {
  const [filter, setFilter] = useState<'all' | 'free' | 'paid' | 'vision' | 'reasoning' | 'tools' | 'large-context' | 'stale'>('all');
  const [query, setQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState<DiscoveredModel | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const { data: discover, isLoading, mutate } = useSWR<DiscoverResponse>('/api/v1/models/discover', fetcher, {
    refreshInterval: 15000,
  });
  const { data: stats } = useSWR<StatsResponse>('/api/v1/models/stats', fetcher, { refreshInterval: 15000 });
  const { data: freeEstimate } = useSWR<{
    verified: string;
    aggregate: { providersCovered: number; sumRequestsPerDayCeiling: number; sumTokensPerMinuteCeiling: number; sumTokensPerMonthCeiling: number; cardRequiredAnywhere: boolean };
    providers: { provider: string; note: string; requestsPerDay: number | null; tokensPerMinute: number | null; tokensPerMonthEstimate: number | null; cardRequired: boolean; source: string; verified: string }[];
  }>('/api/v1/free-tier/estimate', fetcher, { refreshInterval: 3600000 });

  const models = useMemo(() => {
    const all = discover?.models ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((m) => {
      if (filter === 'free') return m.isFree === true || m.freeTier === 'FREE' || m.freeTier === 'FREE_TIER' || m.pricing?.isFree === true || m.pricing?.freeTier === 'FREE' || m.pricing?.freeTier === 'FREE_TIER';
      if (filter === 'paid') return m.freeTier === 'PAID' || (m.isFree !== true && m.pricing?.isFree !== true && m.freeTier !== 'FREE_TIER' && m.pricing?.freeTier !== 'FREE_TIER');
      if (filter === 'vision') return m.capabilities?.vision === true;
      if (filter === 'reasoning') return m.capabilities?.reasoning === true || m.id.includes('think') || m.id.includes('r1') || m.id.includes('reason');
      if (filter === 'tools') return m.capabilities?.toolCalling === true || m.capabilities?.functionCalling === true || m.capabilities?.tools === true;
      if (filter === 'large-context') return (m.contextWindow ?? 0) >= 65536;
      if (filter === 'stale') return m.stale === true;
      return true;
    }).filter((m) => {
      if (!q) return true;
      const caps = Object.keys(m.capabilities ?? {}).join(' ').toLowerCase();
      const ctxStr = m.contextWindow ? `${Math.round(m.contextWindow / 1024)}k` : '';
      return (
        m.id.toLowerCase().includes(q) ||
        (m.nativeModelId ?? '').toLowerCase().includes(q) ||
        m.providerId.toLowerCase().includes(q) ||
        ctxStr.includes(q) ||
        caps.includes(q)
      );
    });
  }, [discover, filter, query]);

  const freeCount = useMemo(
    () => (discover?.models ?? []).filter((m) => m.isFree === true || m.freeTier === 'FREE' || m.freeTier === 'FREE_TIER' || m.pricing?.isFree === true || m.pricing?.freeTier === 'FREE' || m.pricing?.freeTier === 'FREE_TIER').length,
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(label);
    setTimeout(() => setCopiedSnippet(null), 2000);
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
            Model Explorer & Normalization
          </h1>
          <p className="mt-1 text-sm text-white/60 max-w-2xl">
            Live catalog of dynamically discovered models across all registered AI providers. Filter by capabilities, inspect pricing, and copy ready-to-use coding agent configs.
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
        {/* Sourced free-tier aggregate ceiling (verified 2026-08, with source links) */}
        <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-b from-sky-500/10 to-black/40 p-5 backdrop-blur-xl">
          <div className="text-xs text-sky-400/70 font-medium flex items-center gap-1"><Zap className="h-3 w-3" /> Free-tier ceiling</div>
          <div className="mt-1 text-3xl font-extrabold text-sky-300">
            {freeEstimate ? freeEstimate.aggregate.sumRequestsPerDayCeiling.toLocaleString() : '…'}
            <span className="ml-1 text-sm font-semibold text-sky-400/70">req/day</span>
          </div>
          <div className="mt-1 text-[11px] text-white/40">
            sum-of-ceilings across {freeEstimate?.aggregate.providersCovered ?? '—'} providers · verified {freeEstimate?.verified ?? '—'}
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col gap-4">
        {/* Dedicated Prominent Search Bar */}
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search discovered models by model ID, native name, provider (e.g. nvidia-nim, openrouter, mistral), or capability (e.g. vision, tools)..."
            className="w-full rounded-xl border border-white/15 bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-white placeholder-white/40 backdrop-blur-md outline-none transition focus:border-nexus-400 focus:bg-white/[0.07] focus:ring-2 focus:ring-nexus-500/20"
          />
        </div>

        {/* Filter chips + provider breakdown */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: `All (${discover?.models?.length ?? 0})` },
              { id: 'free', label: `Free (${freeCount})` },
              { id: 'paid', label: `Paid (${paidCount})` },
              { id: 'vision', label: 'Vision', icon: Eye },
              { id: 'reasoning', label: 'Reasoning', icon: Brain },
              { id: 'tools', label: 'Tools', icon: Wrench },
              { id: 'large-context', label: '64K+ Ctx', icon: Layers },
              { id: 'stale', label: `Stale (${statStale})` },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as typeof filter)}
                className={`flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition ${
                  filter === f.id
                    ? 'border-nexus-500/50 bg-nexus-500/20 text-nexus-200'
                    : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                {f.icon && <f.icon className="h-3 w-3" />}
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px] text-white/50">
            {Object.entries(byProvider).map(([provider, count]) => (
              <span key={provider} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono">
                {provider}: <span className="text-white/80 font-semibold">{count}</span>
              </span>
            ))}
          </div>
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
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left text-sm table-fixed">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/50">
                  <th className="w-[28%] pb-3 pr-4 font-semibold">Model</th>
                  <th className="w-[14%] pb-3 pr-4 font-semibold">Provider</th>
                  <th className="w-[10%] pb-3 pr-4 font-semibold">Tier</th>
                  <th className="w-[16%] pb-3 pr-4 font-semibold">Token Limits</th>
                  <th className="w-[18%] pb-3 pr-4 font-semibold">Capabilities</th>
                  <th className="w-[14%] pb-3 font-semibold">Pricing / Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {models.map((m, index) => {
                  const isFree = m.isFree === true || m.freeTier === 'FREE' || m.freeTier === 'FREE_TIER' || m.pricing?.isFree === true || m.pricing?.freeTier === 'FREE' || m.pricing?.freeTier === 'FREE_TIER';
                  const caps = m.capabilities ?? {};
                  const capsList = Object.entries(caps)
                    .filter(([, v]) => v === true)
                    .map(([k]) => k)
                    .slice(0, 3);
                  const input = m.pricing?.inputPer1K ?? undefined;
                  const output = m.pricing?.outputPer1K ?? undefined;
                  return (
                    <tr
                      key={`${m.providerId}-${m.id}-${index}`}
                      onClick={() => setSelectedModel(m)}
                      className="cursor-pointer transition hover:bg-white/[0.05]"
                    >
                      <td className="py-3 pr-4 overflow-hidden">
                        <div className="font-mono text-xs text-white truncate font-medium" title={m.id}>{m.id}</div>
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
                      <td className="py-3 pr-4" onClick={(e) => e.stopPropagation()}>
                        <div className="space-y-1">
                          <ContextWindowEditor
                            provider={m.providerId}
                            modelId={m.nativeModelId ?? m.id}
                            contextWindow={m.contextWindow}
                            onChanged={() => mutate()}
                          />
                          {m.maxOutputTokens && (
                            <div className="text-[10px] font-mono text-white/40">
                              max out: <span className="text-white/70">{m.maxOutputTokens.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
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
                        <div className="flex items-center justify-between">
                          <span>
                            {isFree
                              ? 'free'
                              : input !== undefined && output !== undefined
                                ? `$${input}/${output}`
                                : '—'}
                          </span>
                          <span className="text-nexus-400 text-xs font-semibold hover:underline">
                            Inspect &rarr;
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

      {/* Model Details Modal / Drawer */}
      {selectedModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/15 bg-neutral-950 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <div className="text-xs text-nexus-400 font-mono uppercase">{selectedModel.providerId}</div>
                <h3 className="text-lg font-bold text-white font-mono mt-0.5">{selectedModel.id}</h3>
              </div>
              <button
                onClick={() => setSelectedModel(null)}
                className="text-white/40 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {(() => {
              const isFreeModal = selectedModel.isFree === true || selectedModel.freeTier === 'FREE' || selectedModel.freeTier === 'FREE_TIER' || selectedModel.pricing?.isFree === true || selectedModel.pricing?.freeTier === 'FREE' || selectedModel.pricing?.freeTier === 'FREE_TIER';
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="text-white/40 text-[10px] uppercase font-semibold">Context Window</div>
                    <div className="text-sm font-bold text-white mt-0.5">{(selectedModel.contextWindow ?? 8192).toLocaleString()} tokens</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="text-white/40 text-[10px] uppercase font-semibold">Max Output Limit</div>
                    <div className="text-sm font-bold text-white mt-0.5">{(selectedModel.maxOutputTokens ?? 4096).toLocaleString()} tokens</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="text-white/40 text-[10px] uppercase font-semibold">Pricing Tier</div>
                    <div className={`text-sm font-bold mt-0.5 ${isFreeModal ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {isFreeModal ? 'FREE TIER' : (selectedModel.freeTier ?? selectedModel.pricing?.freeTier ?? 'PAID')}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="text-white/40 text-[10px] uppercase font-semibold">Nexus Model URI</div>
                    <div className="text-xs font-mono font-bold text-cyan-300 truncate mt-0.5">nexus/{selectedModel.providerId}/{selectedModel.id}</div>
                  </div>
                </div>
              );
            })()}

            {/* Per-model live probe — verifies the model against the real upstream */}
            <PerModelProbe model={selectedModel} />

            {/* Manual failover model chain — pin similar-tier fallback models */}
            <ModelFalloverEditor model={selectedModel} />

            {/* Coding Agent Configs */}
            <div className="space-y-3 pt-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-1.5">
                <Terminal className="h-4 w-4 text-nexus-400" /> Use Through Nexus with Coding Agents
              </div>

              <div className="space-y-2">
                {[
                  {
                    name: 'Claude Code',
                    snippet: `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"\nexport ANTHROPIC_API_KEY="nexus"\nclaude --model nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'OpenAI Codex CLI',
                    snippet: `export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"\nexport OPENAI_API_KEY="nexus"\ncodex --model nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'Gemini CLI',
                    snippet: `export GEMINI_API_BASE="http://127.0.0.1:8787"\ngemini --model nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'Qwen Code CLI',
                    snippet: `export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"\nexport OPENAI_API_KEY="nexus"\nqwen --model nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'Hermes CLI',
                    snippet: `hermes -m nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'OpenCode',
                    snippet: `opencode --model nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'OpenCode Go',
                    snippet: `opencode-go --model nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'OpenCode Zen',
                    snippet: `opencode-zen --model nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'Aider AI Pair Programmer',
                    snippet: `export OPENAI_API_BASE="http://127.0.0.1:8787/v1"\nexport OPENAI_API_KEY="nexus"\naider --model openai/nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'Cursor IDE',
                    snippet: JSON.stringify({
                      title: `Nexus ${selectedModel.id}`,
                      model: `nexus/${selectedModel.providerId}/${selectedModel.id}`,
                      apiBase: 'http://127.0.0.1:8787/v1',
                      apiKey: 'nexus',
                      provider: 'openai',
                    }, null, 2),
                  },
                  {
                    name: 'Continue (VS Code & JetBrains)',
                    snippet: JSON.stringify({
                      models: [
                        {
                          title: `Nexus ${selectedModel.id}`,
                          provider: 'openai',
                          model: `nexus/${selectedModel.providerId}/${selectedModel.id}`,
                          apiBase: 'http://127.0.0.1:8787/v1',
                          apiKey: 'nexus',
                        },
                      ],
                    }, null, 2),
                  },
                  {
                    name: 'Cline (VS Code)',
                    snippet: JSON.stringify({
                      apiProvider: 'openai',
                      openAiBaseUrl: 'http://127.0.0.1:8787/v1',
                      openAiApiKey: 'nexus',
                      openAiModelId: `nexus/${selectedModel.providerId}/${selectedModel.id}`,
                    }, null, 2),
                  },
                  {
                    name: 'Roo Code',
                    snippet: JSON.stringify({
                      apiProvider: 'openai',
                      openAiBaseUrl: 'http://127.0.0.1:8787/v1',
                      openAiApiKey: 'nexus',
                      openAiModelId: `nexus/${selectedModel.providerId}/${selectedModel.id}`,
                    }, null, 2),
                  },
                  {
                    name: 'Zed Editor',
                    snippet: JSON.stringify({
                      language_models: {
                        openai: {
                          version: '1',
                          api_url: 'http://127.0.0.1:8787/v1',
                          available_models: [{ name: `nexus/${selectedModel.providerId}/${selectedModel.id}` }],
                        },
                      },
                    }, null, 2),
                  },
                  {
                    name: 'Neovim (CodeCompanion & Avante)',
                    snippet: `require("codecompanion").setup({\n  adapters = {\n    openai = function()\n      return require("codecompanion.adapters").extend("openai", {\n        env = { url = "http://127.0.0.1:8787/v1", api_key = "nexus" },\n        schema = { model = { default = "nexus/${selectedModel.providerId}/${selectedModel.id}" } }\n      })\n    end\n  }\n})`,
                  },
                  {
                    name: 'Emacs (gptel)',
                    snippet: `(gptel-make-openai "Nexus"\n  :host "127.0.0.1:8787"\n  :endpoint "/v1/chat/completions"\n  :stream t\n  :key "nexus"\n  :models '("nexus/${selectedModel.providerId}/${selectedModel.id}"))`,
                  },
                  {
                    name: 'VS Code (Global)',
                    snippet: JSON.stringify({
                      'chat.defaultModel': `nexus/${selectedModel.providerId}/${selectedModel.id}`,
                      'github.copilot.advanced': {
                        'debug.overrideProxyUrl': 'http://127.0.0.1:8787',
                      },
                    }, null, 2),
                  },
                  {
                    name: 'JetBrains IDEs (IntelliJ, PyCharm, WebStorm, CLion)',
                    snippet: `export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"\nexport OPENAI_API_KEY="nexus"\n# Custom OpenAI API Server URL: http://127.0.0.1:8787/v1\n# Model ID: nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'OpenHands (OpenDevin)',
                    snippet: `export LLM_BASE_URL="http://127.0.0.1:8787/v1"\nexport LLM_API_KEY="nexus"\nexport LLM_MODEL="nexus/${selectedModel.providerId}/${selectedModel.id}"`,
                  },
                  {
                    name: 'DeepSeek Harness (DSH)',
                    snippet: `dsh --base-url http://127.0.0.1:8787/v1 --api-key nexus --model nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'AGY Builder',
                    snippet: `agy -m nexus/${selectedModel.providerId}/${selectedModel.id}`,
                  },
                  {
                    name: 'cURL / REST API',
                    snippet: `curl -X POST http://127.0.0.1:8787/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer nexus" \\\n  -d '{"model": "nexus/${selectedModel.providerId}/${selectedModel.id}", "messages": [{"role": "user", "content": "Hello"}]}'`,
                  },
                ].map((agent) => (
                  <div key={agent.name} className="rounded-xl border border-white/10 bg-black/60 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-white/80">{agent.name}</span>
                      <button
                        onClick={() => copyToClipboard(agent.snippet, agent.name)}
                        className="flex items-center gap-1 text-[11px] text-nexus-400 hover:text-nexus-300 font-medium"
                      >
                        {copiedSnippet === agent.name ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        {copiedSnippet === agent.name ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-white/60 overflow-x-auto p-2 rounded-lg bg-white/[0.03] select-all">
                      {agent.snippet}
                    </pre>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end border-t border-white/10 pt-4">
              <button
                onClick={() => setSelectedModel(null)}
                className="rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

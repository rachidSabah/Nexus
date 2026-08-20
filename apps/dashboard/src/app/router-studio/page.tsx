'use client';

import { Settings2, Play, Zap, DollarSign, Eye, Brain, Gauge, Shuffle, ArrowRight, KeyRound, Link2, Sparkles, Plus, Cpu } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Alias {
  alias: string;
  description: string;
  filter: {
    capability?: string;
    freeOnly?: boolean;
    minContextWindow?: number;
    providers?: string[];
  };
  ranking: string;
  builtin: boolean;
}

interface ApiKey {
  id: string;
  providerId: string;
  status: 'active' | 'cooldown' | 'exhausted' | 'invalid';
}

interface Provider {
  id: string;
  providerId: string;
  displayName: string;
  health: string;
  capabilities: Record<string, boolean>;
}

interface AliasResolution {
  modelId: string;
  providerId: string;
  reason: string;
  candidateCount: number;
}

export default function RouterStudioPage() {
  const { data: aliases, mutate: refreshAliases } = useSWR<{ aliases: Alias[] }>('/api/v1/aliases', fetcher, { refreshInterval: 10000 });
  const { data: keys } = useSWR<ApiKey[]>('/api/v1/keys', fetcher, { refreshInterval: 5000 });
  const { data: providers } = useSWR<Provider[]>('/api/v1/providers', fetcher, { refreshInterval: 10000 });
  const [resolveResult, setResolveResult] = useState<AliasResolution | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvedAliasName, setResolvedAliasName] = useState<string | null>(null);
  const [resolvingAlias, setResolvingAlias] = useState<string | null>(null);
  const [explain, setExplain] = useState<Record<string, unknown> | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [newAlias, setNewAlias] = useState({
    alias: '',
    description: '',
    capability: '',
    freeOnly: false,
    minContextWindow: 0,
    ranking: 'cheapest' as string,
  });
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  // Group keys by provider for the provider-keys panel
  const keysByProvider = (keys ?? []).reduce<Record<string, { total: number; active: number; cooldown: number; invalid: number }>>((acc, k) => {
    if (!acc[k.providerId]) acc[k.providerId] = { total: 0, active: 0, cooldown: 0, invalid: 0 };
    acc[k.providerId]!.total++;
    if (k.status === 'active') acc[k.providerId]!.active++;
    else if (k.status === 'cooldown') acc[k.providerId]!.cooldown++;
    else if (k.status === 'invalid') acc[k.providerId]!.invalid++;
    return acc;
  }, {});

  async function resolveAlias(alias: string) {
    setResolvingAlias(alias);
    setResolvedAliasName(alias);
    setResolveResult(null);
    setResolveError(null);
    setExplain(null);
    try {
      const r = await fetch(`/api/v1/aliases/${encodeURIComponent(alias)}/resolve`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: { message: `HTTP ${r.status} ${r.statusText}` } }));
        setResolveError(body?.error?.message ?? `Resolution failed: HTTP ${r.status}`);
        return;
      }
      const body = (await r.json()) as AliasResolution;
      setResolveResult(body);
      // Surface the routing decision explanation (Why panel) for the resolved model.
      setExplaining(true);
      try {
        const e = await fetch('/api/v1/routing/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: body.modelId }),
        });
        if (e.ok) setExplain((await e.json()) as Record<string, unknown>);
      } catch {
        /* explanation is best-effort; never block the resolve result */
      } finally {
        setExplaining(false);
      }
    } catch (err) {
      setResolveError(`Network error: ${(err as Error).message || 'Gateway unreachable'}`);
    } finally {
      setResolvingAlias(null);
    }
  }

  async function createAlias() {
    if (!newAlias.alias) {
      setCreateMsg('Alias identifier is required');
      return;
    }
    const filter: Record<string, unknown> = {};
    if (newAlias.capability) filter.capability = newAlias.capability;
    if (newAlias.freeOnly) filter.freeOnly = true;
    if (newAlias.minContextWindow > 0) filter.minContextWindow = newAlias.minContextWindow;

    const r = await fetch('/api/v1/aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alias: newAlias.alias.startsWith('local/') ? newAlias.alias : `local/${newAlias.alias}`,
        description: newAlias.description || 'User-defined cyber route',
        filter,
        ranking: newAlias.ranking,
      }),
    });
    if (r.ok) {
      setCreateMsg(`Created virtual route: ${newAlias.alias}`);
      setNewAlias({ ...newAlias, alias: '', description: '' });
      await refreshAliases();
    } else {
      const body = await r.json().catch(() => ({ error: { message: 'Creation failed' } }));
      setCreateMsg(`Error: ${body?.error?.message ?? r.statusText}`);
    }
  }

  async function deleteAlias(alias: string) {
    if (!confirm(`Delete virtual alias '${alias}'?`)) return;
    await fetch(`/api/v1/aliases/${encodeURIComponent(alias)}`, { method: 'DELETE' });
    await refreshAliases();
  }

  const rankingIcons: Record<string, typeof Zap> = {
    cheapest: DollarSign,
    fastest: Zap,
    highest_quality: Brain,
    largest_context: Eye,
    most_capabilities: Gauge,
  };

  return (
    <div className="space-y-8 relative pb-12 w-full max-w-full overflow-x-hidden">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Smart Model Aliasing & Discovery Matrix
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Settings2 className="h-8 w-8 text-nexus-400" />
            Router Studio & Dynamic Aliases
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Configure virtual routes (e.g. <code>local/coding</code>, <code>local/free</code>).
            Requests automatically resolve at runtime to the best provider endpoint based on latency, price, and health.
          </p>
        </div>
      </div>

      {/* Routing pipeline visualization */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Shuffle className="h-4 w-4 text-nexus-400" /> Dynamic Proxy Routing Pipeline
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 gap-2 text-xs">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
            <Play className="mx-auto mb-1 h-4 w-4 text-nexus-400" />
            <div className="font-semibold text-white">Agent Request</div>
          </div>
          <div className="hidden md:flex items-center justify-center text-white/30"><ArrowRight className="h-4 w-4" /></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
            <div className="font-semibold text-nexus-300">Alias Lookup</div>
          </div>
          <div className="hidden md:flex items-center justify-center text-white/30"><ArrowRight className="h-4 w-4" /></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
            <div className="font-semibold text-white">Rank Match</div>
          </div>
          <div className="hidden md:flex items-center justify-center text-white/30"><ArrowRight className="h-4 w-4" /></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
            <div className="font-semibold text-emerald-400">Target Provider</div>
          </div>
        </div>
      </div>

      {/* Provider + Key status panel */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4 mb-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <KeyRound className="h-4 w-4 text-nexus-400" /> Provider Key Readiness Matrix
            </h2>
            <p className="mt-0.5 text-xs text-white/50">
              Providers require active rotation keys to receive routed proxy requests.
            </p>
          </div>
          <Link
            href="/keys"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10"
          >
            <Link2 className="h-3.5 w-3.5 text-nexus-400" /> Manage Key Vault
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(providers ?? []).map((p) => {
            const keyInfo = keysByProvider[p.providerId];
            return (
              <div key={p.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-sm text-white">{p.providerId}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    p.health === 'healthy' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                  }`}>
                    {p.health}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  {keyInfo ? (
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 font-semibold">{keyInfo.active} active</span>
                      {keyInfo.cooldown > 0 && <span className="text-amber-400">· {keyInfo.cooldown} cd</span>}
                      {keyInfo.invalid > 0 && <span className="text-rose-400">· {keyInfo.invalid} inv</span>}
                    </div>
                  ) : (
                    <span className="text-amber-400/80 text-[11px]">No active keys</span>
                  )}
                  <span className="text-white/40 text-[11px]">{keyInfo ? `${keyInfo.total} total` : '0 keys'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alias list */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-nexus-400" /> Configured Dynamic Aliases ({aliases?.aliases?.length ?? 0})
        </h2>
        <div className="space-y-3">
          {(aliases?.aliases ?? []).map((a) => {
            const Icon = rankingIcons[a.ranking] ?? Zap;
            return (
              <div key={a.alias} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition hover:bg-white/[0.04]">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-nexus-500/10 p-2 text-nexus-400 border border-nexus-500/20 mt-0.5">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-mono text-sm font-bold text-nexus-300">{a.alias}</div>
                    <div className="text-xs text-white/60 mt-0.5">{a.description}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                      {a.filter.capability && <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-white/70">cap: {a.filter.capability}</span>}
                      {a.filter.freeOnly && <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300 font-semibold">free-only</span>}
                      {a.filter.minContextWindow && a.filter.minContextWindow > 0 && (
                        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-white/70">ctx ≥ {a.filter.minContextWindow.toLocaleString()}</span>
                      )}
                      <span className="rounded-md border border-nexus-500/30 bg-nexus-500/10 px-2 py-0.5 text-nexus-300">rank: {a.ranking}</span>
                      {a.builtin && <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-cyan-300">builtin</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    onClick={() => resolveAlias(a.alias)}
                    disabled={resolvingAlias === a.alias}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition shadow-sm flex items-center gap-1.5 ${
                      resolvingAlias === a.alias
                        ? 'bg-nexus-700 opacity-80 cursor-wait'
                        : 'bg-nexus-600 hover:bg-nexus-500 active:scale-95'
                    }`}
                  >
                    {resolvingAlias === a.alias ? (
                      <>
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Resolving...
                      </>
                    ) : (
                      'Test Resolve'
                    )}
                  </button>
                  {!a.builtin && (
                    <button
                      onClick={() => deleteAlias(a.alias)}
                      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Resolution result */}
      {resolveResult && (
        <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-b from-emerald-950/30 to-black/80 p-5 backdrop-blur-2xl shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
              <Zap className="h-4 w-4 text-emerald-400" /> Live Resolution Result
            </h3>
            {resolvedAliasName && (
              <span className="font-mono text-xs text-nexus-300 bg-nexus-500/10 border border-nexus-500/20 px-2.5 py-0.5 rounded-full">
                {resolvedAliasName}
              </span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
            <div className="rounded-lg bg-black/40 p-2.5 border border-emerald-500/20">
              <span className="text-white/40 block text-[10px]">Resolved Model:</span>
              <span className="text-emerald-300 font-bold">{resolveResult.modelId}</span>
            </div>
            <div className="rounded-lg bg-black/40 p-2.5 border border-emerald-500/20">
              <span className="text-white/40 block text-[10px]">Provider:</span>
              <span className="text-white font-bold">{resolveResult.providerId}</span>
            </div>
            <div className="rounded-lg bg-black/40 p-2.5 border border-emerald-500/20">
              <span className="text-white/40 block text-[10px]">Candidates Scanned:</span>
              <span className="text-white font-bold">{resolveResult.candidateCount}</span>
            </div>
            <div className="rounded-lg bg-black/40 p-2.5 border border-emerald-500/20">
              <span className="text-white/40 block text-[10px]">Reasoning:</span>
              <span className="text-white/80">{resolveResult.reason}</span>
            </div>
          </div>
        </div>
      )}

      {/* Router Studio "Why" panel — explains the routing decision for the resolved model */}
      {resolveResult && explaining && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-xs text-white/50">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-transparent" />
            Analyzing routing decision…
          </div>
        </div>
      )}
      {explain && (
        <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-b from-cyan-950/20 to-black/70 p-5 backdrop-blur-2xl shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
              <Brain className="h-4 w-4 text-cyan-400" /> Why This Route?
            </h3>
            <span className="font-mono text-[10px] text-white/40">
              intent: {String((explain.intent as string) ?? 'n/a')} · conf:{' '}
              {typeof explain.confidence === 'number' ? Math.round((explain.confidence as number) * 100) : 'n/a'}%
            </span>
          </div>
          {explain.selectedCandidate ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono">
                {(() => {
                  const c = explain.selectedCandidate as {
                    finalScore: number;
                    breakdown: Record<string, number>;
                    explainability?: Record<string, string | undefined>;
                  };
                  const bd = c.breakdown ?? {};
                  const rows: [string, number | undefined][] = [
                    ['score', c.finalScore],
                    ['health', bd.healthScore ?? bd.health],
                    ['capability', bd.qualityScore ?? bd.capabilityMatch],
                    ['cost', bd.costScore ?? bd.cost],
                    ['latency', bd.latencyScore ?? bd.latency],
                  ];
                  return rows.map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-black/40 border border-cyan-500/15 p-2.5">
                      <span className="text-white/40 block text-[10px] capitalize">{k}</span>
                      <span className="text-cyan-300 font-bold">{typeof v === 'number' ? `${Math.round(v * 100)}%` : 'n/a'}</span>
                    </div>
                  ));
                })()}
              </div>
              {(() => {
                const sc = explain.selectedCandidate as { explainability?: Record<string, string | undefined> };
                const why = sc.explainability?.whySelected ?? sc.explainability?.whyRecovered;
                return why ? (
                  <div className="text-xs text-white/80 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5">
                    <span className="text-emerald-400 font-semibold">Selected because: </span>
                    {why}
                  </div>
                ) : null;
              })()}
              {Array.isArray(explain.topCandidates) && (explain.topCandidates as unknown[]).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Top alternatives</div>
                  <div className="space-y-1">
                    {(explain.topCandidates as { modelId: string; providerId: string; finalScore: number }[])
                      .slice(0, 4)
                      .map((c) => (
                        <div key={`${c.providerId}-${c.modelId}`} className="flex items-center justify-between text-xs font-mono bg-white/[0.02] border border-white/5 rounded px-2.5 py-1.5">
                          <span className="text-white/70">{c.modelId} <span className="text-white/30">· {c.providerId}</span></span>
                          <span className="text-cyan-300/80">{Math.round(c.finalScore * 100)}%</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 text-xs text-white/50">No candidate scored above threshold for this request context.</div>
          )}
        </div>
      )}
      {resolveError && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-4 backdrop-blur-xl">
          <div className="text-xs text-rose-300 font-mono">
            {resolvedAliasName ? `[${resolvedAliasName}] ` : ''}Error resolving alias: {resolveError}
          </div>
        </div>
      )}

      {/* Create custom alias */}
      <div className="rounded-2xl border border-nexus-500/30 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Plus className="h-4 w-4 text-nexus-400" /> Create Custom Virtual Model Alias
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">Alias Identifier</label>
            <input
              type="text"
              value={newAlias.alias}
              onChange={(e) => setNewAlias({ ...newAlias, alias: e.target.value })}
              placeholder="my-coding-route"
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">Description</label>
            <input
              type="text"
              value={newAlias.description}
              onChange={(e) => setNewAlias({ ...newAlias, description: e.target.value })}
              placeholder="Primary coding model route"
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">Required Capability</label>
            <select
              value={newAlias.capability}
              onChange={(e) => setNewAlias({ ...newAlias, capability: e.target.value })}
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white focus:border-nexus-500 focus:outline-none"
            >
              <option value="" className="bg-slate-900 text-white">Any Capability</option>
              <option value="toolCalling" className="bg-slate-900 text-white">Tool Calling</option>
              <option value="vision" className="bg-slate-900 text-white">Vision</option>
              <option value="reasoning" className="bg-slate-900 text-white">Reasoning</option>
              <option value="streaming" className="bg-slate-900 text-white">Streaming</option>
              <option value="jsonMode" className="bg-slate-900 text-white">JSON Mode</option>
              <option value="embeddings" className="bg-slate-900 text-white">Embeddings</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">Ranking Strategy</label>
            <select
              value={newAlias.ranking}
              onChange={(e) => setNewAlias({ ...newAlias, ranking: e.target.value })}
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white focus:border-nexus-500 focus:outline-none"
            >
              <option value="cheapest" className="bg-slate-900 text-white">Cheapest (Free First)</option>
              <option value="cheapest_capable" className="bg-slate-900 text-white">Cheapest Capable (multi-cap)</option>
              <option value="fastest" className="bg-slate-900 text-white">Fastest Response</option>
              <option value="highest_quality" className="bg-slate-900 text-white">Highest Quality</option>
              <option value="largest_context" className="bg-slate-900 text-white">Largest Context</option>
              <option value="most_capabilities" className="bg-slate-900 text-white">Most Capabilities</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-white/70 mb-1">Min Context Window (Tokens)</label>
            <input
              type="number"
              value={newAlias.minContextWindow}
              onChange={(e) => setNewAlias({ ...newAlias, minContextWindow: Number(e.target.value) })}
              placeholder="32768"
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="freeOnlyCheck"
              checked={newAlias.freeOnly}
              onChange={(e) => setNewAlias({ ...newAlias, freeOnly: e.target.checked })}
              className="h-4 w-4 rounded border-white/10 bg-white/5 text-nexus-600 focus:ring-nexus-500"
            />
            <label htmlFor="freeOnlyCheck" className="text-xs font-medium text-white/80 cursor-pointer">
              Enforce Free Models Only
            </label>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={createAlias}
            className="rounded-xl bg-nexus-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:bg-nexus-500 active:scale-95"
          >
            Create Cyber Alias
          </button>
          {createMsg && <span className="text-xs text-white/60">{createMsg}</span>}
        </div>
      </div>
    </div>
  );
}


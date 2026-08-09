'use client';

import { Settings2, Play, Zap, DollarSign, Eye, Brain, Gauge, Shuffle, ArrowRight } from 'lucide-react';
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

interface AliasResolution {
  modelId: string;
  providerId: string;
  reason: string;
  candidateCount: number;
}

export default function RouterStudioPage() {
  const { data: aliases } = useSWR<{ aliases: Alias[] }>('/api/v1/aliases', fetcher, { refreshInterval: 10000 });
  const [resolveResult, setResolveResult] = useState<AliasResolution | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState({
    alias: '',
    description: '',
    capability: '',
    freeOnly: false,
    minContextWindow: 0,
    ranking: 'cheapest' as string,
  });
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  async function resolveAlias(alias: string) {
    setResolveResult(null);
    setResolveError(null);
    try {
      const r = await fetch(`/api/v1/aliases/${encodeURIComponent(alias)}/resolve`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: { message: 'Resolution failed' } }));
        setResolveError(body?.error?.message ?? r.statusText);
        return;
      }
      const body = (await r.json()) as AliasResolution;
      setResolveResult(body);
    } catch (err) {
      setResolveError((err as Error).message);
    }
  }

  async function createAlias() {
    if (!newAlias.alias) {
      setCreateMsg('Alias name is required');
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
        description: newAlias.description || 'User-defined alias',
        filter,
        ranking: newAlias.ranking,
      }),
    });
    if (r.ok) {
      setCreateMsg(`Alias created: ${newAlias.alias}`);
      setNewAlias({ ...newAlias, alias: '', description: '' });
    } else {
      const body = await r.json().catch(() => ({ error: { message: 'Failed' } }));
      setCreateMsg(`Error: ${body?.error?.message ?? r.statusText}`);
    }
  }

  async function deleteAlias(alias: string) {
    if (!confirm(`Delete alias '${alias}'?`)) return;
    await fetch(`/api/v1/aliases/${encodeURIComponent(alias)}`, { method: 'DELETE' });
  }

  const rankingIcons: Record<string, typeof Zap> = {
    cheapest: DollarSign,
    fastest: Zap,
    highest_quality: Brain,
    largest_context: Eye,
    most_capabilities: Gauge,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings2 className="h-6 w-6 text-nexus-400" />
          Router Studio
        </h1>
        <p className="text-sm text-white/50">
          Configure virtual model routes and smart aliases. Aliases resolve dynamically at request time
          to the best currently-available model based on discovery data, health, and pricing.
        </p>
      </div>

      {/* Routing pipeline visualization */}
      <div className="card">
        <h2 className="mb-4 text-sm font-medium text-white/80">Routing Pipeline</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center min-w-[100px]">
            <Play className="mx-auto mb-1 h-3 w-3 text-nexus-400" />
            Request
          </div>
          <ArrowRight className="h-3 w-3 text-white/20" />
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center min-w-[100px]">
            Alias Resolution
          </div>
          <ArrowRight className="h-3 w-3 text-white/20" />
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center min-w-[100px]">
            Model Registry
          </div>
          <ArrowRight className="h-3 w-3 text-white/20" />
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center min-w-[100px]">
            <Shuffle className="mx-auto mb-1 h-3 w-3 text-nexus-400" />
            Routing Engine
          </div>
          <ArrowRight className="h-3 w-3 text-white/20" />
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center min-w-[100px]">
            Key Selection
          </div>
          <ArrowRight className="h-3 w-3 text-white/20" />
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-center min-w-[100px]">
            Provider
          </div>
        </div>
      </div>

      {/* Alias list */}
      <div className="card">
        <h2 className="mb-3 text-sm font-medium text-white/80">Registered Aliases ({aliases?.aliases?.length ?? 0})</h2>
        <div className="space-y-2">
          {(aliases?.aliases ?? []).map((a) => {
            const Icon = rankingIcons[a.ranking] ?? Zap;
            return (
              <div key={a.alias} className="flex items-center justify-between rounded-lg bg-white/[0.02] p-3">
                <div className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-nexus-400" />
                  <div>
                    <div className="font-mono text-sm font-medium text-nexus-300">{a.alias}</div>
                    <div className="text-xs text-white/40">{a.description}</div>
                    <div className="mt-1 flex gap-2 text-[10px] text-white/30">
                      {a.filter.capability && <span className="rounded bg-white/5 px-1">cap: {a.filter.capability}</span>}
                      {a.filter.freeOnly && <span className="rounded bg-emerald-600/20 px-1 text-emerald-300">free-only</span>}
                      {a.filter.minContextWindow && a.filter.minContextWindow > 0 && (
                        <span className="rounded bg-white/5 px-1">ctx ≥ {a.filter.minContextWindow}</span>
                      )}
                      <span className="rounded bg-white/5 px-1">rank: {a.ranking}</span>
                      {a.builtin && <span className="rounded bg-white/5 px-1">builtin</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => resolveAlias(a.alias)}
                    className="rounded-md bg-nexus-600/80 px-2 py-1 text-xs text-white hover:bg-nexus-500"
                  >
                    Resolve
                  </button>
                  {!a.builtin && (
                    <button
                      onClick={() => deleteAlias(a.alias)}
                      className="rounded-md bg-rose-600/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-600/30"
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
        <div className="card border-nexus-500/30">
          <h3 className="text-sm font-medium text-white/80">Resolution Result</h3>
          <div className="mt-2 space-y-1 text-sm">
            <div><span className="text-white/40">Model:</span> <code className="text-nexus-300">{resolveResult.modelId}</code></div>
            <div><span className="text-white/40">Provider:</span> {resolveResult.providerId}</div>
            <div><span className="text-white/40">Candidates:</span> {resolveResult.candidateCount}</div>
            <div><span className="text-white/40">Reason:</span> {resolveResult.reason}</div>
          </div>
        </div>
      )}
      {resolveError && (
        <div className="card border-rose-500/30">
          <div className="text-sm text-rose-300">{resolveError}</div>
        </div>
      )}

      {/* Create custom alias */}
      <div className="card">
        <h2 className="mb-3 text-sm font-medium text-white/80">Create Custom Alias</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-xs text-white/50">
            Alias name (local/ prefix auto-added)
            <input
              type="text"
              value={newAlias.alias}
              onChange={(e) => setNewAlias({ ...newAlias, alias: e.target.value })}
              placeholder="my-coding"
              className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/50">
            Description
            <input
              type="text"
              value={newAlias.description}
              onChange={(e) => setNewAlias({ ...newAlias, description: e.target.value })}
              placeholder="Best model for my use case"
              className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/50">
            Required capability
            <select
              value={newAlias.capability}
              onChange={(e) => setNewAlias({ ...newAlias, capability: e.target.value })}
              className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
            >
              <option value="">Any</option>
              <option value="toolCalling">Tool Calling</option>
              <option value="vision">Vision</option>
              <option value="reasoning">Reasoning</option>
              <option value="streaming">Streaming</option>
              <option value="jsonMode">JSON Mode</option>
              <option value="embeddings">Embeddings</option>
            </select>
          </label>
          <label className="text-xs text-white/50">
            Ranking strategy
            <select
              value={newAlias.ranking}
              onChange={(e) => setNewAlias({ ...newAlias, ranking: e.target.value })}
              className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
            >
              <option value="cheapest">Cheapest (free first)</option>
              <option value="fastest">Fastest</option>
              <option value="highest_quality">Highest Quality</option>
              <option value="largest_context">Largest Context</option>
              <option value="most_capabilities">Most Capabilities</option>
            </select>
          </label>
          <label className="text-xs text-white/50">
            Min context window (tokens)
            <input
              type="number"
              value={newAlias.minContextWindow}
              onChange={(e) => setNewAlias({ ...newAlias, minContextWindow: Number(e.target.value) })}
              placeholder="0"
              className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-white/50">
            <input
              type="checkbox"
              checked={newAlias.freeOnly}
              onChange={(e) => setNewAlias({ ...newAlias, freeOnly: e.target.checked })}
              className="h-4 w-4"
            />
            Free models only
          </label>
        </div>
        <button
          onClick={createAlias}
          className="mt-3 rounded-lg bg-nexus-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-nexus-500"
        >
          Create Alias
        </button>
        {createMsg && <div className="mt-2 text-xs text-white/60">{createMsg}</div>}
      </div>
    </div>
  );
}

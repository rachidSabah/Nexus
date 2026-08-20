'use client';

import {
  GitBranch,
  Plus,
  Trash2,
  Zap,
  Plug,
  CheckCircle2,
  XCircle,
  Loader2,
  Server,
} from 'lucide-react';
import { useState } from 'react';
import useSWR, { mutate } from 'swr';

import { etagFetcher } from '@/lib/etagFetcher';

interface AliasEntry {
  alias: string;
  description?: string;
  filter: { capability?: string; freeOnly?: boolean; minContextWindow?: number; providers?: string[] };
  ranking: string;
  builtin?: boolean;
}

interface ProviderEntry {
  id: string;
  name?: string;
  baseUrl?: string;
  health?: string;
  activeModelsCount?: number;
}

// The 9 ranking strategies the gateway supports (model-aliases.ts). Described
// so a human can pick one without reading source.
const STRATEGIES: { id: string; label: string; desc: string }[] = [
  { id: 'cheapest', label: 'Cheapest', desc: 'Lowest combined cost — free first.' },
  { id: 'cheapest_capable', label: 'Cheapest Capable', desc: 'Free-first, then lowest cost among capable models.' },
  { id: 'fastest', label: 'Fastest', desc: 'Lowest latency (from live key stats).' },
  { id: 'highest_quality', label: 'Highest Quality', desc: 'Most capabilities + largest context.' },
  { id: 'largest_context', label: 'Largest Context', desc: 'Biggest context window.' },
  { id: 'most_capabilities', label: 'Most Capabilities', desc: 'Highest count of capability flags.' },
  { id: 'balanced', label: 'Balanced', desc: 'Quality + cost blend (smart default).' },
  { id: 'least_loaded', label: 'Least Loaded', desc: 'Spread load across providers.' },
  { id: 'most_reliable', label: 'Most Reliable', desc: 'Prefer healthy, error-free models.' },
];

const CAPABILITIES = ['toolCalling', 'vision', 'reasoning', 'streaming', 'jsonMode', 'audio', 'embeddings'];

export default function PoliciesPage() {
  const { data: aliasesRes, error: aliasErr } = useSWR<{ aliases: AliasEntry[] }>('/api/v1/aliases', etagFetcher, {
    refreshInterval: 10_000,
  });
  const { data: providersRes, error: provErr } = useSWR<{ providers: ProviderEntry[] }>('/api/v1/providers', etagFetcher, {
    refreshInterval: 10_000,
  });

  const aliases = aliasesRes?.aliases ?? [];
  const providers = providersRes?.providers ?? [];

  return (
    <div className="space-y-6 relative pb-12 w-full max-w-full overflow-x-hidden">
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-emerald-600/10 blur-[120px]" />

      <div className="border-b border-white/10 pb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-400 backdrop-blur-md mb-2">
          <GitBranch className="h-3.5 w-3.5 animate-pulse text-emerald-300" /> Routing Policy Engine
        </div>
        <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          <Zap className="h-8 w-8 text-emerald-400" /> Policies &amp; Routing Rules
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-3xl">
          Compose routing rules visually. Each alias maps a stable name (e.g.{' '}
          <code className="rounded bg-black/30 px-1">local/coding</code>) to the best live model by filter + ranking
          strategy. Custom providers (self-hosted vLLM / Ollama / LM Studio, or any OpenAI-compatible base URL) are
          onboarded here too. All changes hit the real gateway API.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AliasPanel
          aliases={aliases}
          error={aliasErr}
          onChanged={() => {
            mutate('/api/v1/aliases');
          }}
        />
        <ProviderPanel
          providers={providers}
          error={provErr}
          onChanged={() => {
            mutate('/api/v1/providers');
          }}
        />
      </div>
    </div>
  );
}

function AliasPanel({ aliases, error, onChanged }: { aliases: AliasEntry[]; error?: unknown; onChanged: () => void }) {
  const [alias, setAlias] = useState('');
  const [desc, setDesc] = useState('');
  const [capability, setCapability] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [ranking, setRanking] = useState('cheapest');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function create() {
    if (!alias) {
      setMsg({ kind: 'err', text: 'Alias name is required (e.g. local/my-coding).' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/v1/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias,
          description: desc || 'User-defined alias',
          filter: { ...(capability ? { capability } : {}), freeOnly: freeOnly || undefined },
          ranking,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(j.error?.message ?? `HTTP ${res.status}`);
      }
      setAlias('');
      setDesc('');
      setCapability('');
      setFreeOnly(false);
      setMsg({ kind: 'ok', text: `Alias "${alias}" created.` });
      onChanged();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: string) {
    await fetch(`/api/v1/aliases/${encodeURIComponent(a)}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
        <GitBranch className="h-4 w-4 text-emerald-400" /> Model Aliases
      </div>

      <div className="mb-4 space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="local/my-coding"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-emerald-400/50"
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="description (optional)"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-emerald-400/50"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={capability}
            onChange={(e) => setCapability(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/50"
          >
            <option value="">any capability</option>
            {CAPABILITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={ranking}
            onChange={(e) => setRanking(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/50"
          >
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-[11px] text-white/60">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
            free-tier only
          </label>
          <button
            onClick={create}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create rule
          </button>
        </div>
        <p className="text-[10px] text-white/40">
          {STRATEGIES.find((s) => s.id === ranking)?.desc}
        </p>
        {msg && (
          <div className={`text-[11px] ${msg.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</div>
        )}
      </div>

      {error ? <div className="text-[11px] text-rose-300">Failed to load aliases.</div> : null}
      {aliases.length === 0 && !error && (
        <div className="text-[11px] text-white/40">No aliases yet. Built-in aliases (local/free, local/coding…) resolve automatically.</div>
      )}
      <div className="space-y-2">
        {aliases.map((a) => (
          <div key={a.alias} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-white/80">{a.alias}</span>
                {a.builtin && <span className="rounded bg-white/10 px-1 text-[9px] text-white/40">builtin</span>}
              </div>
              <div className="text-[10px] text-white/40">
                {a.filter?.freeOnly ? 'free · ' : ''}
                {a.filter?.capability ? `${a.filter.capability} · ` : ''}
                <span className="text-emerald-300/70">{a.ranking}</span>
              </div>
            </div>
            {!a.builtin && (
              <button onClick={() => remove(a.alias)} className="text-white/40 transition hover:text-rose-300" title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProviderPanel({ providers, error, onChanged }: { providers: ProviderEntry[]; error?: unknown; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function onboard() {
    if (!name || !baseUrl) {
      setProbe({ kind: 'err', text: 'Name and base URL are required.' });
      return;
    }
    setBusy(true);
    setProbe(null);
    try {
      const res = await fetch('/api/v1/providers/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: name, name, baseUrl, apiKey: apiKey || undefined }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(j.error?.message ?? `HTTP ${res.status}`);
      }
      setName('');
      setBaseUrl('');
      setApiKey('');
      setProbe({ kind: 'ok', text: `Provider "${name}" onboarded.` });
      onChanged();
    } catch (e) {
      setProbe({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/v1/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
        <Plug className="h-4 w-4 text-cyan-400" /> Providers (incl. self-hosted)
      </div>

      <div className="mb-4 space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ollama / vllm / my-proxy"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-emerald-400/50"
          />
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-emerald-400/50"
          />
        </div>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="api key (optional for local)"
          className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-emerald-400/50"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/40">OpenAI-compatible base URL. Local = no key.</span>
          <button
            onClick={onboard}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-500/30 transition hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Onboard
          </button>
        </div>
        {probe && <div className={`text-[11px] ${probe.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>{probe.text}</div>}
      </div>

      {error ? <div className="text-[11px] text-rose-300">Failed to load providers.</div> : null}
      {providers.length === 0 && !error && <div className="text-[11px] text-white/40">No providers registered.</div>}
      <div className="space-y-2">
        {providers.map((p) => {
          const healthy = p.health === 'healthy';
          return (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-white/40" />
                  <span className="font-mono text-[11px] text-white/80">{p.id}</span>
                  {healthy ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-rose-400" />}
                </div>
                <div className="truncate text-[10px] text-white/40">
                  {p.baseUrl ?? ''} · {p.activeModelsCount ?? 0} models
                </div>
              </div>
              <button onClick={() => remove(p.id)} className="text-white/40 transition hover:text-rose-300" title="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

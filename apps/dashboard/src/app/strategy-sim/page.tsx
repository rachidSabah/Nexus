'use client';

import { GitCompare, Sparkles, Filter, Trophy } from 'lucide-react';
import { useState } from 'react';

type Strategy =
  | 'cheapest'
  | 'cheapest_capable'
  | 'fastest'
  | 'highest_quality'
  | 'largest_context'
  | 'most_capabilities'
  | 'balanced'
  | 'least_loaded'
  | 'most_reliable';

const STRATEGIES: { id: Strategy; label: string; hint: string }[] = [
  { id: 'cheapest', label: 'Cheapest', hint: 'free first, then lowest $/1M' },
  { id: 'cheapest_capable', label: 'Cheapest Capable', hint: 'cheapest among required-capability set' },
  { id: 'fastest', label: 'Fastest', hint: 'lowest-cost proxy for latency' },
  { id: 'highest_quality', label: 'Highest Quality', hint: 'most capabilities + largest context' },
  { id: 'largest_context', label: 'Largest Context', hint: 'biggest context window' },
  { id: 'most_capabilities', label: 'Most Capabilities', hint: 'richest feature set' },
  { id: 'balanced', label: 'Balanced', hint: 'quality + cost blend (auto)' },
  { id: 'least_loaded', label: 'Least Loaded', hint: 'provider diversity' },
  { id: 'most_reliable', label: 'Most Reliable', hint: 'non-stale, error-free' },
];

interface CompareResult {
  filter: Record<string, unknown>;
  candidateCount: number;
  a: { strategy: Strategy; top: Array<{ modelId: string; providerId: string }> };
  b: { strategy: Strategy; top: Array<{ modelId: string; providerId: string }> };
}

export default function StrategySimPage() {
  const [strategyA, setStrategyA] = useState<Strategy>('cheapest');
  const [strategyB, setStrategyB] = useState<Strategy>('highest_quality');
  const [capability, setCapability] = useState<string>('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [data, setData] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/v1/routing/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyA,
          strategyB,
          filter: { capability: capability || undefined, freeOnly: freeOnly || undefined },
          topN: 5,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const aWinner = data?.a.top[0];
  const bWinner = data?.b.top[0];
  const sameWinner = !!aWinner && !!bWinner && aWinner.modelId === bWinner.modelId && aWinner.providerId === bWinner.providerId;

  return (
    <div className="space-y-6 relative pb-12 w-full max-w-full overflow-x-hidden">
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-purple-600/10 blur-[120px]" />

      <div className="border-b border-white/10 pb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-purple-400 backdrop-blur-md mb-2">
          <GitCompare className="h-3.5 w-3.5 animate-pulse text-purple-300" /> What-If Analysis
        </div>
        <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          <Sparkles className="h-8 w-8 text-purple-400" /> Strategy A/B Simulator
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-3xl">
          Rank the same live candidate pool under two routing strategies and compare the outcomes.
          Uses the real scoring engine and current model catalog — no fabricated results.
        </p>
      </div>

      {/* Controls */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <StrategySelect label="Strategy A" value={strategyA} onChange={setStrategyA} accent="emerald" />
          <StrategySelect label="Strategy B" value={strategyB} onChange={setStrategyB} accent="cyan" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[11px] text-white/60">
            <Filter className="h-4 w-4 text-white/40" /> Filter:
          </div>
          <select
            value={capability}
            onChange={(e) => setCapability(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/50 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-purple-500/50"
          >
            <option value="">any capability</option>
            <option value="toolCalling">toolCalling</option>
            <option value="vision">vision</option>
            <option value="reasoning">reasoning</option>
            <option value="streaming">streaming</option>
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-white/70">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} className="accent-purple-500" />
            free-tier only
          </label>
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/20 px-4 py-1.5 text-[11px] font-semibold text-purple-200 transition hover:bg-purple-500/30 disabled:opacity-40"
          >
            <GitCompare className="h-3.5 w-3.5" /> {busy ? 'Simulating…' : 'Run A/B'}
          </button>
        </div>
        {err && <div className="mt-2 text-[10px] text-rose-300">{err}</div>}
      </div>

      {/* Results */}
      {data && (
        <>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-[11px] text-white/50">
              <Trophy className="h-4 w-4 text-amber-400" />
              {data.candidateCount} candidates evaluated ·
              {sameWinner ? (
                <span className="font-semibold text-amber-300"> both strategies agree → {aWinner!.modelId}</span>
              ) : (
                <span className="font-semibold text-emerald-300"> strategies diverge</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Column title={`A · ${STRATEGIES.find((s) => s.id === data.a.strategy)?.label ?? data.a.strategy}`} accent="emerald" items={data.a.top} />
            <Column title={`B · ${STRATEGIES.find((s) => s.id === data.b.strategy)?.label ?? data.b.strategy}`} accent="cyan" items={data.b.top} />
          </div>
        </>
      )}
    </div>
  );
}

function StrategySelect({
  label,
  value,
  onChange,
  accent,
}: {
  label: string;
  value: Strategy;
  onChange: (s: Strategy) => void;
  accent: 'emerald' | 'cyan';
}) {
  const ring = accent === 'emerald' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-cyan-500/40 bg-cyan-500/10';
  return (
    <div className={`rounded-xl border ${ring} p-3`}>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Strategy)}
        className="w-full rounded-lg border border-white/15 bg-black/50 px-2 py-1.5 text-[12px] text-white/80 outline-none focus:border-purple-500/50"
      >
        {STRATEGIES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label} — {s.hint}
          </option>
        ))}
      </select>
    </div>
  );
}

function Column({
  title,
  accent,
  items,
}: {
  title: string;
  accent: 'emerald' | 'cyan';
  items: Array<{ modelId: string; providerId: string }>;
}) {
  const color = accent === 'emerald' ? 'text-emerald-400' : 'text-cyan-400';
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
      <div className={`mb-3 text-sm font-bold ${color}`}>{title}</div>
      {items.length === 0 && <div className="text-[11px] text-white/40">No candidates.</div>}
      <div className="space-y-2">
        {items.map((c, i) => (
          <div key={`${c.providerId}/${c.modelId}`} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
            <span className="text-[11px]">
              <span className={i === 0 ? `${color} font-bold` : 'text-white/40'}>#{i + 1}</span>{' '}
              <span className="font-mono text-white/80">{c.modelId}</span>
            </span>
            <span className="text-[10px] text-white/50">{c.providerId}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

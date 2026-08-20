'use client';

import { DollarSign, TrendingUp, AlertTriangle, Gauge, Activity } from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface UsageTotals {
  requestsTotal: number;
  requestsSuccess: number;
  requestsFailed: number;
  tokensInput: number;
  tokensOutput: number;
  tokensSaved: number;
  tokenSavingsPercent: number;
  uptime: number;
}

interface ProviderStat {
  providerId: string;
  healthy: boolean;
  endpointsCount: number;
  keysCount: number;
  activeKeys: number;
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  avgLatencyMs: number;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function CostBudgetPage() {
  const { data: usage } = useSWR<UsageTotals>('/api/v1/metrics/usage', fetcher, { refreshInterval: 8_000 });
  const { data: providersRes } = useSWR<{ providers: ProviderStat[] }>('/api/v1/metrics/providers', fetcher, {
    refreshInterval: 8_000,
  });

  const [tokenBudget, setTokenBudget] = useState<number>(0);
  const [showBudgetInput, setShowBudgetInput] = useState(false);

  const providers = providersRes?.providers ?? [];
  const realTotal = (usage?.tokensInput ?? 0) + (usage?.tokensOutput ?? 0);

  const budgetPct = useMemo(() => {
    if (!tokenBudget || tokenBudget <= 0) return null;
    return Math.min(100, Math.round((realTotal / tokenBudget) * 100));
  }, [realTotal, tokenBudget]);

  const overBudget = budgetPct !== null && budgetPct >= 100;
  const nearBudget = budgetPct !== null && budgetPct >= 80 && budgetPct < 100;

  return (
    <div className="space-y-6 relative pb-12 w-full max-w-full overflow-x-hidden">
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-amber-600/10 blur-[120px]" />

      <div className="border-b border-white/10 pb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-amber-400 backdrop-blur-md mb-2">
          <DollarSign className="h-3.5 w-3.5 animate-pulse text-amber-300" /> Spend Control
        </div>
        <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          <Gauge className="h-8 w-8 text-amber-400" /> Cost &amp; Budget Dashboard
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-3xl">
          Live token burn and request throughput from real gateway telemetry. Set a token budget to watch
          utilization and get an alert when you approach the ceiling.
        </p>
      </div>

      {/* Budget guard */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
            <TrendingUp className="h-4 w-4 text-amber-400" /> Token Budget Guard
          </div>
          {!showBudgetInput ? (
            <button
              type="button"
              onClick={() => setShowBudgetInput(true)}
              className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-500/25"
            >
              {tokenBudget > 0 ? 'Adjust Budget' : 'Set Token Budget'}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={1000}
                defaultValue={tokenBudget || 1_000_000}
                onBlur={(e) => {
                  setTokenBudget(Number(e.target.value) || 0);
                  setShowBudgetInput(false);
                }}
                className="w-32 rounded-lg border border-white/15 bg-black/50 px-2 py-1.5 text-[11px] font-mono text-white/80 outline-none focus:border-amber-500/50"
                placeholder="e.g. 1000000"
                autoFocus
              />
              <button
                type="button"
                onClick={() => {
                  setTokenBudget(0);
                  setShowBudgetInput(false);
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-white/60 hover:bg-white/10"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {tokenBudget > 0 ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-white/50">
                {fmtTokens(realTotal)} / {fmtTokens(tokenBudget)} tokens
              </span>
              <span className={`font-bold ${overBudget ? 'text-rose-400' : nearBudget ? 'text-amber-300' : 'text-emerald-400'}`}>
                {budgetPct}%
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${
                  overBudget ? 'bg-rose-500' : nearBudget ? 'bg-amber-400' : 'bg-emerald-500'
                }`}
                style={{ width: `${budgetPct ?? 0}%` }}
              />
            </div>
            {overBudget && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-300">
                <AlertTriangle className="h-3.5 w-3.5" /> Budget exceeded — {fmtTokens(realTotal - tokenBudget)} over ceiling
              </div>
            )}
            {nearBudget && !overBudget && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" /> Approaching budget ({budgetPct}%)
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 text-[11px] text-white/40">
            No budget set. The gauge below shows real cumulative token usage across the gateway&apos;s uptime.
          </div>
        )}
      </div>

      {/* Live totals */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={<Activity className="h-4 w-4 text-nexus-400" />} label="Requests" value={fmtTokens(usage?.requestsTotal ?? 0)} sub={`${usage?.requestsSuccess ?? 0} ok`} />
        <StatCard icon={<TrendingUp className="h-4 w-4 text-emerald-400" />} label="Tokens In" value={fmtTokens(usage?.tokensInput ?? 0)} sub="prompt" />
        <StatCard icon={<TrendingUp className="h-4 w-4 text-cyan-400" />} label="Tokens Out" value={fmtTokens(usage?.tokensOutput ?? 0)} sub="completion" />
        <StatCard icon={<DollarSign className="h-4 w-4 text-amber-400" />} label="Saved" value={fmtTokens(usage?.tokensSaved ?? 0)} sub={`${usage?.tokenSavingsPercent ?? 0}% opt`} />
        <StatCard icon={<Gauge className="h-4 w-4 text-rose-400" />} label="Errors" value={String(usage?.requestsFailed ?? 0)} sub="failed" />
      </div>

      {/* Per-provider breakdown */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="mb-3 text-xs font-bold uppercase tracking-wider text-white/70">Per-Provider Throughput</div>
        {providers.length === 0 && <div className="text-[11px] text-white/40">No provider telemetry yet.</div>}
        <div className="space-y-2">
          {providers.map((p) => {
            const max = Math.max(1, ...providers.map((x) => x.totalTokens));
            const pct = Math.round((p.totalTokens / max) * 100);
            return (
              <div key={p.providerId} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[11px] font-semibold text-white/80">
                    <span className={`h-2 w-2 rounded-full ${p.healthy ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    {p.providerId}
                  </span>
                  <span className="font-mono text-[11px] text-white/60">{fmtTokens(p.totalTokens)} tok</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-nexus-500/70" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-white/40">
                  <span>{p.totalRequests} req</span>
                  <span>{p.activeKeys}/{p.keysCount} keys</span>
                  <span>{p.totalErrors} err</span>
                  <span>{p.avgLatencyMs}ms avg</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-white/50">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span></div>
      <div className="mt-2 font-mono text-xl font-bold text-white">{value}</div>
      <div className="text-[10px] text-white/40">{sub}</div>
    </div>
  );
}

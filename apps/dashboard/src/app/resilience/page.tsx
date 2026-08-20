'use client';

import { ShieldCheck, Activity, Terminal, GitBranch, AlertTriangle, CheckCircle2, XCircle, Loader2, Radio } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { etagFetcher } from '@/lib/etagFetcher';

interface LiveEvent {
  id: number;
  type: string;
  at: number;
  text: string;
}

interface ProviderMetric {
  endpointCount: number;
  healthy: number;
  degraded: number;
  open: number;
  keys: number;
  activeKeys: number;
  cooldownKeys: number;
  invalidKeys: number;
  totalRequests: number;
  totalTokens: number;
  totalErrors: number;
  rateLimitedCount: number;
  avgLatencyMs: number;
}

interface DetachedTask {
  id: string;
  model: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
}

interface ExecutionStep {
  agentId: string;
  status: string;
  error?: string;
}

interface Execution {
  id: string;
  status: string;
  steps?: ExecutionStep[];
}

function timeAgo(ts: number | undefined): string {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function summarizeEvent(type: string, payload: Record<string, unknown>): string {
  const p = payload ?? {};
  if (/circuit/.test(type)) {
    const ep = p.endpointId ?? p.providerId ?? '?';
    return `circuit ${p.open ? 'OPEN' : 'closed'} → ${ep}`;
  }
  if (/failover/.test(type)) {
    return `failover: ${p.from ?? p.providerId ?? '?'} → ${p.to ?? '?'}`;
  }
  if (/provider\.onboarded|endpoint\.added/.test(type)) {
    return `endpoint ready: ${p.displayName ?? p.providerId ?? '?'}`;
  }
  if (/rate.?limit/.test(type)) {
    return `rate-limit cooldown: ${p.providerId ?? p.keyId ?? '?'}`;
  }
  if (/token/.test(type)) {
    return `tokens: +${p.savedTokens ?? p.processed ?? '?'} (${p.mode ?? type})`;
  }
  if (/anomaly/.test(type)) {
    return `anomaly: ${p.kind ?? type}`;
  }
  return '';
}

export default function ResiliencePage() {
  const { data: metrics } = useSWR<{ byProvider?: Record<string, ProviderMetric> }>(
    '/api/v1/metrics',
    etagFetcher,
    { refreshInterval: 8_000 },
  );
  const { data: tasksRes } = useSWR<{ tasks: DetachedTask[] }>('/api/v1/tasks', etagFetcher, {
    refreshInterval: 6_000,
  });
  const { data: execRes } = useSWR<{ executions: Execution[] }>('/api/v1/agents/executions?limit=20', etagFetcher, {
    refreshInterval: 10_000,
  });

  // ── Live SSE telemetry (real-time ops console) ──────────────────────
  // Subscribes to the gateway's unified event stream. Existing polls remain
  // as a guaranteed fallback; SSE adds the live, push-based event feed so
  // circuit-open / failover / token-burn updates appear instantly.
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [liveConnected, setLiveConnected] = useState(false);
  const evId = useRef(0);
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/v1/system/events');
      es.onopen = () => setLiveConnected(true);
      es.onerror = () => setLiveConnected(false);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (!data || typeof data !== 'object') return;
          const type = String(data.type ?? 'event');
          // Only surface operational-resilience-relevant events.
          if (!/circuit|failover|provider|endpoint|token|rate.?limit|anomaly/i.test(type)) return;
          const payload = data.payload ?? data;
          const text = summarizeEvent(type, payload);
          if (!text) return;
          setLiveEvents((prev) => [{ id: evId.current++, type, at: Date.now(), text }, ...prev].slice(0, 12));
        } catch {
          /* ignore malformed frame */
        }
      };
    } catch {
      setLiveConnected(false);
    }
    return () => {
      es?.close();
      setLiveConnected(false);
    };
  }, []);

  const byProvider = metrics?.byProvider ?? {};

  const providers = Object.entries(byProvider);
  const circuitOpen = providers.filter(([, p]) => p.open > 0);
  const degraded = providers.filter(([, p]) => p.degraded > 0);
  const tasks = tasksRes?.tasks ?? [];
  const executions = execRes?.executions ?? [];

  const totalErrors = providers.reduce((s, [, p]) => s + p.totalErrors, 0);
  const totalRateLimited = providers.reduce((s, [, p]) => s + p.rateLimitedCount, 0);

  return (
    <div className="space-y-6 relative pb-12 w-full max-w-full overflow-x-hidden">
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-emerald-600/10 blur-[120px]" />

      <div className="border-b border-white/10 pb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-emerald-400 backdrop-blur-md mb-2">
          <ShieldCheck className="h-3.5 w-3.5 animate-pulse text-emerald-300" /> Operational Resilience
          <span className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] ${liveConnected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/40'}`}>
            <Radio className="h-2.5 w-2.5" /> {liveConnected ? 'LIVE' : 'POLL'}
          </span>
        </div>
        <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          <Activity className="h-8 w-8 text-emerald-400" /> Agent Health &amp; Resilience Board
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-3xl">
          Live circuit-breaker state, detached long-task runs, and orchestrated-agent failovers — all
          from real gateway telemetry.
        </p>
      </div>

      {/* Live SSE event feed */}
      <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4 backdrop-blur-xl">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
            <Radio className={`h-4 w-4 ${liveConnected ? 'animate-pulse text-emerald-300' : 'text-white/30'}`} /> Live Event Stream
          </div>
          <span className="text-[10px] text-white/40">{liveConnected ? 'SSE connected' : 'polling fallback'}</span>
        </div>
        {liveEvents.length === 0 ? (
          <div className="text-[11px] text-white/40">Listening for circuit / failover / token events…</div>
        ) : (
          <div className="space-y-1 font-mono text-[10px] text-white/60">
            {liveEvents.map((ev) => (
              <div key={ev.id} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                <span className="text-emerald-300/80">{ev.type}</span>
                <span className="truncate">{ev.text}</span>
                <span className="ml-auto shrink-0 text-white/30">{timeAgo(ev.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} label="Circuit Open" value={String(circuitOpen.length)} tone={circuitOpen.length ? 'amber' : 'ok'} sub="providers tripped" />
        <SummaryCard icon={<AlertTriangle className="h-4 w-4 text-amber-400" />} label="Degraded" value={String(degraded.length)} tone={degraded.length ? 'amber' : 'ok'} sub="providers" />
        <SummaryCard icon={<XCircle className="h-4 w-4 text-rose-400" />} label="Total Errors" value={String(totalErrors)} tone={totalErrors > 0 ? 'amber' : 'ok'} sub="across providers" />
        <SummaryCard icon={<GitBranch className="h-4 w-4 text-cyan-400" />} label="Rate Limited" value={String(totalRateLimited)} tone={totalRateLimited > 0 ? 'amber' : 'ok'} sub="key cooldowns" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Circuit / provider health */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
            <ShieldCheck className="h-4 w-4 text-emerald-400" /> Circuit &amp; Endpoint Health
          </div>
          {providers.length === 0 && <div className="text-[11px] text-white/40">No provider telemetry.</div>}
          <div className="space-y-2">
            {providers.map(([pid, p]) => {
              const tripped = p.open > 0;
              const deg = p.degraded > 0;
              return (
                <div key={pid} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[11px] font-semibold text-white/80">
                      <span className={`h-2 w-2 rounded-full ${tripped ? 'bg-rose-400' : deg ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                      {pid}
                    </span>
                    <span className="text-[10px] text-white/40">
                      {p.healthy}/{p.endpointCount} ok
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-white/40">
                    {tripped && <span className="text-rose-300">circuit_open ({p.open})</span>}
                    {deg && <span className="text-amber-300">degraded ({p.degraded})</span>}
                    <span>{p.activeKeys}/{p.keys} keys</span>
                    <span>{p.totalErrors} err</span>
                    <span>{p.rateLimitedCount} rl</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detached tasks */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
            <Terminal className="h-4 w-4 text-cyan-400" /> Detached Tasks
          </div>
          {tasks.length === 0 && <div className="text-[11px] text-white/40">No detached tasks running.</div>}
          <div className="space-y-2">
            {tasks.slice(0, 12).map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                <span className="flex items-center gap-2 text-[11px]">
                  <StatusDot status={t.status} />
                  <span className="font-mono text-white/70 truncate">{t.model}</span>
                </span>
                <span className="text-[10px] text-white/40">{timeAgo(t.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Orchestrated executions / failovers */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
            <GitBranch className="h-4 w-4 text-purple-400" /> Agent Executions
          </div>
          {executions.length === 0 && <div className="text-[11px] text-white/40">No orchestrated executions.</div>}
          <div className="space-y-2">
            {executions.slice(0, 12).map((e) => {
              const fails = (e.steps ?? []).filter((s) => s.status === 'failed' || s.error).length;
              return (
                <div key={e.id} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-white/70">{e.id}</span>
                    <span className={`text-[10px] font-bold ${e.status === 'completed' ? 'text-emerald-400' : e.status === 'failed' ? 'text-rose-400' : 'text-cyan-300'}`}>
                      {e.status}
                    </span>
                  </div>
                  {fails > 0 && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-300">
                      <AlertTriangle className="h-3 w-3" /> {fails} failover step(s)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, tone, sub }: { icon: React.ReactNode; label: string; value: string; tone: 'ok' | 'amber'; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-white/50">{icon}<span className="text-[10px] uppercase tracking-wider">{label}</span></div>
      <div className={`mt-2 font-mono text-xl font-bold ${tone === 'amber' ? 'text-amber-300' : 'text-white'}`}>{value}</div>
      <div className="text-[10px] text-white/40">{sub}</div>
    </div>
  );
}

function StatusDot({ status }: { status: DetachedTask['status'] }) {
  if (status === 'running') return <Loader2 className="h-3 w-3 animate-spin text-sky-400" />;
  if (status === 'completed') return <CheckCircle2 className="h-3 w-3 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="h-3 w-3 text-rose-400" />;
  return <span className="h-3 w-3 rounded-full bg-white/30" />;
}

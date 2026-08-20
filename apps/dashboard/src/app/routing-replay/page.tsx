'use client';

import {
  History,
  ArrowRight,
  Trophy,
  GitBranch,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TraceAttempt {
  attempt: number;
  endpointId: string;
  providerId: string;
  keyId?: string;
  status: number;
  latencyMs: number;
  error?: string;
  failureReason?: string;
}

interface RequestTrace {
  requestId: string;
  receivedAt: number;
  completedAt?: number;
  requestedModel: string;
  resolvedModel?: string;
  aliasResolution?: { reason: string; candidateCount: number };
  routingDecision?: { endpointId: string; providerId: string; alternativesCount: number; strategy: string };
  attempts: TraceAttempt[];
  cacheHit: boolean;
  semanticCacheHit: boolean;
  totalLatencyMs: number;
  ttftMs?: number;
  tokensUsed?: { input: number; output: number; total: number };
  costUsd?: number;
  status: 'success' | 'failed' | 'cached';
  error?: string;
}

interface ExplainCandidate {
  modelId: string;
  providerId: string;
  finalScore: number;
  reasons: string[];
  explainability: string;
  breakdown?: Record<string, number>;
}

interface ExplainResponse {
  selectedModel: string;
  provider: string;
  score: number;
  candidateCount: number;
  topCandidates: ExplainCandidate[];
  fallbackPath: Array<{ modelId: string; providerId: string; score: number; reasons: string[] }>;
  decisionExplanation: string;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function statusColor(status: RequestTrace['status']): string {
  if (status === 'success') return 'text-emerald-400';
  if (status === 'cached') return 'text-cyan-400';
  return 'text-rose-400';
}

export default function RoutingReplayPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: tracesRes, isLoading } = useSWR<{ traces: RequestTrace[] }>(
    '/api/v1/traces?limit=100',
    fetcher,
    { refreshInterval: 10_000 },
  );

  const traces = useMemo(() => tracesRes?.traces ?? [], [tracesRes]);

  const selected = traces.find((t) => t.requestId === selectedId) ?? null;
  // Re-run the live scoring engine against the trace's requested model to
  // show the CURRENT candidate ranking (real ScoringEngine, real catalog).
  const { data: explain } = useSWR<ExplainResponse>(
    selected ? `/api/v1/routing/explain?model=${encodeURIComponent(selected.resolvedModel ?? selected.requestedModel)}` : null,
    fetcher,
    { keepPreviousData: true },
  );

  return (
    <div className="space-y-6 relative pb-12 w-full max-w-full overflow-x-hidden">
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />

      <div className="border-b border-white/10 pb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
          <History className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Routing Observability
        </div>
        <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          <GitBranch className="h-8 w-8 text-nexus-400" /> Routing Decision Replay
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-3xl">
          Inspect every past routing decision — the actual winner, the real fallback attempts, and why
          the scoring engine would pick today. Click a trace to replay it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* LEFT: trace list */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-white/70">Request Traces</span>
            <span className="text-[10px] text-white/40">{traces.length} recent</span>
          </div>
          {isLoading && traces.length === 0 && (
            <div className="py-10 text-center text-xs text-white/40">Loading traces…</div>
          )}
          {!isLoading && traces.length === 0 && (
            <div className="py-10 text-center text-xs text-white/40">
              No traces yet. Send a request through the gateway to populate the replay log.
            </div>
          )}
          <div className="space-y-2">
            {traces.map((t) => (
              <button
                key={t.requestId}
                type="button"
                onClick={() => setSelectedId(t.requestId)}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                  selectedId === t.requestId
                    ? 'border-nexus-500/50 bg-nexus-500/10'
                    : 'border-white/10 bg-black/30 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-nexus-300 truncate">{t.requestId}</span>
                  <span className={`text-[10px] font-bold uppercase ${statusColor(t.status)}`}>{t.status}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/50">
                  <span>{fmtTime(t.receivedAt)}</span>
                  <span className="font-mono text-white/70">{t.resolvedModel ?? t.requestedModel}</span>
                  <span className="inline-flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" /> {t.routingDecision?.providerId ?? '—'}
                  </span>
                  <span>{t.attempts.length} attempt(s)</span>
                  {typeof t.costUsd === 'number' && <span className="text-amber-300/80">${t.costUsd.toFixed(4)}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT: replay detail */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
          {!selected && (
            <div className="py-16 text-center text-xs text-white/40">Select a trace to replay its routing decision.</div>
          )}
          {selected && (
            <div className="space-y-5">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/70">Trace</div>
                <div className="mt-1 font-mono text-[11px] text-nexus-300">{selected.requestId}</div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  <div className="text-white/50">Requested: <span className="font-mono text-white/70">{selected.requestedModel}</span></div>
                  <div className="text-white/50">Resolved: <span className="font-mono text-white/70">{selected.resolvedModel ?? '—'}</span></div>
                  <div className="text-white/50">Latency: <span className="font-mono text-white/70">{selected.totalLatencyMs}ms</span></div>
                  <div className="text-white/50">TTFT: <span className="font-mono text-white/70">{selected.ttftMs ?? '—'}ms</span></div>
                </div>
              </div>

              {/* Real attempt / fallback sequence */}
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
                  <GitBranch className="h-4 w-4 text-nexus-400" /> Fallback Attempts (real)
                </div>
                <div className="mt-2 space-y-2">
                  {selected.attempts.length === 0 && (
                    <div className="text-[11px] text-white/40">Single-shot success — no fallbacks needed.</div>
                  )}
                  {selected.attempts.map((a) => (
                    <div key={a.attempt} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-white/80">
                          #{a.attempt} → {a.providerId}/{a.endpointId}
                        </span>
                        {a.status >= 200 && a.status < 300 ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-400">
                            <XCircle className="h-3 w-3" /> {a.status || 'ERR'}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-white/50">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {a.latencyMs}ms</span>
                        {a.keyId && <span className="font-mono">key:{a.keyId}</span>}
                        {a.failureReason && <span className="text-amber-300/80">{a.failureReason}</span>}
                      </div>
                      {a.error && <div className="mt-1 truncate font-mono text-[10px] text-rose-300/70">{a.error}</div>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Live scoring replay */}
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/70">
                  <Trophy className="h-4 w-4 text-amber-400" /> Live Scoring Replay (current catalog)
                </div>
                {!explain && <div className="mt-2 text-[11px] text-white/40">Computing candidate ranking…</div>}
                {explain && (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                      {explain.decisionExplanation}
                    </div>
                    <div className="text-[10px] text-white/40">
                      Top {explain.topCandidates.length} of {explain.candidateCount} evaluated candidates:
                    </div>
                    {explain.topCandidates.map((c, i) => (
                      <div key={`${c.providerId}/${c.modelId}`} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-white/80">
                            <span className={i === 0 ? 'text-emerald-400' : 'text-white/40'}>#{i + 1}</span>{' '}
                            {c.modelId} <span className="text-white/40">@ {c.providerId}</span>
                          </span>
                          <span className="font-mono text-[11px] text-nexus-300">{c.finalScore.toFixed(2)}</span>
                        </div>
                        {c.reasons?.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {c.reasons.slice(0, 4).map((r, ri) => (
                              <span key={ri} className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/60">{r}</span>
                            ))}
                          </div>
                        )}
                        {i === 0 && c.explainability && (
                          <div className="mt-1 text-[10px] text-emerald-300/80">{c.explainability}</div>
                        )}
                      </div>
                    ))}
                    {explain.fallbackPath.length > 0 && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-white/40">
                        <AlertTriangle className="h-3 w-3 text-amber-400" /> Fallback path: {explain.fallbackPath.map((f) => f.modelId).join(' → ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

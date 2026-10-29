'use client';

import { Bot, CheckCircle2, ClipboardCheck, Radar, RefreshCw, Server, ShieldAlert, Tags } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { describeError, postAction, type ActionFailure } from '@/lib/actionFeedback';
import { etagFetcher } from '@/lib/etagFetcher';

/* The intelligence API serves data the system never invents: every number
 * comes from discovered, verified or approval-gated records — the empty
 * states below are honest (operators see "no verified data yet" rather
 * than zero-filled placeholders). */

interface IntelligenceOverview {
  discoveredModels: number;
  verifiedEndpoints: number;
  pendingApprovals: number;
  openSecurityFindings: number;
  providersCount: number;
  freeAccessModels: number;
  staleRecords: number;
  degradedConnectors: number;
  lastDiscoveryAt?: string;
  generatedAt: string;
}

interface IntelligenceHealth {
  subsystem: 'discovery';
  status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'ERROR';
  healthy: boolean;
  message: string;
  metrics: Record<string, unknown>;
  remediation?: string;
}

interface ConnectorHealth {
  id: string;
  status: string;
  authority: number;
  lastRunAt?: string;
  lastError?: string;
  consecutiveFailures: number;
}

interface ProviderModelRecord {
  id: string;
  providerId: string;
  providerModelId: string;
  displayName?: string;
  lifecycle: string;
  availabilityStatus: string;
  pricingStatus: string;
  capabilities: Record<string, boolean | undefined>;
  confidence: number;
  lastVerifiedAt?: string;
}

interface FindingRecord {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status: string;
  excerpt: string;
  sourceRef: string;
  lastSeenAt: string;
}

interface JobRecord {
  id: string;
  connectorId: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead';
  attempts: number;
  scheduledAt: string;
  error?: string;
}

function sevClass(severity: FindingRecord['severity']): string {
  if (severity === 'critical') return 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40';
  if (severity === 'high') return 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/40';
  if (severity === 'medium') return 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40';
  return 'bg-white/10 text-white/70 ring-1 ring-white/20';
}

function lifecycleClass(lifecycle: string): string {
  if (lifecycle === 'verified' || lifecycle === 'approved' || lifecycle === 'active') {
    return 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40';
  }
  if (lifecycle === 'restricted' || lifecycle === 'rejected') {
    return 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40';
  }
  if (lifecycle === 'stale') return 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40';
  return 'bg-white/10 text-white/70 ring-1 ring-white/20';
}

export default function ProviderIntelligencePage() {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const {
    data: overview,
    error: overviewError,
    mutate: mutateOverview,
  } = useSWR<IntelligenceOverview>(
    '/api/v1/intelligence/overview',
    etagFetcher,
    { refreshInterval: 15_000 },
  );
  const { data: health } = useSWR<IntelligenceHealth>('/api/v1/intelligence/health', etagFetcher, {
    refreshInterval: 15_000,
  });
  const { data: connectors } = useSWR<ConnectorHealth[]>('/api/v1/intelligence/connectors', etagFetcher, {
    refreshInterval: 15_000,
  });
  const { data: models } = useSWR<ProviderModelRecord[]>('/api/v1/intelligence/models?limit=100', etagFetcher, {
    refreshInterval: 15_000,
  });
  const { data: findings, mutate: mutateFindings } = useSWR<FindingRecord[]>(
    '/api/v1/intelligence/security/findings?limit=100',
    etagFetcher,
    { refreshInterval: 15_000 },
  );
  const { data: jobs, mutate: mutateJobs } = useSWR<JobRecord[]>('/api/v1/intelligence/jobs?limit=50', etagFetcher, {
    refreshInterval: 10_000,
  });

  const runDiscovery = async (connectorId?: string) => {
    setActionLoading(connectorId ?? 'run');
    const failure = await postAction(
      '/api/v1/intelligence/jobs/run',
      connectorId ? { connectorId } : {},
      'Discovery run failed',
    );
    setFailure(failure);
    await Promise.all([mutateOverview(), mutateJobs()]);
    setActionLoading(null);
  };

  const verifyModel = async (id: string) => {
    setActionLoading(id);
    const failure = await postAction(
      '/api/v1/intelligence/verification/run',
      { kind: 'provider_model', id },
      'Verification failed',
    );
    setFailure(failure);
    await mutateOverview();
    setActionLoading(null);
  };

  const resolveFinding = async (id: string) => {
    setActionLoading(id);
    const failure = await postAction(
      `/api/v1/intelligence/security/findings/${id}/status`,
      { status: 'resolved' },
      'Finding update failed',
    );
    setFailure(failure);
    await mutateFindings();
    setActionLoading(null);
  };

  const statCards: Array<{ icon: typeof Radar; label: string; value: number; hint?: string }> = [
    { label: 'Discovered models', value: overview?.discoveredModels ?? 0, hint: `${overview?.providersCount ?? 0} provider(s)`, icon: Bot },
    { label: 'Verified endpoints', value: overview?.verifiedEndpoints ?? 0, icon: Server },
    { label: 'Pending approvals', value: overview?.pendingApprovals ?? 0, hint: 'Human gate required', icon: ClipboardCheck },
    { label: 'Open findings', value: overview?.openSecurityFindings ?? 0, icon: ShieldAlert },
    { label: 'Free-tier models', value: overview?.freeAccessModels ?? 0, hint: 'documented plans only', icon: Tags },
    { label: 'Stale records', value: overview?.staleRecords ?? 0, icon: RefreshCw },
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-2">
            <Radar className="h-3.5 w-3.5 text-cyan-400" /> Provider Intelligence OS
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            AI Provider Intelligence
          </h1>
          <p className="mt-1 text-sm text-white/60">
            Continuous provider/model discovery, redaction-first evidence, independent verification dimensions and a
            hash-bound human approval gate before anything reaches production routing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runDiscovery()}
            disabled={actionLoading !== null}
            className="pill bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            <Radar className="h-3.5 w-3.5" /> {actionLoading === 'run' ? 'Running…' : 'Run discovery'}
          </button>
          <button
            onClick={() => mutateOverview()}
            className="pill bg-white/5 text-white/70 ring-1 ring-white/15 hover:bg-white/10"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Failure banners — actions and reads never fail silently */}
      {failure && (
        <div className="card border-l-4 border-l-rose-500">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-rose-300">
                <ShieldAlert className="h-4 w-4" /> {failure.title}
              </div>
              <div className="mt-1 text-xs text-white/60">{failure.detail}</div>
            </div>
            <button
              onClick={() => setFailure(null)}
              className="text-xs text-white/40 hover:text-white/80 whitespace-nowrap"
            >
              dismiss
            </button>
          </div>
        </div>
      )}
      {overviewError && (
        <div className="card border-l-4 border-l-amber-500 text-xs text-white/60">
          Gateway data unreachable — <span className="text-white/40">{describeError(overviewError)}</span>.{' '}
          The dashboard proxies <span className="font-mono">/api/*</span> to{' '}
          <span className="font-mono text-white/80">NEXUS_GATEWAY_URL</span> (default{' '}
          <span className="font-mono">http://127.0.0.1:8787</span>): check the gateway is running, the URL matches, and
          that this install allows unauthenticated management access (open install).
        </div>
      )}

      {/* Health banner */}
      {health && (
        <div
          className={`card flex flex-col gap-1 border-l-4 ${
            health.status === 'HEALTHY'
              ? 'border-l-emerald-500'
              : health.status === 'DEGRADED'
                ? 'border-l-amber-500'
                : 'border-l-rose-500'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-white/50">Discovery health</span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                health.healthy
                  ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40'
              }`}
            >
              {health.healthy ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
              {health.status}
            </span>
          </div>
          <div className="text-sm text-white/80">{health.message}</div>
          {health.remediation && <div className="text-xs text-white/40">{health.remediation}</div>}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="card">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase text-white/50">{s.label}</span>
                <Icon className="h-4 w-4 text-cyan-400/70" />
              </div>
              <div className="mt-3 text-2xl font-bold text-white">{s.value}</div>
              {s.hint && <div className="mt-1 text-xs text-white/40">{s.hint}</div>}
            </div>
          );
        })}
      </div>

      {/* Connectors */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-white/50 mb-3">Connectors</h2>
        {(connectors ?? []).length === 0 ? (
          <div className="card text-sm text-white/40">No connectors registered.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(connectors ?? []).map((c) => (
              <div key={c.id} className="card">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-white">{c.id}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      c.status === 'healthy'
                        ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                        : c.status === 'blocked'
                          ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
                          : 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40'
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="mt-2 text-xs text-white/40">
                  authority {c.authority.toFixed(2)}
                  {c.consecutiveFailures > 0 && ` · ${c.consecutiveFailures} failure(s)`}
                  {c.lastRunAt && ` · last run ${new Date(c.lastRunAt).toLocaleTimeString()}`}
                </div>
                {c.lastError && <div className="mt-1 text-xs text-rose-400/80 truncate">{c.lastError}</div>}
                <button
                  onClick={() => runDiscovery(c.id)}
                  disabled={actionLoading !== null}
                  className="pill mt-3 bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  <Radar className="h-3 w-3" /> {actionLoading === c.id ? 'Running…' : 'Run connector'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Models table */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-white/50 mb-3">Model catalog</h2>
        {(models ?? []).length === 0 ? (
          <div className="card text-sm text-white/40">No verified data yet — run a discovery connector above.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-white/40 border-b border-white/10">
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Lifecycle</th>
                  <th className="py-2 pr-3">Availability</th>
                  <th className="py-2 pr-3">Pricing</th>
                  <th className="py-2 pr-3">Conf.</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(models ?? []).slice(0, 50).map((m) => (
                  <tr key={m.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-white/70">{m.providerId}</td>
                    <td className="py-2 pr-3 text-white">{m.displayName ?? m.providerModelId}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${lifecycleClass(m.lifecycle)}`}>
                        {m.lifecycle}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-white/50">{m.availabilityStatus}</td>
                    <td className="py-2 pr-3 text-xs text-white/50">{m.pricingStatus}</td>
                    <td className="py-2 pr-3 text-xs text-white/70">{m.confidence.toFixed(0)}</td>
                    <td className="py-2 pr-3">
                      <button
                        onClick={() => verifyModel(m.id)}
                        disabled={actionLoading !== null}
                        className="text-xs text-cyan-300 hover:text-cyan-200 disabled:opacity-40"
                      >
                        {actionLoading === m.id ? 'verifying…' : 'verify'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Findings */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-white/50 mb-3">
            Security findings <span className="text-white/30">(redacted metadata only)</span>
          </h2>
          {(findings ?? []).length === 0 ? (
            <div className="card text-sm text-white/40">No findings recorded.</div>
          ) : (
            <div className="space-y-2">
              {(findings ?? []).slice(0, 10).map((f) => (
                <div key={f.id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${sevClass(f.severity)}`}>
                          {f.severity}
                        </span>
                        <span className="text-sm text-white truncate">{f.title}</span>
                      </div>
                      <div className="mt-1 text-xs text-white/40 line-clamp-2">{f.excerpt}</div>
                    </div>
                    {f.status === 'open' && (
                      <button
                        onClick={() => resolveFinding(f.id)}
                        disabled={actionLoading !== null}
                        className="text-xs text-cyan-300 hover:text-cyan-200 whitespace-nowrap disabled:opacity-40"
                      >
                        {actionLoading === f.id ? '…' : 'mark resolved'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent jobs */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-white/50 mb-3">Recent jobs</h2>
          {(jobs ?? []).length === 0 ? (
            <div className="card text-sm text-white/40">No discovery jobs yet.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-white/40 border-b border-white/10">
                    <th className="py-2 pr-3">Connector</th>
                    <th className="py-2 pr-3">Kind</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {(jobs ?? []).slice(0, 15).map((j) => (
                    <tr key={j.id} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs text-white/70">{j.connectorId}</td>
                      <td className="py-2 pr-3 text-xs text-white/50">{j.kind}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            j.status === 'succeeded'
                              ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                              : j.status === 'queued' || j.status === 'running'
                                ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40'
                                : j.status === 'dead'
                                  ? 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40'
                                  : 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
                          }`}
                        >
                          {j.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-white/50">
                        {j.attempts}
                        {j.error && <div className="text-rose-400/70 truncate max-w-40">{j.error}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

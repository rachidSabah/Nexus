'use client';

import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Clock,
  Flame,
  Activity,
  Wrench,
  Settings,
} from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { etagFetcher } from '@/lib/etagFetcher';

interface RuntimeIncident {
  id: string;
  timestamp: number;
  subsystem: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  anomalyType: string;
  diagnosis: {
    incidentId: string;
    subsystem: string;
    signal: string;
    severity: string;
    probableCause: string;
    evidence: string[];
    confidence: number;
    recommendedRemediation: string;
    autoRemediationPermitted: boolean;
    policyTier: 'AUTO_SAFE' | 'APPROVAL_REQUIRED' | 'NEVER_AUTOMATE';
  };
  evidence: string[];
  status: 'OPEN' | 'ACKNOWLEDGED' | 'REMEDIATING' | 'RESOLVED' | 'ESCALATED';
  remediationHistory: Array<{
    id: string;
    incidentId: string;
    action: {
      actionType: string;
      targetSubsystem: string;
      targetId?: string;
      initiatedBy: 'AUTONOMOUS' | 'OPERATOR';
    };
    policy: string;
    attemptNumber: number;
    status: string;
    startedAt: number;
    completedAt?: number;
    verificationResult?: {
      verified: boolean;
      evidence: string;
    };
    error?: string;
    operatorNotes?: string;
  }>;
  verificationResult?: {
    verified: boolean;
    evidence: string;
    resolvedAt: number;
  };
  createdAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  escalatedAt?: number;
  operatorNotes?: string;
}

interface RuntimeAnomaly {
  id: string;
  anomalyType: string;
  subsystem: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  detectedAt: number;
  evidence: string;
  threshold: number;
  observedValue: number;
  targetId?: string;
}

interface RemediationPolicyRule {
  actionType: string;
  policyTier: 'AUTO_SAFE' | 'APPROVAL_REQUIRED' | 'NEVER_AUTOMATE';
  maxAttempts: number;
  cooldownSeconds: number;
  requiresVerification: boolean;
  description: string;
  enabled: boolean;
}

interface RuntimeIntelligenceOverview {
  systemState: string;
  activeIncidentsCount: number;
  resolvedIncidentsCount: number;
  activeAnomaliesCount: number;
  totalRemediationsCount: number;
  successfulRemediationsCount: number;
  failedRemediationsCount: number;
  escalatedIncidentsCount: number;
  incidents: RuntimeIncident[];
  activeAnomalies: RuntimeAnomaly[];
  policies: RemediationPolicyRule[];
  statisticalTrends: {
    errorRateP95: number;
    latencyP95Ms: number;
    rateLimitCount1m: number;
    tokenCost1hUsd: number;
  };
}

export default function RuntimeIntelligencePage() {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [operatorNoteInput, setOperatorNoteInput] = useState<Record<string, string>>({});

  const { data: overview, mutate } = useSWR<RuntimeIntelligenceOverview>(
    '/api/v1/system/intelligence',
    etagFetcher,
    { refreshInterval: 4000 },
  );

  const handleAcknowledge = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch(`/api/v1/system/incidents/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorNotes: operatorNoteInput[id] || 'Acknowledged in Mission Control' }),
      });
      await mutate();
    } catch {
      // swallow
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch(`/api/v1/system/incidents/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorNotes: operatorNoteInput[id] || 'Approved by operator' }),
      });
      await mutate();
    } catch {
      // swallow
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolve = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch(`/api/v1/system/incidents/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verificationEvidence: operatorNoteInput[id] || 'Manually verified resolved by operator' }),
      });
      await mutate();
    } catch {
      // swallow
    } finally {
      setActionLoading(null);
    }
  };

  const handleTogglePolicy = async (actionType: string, currentEnabled: boolean) => {
    try {
      await fetch('/api/v1/system/intelligence/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType,
          patch: { enabled: !currentEnabled },
        }),
      });
      await mutate();
    } catch {
      // swallow
    }
  };

  const incidents = overview?.incidents ?? [];
  const anomalies = overview?.activeAnomalies ?? [];
  const policies = overview?.policies ?? [];

  const filteredIncidents = filterStatus === 'ALL'
    ? incidents
    : incidents.filter((i) => i.status === filterStatus);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-purple-400 mb-2">
            <ShieldAlert className="h-3.5 w-3.5 text-purple-400" /> Bounded Autonomous Control Plane
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            Runtime Intelligence & Self-Healing
          </h1>
          <p className="mt-1 text-sm text-white/60">
            Real-time anomaly detection, deterministic root-cause diagnosis, policy-controlled self-remediation, and incident verification.
          </p>
        </div>
        <div>
          <button
            onClick={() => mutate()}
            className="pill bg-purple-500/10 text-purple-300 ring-1 ring-purple-500/30 hover:bg-purple-500/20"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-white/50">Runtime State</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
              overview?.systemState === 'HEALTHY'
                ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                : 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
            }`}>
              {overview?.systemState === 'HEALTHY' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {overview?.systemState ?? 'HEALTHY'}
            </span>
          </div>
          <div className="mt-4 text-2xl font-bold text-white">
            {overview?.activeIncidentsCount ?? 0} <span className="text-sm font-normal text-white/50">active incidents</span>
          </div>
          <div className="mt-1 text-xs text-white/40">
            {overview?.escalatedIncidentsCount ?? 0} escalated to operator
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-white/50">Anomalies Active</span>
            <Flame className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-4 text-2xl font-bold text-white">
            {anomalies.length}
          </div>
          <div className="mt-1 text-xs text-white/40">
            Across 14 unified subsystems
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-white/50">Self-Healing Actions</span>
            <Wrench className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-4 text-2xl font-bold text-white">
            {overview?.successfulRemediationsCount ?? 0} <span className="text-sm font-normal text-white/50">/ {overview?.totalRemediationsCount ?? 0}</span>
          </div>
          <div className="mt-1 text-xs text-emerald-400/80">
            {overview?.totalRemediationsCount ? `${Math.round(((overview.successfulRemediationsCount ?? 0) / overview.totalRemediationsCount) * 100)}% verified success` : 'No remediations'}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase text-white/50">Statistical Trends</span>
            <Activity className="h-4 w-4 text-purple-400" />
          </div>
          <div className="mt-2 space-y-1 text-xs text-white/70">
            <div className="flex justify-between">
              <span>P95 Latency:</span>
              <span className="font-mono text-white">{overview?.statisticalTrends.latencyP95Ms ?? 0}ms</span>
            </div>
            <div className="flex justify-between">
              <span>Error Rate:</span>
              <span className="font-mono text-white">{overview?.statisticalTrends.errorRateP95 ?? 0}%</span>
            </div>
            <div className="flex justify-between">
              <span>429 Rate Limits (1m):</span>
              <span className="font-mono text-white">{overview?.statisticalTrends.rateLimitCount1m ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Incidents Management Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-purple-400" /> Incidents & Self-Healing Feed
          </h2>
          <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1 border border-white/10 text-xs">
            {['ALL', 'OPEN', 'ACKNOWLEDGED', 'REMEDIATING', 'RESOLVED', 'ESCALATED'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  filterStatus === st ? 'bg-purple-600 text-white font-semibold' : 'text-white/60 hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {filteredIncidents.length === 0 ? (
          <div className="card text-center py-12 text-white/50">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400 opacity-60" />
            No incidents found matching current filter. All subsystems operational.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredIncidents.map((incident) => {
              const sevBadge = {
                CRITICAL: 'bg-rose-500/20 text-rose-300 ring-rose-500/40',
                HIGH: 'bg-amber-500/20 text-amber-300 ring-amber-500/40',
                MEDIUM: 'bg-sky-500/20 text-sky-300 ring-sky-500/40',
                LOW: 'bg-slate-500/20 text-slate-300 ring-slate-500/40',
              }[incident.severity] ?? 'bg-slate-500/20 text-slate-300';

              const stBadge = {
                OPEN: 'bg-rose-500/20 text-rose-400 ring-rose-500/30',
                ACKNOWLEDGED: 'bg-amber-500/20 text-amber-400 ring-amber-500/30',
                REMEDIATING: 'bg-sky-500/20 text-sky-400 ring-sky-500/30',
                RESOLVED: 'bg-emerald-500/20 text-emerald-400 ring-emerald-500/30',
                ESCALATED: 'bg-purple-500/20 text-purple-300 ring-purple-500/30 font-bold',
              }[incident.status] ?? 'bg-slate-500/20 text-slate-300';

              return (
                <div key={incident.id} className="card space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-white">{incident.id}</span>
                      <span className={`px-2 py-0.5 rounded text-xs ring-1 font-semibold ${sevBadge}`}>
                        {incident.severity}
                      </span>
                      <span className="px-2 py-0.5 rounded text-xs bg-white/5 text-white/70 border border-white/10 font-mono">
                        {incident.subsystem}
                      </span>
                      <span className="px-2 py-0.5 rounded text-xs bg-white/5 text-white/70 border border-white/10 font-mono">
                        {incident.anomalyType}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs ring-1 font-semibold ${stBadge}`}>
                        {incident.status}
                      </span>
                    </div>
                    <div className="text-xs text-white/40 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(incident.createdAt).toLocaleTimeString()}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <div className="text-white/50 font-semibold mb-1">PROBABLE CAUSE</div>
                      <p className="text-white/90 bg-black/20 p-2.5 rounded border border-white/5 leading-relaxed">
                        {incident.diagnosis.probableCause}
                      </p>
                      <div className="mt-2 text-white/50 font-semibold">EVIDENCE</div>
                      <ul className="list-disc list-inside text-white/70 space-y-0.5 mt-1">
                        {incident.evidence.map((ev, idx) => (
                          <li key={idx} className="truncate">{ev}</li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <div className="text-white/50 font-semibold mb-1">RECOMMENDED REMEDIATION</div>
                      <div className="bg-black/20 p-2.5 rounded border border-white/5 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-purple-300">{incident.diagnosis.recommendedRemediation}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            incident.diagnosis.policyTier === 'AUTO_SAFE' ? 'bg-emerald-500/20 text-emerald-400' :
                            incident.diagnosis.policyTier === 'APPROVAL_REQUIRED' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-rose-500/20 text-rose-400'
                          }`}>
                            {incident.diagnosis.policyTier}
                          </span>
                        </div>
                        <div className="text-white/60">
                          Confidence: {Math.round(incident.diagnosis.confidence * 100)}% | Auto-Remediation: {incident.diagnosis.autoRemediationPermitted ? 'Permitted' : 'Blocked'}
                        </div>
                      </div>

                      {incident.verificationResult && (
                        <div className="mt-2 p-2 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                          <strong>Verification:</strong> {incident.verificationResult.evidence}
                        </div>
                      )}

                      {incident.operatorNotes && (
                        <div className="mt-2 p-2 rounded bg-white/5 border border-white/10 text-white/80">
                          <strong>Operator Notes:</strong> {incident.operatorNotes}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Remediation Execution History */}
                  {incident.remediationHistory.length > 0 && (
                    <div className="border-t border-white/5 pt-2">
                      <div className="text-xs font-semibold text-white/50 mb-1">EXECUTION HISTORY</div>
                      <div className="space-y-1">
                        {incident.remediationHistory.map((rem) => (
                          <div key={rem.id} className="flex items-center justify-between bg-white/[0.02] px-2.5 py-1 rounded text-xs">
                            <span className="font-mono text-white/80">
                              Attempt #{rem.attemptNumber}: {rem.action.actionType} ({rem.action.initiatedBy})
                            </span>
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold ${rem.status === 'COMPLETED' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {rem.status}
                              </span>
                              {rem.verificationResult?.evidence && (
                                <span className="text-white/40 truncate max-w-xs">{rem.verificationResult.evidence}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Operator Action Bar */}
                  {incident.status !== 'RESOLVED' && (
                    <div className="border-t border-white/5 pt-3 flex flex-col sm:flex-row items-center justify-between gap-2">
                      <input
                        type="text"
                        placeholder="Operator note / reason..."
                        value={operatorNoteInput[incident.id] ?? ''}
                        onChange={(e) => setOperatorNoteInput({ ...operatorNoteInput, [incident.id]: e.target.value })}
                        className="w-full sm:w-80 px-2.5 py-1 text-xs rounded bg-black/40 border border-white/10 text-white"
                      />
                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        {incident.status === 'OPEN' && (
                          <button
                            onClick={() => handleAcknowledge(incident.id)}
                            disabled={actionLoading === incident.id}
                            className="px-2.5 py-1 rounded text-xs font-medium bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40 hover:bg-amber-500/30"
                          >
                            Acknowledge
                          </button>
                        )}
                        {(incident.diagnosis.policyTier === 'APPROVAL_REQUIRED' || incident.status === 'OPEN' || incident.status === 'ACKNOWLEDGED') && (
                          <button
                            onClick={() => handleApprove(incident.id)}
                            disabled={actionLoading === incident.id}
                            className="px-2.5 py-1 rounded text-xs font-medium bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40 hover:bg-purple-500/30"
                          >
                            Approve & Remediate
                          </button>
                        )}
                        <button
                          onClick={() => handleResolve(incident.id)}
                          disabled={actionLoading === incident.id}
                          className="px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Anomalies Matrix */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Flame className="h-5 w-5 text-amber-400" /> Active Statistical Anomalies
        </h2>
        {anomalies.length === 0 ? (
          <div className="card text-center py-6 text-white/50 text-xs">
            No statistical anomalies detected in sliding window.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {anomalies.map((anom) => (
              <div key={anom.id} className="card p-3 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-amber-300">{anom.anomalyType}</span>
                  <span className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono text-[10px]">
                    {anom.subsystem}
                  </span>
                </div>
                <p className="text-white/80">{anom.evidence}</p>
                <div className="text-white/40 flex justify-between pt-1">
                  <span>Threshold: {anom.threshold}</span>
                  <span>Observed: {anom.observedValue}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Remediation Policy Matrix */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="h-5 w-5 text-sky-400" /> Self-Healing Policy Matrix
        </h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-white/50">
                <th className="p-3">Action Type</th>
                <th className="p-3">Policy Tier</th>
                <th className="p-3">Max Attempts</th>
                <th className="p-3">Cooldown</th>
                <th className="p-3">Verification</th>
                <th className="p-3">Description</th>
                <th className="p-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {policies.map((p) => (
                <tr key={p.actionType} className="hover:bg-white/[0.01]">
                  <td className="p-3 font-mono font-bold text-white">{p.actionType}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      p.policyTier === 'AUTO_SAFE' ? 'bg-emerald-500/20 text-emerald-400' :
                      p.policyTier === 'APPROVAL_REQUIRED' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-rose-500/20 text-rose-400'
                    }`}>
                      {p.policyTier}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-white/70">{p.maxAttempts}</td>
                  <td className="p-3 font-mono text-white/70">{p.cooldownSeconds}s</td>
                  <td className="p-3 text-white/70">{p.requiresVerification ? 'Required' : 'No'}</td>
                  <td className="p-3 text-white/60 max-w-sm">{p.description}</td>
                  <td className="p-3 text-right">
                    {p.policyTier === 'NEVER_AUTOMATE' ? (
                      <span className="text-rose-400/60 font-semibold">Prohibited</span>
                    ) : (
                      <button
                        onClick={() => handleTogglePolicy(p.actionType, p.enabled)}
                        className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                          p.enabled
                            ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30'
                            : 'bg-white/10 text-white/50 hover:bg-white/20'
                        }`}
                      >
                        {p.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

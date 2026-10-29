'use client';

import { BadgeCheck, ClipboardCheck, ChevronDown, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { describeError, postAction, type ActionFailure } from '@/lib/actionFeedback';
import { etagFetcher } from '@/lib/etagFetcher';

/* Human approval gate for AI provider integrations. Nothing reaches the
 * production routing fabric except an adapter version whose immutable artifact
 * hash still matches the hash the reviewer approved (bindingValid), published
 * explicitly by an operator on this page. */

interface AdapterManifest {
  providerId: string;
  adapterVersion: string;
  apiStyle: string;
  baseUrl: string;
  supportedOperations: string[];
  models: string[];
  credentialRef: string | null;
  verificationState: string;
  approvalState: string;
  productionEnabled: boolean;
  pricingStatus: string;
  evidenceHashes: string[];
  generator: string;
  generatedAt: string;
}

interface ApprovalRow {
  id: string;
  adapterVersionId: string;
  adapterArtifactHash: string;
  state: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  updatedAt: string;
  adapter?: AdapterManifest;
  bindingValid: boolean;
}

export default function IntelligenceApprovalsPage() {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const {
    data: approvals,
    error: approvalsError,
    mutate,
  } = useSWR<ApprovalRow[]>(
    '/api/v1/intelligence/approvals?limit=200',
    etagFetcher,
    { refreshInterval: 15_000 },
  );

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setActionLoading(id);
    const failure = await postAction(
      `/api/v1/intelligence/approvals/${id}/decision`,
      { decision, note: notes[id] || undefined },
      'Approval decision failed',
    );
    setFailure(failure);
    await mutate();
    setActionLoading(null);
  };

  const publish = async (adapterVersionId: string): Promise<void> => {
    setActionLoading(adapterVersionId);
    const failure = await postAction(
      `/api/v1/intelligence/adapters/${adapterVersionId}/publish`,
      {},
      'Publish failed',
    );
    setFailure(failure);
    await mutate();
    setActionLoading(null);
  };

  const pending = (approvals ?? []).filter((a) => a.state === 'pending');
  const decided = (approvals ?? []).filter((a) => a.state !== 'pending');

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-2">
            <ClipboardCheck className="h-3.5 w-3.5 text-cyan-400" /> Integration Review Gate
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            Integration Approvals
          </h1>
          <p className="mt-1 text-sm text-white/60">
            Review hash-bound adapter artifacts before they may be published into live routing. Reject with a note, or
            approve and then publish — publishing requires binding validity and the publish permission.
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="pill bg-white/5 text-white/70 ring-1 ring-white/15 hover:bg-white/10"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {/* Failure banners — decisions and publishes never fail silently */}
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
      {approvalsError && (
        <div className="card border-l-4 border-l-amber-500 text-xs text-white/60">
          Gateway data unreachable — <span className="text-white/40">{describeError(approvalsError)}</span>.{' '}
          Check the gateway is running at{' '}
          <span className="font-mono text-white/80">NEXUS_GATEWAY_URL</span> (default{' '}
          <span className="font-mono">http://127.0.0.1:8787</span>) and that this install allows unauthenticated
          management access (open install).
        </div>
      )}

      {/* Pending */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-white/50 mb-3">
          Pending review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="card text-sm text-white/40">No pending approvals.</div>
        ) : (
          <div className="space-y-3">
            {pending.map((a) => (
              <div key={a.id} className="card">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                      a.bindingValid
                        ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40'
                    }`}>
                      {a.bindingValid ? <BadgeCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                      {a.bindingValid ? 'artifact binding valid' : 'binding INVALID — re-approval required'}
                    </span>
                    <div className="font-mono text-xs text-white/50 truncate">
                      {a.adapterVersionId} · hash {a.adapterArtifactHash.slice(0, 16)}…
                    </div>
                    {a.adapter && (
                      <div className="text-xs text-white/60">
                        {a.adapter.providerId} · {a.adapter.apiStyle} · {a.adapter.baseUrl} · {a.adapter.models.length}{' '}
                        model(s) · {a.adapter.supportedOperations.join(', ')}
                      </div>
                    )}
                    <div className="text-xs text-white/30">
                      requested by {a.requestedBy} at {new Date(a.requestedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0 sm:w-72">
                    <input
                      value={notes[a.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                      placeholder="Decision note (optional)"
                      className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-cyan-500/50"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => decide(a.id, 'rejected')}
                        disabled={actionLoading !== null}
                        className="flex-1 pill bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        {actionLoading === a.id ? '…' : 'Reject'}
                      </button>
                      <button
                        onClick={() => decide(a.id, 'approved')}
                        disabled={actionLoading !== null}
                        className="flex-1 pill bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {actionLoading === a.id ? '…' : 'Approve'}
                      </button>
                    </div>
                    {a.adapter && (
                      <>
                        <button
                          onClick={() => setExpanded((e) => ({ ...e, [a.id]: !e[a.id] }))}
                          className="text-xs text-white/40 hover:text-white/70 self-start flex items-center gap-1"
                        >
                          <ChevronDown className={`h-3 w-3 transition-transform ${expanded[a.id] ? 'rotate-180' : ''}`} />
                          Manifest hash & evidence
                        </button>
                        {expanded[a.id] && (
                          <pre className="max-h-48 overflow-auto rounded-md bg-black/40 p-2 text-[10px] leading-relaxed text-white/60">
                            {JSON.stringify(
                              {
                                adapterVersion: a.adapter.adapterVersion,
                                apiStyle: a.adapter.apiStyle,
                                baseUrlSource: a.adapter.baseUrl,
                                models: a.adapter.models,
                                supportedOperations: a.adapter.supportedOperations,
                                credentialRef: a.adapter.credentialRef,
                                verificationState: a.adapter.verificationState,
                                pricingStatus: a.adapter.pricingStatus,
                                evidenceHashes: a.adapter.evidenceHashes,
                                generator: a.adapter.generator,
                                generatedAt: a.adapter.generatedAt,
                                approvalState: a.adapter.approvalState,
                                productionEnabled: a.adapter.productionEnabled,
                              },
                              null,
                              1,
                            )}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Approved (publish gate) */}
      {decided.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-white/50 mb-3">
            Decision history ({decided.length})
          </h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-white/40 border-b border-white/10">
                  <th className="py-2 pr-3">Adapter</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3">Decided by</th>
                  <th className="py-2 pr-3">Note</th>
                  <th className="py-2 pr-3">Publish</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((a) => (
                  <tr key={a.id} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-white/70">{a.adapterVersionId}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          a.state === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40'
                        }`}
                      >
                        {a.state}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-white/50">
                      {a.decidedBy} · {a.decidedAt && new Date(a.decidedAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-xs text-white/50 max-w-60 truncate">{a.decisionNote ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {a.state === 'approved' && (
                        <button
                          onClick={() => publish(a.adapterVersionId)}
                          disabled={actionLoading !== null || !a.bindingValid}
                          className="pill bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-40"
                          title={a.bindingValid ? undefined : 'Hash binding invalid — re-approval required'}
                        >
                          {actionLoading === a.adapterVersionId ? 'publishing…' : 'Publish to routing'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import {
  ShieldAlert,
  Stethoscope,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ErrorDiagnostic {
  id: string;
  providerId: string;
  providerDisplayName?: string;
  modelId?: string;
  keyId?: string;
  maskedKey?: string;
  category: string;
  scope: string;
  transience: string;
  httpStatus?: number;
  upstreamCode?: string;
  upstreamMessage?: string;
  timestamp: number;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceCount: number;
  consecutiveFailures: number;
  cooldownUntil?: number;
  circuitBreakerState?: 'closed' | 'open' | 'half_open';
  latencyMs?: number;
  likelyCause: string;
  recommendedAction: string;
  resolved: boolean;
  resolvedAt?: number;
  resolutionAction?: string;
}

export interface ErrorDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  diagnostic: ErrorDiagnostic | null;
  onResolve?: () => void;
}

export function ErrorDetailsModal({ isOpen, onClose, diagnostic, onResolve }: ErrorDetailsModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !diagnostic || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-neutral-950 p-5 sm:p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-rose-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Diagnostic Error Report</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border ${
                  diagnostic.resolved
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                }`}>
                  {diagnostic.resolved ? 'RESOLVED' : 'ACTIVE ERROR'}
                </span>
              </div>
              <p className="text-xs text-white/50 font-mono mt-0.5">{diagnostic.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
          {/* Structured Details Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="text-[10px] uppercase font-bold text-white/40">Category &amp; Scope</span>
              <div className="mt-1 font-semibold text-nexus-300">{diagnostic.category}</div>
              <div className="text-[11px] text-white/50">{diagnostic.scope} · {diagnostic.transience}</div>
            </div>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="text-[10px] uppercase font-bold text-white/40">HTTP Status &amp; Code</span>
              <div className="mt-1 font-mono font-bold text-rose-300">
                HTTP {diagnostic.httpStatus ?? '—'}
              </div>
              <div className="text-[11px] font-mono text-white/50 truncate">
                {diagnostic.upstreamCode ?? 'NONE'}
              </div>
            </div>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="text-[10px] uppercase font-bold text-white/40">Target Entity</span>
              <div className="mt-1 font-mono font-semibold text-white/80">{diagnostic.providerId}</div>
              {diagnostic.maskedKey && (
                <div className="text-[11px] font-mono text-emerald-400">Key: {diagnostic.maskedKey}</div>
              )}
              {diagnostic.modelId && (
                <div className="text-[11px] font-mono text-cyan-400 truncate">Model: {diagnostic.modelId}</div>
              )}
            </div>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="text-[10px] uppercase font-bold text-white/40">Telemetry Counters</span>
              <div className="mt-1 text-white/80">
                Occurrences: <span className="font-bold text-white">{diagnostic.occurrenceCount}</span>
              </div>
              <div className="text-[11px] text-white/50">
                Failures streak: {diagnostic.consecutiveFailures}
              </div>
            </div>
          </div>

          {/* Upstream Message */}
          {diagnostic.upstreamMessage && (
            <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs space-y-1">
              <span className="text-[10px] uppercase font-bold text-white/40">Upstream Raw Message</span>
              <div className="font-mono text-rose-300/90 text-[11px] break-all max-h-28 overflow-y-auto">
                {diagnostic.upstreamMessage}
              </div>
            </div>
          )}

          {/* Suspected Cause & Recommendation */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3.5 text-xs space-y-2">
            <div>
              <span className="font-bold text-amber-400">Suspected Root Cause:</span>
              <p className="mt-0.5 text-white/80">{diagnostic.likelyCause}</p>
            </div>
            <div>
              <span className="font-bold text-nexus-300">Recommended Remediation:</span>
              <p className="mt-0.5 text-white/80">{diagnostic.recommendedAction}</p>
            </div>
          </div>
        </div>

        {/* Action Buttons Footer */}
        <div className="flex items-center justify-between border-t border-white/10 pt-4 shrink-0">
          <span className="text-[11px] text-white/40">
            Last seen: {new Date(diagnostic.lastSeenAt).toLocaleTimeString()}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white/70 hover:bg-white/10 transition"
            >
              Close
            </button>
            {onResolve && !diagnostic.resolved && (
              <button
                onClick={() => {
                  onClose();
                  onResolve();
                }}
                className="flex items-center gap-1.5 rounded-xl bg-nexus-600 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-nexus-500 transition active:scale-95"
              >
                <Stethoscope className="h-3.5 w-3.5" /> Resolve Error
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

'use client';

import {
  CheckCircle2,
  Loader2,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSWRConfig } from 'swr';

export interface ResolutionStepLog {
  step: string;
  status: 'ok' | 'fail' | 'info';
  message: string;
}

export interface RemediationReport {
  resolved: boolean;
  providerId: string;
  targetModel?: string;
  targetKeyId?: string;
  actionTaken: string;
  steps: ResolutionStepLog[];
  verification: 'passed' | 'failed' | 'skipped';
  healthy: boolean;
  message: string;
  recommendation?: string;
  latencyMs?: number;
  timestamp: number;
}

export interface LiveErrorResolverModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: {
    type: 'provider' | 'key' | 'model' | 'diagnostic';
    id: string;
    secondaryId?: string; // modelId or keyId
    displayName?: string;
  };
}

export function LiveErrorResolverModal({ isOpen, onClose, target }: LiveErrorResolverModalProps) {
  const { mutate } = useSWRConfig();
  const [mounted, setMounted] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<RemediationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<number>(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const stages = [
    { title: '1. Diagnose', desc: 'Inspect error classification & circuit state' },
    { title: '2. Remediate', desc: 'Rotate credentials / un-cooldown / refresh catalog' },
    { title: '3. Live Verify', desc: 'Execute live upstream verification probe' },
    { title: '4. Recover', desc: 'Update health state & restore active routing' },
  ];

  const runResolution = async () => {
    setIsRunning(true);
    setError(null);
    setReport(null);
    setCurrentStage(1);

    try {
      let url = '';
      if (target.type === 'provider') {
        url = `/api/v1/providers/${target.id}/resolve`;
      } else if (target.type === 'key') {
        url = `/api/v1/keys/${target.id}/resolve`;
      } else if (target.type === 'model' && target.secondaryId) {
        url = `/api/v1/models/${target.id}/${target.secondaryId}/resolve`;
      } else if (target.type === 'diagnostic') {
        url = `/api/v1/errors/${target.id}/resolve`;
      } else {
        url = `/api/v1/providers/${target.id}/resolve`;
      }

      // Stage progression simulation for live visual feedback
      const timer1 = setTimeout(() => setCurrentStage(2), 600);
      const timer2 = setTimeout(() => setCurrentStage(3), 1400);

      const res = await fetch(url, { method: 'POST' });
      const data = (await res.json()) as RemediationReport;

      clearTimeout(timer1);
      clearTimeout(timer2);
      setCurrentStage(4);
      setReport(data);

      // Revalidate all data streams across the dashboard
      void mutate('/api/v1/providers');
      void mutate('/api/v1/keys');
      void mutate('/api/v1/endpoints');
      void mutate('/api/v1/metrics');
      void mutate('/api/v1/errors');
      void mutate('/api/v1/system/health');
    } catch (err) {
      setError((err as Error).message || 'Failed to execute error resolution');
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void runResolution();
    } else {
      setReport(null);
      setError(null);
      setCurrentStage(0);
    }
  }, [isOpen, target.id]);

  if (!isOpen || !mounted) return null;

  const isSuccess = report?.resolved && report?.healthy;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-nexus-500/30 bg-neutral-950 p-5 sm:p-6 shadow-2xl overflow-hidden">
        {/* Ambient background glow */}
        <div className="pointer-events-none absolute -top-10 -right-10 h-64 w-64 rounded-full bg-nexus-600/15 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-64 w-64 rounded-full bg-cyan-600/15 blur-[80px]" />

        {/* Modal Header */}
        <div className="relative flex items-center justify-between border-b border-white/10 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-nexus-500/30 bg-nexus-500/10 p-2.5 text-nexus-400">
              <Stethoscope className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">Live Error Resolution Engine</h3>
                <span className="rounded-md border border-nexus-500/30 bg-nexus-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-nexus-300">
                  {target.type}
                </span>
              </div>
              <p className="text-xs text-white/50">
                Target: <span className="font-mono text-white/80 font-bold">{target.displayName || target.id}</span>
                {target.secondaryId && <span className="text-white/40"> / {target.secondaryId}</span>}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Modal Content */}
        <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-1 min-h-0">
          {/* 4-Stage Lifecycle Stepper */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {stages.map((stage, idx) => {
              const stepNum = idx + 1;
              const isCompleted = currentStage > stepNum || (currentStage === 4 && !isRunning && isSuccess);
              const isCurrent = currentStage === stepNum && isRunning;
              const isFailed = currentStage === 4 && !isRunning && !isSuccess && stepNum === 4;

              return (
                <div
                  key={stage.title}
                  className={`rounded-xl border p-2.5 text-xs transition ${
                    isCompleted
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : isCurrent
                        ? 'border-nexus-500/50 bg-nexus-500/20 text-nexus-200 animate-pulse'
                        : isFailed
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                          : 'border-white/5 bg-white/[0.02] text-white/40'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span>{stage.title}</span>
                    {isCompleted ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : isCurrent ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-nexus-400" />
                    ) : isFailed ? (
                      <XCircle className="h-3.5 w-3.5 text-rose-400" />
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[10px] opacity-75 truncate">{stage.desc}</div>
                </div>
              );
            })}
          </div>

          {/* Live Step Logs Console */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-white/50">
              <span>Execution Progression Logs</span>
              {isRunning && (
                <span className="flex items-center gap-1.5 text-nexus-400 text-[11px] font-mono lowercase">
                  <Loader2 className="h-3 w-3 animate-spin" /> executing real probe...
                </span>
              )}
            </div>

            <div className="min-h-[120px] max-h-[180px] overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-xs space-y-1.5 shadow-inner">
              {isRunning && (!report?.steps || report.steps.length === 0) && (
                <div className="flex items-center gap-2 text-nexus-300/70 text-xs">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Running deterministic diagnostic & upstream verification probe...</span>
                </div>
              )}

              {report?.steps?.map((step, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 text-[11px] ${
                    step.status === 'ok'
                      ? 'text-emerald-300/90'
                      : step.status === 'fail'
                        ? 'text-rose-300 font-semibold'
                        : 'text-nexus-300/80'
                  }`}
                >
                  <span className="shrink-0 text-white/30">[{step.step}]</span>
                  <span className="shrink-0">
                    {step.status === 'ok' ? '✓' : step.status === 'fail' ? '✗' : '→'}
                  </span>
                  <span className="break-all">{step.message}</span>
                </div>
              ))}

              {error && (
                <div className="flex items-start gap-2 text-rose-400 text-[11px] font-bold">
                  <span>[Exception] ✗ {error}</span>
                </div>
              )}
            </div>
          </div>

          {/* Final Status Banner */}
          {report && (
            <div
              className={`rounded-xl border p-3.5 text-xs space-y-1.5 ${
                isSuccess
                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
              }`}
            >
              <div className="flex items-center justify-between font-bold text-sm">
                <div className="flex items-center gap-2">
                  {isSuccess ? (
                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-rose-400" />
                  )}
                  <span>{isSuccess ? 'Error Remediated & Live Verified' : 'Resolution Incomplete'}</span>
                </div>
                {report.latencyMs != null && (
                  <span className="font-mono text-[11px] opacity-80">{report.latencyMs}ms latency</span>
                )}
              </div>

              <p className="text-xs opacity-90">{report.message}</p>

              {report.recommendation && (
                <div className="mt-2 rounded-lg bg-black/40 border border-white/10 p-2 text-[11px] text-white/80">
                  <span className="font-bold text-amber-400">Recommendation: </span>
                  {report.recommendation}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 border-t border-white/10 pt-4 shrink-0">
          <div className="text-[11px] text-white/40">
            Nexus Gateway Resolution Engine · Real Upstream Verification Guaranteed
          </div>

          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={runResolution}
              disabled={isRunning}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 transition disabled:opacity-50"
            >
              <RotateCw className={`h-3.5 w-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              Re-test &amp; Verify
            </button>

            <button
              onClick={onClose}
              className="rounded-xl bg-nexus-600 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-nexus-500 transition"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

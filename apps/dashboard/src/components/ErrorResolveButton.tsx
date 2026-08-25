'use client';

import { AlertCircle, Stethoscope } from 'lucide-react';
import { useState } from 'react';

import { ErrorDetailsModal, type ErrorDiagnostic } from './ErrorDetailsModal';
import { LiveErrorResolverModal } from './LiveErrorResolverModal';

export interface ErrorResolveButtonProps {
  target: {
    type: 'provider' | 'key' | 'model' | 'diagnostic';
    id: string;
    secondaryId?: string;
    displayName?: string;
  };
  errorCount?: number;
  diagnostic?: ErrorDiagnostic | null;
  size?: 'sm' | 'md' | 'xs';
  variant?: 'button' | 'badge' | 'icon';
}

export function ErrorResolveButton({
  target,
  errorCount = 0,
  diagnostic = null,
  size = 'sm',
  variant = 'button',
}: ErrorResolveButtonProps) {
  const [resolveOpen, setResolveOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const padding =
    size === 'xs' ? 'px-2 py-0.5 text-[10px]' : size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-xs';

  if (variant === 'badge') {
    return (
      <>
        <div className="inline-flex items-center gap-1">
          <button
            onClick={() => setResolveOpen(true)}
            className={`inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 font-semibold text-rose-300 transition hover:bg-rose-500/20 active:scale-95 ${padding}`}
            title="Launch Live Remediation Engine"
          >
            <Stethoscope className="h-3 w-3 text-rose-400" />
            <span>Resolve ({errorCount})</span>
          </button>

          {diagnostic && (
            <button
              onClick={() => setDetailsOpen(true)}
              className="rounded-lg border border-white/10 bg-white/5 p-1 text-white/50 hover:bg-white/10 hover:text-white transition"
              title="Inspect Error Diagnostics"
            >
              <AlertCircle className="h-3 w-3" />
            </button>
          )}
        </div>

        <LiveErrorResolverModal isOpen={resolveOpen} onClose={() => setResolveOpen(false)} target={target} />
        <ErrorDetailsModal
          isOpen={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          diagnostic={diagnostic}
          onResolve={() => setResolveOpen(true)}
        />
      </>
    );
  }

  if (variant === 'icon') {
    return (
      <>
        <button
          onClick={() => setResolveOpen(true)}
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 transition hover:bg-rose-500/20 active:scale-95"
          title={`Resolve error on ${target.displayName || target.id}`}
        >
          <Stethoscope className="h-3.5 w-3.5 text-rose-400" />
        </button>

        <LiveErrorResolverModal isOpen={resolveOpen} onClose={() => setResolveOpen(false)} target={target} />
      </>
    );
  }

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        <button
          onClick={() => setResolveOpen(true)}
          className={`flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-gradient-to-r from-rose-600/20 to-nexus-600/20 font-bold text-rose-200 shadow-md transition hover:scale-[1.02] hover:border-rose-500/60 active:scale-95 ${padding}`}
        >
          <Stethoscope className="h-3.5 w-3.5 text-rose-400" />
          <span>Resolve Error</span>
          {errorCount > 0 && (
            <span className="ml-0.5 rounded-full bg-rose-500/30 px-1.5 py-0.2 text-[10px] font-mono text-rose-100">
              {errorCount}
            </span>
          )}
        </button>

        {diagnostic && (
          <button
            onClick={() => setDetailsOpen(true)}
            className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white transition"
          >
            Details
          </button>
        )}
      </div>

      <LiveErrorResolverModal isOpen={resolveOpen} onClose={() => setResolveOpen(false)} target={target} />
      <ErrorDetailsModal
        isOpen={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        diagnostic={diagnostic}
        onResolve={() => setResolveOpen(true)}
      />
    </>
  );
}

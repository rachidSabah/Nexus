'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log client/render error cleanly
    console.error('Dashboard error boundary captured error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 max-w-lg backdrop-blur-xl">
        <div className="flex items-center justify-center gap-2 text-rose-400 font-bold text-lg mb-2">
          <AlertCircle className="h-6 w-6" />
          <span>Dashboard Error</span>
        </div>
        <p className="text-sm text-white/70 mb-6 font-mono text-left bg-black/40 p-3 rounded-lg border border-white/5 break-all">
          {error.message || 'An unexpected error occurred while rendering the dashboard.'}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/30"
        >
          <RefreshCw className="h-4 w-4" />
          <span>Retry Component</span>
        </button>
      </div>
    </div>
  );
}

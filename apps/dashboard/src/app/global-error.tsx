'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#090d16] text-white flex min-h-screen items-center justify-center p-8 font-sans">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-8 max-w-lg backdrop-blur-xl text-center">
          <div className="flex items-center justify-center gap-2 text-rose-400 font-bold text-xl mb-3">
            <AlertCircle className="h-7 w-7" />
            <span>Application Error</span>
          </div>
          <p className="text-sm text-white/70 mb-6 font-mono text-left bg-black/50 p-4 rounded-lg border border-white/10 break-all">
            {error.message || 'A root-level rendering error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/20 px-5 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/30"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Reload Application</span>
          </button>
        </div>
      </body>
    </html>
  );
}

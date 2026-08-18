'use client';

import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-4 backdrop-blur-xl">
        <Loader2 className="h-5 w-5 animate-spin text-nexus-400" />
        <span className="text-xs font-mono text-white/70">Loading Nexus Telemetry...</span>
      </div>
    </div>
  );
}

'use client';

import { FileQuestion, Home } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 max-w-md backdrop-blur-xl">
        <div className="flex items-center justify-center gap-2 text-nexus-400 font-bold text-xl mb-2">
          <FileQuestion className="h-8 w-8" />
          <span>404 - Page Not Found</span>
        </div>
        <p className="text-xs text-white/60 mb-6">
          The requested dashboard view or resource could not be found.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl border border-nexus-500/40 bg-nexus-500/20 px-4 py-2 text-xs font-semibold text-nexus-300 transition hover:bg-nexus-500/30"
        >
          <Home className="h-4 w-4" />
          <span>Back to Overview</span>
        </Link>
      </div>
    </div>
  );
}

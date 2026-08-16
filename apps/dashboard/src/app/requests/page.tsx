'use client';

import { Radio, Sparkles, Activity, Cpu } from 'lucide-react';

import { EventFeed } from '@/components/EventFeed';
import { useLiveEvents } from '@/hooks/api';

export default function RequestsPage() {
  const events = useLiveEvents();
  return (
    <div className="space-y-8 relative pb-12 w-full max-w-full overflow-x-hidden">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Real-time Proxy Telemetry
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Radio className="h-8 w-8 text-nexus-400 animate-pulse" />
            Gateway Request Stream & Trace
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Live WebSocket stream of agent traffic, proxy request routing decisions, failovers, and provider responses.
          </p>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <span className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            LIVE FEED ACTIVE
          </span>
        </div>
      </div>

      {/* Telemetry Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-950/20 to-white/[0.02] p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-nexus-300/80">Stream Event Count</span>
            <Activity className="h-4 w-4 text-nexus-400" />
          </div>
          <div className="mt-3 text-3xl font-black text-nexus-300">{events.length}</div>
          <div className="mt-1 text-[11px] text-nexus-400/60">Captured telemetry items</div>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-white/[0.02] p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">Successful Calls</span>
            <Cpu className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-3 text-3xl font-black text-emerald-300">
            {events.filter((e) => e.type === 'provider.request.succeeded' || e.type === 'request.received').length}
          </div>
          <div className="mt-1 text-[11px] text-emerald-400/60">Proxy requests served</div>
        </div>
        <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-cyan-950/20 to-white/[0.02] p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400/80">WebSocket Protocol</span>
            <Radio className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-3 text-sm font-mono font-bold text-cyan-300">ws://127.0.0.1:8787/ws</div>
          <div className="mt-1 text-[11px] text-cyan-400/60">Connected to local gateway</div>
        </div>
      </div>

      {/* Main Stream Window */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Activity className="h-4 w-4 text-nexus-400" /> Live Event Telemetry Stream
        </h2>
        <EventFeed events={events} />
      </div>
    </div>
  );
}


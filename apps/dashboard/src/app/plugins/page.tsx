'use client';

import { Layers, Trash2, Sparkles, Cpu, CheckCircle2 } from 'lucide-react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PluginDescriptor {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  hooks: readonly string[];
  capabilities: readonly string[];
}

export default function PluginsPage() {
  const { data: plugins, isLoading } = useSWR<readonly PluginDescriptor[]>('/api/v1/plugins', fetcher, { refreshInterval: 5000 });

  async function unload(id: string) {
    if (!confirm(`Unload plugin "${id}"?`)) return;
    const r = await fetch(`/api/v1/plugins/${id}/unload`, { method: 'POST' });
    if (!r.ok) alert(`Failed to unload: ${r.statusText}`);
  }

  return (
    <div className="space-y-8 relative pb-12 w-full max-w-full overflow-x-hidden">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Loaded Gateway Plugins & Hooks
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Layers className="h-8 w-8 text-nexus-400" />
            Loaded Plugins & Lifecycle Hooks
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Inspect loaded request lifecycle hooks (<code>onRequest</code>, <code>onRouteResolved</code>, <code>onProviderChunk</code>, <code>onResponse</code>).
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-emerald-400" /> Active Plugin Runtimes ({(plugins ?? []).length})
        </h2>
        {isLoading ? (
          <div className="py-8 text-center text-xs text-white/40">Loading loaded plugin registry...</div>
        ) : (plugins ?? []).length === 0 ? (
          <div className="py-8 text-center text-xs text-white/40">
            No plugins loaded. Plugins hook dynamically into proxy request/response pipelines.
          </div>
        ) : (
          <div className="space-y-4">
            {(plugins ?? []).map((p) => (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-white/5 bg-black/40 p-4 transition hover:border-nexus-500/30">
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-sm text-white">{p.name}</span>
                    <span className="font-mono text-xs text-white/40">v{p.version}</span>
                    {p.author && <span className="text-xs text-nexus-400/80">by {p.author}</span>}
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" /> Active
                    </span>
                  </div>
                  <div className="text-xs text-white/70">{p.description}</div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-semibold uppercase text-white/40 mr-1">Lifecycle Hooks:</span>
                    {p.hooks.map((h) => (
                      <span key={h} className="rounded-md border border-nexus-500/30 bg-nexus-500/10 px-2 py-0.5 text-[10px] font-mono text-nexus-300">
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => unload(p.id)}
                  className="self-end sm:self-center rounded-xl border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300 transition hover:bg-rose-500/20"
                  title="Unload Plugin"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


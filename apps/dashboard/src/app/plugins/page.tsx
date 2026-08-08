'use client';

import { Layers, Trash2 } from 'lucide-react';
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
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Layers className="h-6 w-6 text-nexus-400" />
          Plugins
        </h1>
        <p className="text-sm text-white/50">
          Loaded plugins and their lifecycle hooks. Load new plugins via <code className="rounded bg-white/5 px-1">POST /v1/plugins/load</code>.
        </p>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="py-4 text-center text-sm text-white/40">Loading…</div>
        ) : (plugins ?? []).length === 0 ? (
          <div className="py-8 text-center text-sm text-white/40">
            No plugins loaded. Plugins can hook into the request lifecycle: <code className="rounded bg-white/5 px-1">onRequest</code>, <code className="rounded bg-white/5 px-1">onRouteResolved</code>, <code className="rounded bg-white/5 px-1">onProviderChunk</code>, <code className="rounded bg-white/5 px-1">onResponse</code>, etc.
          </div>
        ) : (
          <div className="space-y-3">
            {(plugins ?? []).map((p) => (
              <div key={p.id} className="flex items-start justify-between rounded-lg bg-white/[0.02] p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-white/40">v{p.version}</span>
                    {p.author && <span className="text-xs text-white/40">by {p.author}</span>}
                  </div>
                  <div className="mt-1 text-sm text-white/60">{p.description}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.hooks.map((h) => (
                      <span key={h} className="rounded bg-nexus-600/20 px-1.5 py-0.5 text-[10px] font-mono text-nexus-300">{h}</span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => unload(p.id)}
                  className="rounded-md bg-rose-600/20 p-2 text-rose-300 hover:bg-rose-600/30"
                  title="Unload"
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

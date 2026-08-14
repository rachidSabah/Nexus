'use client';

import { Store, Package, Bot, Wrench, Download, CheckCircle2, Sparkles, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ExtensionPackage {
  metadata: {
    id: string;
    name: string;
    description: string;
    version: string;
    type: string;
    category: string;
    author: { name: string; verified: boolean };
    license: string;
    keywords: string[];
  };
  versions: Array<{ version: string; signature?: string; downloadUrl: string }>;
}

interface MarketplaceSearchResult {
  total: number;
  page: number;
  pageSize: number;
  results: ExtensionPackage[];
}

interface InstalledExtension {
  package: ExtensionPackage;
  installedVersion: string;
  enabled: boolean;
}

export default function MarketplacePage() {
  const [filter, setFilter] = useState<string>('');
  const { data: search, isLoading } = useSWR<MarketplaceSearchResult>(
    `/api/v1/marketplace/search${filter ? `?type=${filter}` : ''}`,
    fetcher,
    { refreshInterval: 30000 },
  );
  const { data: installed, mutate: refreshInstalled } = useSWR<readonly InstalledExtension[]>(
    '/api/v1/marketplace/installed',
    fetcher,
    { refreshInterval: 10000 },
  );

  const installedIds = new Set((installed ?? []).map((i) => i.package.metadata.id));

  async function install(id: string) {
    const r = await fetch(`/api/v1/marketplace/extensions/${id}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skipSignatureVerification: true }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({ error: { message: 'Install failed' } }));
      alert(`Install failed: ${body?.error?.message ?? r.statusText}`);
      return;
    }
    await refreshInstalled();
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
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Prebuilt Extension Catalog & Store
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Store className="h-8 w-8 text-nexus-400" />
            Agent Nexus Marketplace
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Discover, install, and update verified security guardrails, autonomous coding agents, and developer tools.
          </p>
        </div>
      </div>

      {/* Filter & Stat Bar */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-4 sm:p-5 backdrop-blur-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Package className="h-4 w-4 text-nexus-400" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-10 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white focus:border-nexus-500 focus:outline-none"
          >
            <option value="" className="bg-slate-900 text-white">All Extension Types</option>
            <option value="plugin" className="bg-slate-900 text-white">Plugins</option>
            <option value="agent" className="bg-slate-900 text-white">Agents</option>
            <option value="tool" className="bg-slate-900 text-white">Tools</option>
            <option value="template" className="bg-slate-900 text-white">Templates</option>
            <option value="workflow" className="bg-slate-900 text-white">Workflows</option>
          </select>
        </div>
        <div className="text-xs font-mono text-white/60">
          <span className="text-nexus-300 font-bold">{search?.total ?? 0}</span> extensions available · <span className="text-emerald-400 font-bold">{installedIds.size}</span> installed
        </div>
      </div>

      {/* Extension Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full rounded-2xl border border-white/10 bg-black/40 py-12 text-center text-xs text-white/40">
            Querying extension marketplace catalog...
          </div>
        ) : (search?.results ?? []).length === 0 ? (
          <div className="col-span-full rounded-2xl border border-white/10 bg-black/40 py-12 text-center text-xs text-white/40">
            No extensions found matching search parameters.
          </div>
        ) : (
          (search?.results ?? []).map((ext) => {
            const isInstalled = installedIds.has(ext.metadata.id);
            const Icon = ext.metadata.type === 'agent' ? Bot : ext.metadata.type === 'tool' ? Wrench : Package;
            return (
              <div key={ext.metadata.id} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 backdrop-blur-xl transition hover:border-nexus-500/40 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <div className="rounded-xl bg-nexus-500/10 p-2 text-nexus-400 border border-nexus-500/20 mt-0.5">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-white">{ext.metadata.name}</div>
                        <div className="text-[11px] text-white/40 font-mono">
                          v{ext.metadata.version} · <span className="capitalize">{ext.metadata.type}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-white/70">{ext.metadata.description}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {ext.metadata.keywords.slice(0, 4).map((k) => (
                      <span key={k} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-white/50">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                  <div className="text-[11px] text-white/40 flex items-center gap-1">
                    <span>by {ext.metadata.author.name}</span>
                    {ext.metadata.author.verified && <ShieldCheck className="h-3.5 w-3.5 text-cyan-400 inline" />}
                  </div>
                  {isInstalled ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Installed
                    </span>
                  ) : (
                    <button
                      onClick={() => install(ext.metadata.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-nexus-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md transition hover:bg-nexus-500 active:scale-95"
                    >
                      <Download className="h-3.5 w-3.5" /> Install Extension
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}


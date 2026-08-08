'use client';

import { Store, Package, Bot, Wrench, Download, CheckCircle2 } from 'lucide-react';
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
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Store className="h-6 w-6 text-nexus-400" />
          Marketplace
        </h1>
        <p className="text-sm text-white/50">Browse and install extensions, agents, and tools.</p>
      </div>

      <div className="card flex items-center gap-3">
        <Package className="h-4 w-4 text-white/40" />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
        >
          <option value="">All types</option>
          <option value="plugin">Plugins</option>
          <option value="agent">Agents</option>
          <option value="tool">Tools</option>
          <option value="template">Templates</option>
          <option value="workflow">Workflows</option>
        </select>
        <span className="text-xs text-white/40">
          {search?.total ?? 0} available · {installedIds.size} installed
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full py-8 text-center text-sm text-white/40">Loading…</div>
        ) : (search?.results ?? []).length === 0 ? (
          <div className="col-span-full py-8 text-center text-sm text-white/40">
            No extensions found. Add extensions to the catalog via <code className="rounded bg-white/5 px-1">POST /v1/marketplace/extensions</code>.
          </div>
        ) : (
          (search?.results ?? []).map((ext) => {
            const isInstalled = installedIds.has(ext.metadata.id);
            const Icon = ext.metadata.type === 'agent' ? Bot : ext.metadata.type === 'tool' ? Wrench : Package;
            return (
              <div key={ext.metadata.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2">
                    <Icon className="mt-1 h-4 w-4 text-nexus-400" />
                    <div>
                      <div className="font-medium">{ext.metadata.name}</div>
                      <div className="text-xs text-white/40">v{ext.metadata.version} · {ext.metadata.type}</div>
                    </div>
                  </div>
                  {isInstalled ? (
                    <span className="pill pill-healthy"><CheckCircle2 className="h-3 w-3" /> installed</span>
                  ) : (
                    <button
                      onClick={() => install(ext.metadata.id)}
                      className="rounded-md bg-nexus-600/80 px-2 py-1 text-xs font-medium text-white hover:bg-nexus-500"
                    >
                      <Download className="h-3 w-3" /> Install
                    </button>
                  )}
                </div>
                <div className="mt-2 text-xs text-white/60">{ext.metadata.description}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {ext.metadata.keywords.slice(0, 3).map((k) => (
                    <span key={k} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40">{k}</span>
                  ))}
                </div>
                <div className="mt-2 text-[10px] text-white/40">
                  by {ext.metadata.author.name}{ext.metadata.author.verified ? ' ✓' : ''}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

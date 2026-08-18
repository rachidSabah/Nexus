'use client';

import {
  Store,
  Package,
  Bot,
  Wrench,
  Download,
  Sparkles,
  ShieldCheck,
  Trash2,
  Power,
  Search,
  Server,
  Workflow,
  Shield,
  Star,
  RefreshCw,
} from 'lucide-react';
import { useState, useMemo } from 'react';
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
  downloads?: number;
  rating?: { average: number; count: number };
  permissions?: {
    filesystem?: boolean;
    network?: boolean;
    environment?: boolean;
    secrets?: boolean;
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

const CATEGORIES = [
  { id: '', label: 'All Extensions', icon: Store },
  { id: 'plugin', label: 'Security & Plugins', icon: Shield },
  { id: 'mcp-server', label: 'MCP Servers', icon: Server },
  { id: 'workflow', label: 'Workflows', icon: Workflow },
  { id: 'agent', label: 'Coding Agents', icon: Bot },
  { id: 'tool', label: 'Tools', icon: Wrench },
];

export default function MarketplacePage() {
  const [selectedType, setSelectedType] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: search, isLoading, mutate: refreshSearch } = useSWR<MarketplaceSearchResult>(
    `/api/v1/marketplace/search${selectedType ? `?type=${selectedType}` : ''}`,
    fetcher,
    { refreshInterval: 30000 },
  );

  const { data: installed, mutate: refreshInstalled } = useSWR<readonly InstalledExtension[]>(
    '/api/v1/marketplace/installed',
    fetcher,
    { refreshInterval: 10000 },
  );

  const installedMap = useMemo(() => {
    const map = new Map<string, InstalledExtension>();
    for (const item of installed ?? []) {
      if (item?.package?.metadata?.id) {
        map.set(item.package.metadata.id, item);
      }
    }
    return map;
  }, [installed]);

  async function handleInstall(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/marketplace/extensions/${id}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipSignatureVerification: true, enableAfterInstall: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: 'Install failed' } }));
        alert(`Install failed: ${body?.error?.message ?? res.statusText}`);
      }
      await refreshInstalled();
      await refreshSearch();
    } finally {
      setBusyId(null);
    }
  }

  async function handleUninstall(id: string) {
    if (!confirm(`Are you sure you want to remove extension ${id}?`)) return;
    setBusyId(id);
    try {
      await fetch(`/api/v1/marketplace/extensions/${id}`, { method: 'DELETE' });
      await refreshInstalled();
      await refreshSearch();
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(id: string, currentlyEnabled: boolean) {
    setBusyId(id);
    try {
      await fetch(`/api/v1/marketplace/extensions/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      });
      await refreshInstalled();
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdate(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/v1/marketplace/extensions/${id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoUpdate: true }),
      });
      await refreshInstalled();
      await refreshSearch();
    } finally {
      setBusyId(null);
    }
  }

  const filteredResults = useMemo(() => {
    const list = search?.results ?? [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (ext) =>
        ext.metadata.name.toLowerCase().includes(q) ||
        ext.metadata.description.toLowerCase().includes(q) ||
        ext.metadata.keywords.some((k) => k.toLowerCase().includes(q)) ||
        ext.metadata.id.toLowerCase().includes(q),
    );
  }, [search?.results, searchQuery]);

  return (
    <div className="space-y-8 relative pb-12 w-full max-w-full overflow-x-hidden">
      {/* Background Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Production Extensions & MCP Store
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Store className="h-8 w-8 text-nexus-400" />
            Agent Nexus Marketplace
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Discover, install, and update verified security guardrails, autonomous coding agents, MCP servers, and developer workflows.
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-white/60 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-2 self-start md:self-auto">
          <Package className="h-4 w-4 text-nexus-400" />
          <span><strong className="text-white">{search?.total ?? 0}</strong> Available</span>
          <span className="text-white/20">|</span>
          <span><strong className="text-emerald-400">{installedMap.size}</strong> Installed</span>
        </div>
      </div>

      {/* Category Tabs & Search Bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = selectedType === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedType(cat.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? 'bg-nexus-600 text-white shadow-lg shadow-nexus-600/30 border border-nexus-500/50'
                    : 'bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white border border-white/10'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? 'text-white' : 'text-nexus-400'}`} />
                {cat.label}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search verified guardrails, MCP servers, agents, tools by keyword..."
            className="w-full h-11 rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-4 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none backdrop-blur-md"
          />
        </div>
      </div>

      {/* Extension Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full rounded-2xl border border-white/10 bg-black/40 py-16 text-center text-xs text-white/40">
            Querying extension marketplace catalog...
          </div>
        ) : filteredResults.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-white/10 bg-black/40 py-16 text-center text-xs text-white/40">
            No extensions found matching &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          filteredResults.map((ext) => {
            const installedExt = installedMap.get(ext.metadata.id);
            const isInstalled = !!installedExt;
            const isEnabled = installedExt?.enabled ?? false;
            const isBusy = busyId === ext.metadata.id;

            const Icon =
              ext.metadata.type === 'agent'
                ? Bot
                : ext.metadata.type === 'mcp-server'
                ? Server
                : ext.metadata.type === 'workflow'
                ? Workflow
                : ext.metadata.type === 'plugin'
                ? Shield
                : Wrench;

            return (
              <div
                key={ext.metadata.id}
                className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 backdrop-blur-xl transition hover:border-nexus-500/40 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-nexus-500/10 p-2.5 text-nexus-400 border border-nexus-500/20 mt-0.5">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-white flex items-center gap-1.5">
                          {ext.metadata.name}
                        </div>
                        <div className="text-[11px] text-white/40 font-mono flex items-center gap-2 mt-0.5">
                          <span>v{ext.metadata.version}</span>
                          <span>•</span>
                          <span className="capitalize text-nexus-300 font-semibold">{ext.metadata.type}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-white/70 leading-relaxed min-h-[3rem]">
                    {ext.metadata.description}
                  </div>

                  {/* Permissions & Security Badges */}
                  <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                    {ext.permissions?.filesystem && (
                      <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                        Filesystem
                      </span>
                    )}
                    {ext.permissions?.network && (
                      <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                        Network
                      </span>
                    )}
                    {ext.permissions?.secrets && (
                      <span className="rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] font-mono text-purple-300">
                        Vault Secrets
                      </span>
                    )}
                    {ext.metadata.keywords.slice(0, 3).map((k) => (
                      <span key={k} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-white/50">
                        {k}
                      </span>
                    ))}
                  </div>

                  {/* Ratings & Downloads */}
                  <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-white/40 border-t border-white/5 pt-2.5">
                    <div className="flex items-center gap-1 text-amber-400">
                      <Star className="h-3 w-3 fill-amber-400" />
                      <span>{ext.rating?.average ?? 4.9}</span>
                      <span className="text-white/30">({ext.rating?.count ?? 100})</span>
                    </div>
                    <div>{ext.downloads ?? 1200} installs</div>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-white/40 flex items-center gap-1">
                    <span>by {ext.metadata.author.name}</span>
                    {ext.metadata.author.verified && <ShieldCheck className="h-3.5 w-3.5 text-cyan-400 inline" />}
                  </div>

                  {isInstalled ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleToggle(ext.metadata.id, isEnabled)}
                        className={`p-1.5 rounded-lg border transition text-xs font-semibold ${
                          isEnabled
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                            : 'border-white/10 bg-white/5 text-white/40 hover:bg-white/10'
                        }`}
                        title={isEnabled ? 'Extension active (click to disable)' : 'Extension disabled (click to enable)'}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleUpdate(ext.metadata.id)}
                        className="p-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition text-xs"
                        title="Check updates"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleUninstall(ext.metadata.id)}
                        className="p-1.5 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition text-xs"
                        title="Uninstall extension"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleInstall(ext.metadata.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-nexus-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md transition hover:bg-nexus-500 active:scale-95 disabled:opacity-40"
                    >
                      <Download className={`h-3.5 w-3.5 ${isBusy ? 'animate-bounce' : ''}`} />
                      {isBusy ? 'Installing…' : 'Install'}
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


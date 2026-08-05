'use client';

import { Brain, Search, Clock, Database } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface MemoryRecord {
  id: string;
  namespace: string;
  scope: 'short' | 'long';
  contentType: string;
  content: string;
  createdAt: string;
  tokenCount: number;
}

export default function MemoryPage() {
  const [namespace, setNamespace] = useState('default');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ record: MemoryRecord; score: number }>>([]);

  const { data, isLoading } = useSWR<{ count: number }>(`/api/v1/memory/${namespace}/list?limit=50`, fetcher, { refreshInterval: 5000 });
  const { data: memories } = useSWR<readonly MemoryRecord[]>(`/api/v1/memory/${namespace}/list?limit=50`, fetcher, { refreshInterval: 5000 });

  async function search() {
    if (!query) return;
    const r = await fetch(`/api/v1/memory/${namespace}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 10 }),
    });
    const data = (await r.json()) as { results: Array<{ record: MemoryRecord; score: number }> };
    setSearchResults(data.results ?? []);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Brain className="h-6 w-6 text-nexus-400" />
          Memory
        </h1>
        <p className="text-sm text-white/50">Short-term and long-term memory across namespaces.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-amber-400" /><div className="stat-label">Short-term</div></div>
          <div className="mt-2 text-xs text-white/50">Per-session conversation context. Cleared when session ends.</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2"><Database className="h-4 w-4 text-emerald-400" /><div className="stat-label">Long-term</div></div>
          <div className="mt-2 text-xs text-white/50">Vector-indexed. Survives restarts. Used for user preferences, project knowledge.</div>
        </div>
        <div className="card">
          <div className="stat-label">Total in namespace</div>
          <div className="mt-2 stat-value">{data?.count ?? 0}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-sm font-medium text-white/80">Search</h2>
        <div className="flex gap-2">
          <input
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="namespace"
            className="h-9 w-40 rounded-lg border border-white/5 bg-white/[0.02] px-3 text-sm placeholder:text-white/30 focus:border-nexus-500/50 focus:outline-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="semantic search query…"
            className="h-9 flex-1 rounded-lg border border-white/5 bg-white/[0.02] px-3 text-sm placeholder:text-white/30 focus:border-nexus-500/50 focus:outline-none"
          />
          <button
            onClick={search}
            className="h-9 rounded-lg bg-nexus-600 px-4 text-sm font-medium text-white transition hover:bg-nexus-500"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="mt-4 space-y-2">
            {searchResults.map((r) => (
              <div key={r.record.id} className="rounded-lg bg-black/30 p-3 text-sm">
                <div className="flex items-center justify-between text-xs text-white/40">
                  <span>{r.record.namespace} · {r.record.scope}</span>
                  <span className="font-mono">score: {r.score.toFixed(3)}</span>
                </div>
                <div className="mt-1 text-white/70">{r.record.content.slice(0, 300)}{r.record.content.length > 300 ? '…' : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-4 text-sm font-medium text-white/80">Recent memories in "{namespace}"</h2>
        <div className="max-h-96 overflow-y-auto font-mono text-xs">
          {isLoading ? (
            <div className="py-8 text-center text-white/40">Loading…</div>
          ) : (memories ?? []).length === 0 ? (
            <div className="py-8 text-center text-white/40">No memories yet.</div>
          ) : (
            (memories ?? []).map((m) => (
              <div key={m.id} className="border-b border-white/[0.02] py-2">
                <div className="flex items-center gap-3">
                  <span className="text-white/30">{new Date(m.createdAt).toLocaleString()}</span>
                  <span className={`pill ${m.scope === 'short' ? 'pill-degraded' : 'pill-healthy'}`}>{m.scope}</span>
                  <span className="text-nexus-300">{m.contentType}</span>
                  <span className="text-white/40">{m.tokenCount} tok</span>
                </div>
                <div className="mt-1 text-white/60">{m.content.slice(0, 200)}{m.content.length > 200 ? '…' : ''}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

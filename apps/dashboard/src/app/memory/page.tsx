'use client';

import { Brain, Search, Clock, Database, Sparkles, Cpu, Trash2, Plus } from 'lucide-react';
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

interface MemoryListResponse {
  count: number;
  records: MemoryRecord[];
}

export default function MemoryPage() {
  const [namespace, setNamespace] = useState('default');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ record: MemoryRecord; score: number }>>([]);
  const [newContent, setNewContent] = useState('');
  const [newScope, setNewScope] = useState<'short' | 'long'>('long');
  const [newType, setNewType] = useState('note');
  const [storing, setStoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listKey = `/api/v1/memory/${namespace}/list?limit=50`;
  const { data, isLoading, mutate } = useSWR<MemoryListResponse>(listKey, fetcher, { refreshInterval: 5000 });

  const memories: MemoryRecord[] = Array.isArray(data?.records) ? data!.records : [];

  async function search() {
    if (!query) return;
    setError(null);
    try {
      const r = await fetch(`/api/v1/memory/${namespace}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 10 }),
      });
      const resp = (await r.json()) as { results: Array<{ record: MemoryRecord; score: number }> };
      setSearchResults(resp.results ?? []);
    } catch {
      setError('Search failed');
    }
  }

  async function store() {
    if (!newContent.trim()) return;
    setStoring(true);
    setError(null);
    try {
      const r = await fetch(`/api/v1/memory/${namespace}/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: newContent.trim(), scope: newScope, contentType: newType }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `HTTP ${r.status}`);
      }
      setNewContent('');
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Store failed');
    } finally {
      setStoring(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const r = await fetch(`/api/v1/memory/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
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
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Vector Memory & Knowledge Index
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Brain className="h-8 w-8 text-nexus-400" />
            Agent Memory & Vector Store
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Short-term session context and long-term vector-indexed memory across agent namespaces.
          </p>
        </div>
      </div>

      {/* Cyber Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-amber-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/80">Short-Term Memory</span>
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400 border border-amber-500/20">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-[11px] text-amber-400/80 font-mono">Per-session conversation context. Cleared on session end.</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-emerald-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">Long-Term Vector Store</span>
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
              <Database className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-[11px] text-emerald-400/80 font-mono">Vector indexed knowledge base. Survives restarts.</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-nexus-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-nexus-300/80">Namespace Record Count</span>
            <div className="rounded-lg bg-nexus-500/10 p-2 text-nexus-400 border border-nexus-500/20">
              <Brain className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-nexus-300">{data?.count ?? 0}</div>
          <div className="mt-1 text-[11px] text-nexus-400/60">Active records in &quot;{namespace}&quot;</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nexus-500" />
        </div>
      </div>

      {/* Store new memory */}
      <div className="rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-950/20 to-white/[0.02] p-5 sm:p-6 backdrop-blur-xl space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Plus className="h-4 w-4 text-nexus-400" /> Store Memory Record
        </h2>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="Write a memory entry (knowledge, note, context)…"
          rows={3}
          className="w-full rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-2.5 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none resize-y font-mono"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            value={newScope}
            onChange={(e) => setNewScope(e.target.value as 'short' | 'long')}
            className="h-10 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white focus:border-nexus-500 focus:outline-none"
          >
            <option value="short">short (session)</option>
            <option value="long">long (persistent)</option>
          </select>
          <input
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            placeholder="contentType (e.g. note)"
            className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none font-mono"
          />
          <button
            onClick={store}
            disabled={storing || !newContent.trim()}
            className="h-10 rounded-xl bg-nexus-600 px-5 text-xs font-semibold text-white transition hover:bg-nexus-500 active:scale-95 shadow-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> {storing ? 'Storing…' : 'Store'}
          </button>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      {/* Semantic Search Toolbar */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Search className="h-4 w-4 text-nexus-400" /> Semantic Vector Search
        </h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
            placeholder="namespace (e.g. default)"
            className="h-10 sm:w-48 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none font-mono"
          />
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Query semantic memory vectors..."
              className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] pl-10 pr-4 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none"
            />
          </div>
          <button
            onClick={search}
            className="h-10 rounded-xl bg-nexus-600 px-5 text-xs font-semibold text-white transition hover:bg-nexus-500 active:scale-95 shadow-md flex items-center justify-center gap-1.5"
          >
            <Search className="h-4 w-4" /> Vector Search
          </button>
        </div>

        {searchResults.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
            {searchResults.map((r) => (
              <div key={r.record.id} className="rounded-xl border border-nexus-500/30 bg-nexus-950/20 p-3.5 text-xs">
                <div className="flex items-center justify-between text-white/50 font-mono text-[11px]">
                  <span>{r.record.namespace} · {r.record.scope} scope</span>
                  <span className="text-emerald-400 font-bold">Similarity Score: {r.score.toFixed(3)}</span>
                </div>
                <div className="mt-2 text-white/90 font-mono">{r.record.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Memory Stream List */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-emerald-400" /> Recent Memory Tokens in &quot;{namespace}&quot;
        </h2>
        <div className="max-h-96 overflow-y-auto space-y-2.5 font-mono text-xs pr-1">
          {isLoading ? (
            <div className="py-8 text-center text-xs text-white/40">Querying memory store...</div>
          ) : memories.length === 0 ? (
            <div className="py-8 text-center text-xs text-white/40">No memory tokens recorded in this namespace.</div>
          ) : (
            memories.map((m) => (
              <div key={m.id} className="relative rounded-xl border border-white/5 bg-black/40 p-3.5 transition hover:border-white/20">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-white/40">{new Date(m.createdAt).toLocaleString()}</span>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                      m.scope === 'short' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {m.scope}
                    </span>
                    <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-nexus-300">{m.contentType}</span>
                    <span className="text-white/50">{m.tokenCount} tokens</span>
                  </div>
                </div>
                <div className="mt-2 text-white/80">{m.content}</div>
                <button
                  onClick={() => remove(m.id)}
                  className="absolute right-3 top-3 rounded-lg border border-red-500/20 bg-red-500/10 p-1.5 text-red-400 transition hover:border-red-500/40 hover:bg-red-500/20"
                  title="Delete memory"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


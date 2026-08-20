'use client';

import { ChevronRight, RefreshCw, Send, Terminal, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { etagFetcher } from '@/lib/etagFetcher';

const fetcher = etagFetcher;

interface DetachedTask {
  id: string;
  model: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  content?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: string;
}

interface TaskListResponse {
  tasks: DetachedTask[];
}

function timeAgo(ts: number | undefined): string {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function statusBadge(status: DetachedTask['status']) {
  switch (status) {
    case 'completed':
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300"><CheckCircle2 className="h-3 w-3" /> completed</span>;
    case 'failed':
      return <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300"><XCircle className="h-3 w-3" /> failed</span>;
    case 'running':
      return <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300"><Loader2 className="h-3 w-3 animate-spin" /> running</span>;
    default:
      return <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-white/50"><Clock className="h-3 w-3" /> pending</span>;
  }
}

export default function DetachedTasksPage() {
  const [model, setModel] = useState('opencode-zen/hy3-free');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [poll, setPoll] = useState<DetachedTask | null>(null);
  const [polling, setPolling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh the list so running tasks flip to completed without manual refresh.
  const { data, mutate } = useSWR<TaskListResponse>('/api/v1/tasks', fetcher, {
    refreshInterval: 4000,
    revalidateOnFocus: true,
  });

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const fire = useCallback(async () => {
    if (!prompt.trim()) {
      setSubmitError('Enter a prompt first.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      setPrompt('');
      await mutate();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [model, prompt, mutate]);

  const openPoll = useCallback(async (id: string) => {
    setExpanded(id);
    const load = async () => {
      const res = await fetch(`/api/v1/tasks/${id}`);
      if (res.ok) {
        const t: DetachedTask = await res.json();
        setPoll(t);
        if (t.status === 'completed' || t.status === 'failed') {
          if (pollTimer.current) clearInterval(pollTimer.current);
        }
      }
    };
    setPolling(true);
    await load();
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(load, 1500);
    setPolling(false);
  }, []);

  const closePoll = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setExpanded(null);
    setPoll(null);
  }, []);

  const tasks = data?.tasks ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Terminal className="h-6 w-6 text-cyan-400" /> Detached Tasks
        </h1>
        <p className="text-sm text-white/50">
          Fire a long-running completion that runs on the gateway even if your browser disconnects.
          Poll by job id to resume — à la <code className="rounded bg-white/10 px-1">/fork</code>.
        </p>
      </header>

      {/* Compose */}
      <div className="rounded-2xl border border-white/10 bg-black/40 p-5 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-72 rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 font-mono text-sm text-white outline-none focus:border-cyan-400/60"
            placeholder="model (e.g. opencode-zen/hy3-free)"
          />
          <button
            onClick={fire}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/90 px-4 py-1.5 text-sm font-medium text-black transition hover:bg-cyan-400 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? 'Firing…' : 'Fire detached task'}
          </button>
          <button
            onClick={() => mutate()}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className="w-full resize-y rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/60"
          placeholder="Prompt for the detached coding-agent run…"
        />
        {submitError && <p className="mt-2 text-xs text-red-400">{submitError}</p>}
      </div>

      {/* List */}
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-white/40">Jobs ({tasks.length})</div>
        {tasks.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40">
            No detached tasks yet. Fire one above.
          </div>
        )}
        {tasks.map((t) => (
          <div key={t.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {statusBadge(t.status)}
                <span className="truncate font-mono text-sm text-white/80">{t.model}</span>
                <span className="font-mono text-xs text-white/40">{t.id}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/40">{timeAgo(t.createdAt)}</span>
                <button
                  onClick={() => (expanded === t.id ? closePoll() : openPoll(t.id))}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/5"
                >
                  {expanded === t.id ? 'Hide' : 'Poll'} <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
            {t.usage && (
              <div className="mt-1 text-xs text-white/40">
                {t.usage.promptTokens}↑ / {t.usage.completionTokens}↓ · {t.usage.totalTokens} total tokens
              </div>
            )}
            {expanded === t.id && poll && (
              <div className="mt-3 rounded-lg border border-white/5 bg-black/50 p-3">
                {polling && !poll.content && poll.status === 'running' && (
                  <div className="flex items-center gap-2 text-xs text-white/50"><Loader2 className="h-3 w-3 animate-spin" /> running…</div>
                )}
                {poll.status === 'failed' && <pre className="whitespace-pre-wrap text-xs text-red-300">{poll.error}</pre>}
                {poll.content && (
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-white/80">{poll.content}</pre>
                )}
                {!poll.content && poll.status !== 'failed' && poll.status !== 'running' && (
                  <div className="text-xs text-white/40">Waiting for result…</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

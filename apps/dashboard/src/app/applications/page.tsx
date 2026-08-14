'use client';

import { Boxes, RefreshCw, Play, Square, RotateCw, Plus, AlertTriangle, CheckCircle2, Loader2, ListTree } from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';

import { etagFetcher } from '@/lib/etagFetcher';

const fetcher = etagFetcher;

interface ApplicationSummary {
  appId: string;
  objective: string;
  stage: string;
  createdAt?: number;
}

interface ApplicationsResponse {
  applications: ApplicationSummary[];
}

interface AppState {
  appId: string;
  stage: string;
  spec?: { description?: string; features?: string[] };
  architecture?: { components?: { name: string; type: string }[] };
  workspace?: { workspacePath?: string };
  buildContext?: {
    requiresApproval?: boolean;
    riskLevel?: string;
    riskFlags?: string[];
    selectedModel?: string;
    selectedProvider?: string;
    repairAttempts?: number;
    maxRepairAttempts?: number;
    lastTestResult?: { passed: number; failed: number };
  };
  workflowId?: string;
  runId?: string;
  repairAttempts?: number;
  error?: string;
  eventCount?: number;
}

function stagePill(stage: string): string {
  switch (stage) {
    case 'COMPLETED':
      return 'pill pill-healthy';
    case 'FAILED':
      return 'pill bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30';
    case 'BUILDING':
    case 'SCAFFOLD':
    case 'IMPLEMENT':
    case 'TEST':
    case 'VERIFY':
      return 'pill bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30';
    default:
      return 'pill bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/30';
  }
}

function riskPill(level?: string): string {
  if (level === 'CRITICAL' || level === 'HIGH')
    return 'pill bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30';
  if (level === 'MEDIUM') return 'pill bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30';
  return 'pill bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30';
}

export default function ApplicationsPage() {
  const [objective, setObjective] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, mutate } = useSWR<ApplicationsResponse>('/api/v1/applications', fetcher, {
    refreshInterval: 10000,
  });

  const apps = data?.applications ?? [];
  const selected = selectedId ?? (apps[0]?.appId ?? null);

  const { data: detail, mutate: mutateDetail } = useSWR<AppState>(
    selected ? `/api/v1/applications/${selected}/state` : null,
    fetcher,
    { refreshInterval: 5000 },
  );

  const createApp = useCallback(async () => {
    if (!objective.trim()) return;
    setBusy('create');
    setError(null);
    try {
      const res = await fetch('/api/v1/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objective: objective.trim() }),
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      setObjective('');
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [objective, mutate]);

  const act = useCallback(
    async (id: string, action: 'plan' | 'build' | 'cancel' | 'retry', body?: object) => {
      setBusy(`${action}:${id}`);
      setError(null);
      try {
        const res = await fetch(`/api/v1/applications/${id}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`${action} failed (${res.status}): ${txt.slice(0, 120)}`);
        }
        await mutateDetail();
        await mutate();
        void globalMutate('/api/v1/applications');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [mutate, mutateDetail],
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Boxes className="h-7 w-7 text-sky-400" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Application Operations Center</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Autonomous application lifecycle — plan, build, verify, recover.
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            void mutate();
            if (selected) void mutateDetail();
          }}
          className="pill bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/20"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </header>

      {error && (
        <div className="card mb-4 ring-1 ring-rose-500/30" style={{ background: 'rgba(244,63,94,0.08)' }}>
          <p className="flex items-center gap-2 text-sm text-rose-300">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <input
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createApp();
          }}
          placeholder="Describe an application to build autonomously…"
          className="flex-1 rounded-lg border px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sky-500/40"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        />
        <button
          onClick={() => void createApp()}
          disabled={busy === 'create' || !objective.trim()}
          className="pill bg-sky-500/90 text-white ring-1 ring-sky-400/40 hover:bg-sky-400 disabled:opacity-50"
        >
          {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        {/* List */}
        <section className="card h-fit">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            <ListTree className="h-4 w-4" /> Applications ({apps.length})
          </h2>
          {isLoading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
          {!isLoading && apps.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No applications yet. Create one above to start an autonomous build.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {apps.map((a, i) => (
              <li key={`${i}-${a.appId}`}>
                <button
                  onClick={() => setSelectedId(a.appId)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                    selected === a.appId ? 'border-sky-500/50 bg-sky-500/10' : 'hover:border-sky-500/30'
                  }`}
                  style={{ borderColor: selected === a.appId ? undefined : 'var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {a.appId.slice(0, 12)}
                    </span>
                    <span className={stagePill(a.stage)}>{a.stage}</span>
                  </div>
                  <p className="mt-1 truncate text-sm" style={{ color: 'var(--text-primary)' }}>
                    {a.objective}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Detail */}
        <section className="card">
          {!detail && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select an application to inspect.</p>}
          {detail && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    {apps.find((a) => a.appId === detail.appId)?.objective ?? detail.appId}
                  </h2>
                  <p className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {detail.appId}
                  </p>
                </div>
                <span className={stagePill(detail.stage)}>{detail.stage}</span>
              </div>

              {detail.error && (
                <div className="rounded-lg p-3 text-sm text-rose-300" style={{ background: 'rgba(244,63,94,0.08)' }}>
                  {detail.error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="card">
                  <div className="stat-label">Risk</div>
                  <div className="mt-1">
                    <span className={riskPill(detail.buildContext?.riskLevel)}>
                      {detail.buildContext?.riskLevel ?? 'LOW'}
                    </span>
                  </div>
                </div>
                <div className="card">
                  <div className="stat-label">Repair</div>
                  <div className="stat-value text-xl">
                    {detail.buildContext?.repairAttempts ?? detail.repairAttempts ?? 0}
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      /{detail.buildContext?.maxRepairAttempts ?? 3}
                    </span>
                  </div>
                </div>
                <div className="card">
                  <div className="stat-label">Model</div>
                  <div className="mt-1 truncate font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {detail.buildContext?.selectedModel ?? '—'}
                  </div>
                </div>
                <div className="card">
                  <div className="stat-label">Provider</div>
                  <div className="mt-1 truncate font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {detail.buildContext?.selectedProvider ?? '—'}
                  </div>
                </div>
              </div>

              {detail.buildContext?.riskFlags && detail.buildContext.riskFlags.length > 0 && (
                <div>
                  <div className="stat-label mb-1">Risk Flags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.buildContext.riskFlags.map((f, i) => (
                      <span key={`${i}-${f}`} className="pill bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.architecture?.components && detail.architecture.components.length > 0 && (
                <div>
                  <div className="stat-label mb-1">Architecture</div>
                  <ul className="flex flex-col gap-1">
                    {detail.architecture.components.map((c, i) => (
                      <li key={`${i}-${c.name}`} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> {c.name}
                        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>({c.type})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.workspace?.workspacePath && (
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Workspace: <span className="font-mono">{detail.workspace.workspacePath}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => void act(detail.appId, 'plan')}
                  disabled={!!busy}
                  className="pill bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/20 disabled:opacity-50"
                >
                  {busy === `plan:${detail.appId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Plan
                </button>
                <button
                  onClick={() => void act(detail.appId, 'build')}
                  disabled={!!busy}
                  className="pill bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {busy === `build:${detail.appId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Build
                </button>
                <button
                  onClick={() => void act(detail.appId, 'retry')}
                  disabled={!!busy}
                  className="pill bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {busy === `retry:${detail.appId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />} Retry
                </button>
                <button
                  onClick={() => void act(detail.appId, 'cancel')}
                  disabled={!!busy}
                  className="pill bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/20 disabled:opacity-50"
                >
                  {busy === `cancel:${detail.appId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Cancel
                </button>
              </div>

              {detail.eventCount !== undefined && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {detail.eventCount} lifecycle events recorded.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

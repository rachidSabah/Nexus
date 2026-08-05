'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Workflow, Play, Pause, Square, RotateCcw, Plus } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  version: number;
  steps: Array<{ name: string; agent?: string; task: string }>;
  tags?: string[];
}

interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  steps: Array<{ index: number; stepName: string; agentId: string; status: string }>;
  totalCostUsd: number;
  totalTokensUsed: number;
}

export default function WorkflowsPage() {
  const { data: workflows, isLoading } = useSWR<readonly WorkflowDef[]>('/api/v1/workflows', fetcher, { refreshInterval: 5000 });
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const { data: executions } = useSWR<readonly WorkflowExecution[]>(
    selectedId ? `/api/v1/workflows/${selectedId}/executions?limit=20` : null,
    fetcher,
    { refreshInterval: 3000 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Workflow className="h-6 w-6 text-nexus-400" />
          Workflows
        </h1>
        <p className="text-sm text-white/50">Define, version, execute, and replay multi-agent workflows.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Workflow list */}
        <div className="card lg:col-span-1">
          <h2 className="mb-3 text-sm font-medium text-white/80">Definitions</h2>
          <div className="space-y-2">
            {isLoading ? (
              <div className="py-4 text-center text-sm text-white/40">Loading…</div>
            ) : (workflows ?? []).length === 0 ? (
              <div className="py-4 text-center text-sm text-white/40">No workflows defined.</div>
            ) : (
              (workflows ?? []).map((w) => (
                <button
                  key={`${w.id}-${w.version}`}
                  onClick={() => setSelectedId(w.id)}
                  className={`w-full rounded-lg p-3 text-left transition ${selectedId === w.id ? 'bg-white/10' : 'bg-white/[0.02] hover:bg-white/5'}`}
                >
                  <div className="text-sm font-medium">{w.name}</div>
                  <div className="mt-0.5 text-xs text-white/40">
                    v{w.version} · {w.steps.length} steps
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Workflow detail / visual builder */}
        <div className="card lg:col-span-2">
          {selectedId ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-white/80">
                  {workflows?.find((w) => w.id === selectedId)?.name} — visual builder
                </h2>
                <button className="rounded-lg bg-nexus-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-nexus-500">
                  <Plus className="h-3 w-3" /> Step
                </button>
              </div>
              {/* Visual step flow */}
              <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2">
                {workflows?.find((w) => w.id === selectedId)?.steps.map((step, i) => (
                  <div key={i} className="flex items-center">
                    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-center min-w-[140px]">
                      <div className="text-xs font-medium text-nexus-300">{step.name}</div>
                      <div className="mt-1 text-[10px] text-white/40">{step.agent ?? 'auto'}</div>
                    </div>
                    {i < (workflows?.find((w) => w.id === selectedId)?.steps.length ?? 0) - 1 && (
                      <div className="px-1 text-white/20">→</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Executions */}
              <h3 className="mt-6 mb-3 text-xs font-medium uppercase tracking-wider text-white/40">Recent executions</h3>
              <div className="space-y-2">
                {(executions ?? []).length === 0 ? (
                  <div className="py-4 text-center text-sm text-white/40">No executions yet.</div>
                ) : (
                  (executions ?? []).map((ex) => (
                    <div key={ex.id} className="rounded-lg bg-black/30 p-3">
                      <div className="flex items-center justify-between">
                        <span className={`pill pill-${ex.status === 'completed' ? 'healthy' : ex.status === 'failed' ? 'unhealthy' : 'degraded'}`}>
                          {ex.status}
                        </span>
                        <span className="font-mono text-[10px] text-white/30">{ex.id.slice(0, 8)}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-xs text-white/60">
                        <span>{new Date(ex.startedAt).toLocaleTimeString()}</span>
                        <span>${ex.totalCostUsd.toFixed(4)}</span>
                        <span>{ex.totalTokensUsed} tok</span>
                      </div>
                      <div className="mt-2 flex gap-1">
                        {ex.steps.map((s) => (
                          <div
                            key={s.index}
                            className={`h-1.5 flex-1 rounded-full ${
                              s.status === 'completed' ? 'bg-emerald-500' :
                              s.status === 'failed' ? 'bg-rose-500' :
                              s.status === 'running' ? 'bg-amber-500' :
                              s.status === 'skipped' ? 'bg-white/10' :
                              'bg-white/5'
                            }`}
                            title={`${s.stepName}: ${s.status}`}
                          />
                        ))}
                      </div>
                      <div className="mt-2 flex gap-2">
                        {ex.status === 'running' && (
                          <button className="rounded-md bg-amber-600/20 px-2 py-1 text-xs text-amber-300 hover:bg-amber-600/30">
                            <Pause className="h-3 w-3" /> Pause
                          </button>
                        )}
                        {ex.status === 'paused' && (
                          <button className="rounded-md bg-emerald-600/20 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-600/30">
                            <Play className="h-3 w-3" /> Resume
                          </button>
                        )}
                        {(ex.status === 'running' || ex.status === 'paused') && (
                          <button className="rounded-md bg-rose-600/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-600/30">
                            <Square className="h-3 w-3" /> Cancel
                          </button>
                        )}
                        {(ex.status === 'completed' || ex.status === 'failed') && (
                          <button className="rounded-md bg-white/5 px-2 py-1 text-xs text-white/60 hover:bg-white/10">
                            <RotateCcw className="h-3 w-3" /> Replay
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="py-16 text-center text-sm text-white/40">
              Select a workflow on the left to view its visual builder and execution history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

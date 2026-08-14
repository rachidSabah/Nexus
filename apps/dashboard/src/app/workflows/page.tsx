'use client';

import { Workflow, Play, Pause, Square, RotateCcw, Sparkles, Activity, Cpu } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

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
  const { data: executions, mutate: refreshExecutions } = useSWR<readonly WorkflowExecution[]>(
    selectedId ? `/api/v1/workflows/${selectedId}/executions?limit=20` : null,
    fetcher,
    { refreshInterval: 3000 },
  );

  async function callExecutionEndpoint(executionId: string, action: 'pause' | 'resume' | 'cancel' | 'replay') {
    if (!selectedId) return;
    const url = `/api/v1/workflows/${selectedId}/executions/${executionId}/${action}`;
    try {
      const r = await fetch(url, { method: 'POST' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: { message: 'Request failed' } }));
        alert(`Failed to ${action} execution: ${body?.error?.message ?? r.statusText}`);
      }
      await refreshExecutions();
    } catch (err) {
      alert(`Failed to ${action} execution: ${(err as Error).message}`);
    }
  }

  async function startExecution(workflowId: string) {
    const inputs = prompt('Optional inputs (JSON):');
    let parsedInputs: Record<string, unknown> | undefined;
    if (inputs) {
      try {
        parsedInputs = JSON.parse(inputs);
      } catch {
        alert('Invalid JSON inputs');
        return;
      }
    }
    const r = await fetch(`/api/v1/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: parsedInputs ?? {} }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({ error: { message: 'Failed to start' } }));
      alert(`Failed to start: ${body?.error?.message ?? r.statusText}`);
      return;
    }
    await refreshExecutions();
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
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Multi-Agent Orchestration & Replay
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Workflow className="h-8 w-8 text-nexus-400" />
            Multi-Agent Workflows & Executions
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Execute, pause, inspect, and replay multi-step agent pipelines across your local AI gateway.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Workflow Definitions Sidebar */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl lg:col-span-1">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
            <Workflow className="h-4 w-4 text-nexus-400" /> Registered Workflow Definitions
          </h2>
          <div className="space-y-3">
            {isLoading ? (
              <div className="py-6 text-center text-xs text-white/40">Loading workflows...</div>
            ) : (workflows ?? []).length === 0 ? (
              <div className="py-6 text-center text-xs text-white/40">No workflows registered.</div>
            ) : (
              (workflows ?? []).map((w) => (
                <div key={`${w.id}-${w.version}`} className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedId(w.id)}
                    className={`flex-1 rounded-xl p-3.5 text-left border transition ${
                      selectedId === w.id
                        ? 'border-nexus-500/50 bg-nexus-500/10 shadow-md'
                        : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="text-sm font-bold text-white">{w.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-white/50">
                      <span>v{w.version}</span>
                      <span>· {w.steps.length} step{w.steps.length !== 1 ? 's' : ''}</span>
                    </div>
                  </button>
                  <button
                    onClick={() => startExecution(w.id)}
                    title="Dispatch Execution"
                    className="rounded-xl bg-gradient-to-r from-nexus-600 to-cyan-600 p-3 text-white transition hover:scale-105 active:scale-95 shadow-md"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Workflow Visual Builder & Execution History */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl lg:col-span-2">
          {selectedId ? (
            <>
              <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-emerald-400" /> {workflows?.find((w) => w.id === selectedId)?.name} — Visual Step Flow
                </h2>
              </div>

              {/* Visual step flow */}
              <div className="flex items-center gap-2 overflow-x-auto pb-3">
                {workflows?.find((w) => w.id === selectedId)?.steps.map((step, i) => (
                  <div key={i} className="flex items-center">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center min-w-[130px]">
                      <div className="text-xs font-bold text-nexus-300">{step.name}</div>
                      <div className="mt-1 text-[10px] text-white/40 font-mono">Agent: {step.agent ?? 'auto'}</div>
                    </div>
                    {i < (workflows?.find((w) => w.id === selectedId)?.steps.length ?? 0) - 1 && (
                      <div className="px-2 text-white/30 text-xs font-mono">→</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Executions */}
              <h3 className="mt-6 mb-3 text-xs font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-400" /> Live Execution Stream & History
              </h3>
              <div className="space-y-3">
                {(executions ?? []).length === 0 ? (
                  <div className="py-6 text-center text-xs text-white/40">No execution history recorded.</div>
                ) : (
                  (executions ?? []).map((ex) => (
                    <div key={ex.id} className="rounded-xl border border-white/5 bg-black/40 p-4">
                      <div className="flex items-center justify-between">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize border ${
                          ex.status === 'completed' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
                          ex.status === 'failed' ? 'border-rose-500/30 bg-rose-500/10 text-rose-400' :
                          'border-amber-500/30 bg-amber-500/10 text-amber-400'
                        }`}>
                          {ex.status}
                        </span>
                        <span className="font-mono text-[11px] text-white/40">ID: {ex.id.slice(0, 10)}</span>
                      </div>

                      <div className="mt-3 flex items-center gap-4 text-xs font-mono text-white/70">
                        <span>Started: {new Date(ex.startedAt).toLocaleTimeString()}</span>
                        <span>Cost: ${ex.totalCostUsd.toFixed(4)}</span>
                        <span>Tokens: {ex.totalTokensUsed.toLocaleString()}</span>
                      </div>

                      <div className="mt-3 flex gap-1.5">
                        {ex.steps.map((s) => (
                          <div
                            key={s.index}
                            className={`h-2 flex-1 rounded-full ${
                              s.status === 'completed' ? 'bg-emerald-400' :
                              s.status === 'failed' ? 'bg-rose-500' :
                              s.status === 'running' ? 'bg-amber-400 animate-pulse' :
                              s.status === 'skipped' ? 'bg-white/10' :
                              'bg-white/5'
                            }`}
                            title={`${s.stepName}: ${s.status}`}
                          />
                        ))}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        {ex.status === 'running' && (
                          <button
                            onClick={() => callExecutionEndpoint(ex.id, 'pause')}
                            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-300 transition hover:bg-amber-500/20"
                          >
                            <Pause className="h-3 w-3 inline mr-1" /> Pause
                          </button>
                        )}
                        {ex.status === 'paused' && (
                          <button
                            onClick={() => callExecutionEndpoint(ex.id, 'resume')}
                            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300 transition hover:bg-emerald-500/20"
                          >
                            <Play className="h-3 w-3 inline mr-1" /> Resume
                          </button>
                        )}
                        {(ex.status === 'running' || ex.status === 'paused') && (
                          <button
                            onClick={() => callExecutionEndpoint(ex.id, 'cancel')}
                            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs text-rose-300 transition hover:bg-rose-500/20"
                          >
                            <Square className="h-3 w-3 inline mr-1" /> Cancel
                          </button>
                        )}
                        {(ex.status === 'completed' || ex.status === 'failed') && (
                          <button
                            onClick={() => callExecutionEndpoint(ex.id, 'replay')}
                            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 transition hover:bg-white/10"
                          >
                            <RotateCcw className="h-3 w-3 inline mr-1" /> Replay Execution
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="py-20 text-center text-xs text-white/40">
              Select a workflow definition on the left to inspect its visual pipeline and execution history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



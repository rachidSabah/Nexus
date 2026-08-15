'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  Pause,
  Play,
  Shield,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface MissionTask {
  taskId: string;
  type: string;
  title: string;
  objective: string;
  requiredCapabilities: string[];
  risk: string;
  dependencies: string[];
  selectedAgent?: string;
  selectedModel?: string;
  selectedProvider?: string;
  status: 'PENDING' | 'BLOCKED' | 'READY' | 'ASSIGNED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  durationMs?: number;
  output?: string;
  error?: string;
  repairAttempts?: number;
}

interface MissionPlan {
  missionId: string;
  objective: string;
  tasks: MissionTask[];
  estimatedDurationMs: number;
  riskLevel: string;
  requiresApproval: boolean;
  approvalReason?: string;
  maxParallelTasks: number;
}

interface Mission {
  id: string;
  spec: {
    objective: string;
    workspace?: string;
    policy?: string;
    type?: string;
  };
  status:
    | 'CREATED'
    | 'DISCOVERING'
    | 'PLANNING'
    | 'RISK_ANALYSIS'
    | 'AWAITING_APPROVAL'
    | 'READY'
    | 'EXECUTING'
    | 'VERIFYING'
    | 'REPAIRING'
    | 'REASSIGNING'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED'
    | 'PAUSED';
  plan?: MissionPlan;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  approvedAt?: number;
  currentTaskId?: string;
  activeTaskIds: string[];
  completedTaskIds: string[];
  failedTaskIds: string[];
  totalTokens: number;
  estimatedCost: number;
  tokenSavings: number;
  failoverCount: number;
  repairCount: number;
  verification?: {
    status: 'PASSED' | 'FAILED' | 'PARTIAL' | 'BLOCKED';
    checks: Array<{ name: string; passed: boolean; message: string }>;
  };
}

export default function MissionsPage() {
  const { data: missionData, mutate } = useSWR<{ missions: Mission[] }>(
    '/api/v1/missions',
    fetcher,
    { refreshInterval: 2500 },
  );
  const { data: debugData } = useSWR('/api/v1/debug/missions', fetcher, { refreshInterval: 3000 });

  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [objectiveInput, setObjectiveInput] = useState('');
  const [policyInput, setPolicyInput] = useState('nexus/auto');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const missions = missionData?.missions ?? [];
  const selectedMission =
    missions.find((m) => m.id === selectedMissionId) ?? missions[0] ?? null;

  const handleCreateMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!objectiveInput.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/v1/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: objectiveInput.trim(),
          policy: policyInput,
        }),
      });
      const newMission = await res.json();
      if (newMission?.id) {
        setSelectedMissionId(newMission.id);
        setObjectiveInput('');
        mutate();
      }
    } catch {
      // ignore
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAction = async (action: 'plan' | 'approve' | 'execute' | 'pause' | 'resume' | 'cancel') => {
    if (!selectedMission || actionLoading) return;
    setActionLoading(true);
    try {
      await fetch(`/api/v1/missions/${selectedMission.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      mutate();
    } catch {
      // ignore
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusColor = (status: Mission['status']) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60';
      case 'EXECUTING':
      case 'VERIFYING':
        return 'text-sky-400 bg-sky-950/40 border-sky-800/60 animate-pulse';
      case 'REPAIRING':
      case 'REASSIGNING':
        return 'text-amber-400 bg-amber-950/40 border-amber-800/60 animate-pulse';
      case 'AWAITING_APPROVAL':
        return 'text-orange-400 bg-orange-950/40 border-orange-800/60';
      case 'FAILED':
        return 'text-rose-400 bg-rose-950/40 border-rose-800/60';
      case 'CANCELLED':
      case 'PAUSED':
        return 'text-slate-400 bg-slate-900/60 border-slate-800';
      default:
        return 'text-indigo-400 bg-indigo-950/40 border-indigo-800/60';
    }
  };

  const getTaskStatusBadge = (status: MissionTask['status']) => {
    switch (status) {
      case 'COMPLETED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">COMPLETED</span>;
      case 'RUNNING':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-sky-950/60 text-sky-300 border border-sky-800/60 animate-pulse">RUNNING</span>;
      case 'FAILED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-rose-950/60 text-rose-300 border border-rose-800/60">FAILED</span>;
      case 'READY':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">READY</span>;
      case 'BLOCKED':
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-slate-900/60 text-slate-400 border border-slate-800">BLOCKED</span>;
      default:
        return <span className="px-2 py-0.5 text-xs font-medium rounded bg-slate-900/60 text-slate-400 border border-slate-800">{status}</span>;
    }
  };

  const tasks = selectedMission?.plan?.tasks ?? [];
  const completedCount = selectedMission?.completedTaskIds?.length ?? 0;
  const totalCount = tasks.length || 1;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-950/80 border border-indigo-800/50 text-indigo-400 shadow-inner">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
                Mission Control
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-900/50 border border-indigo-700/40 text-indigo-300 font-mono">
                  v0.5.0 Phase 29
                </span>
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Unified autonomous AI mission decomposition, multi-agent DAG scheduling & repair loops
              </p>
            </div>
          </div>
        </div>

        {/* Global Telemetry Card */}
        <div className="flex items-center gap-4 bg-slate-900/80 border border-slate-800 px-4 py-2.5 rounded-xl">
          <div className="text-right border-r border-slate-800 pr-4">
            <div className="text-xs text-slate-400">Total Missions</div>
            <div className="text-lg font-bold text-white font-mono">{debugData?.metrics?.totalMissions ?? missions.length}</div>
          </div>
          <div className="text-right border-r border-slate-800 pr-4">
            <div className="text-xs text-slate-400">Repairs Triggered</div>
            <div className="text-lg font-bold text-amber-400 font-mono">{debugData?.metrics?.totalRepairs ?? 0}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">Tokens Processed</div>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              {(debugData?.metrics?.totalTokensConsumed ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Mission Creation Form */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
        <form onSubmit={handleCreateMission} className="flex flex-col md:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Describe your objective (e.g. 'Build a customer REST API with authentication and tests')"
              value={objectiveInput}
              onChange={(e) => setObjectiveInput(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div className="w-full md:w-52">
            <select
              value={policyInput}
              onChange={(e) => setPolicyInput(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
            >
              <option value="nexus/auto">nexus/auto</option>
              <option value="nexus/best-coding">nexus/best-coding</option>
              <option value="nexus/fast">nexus/fast</option>
              <option value="nexus/quality">nexus/quality</option>
              <option value="nexus/low-cost">nexus/low-cost</option>
              <option value="nexus/application-builder">nexus/application-builder</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !objectiveInput.trim()}
            className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-all shadow-md shadow-indigo-950/40"
          >
            <Sparkles className="w-4 h-4" />
            {isSubmitting ? 'Decomposing...' : 'Launch Mission'}
          </button>
        </form>
      </div>

      {/* Main Grid: Mission Selector & Live Active Mission */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Mission History */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-800/60">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Missions List</span>
            <span className="text-xs text-slate-500 font-mono">{missions.length} recorded</span>
          </div>

          <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
            {missions.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                No missions created yet. Enter an objective above to start.
              </div>
            ) : (
              missions.map((m) => {
                const isSelected = selectedMission?.id === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMissionId(m.id)}
                    className={`text-left p-3.5 rounded-xl border transition-all flex flex-col gap-2 ${
                      isSelected
                        ? 'bg-slate-800/80 border-indigo-600/70 shadow-sm'
                        : 'bg-slate-950/40 border-slate-800/60 hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-slate-400">{m.id}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${getStatusColor(m.status)}`}>
                        {m.status}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-slate-200 line-clamp-2">{m.spec.objective}</div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                      <span>{m.plan?.tasks?.length ?? 0} tasks</span>
                      <span>•</span>
                      <span>${m.estimatedCost.toFixed(4)}</span>
                      <span>•</span>
                      <span>{m.totalTokens.toLocaleString()} tok</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right 2-Columns: Selected Mission Details & Interactive DAG */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {selectedMission ? (
            <>
              {/* Mission Header Card */}
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 flex flex-col gap-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
                      {selectedMission.id}
                    </span>
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${getStatusColor(selectedMission.status)}`}>
                      {selectedMission.status}
                    </span>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="flex items-center gap-2">
                    {selectedMission.status === 'AWAITING_APPROVAL' && (
                      <button
                        onClick={() => handleAction('approve')}
                        disabled={actionLoading}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow-sm"
                      >
                        <Shield className="w-3.5 h-3.5" />
                        Approve Execution
                      </button>
                    )}
                    {selectedMission.status === 'READY' && (
                      <button
                        onClick={() => handleAction('execute')}
                        disabled={actionLoading}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Execute
                      </button>
                    )}
                    {selectedMission.status === 'EXECUTING' && (
                      <button
                        onClick={() => handleAction('pause')}
                        disabled={actionLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        Pause
                      </button>
                    )}
                    {selectedMission.status === 'PAUSED' && (
                      <button
                        onClick={() => handleAction('resume')}
                        disabled={actionLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Resume
                      </button>
                    )}
                    {['EXECUTING', 'REPAIRING', 'READY', 'PAUSED'].includes(selectedMission.status) && (
                      <button
                        onClick={() => handleAction('cancel')}
                        disabled={actionLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 text-xs font-semibold rounded-lg border border-rose-800/60"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <h2 className="text-xl font-bold text-white">{selectedMission.spec.objective}</h2>
                  <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-400 font-mono">
                    <span>Policy: <span className="text-indigo-300">{selectedMission.spec.policy}</span></span>
                    <span>•</span>
                    <span>Tokens: <span className="text-slate-200">{selectedMission.totalTokens.toLocaleString()}</span></span>
                    <span>•</span>
                    <span>Cost: <span className="text-slate-200">${selectedMission.estimatedCost.toFixed(4)}</span></span>
                    <span>•</span>
                    <span>Repairs: <span className="text-amber-400">{selectedMission.repairCount}</span></span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Task Progress</span>
                    <span className="font-mono">{completedCount} / {tasks.length} ({progressPct}%)</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                    <div
                      className="bg-indigo-500 h-full transition-all duration-500 rounded-full"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Verification & Risk Notice if any */}
              {selectedMission.status === 'AWAITING_APPROVAL' && (
                <div className="bg-orange-950/30 border border-orange-800/60 rounded-2xl p-4 flex items-start gap-3 text-sm text-orange-200">
                  <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-orange-300">Approval Required</div>
                    <div className="text-xs text-orange-200/80 mt-0.5">
                      {selectedMission.plan?.approvalReason ?? 'This mission contains elevated or high-risk execution steps.'}
                    </div>
                  </div>
                </div>
              )}

              {selectedMission.verification && (
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      Verification Engine Report
                    </span>
                    <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${
                      selectedMission.verification.status === 'PASSED'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : 'bg-rose-950 text-rose-400 border-rose-800'
                    }`}>
                      {selectedMission.verification.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {selectedMission.verification.checks.map((c, i) => (
                      <div key={i} className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/60 text-xs flex items-center gap-2">
                        {c.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                        )}
                        <div>
                          <div className="font-medium text-slate-200">{c.name}</div>
                          <div className="text-slate-400 text-[11px]">{c.message}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive DAG Task Nodes */}
              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Mission Execution DAG ({tasks.length} Nodes)
                  </span>
                  <span className="text-xs text-slate-500 font-mono">Max parallel: {selectedMission.plan?.maxParallelTasks ?? 4}</span>
                </div>

                <div className="flex flex-col gap-3">
                  {tasks.map((task, idx) => (
                    <div
                      key={task.taskId}
                      className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col gap-2.5 hover:border-slate-700 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-500">#{idx + 1}</span>
                          <span className="text-sm font-semibold text-slate-100">{task.title}</span>
                        </div>
                        {getTaskStatusBadge(task.status)}
                      </div>

                      <p className="text-xs text-slate-400">{task.objective}</p>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-900 text-xs font-mono text-slate-500">
                        <div className="flex items-center gap-3">
                          <span>Type: <span className="text-slate-300">{task.type}</span></span>
                          {task.selectedAgent && (
                            <span>Agent: <span className="text-indigo-400">{task.selectedAgent}</span></span>
                          )}
                          {task.repairAttempts && task.repairAttempts > 0 ? (
                            <span>Repairs: <span className="text-amber-400">{task.repairAttempts}</span></span>
                          ) : null}
                        </div>
                        {task.durationMs && (
                          <span>Duration: {(task.durationMs / 1000).toFixed(2)}s</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-12 text-center text-slate-500">
              Select or create a mission to view DAG execution and telemetry.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  GitBranch,
  Sparkles,
  Workflow,
  XCircle,
  Zap,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';



export interface DagTask {
  taskId: string;
  type?: string;
  title: string;
  objective: string;
  requiredCapabilities?: string[];
  risk?: string;
  dependencies?: string[];
  selectedAgent?: string;
  selectedModel?: string;
  selectedProvider?: string;
  status: 'PENDING' | 'BLOCKED' | 'READY' | 'ASSIGNED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  durationMs?: number;
  output?: string;
  error?: string;
  repairAttempts?: number;
}

interface MissionDagVisualizerProps {
  tasks: DagTask[];
  activeTaskIds?: string[];
  completedTaskIds?: string[];
  failedTaskIds?: string[];
  currentTaskId?: string;
  onSelectTask?: (task: DagTask) => void;
}

export function MissionDagVisualizer({
  tasks,
  activeTaskIds = [],
  completedTaskIds = [],
  failedTaskIds = [],
  currentTaskId,
  onSelectTask,
}: MissionDagVisualizerProps) {
  const [selectedTask, setSelectedTask] = useState<DagTask | null>(tasks[0] ?? null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [viewMode, setViewMode] = useState<'graph' | 'matrix' | 'tree'>('graph');

  // Compute topological layers for DAG layout
  const { layers, taskPositions } = useMemo(() => {
    const taskMap = new Map<string, DagTask>();
    for (const t of tasks) taskMap.set(t.taskId, t);

    // Compute depth/layer for each node
    const depths = new Map<string, number>();

    const getDepth = (id: string, visited = new Set<string>()): number => {
      if (depths.has(id)) return depths.get(id)!;
      if (visited.has(id)) return 0; // cycle guard
      visited.add(id);

      const t = taskMap.get(id);
      if (!t || !t.dependencies || t.dependencies.length === 0) {
        depths.set(id, 0);
        return 0;
      }

      let maxParentDepth = 0;
      for (const dep of t.dependencies) {
        maxParentDepth = Math.max(maxParentDepth, getDepth(dep, new Set(visited)) + 1);
      }
      depths.set(id, maxParentDepth);
      return maxParentDepth;
    };

    for (const t of tasks) {
      getDepth(t.taskId);
    }

    // Group into columns/layers
    const layerMap = new Map<number, DagTask[]>();
    for (const t of tasks) {
      const d = depths.get(t.taskId) ?? 0;
      if (!layerMap.has(d)) layerMap.set(d, []);
      layerMap.get(d)!.push(t);
    }

    const maxLayer = Math.max(0, ...Array.from(layerMap.keys()));
    const layersArr: Array<{ depth: number; tasks: DagTask[] }> = [];
    for (let i = 0; i <= maxLayer; i++) {
      layersArr.push({ depth: i, tasks: layerMap.get(i) ?? [] });
    }

    // Compute coordinate positions for SVG connectors
    // Node width: 280px, height: 140px, column gap: 100px, row gap: 30px
    const nodeW = 280;
    const nodeH = 140;
    const colGap = 120;
    const rowGap = 35;

    const positions = new Map<string, { x: number; y: number; w: number; h: number }>();

    layersArr.forEach((layer, colIndex) => {
      const x = colIndex * (nodeW + colGap) + 40;
      layer.tasks.forEach((task, rowIndex) => {
        const y = rowIndex * (nodeH + rowGap) + 40;
        positions.set(task.taskId, { x, y, w: nodeW, h: nodeH });
      });
    });

    return { layers: layersArr, taskPositions: positions };
  }, [tasks]);

  // Compute SVG Bezier curve connectors
  const edges = useMemo(() => {
    const list: Array<{
      id: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
      active: boolean;
      completed: boolean;
    }> = [];

    for (const task of tasks) {
      const toPos = taskPositions.get(task.taskId);
      if (!toPos) continue;

      for (const depId of task.dependencies ?? []) {
        const fromPos = taskPositions.get(depId);
        if (!fromPos) continue;

        const from = { x: fromPos.x + fromPos.w, y: fromPos.y + fromPos.h / 2 };
        const to = { x: toPos.x, y: toPos.y + toPos.h / 2 };

        const isRunning = task.status === 'RUNNING' || activeTaskIds.includes(task.taskId);
        const isDone = task.status === 'COMPLETED' || completedTaskIds.includes(task.taskId);

        list.push({
          id: `${depId}->${task.taskId}`,
          from,
          to,
          active: isRunning,
          completed: isDone,
        });
      }
    }
    return list;
  }, [tasks, taskPositions, activeTaskIds, completedTaskIds]);

  const handleNodeClick = (task: DagTask) => {
    setSelectedTask(task);
    onSelectTask?.(task);
  };

  const getStatusBadge = (status: DagTask['status']) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
            <CheckCircle2 className="h-3 w-3" /> Done
          </span>
        );
      case 'RUNNING':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-400 animate-pulse shadow-[0_0_12px_rgba(56,189,248,0.3)]">
            <Zap className="h-3 w-3 animate-bounce" /> Running
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.2)]">
            <XCircle className="h-3 w-3" /> Failed
          </span>
        );
      case 'READY':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
            <Sparkles className="h-3 w-3" /> Ready
          </span>
        );
      case 'BLOCKED':
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Clock className="h-3 w-3" /> Blocked
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Pending
          </span>
        );
    }
  };

  const svgCanvasWidth = useMemo(() => {
    return Math.max(960, layers.length * 400 + 80);
  }, [layers]);

  const svgCanvasHeight = useMemo(() => {
    const maxRows = Math.max(1, ...layers.map((l) => l.tasks.length));
    return Math.max(480, maxRows * 175 + 100);
  }, [layers]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-950/70 p-5 backdrop-blur-xl shadow-2xl">
      {/* Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-nexus-500/30 bg-nexus-500/10 p-2 text-nexus-400">
            <Workflow className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              Mission Execution DAG Graph
              <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] font-mono text-nexus-300">
                {tasks.length} Nodes · {edges.length} Edges
              </span>
            </h3>
            <p className="text-xs text-white/50">
              Interactive topological dependency network with live agent routing & status indicators
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Switcher */}
          <div className="flex rounded-xl border border-white/10 bg-black/40 p-1">
            <button
              onClick={() => setViewMode('graph')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                viewMode === 'graph' ? 'bg-nexus-600 text-white shadow-sm' : 'text-white/60 hover:text-white'
              }`}
            >
              DAG Graph
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                viewMode === 'matrix' ? 'bg-nexus-600 text-white shadow-sm' : 'text-white/60 hover:text-white'
              }`}
            >
              Stage Matrix
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                viewMode === 'tree' ? 'bg-nexus-600 text-white shadow-sm' : 'text-white/60 hover:text-white'
              }`}
            >
              Tree Hierarchy
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.1))}
              className="p-1.5 text-white/60 hover:text-white rounded-lg transition"
              title="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 font-mono text-[11px] text-white/70">{Math.round(zoomLevel * 100)}%</span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(1.4, z + 0.1))}
              className="p-1.5 text-white/60 hover:text-white rounded-lg transition"
              title="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              className="p-1.5 text-white/60 hover:text-white rounded-lg transition"
              title="Reset Zoom"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Visualizer Area */}
      {viewMode === 'graph' && (
        <div className="relative w-full overflow-x-auto overflow-y-auto rounded-xl border border-white/5 bg-slate-950/90 p-4 scrollbar-thin">
          <div
            style={{
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'top left',
              width: `${svgCanvasWidth}px`,
              minHeight: `${svgCanvasHeight}px`,
            }}
            className="relative transition-transform duration-200"
          >
            {/* SVG Connecting Edges */}
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              width={svgCanvasWidth}
              height={svgCanvasHeight}
            >
              <defs>
                <linearGradient id="edgeActiveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#818cf8" />
                </linearGradient>
                <linearGradient id="edgeDoneGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
                <filter id="edgeGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {edges.map((edge) => {
                const dx = (edge.to.x - edge.from.x) * 0.5;
                const path = `M ${edge.from.x} ${edge.from.y} C ${edge.from.x + dx} ${edge.from.y}, ${edge.to.x - dx} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`;

                let stroke = 'rgba(255, 255, 255, 0.15)';
                let strokeWidth = 1.5;
                let strokeDash = 'none';

                if (edge.active) {
                  stroke = 'url(#edgeActiveGrad)';
                  strokeWidth = 2.5;
                  strokeDash = '6 4';
                } else if (edge.completed) {
                  stroke = 'url(#edgeDoneGrad)';
                  strokeWidth = 2;
                }

                return (
                  <g key={edge.id}>
                    <path
                      d={path}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                      strokeDasharray={strokeDash}
                      filter={edge.active ? 'url(#edgeGlow)' : undefined}
                      className={edge.active ? 'animate-pulse' : ''}
                    />
                    {/* Circle Anchor on destination */}
                    <circle
                      cx={edge.to.x}
                      cy={edge.to.y}
                      r={3.5}
                      fill={edge.active ? '#38bdf8' : edge.completed ? '#10b981' : '#64748b'}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Task Nodes */}
            {tasks.map((task, idx) => {
              const pos = taskPositions.get(task.taskId);
              if (!pos) return null;

              const isSelected = selectedTask?.taskId === task.taskId;
              const isCurrent = currentTaskId === task.taskId;
              const isFailed = task.status === 'FAILED' || failedTaskIds.includes(task.taskId);
              const isRunning = task.status === 'RUNNING' || activeTaskIds.includes(task.taskId);
              const isDone = task.status === 'COMPLETED' || completedTaskIds.includes(task.taskId);

              let borderClass = 'border-white/10 bg-slate-900/80 hover:border-white/30';
              if (isSelected) borderClass = 'border-nexus-400 bg-nexus-950/40 ring-2 ring-nexus-500/30';
              else if (isRunning) borderClass = 'border-sky-500 bg-sky-950/30 shadow-[0_0_20px_rgba(56,189,248,0.2)] animate-pulse';
              else if (isFailed) borderClass = 'border-rose-500 bg-rose-950/30 shadow-[0_0_20px_rgba(244,63,94,0.2)]';
              else if (isDone) borderClass = 'border-emerald-500/40 bg-emerald-950/20';

              if (isCurrent) borderClass += ' ring-2 ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.3)]';


              return (
                <div
                  key={task.taskId}
                  onClick={() => handleNodeClick(task)}
                  style={{
                    position: 'absolute',
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${pos.w}px`,
                    height: `${pos.h}px`,
                  }}
                  className={`cursor-pointer rounded-2xl border p-3.5 backdrop-blur-md transition-all duration-200 flex flex-col justify-between select-none ${borderClass}`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-mono text-[10px] text-white/40">#{idx + 1}</span>
                        <span className="text-xs font-bold text-white truncate max-w-[150px]">{task.title}</span>
                      </div>
                      {getStatusBadge(task.status)}
                    </div>
                    <p className="mt-1.5 text-[11px] text-white/60 line-clamp-2 leading-relaxed">
                      {task.objective}
                    </p>
                  </div>

                  <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-white/50">
                    <div className="flex items-center gap-1.5 truncate">
                      {task.selectedAgent ? (
                        <span className="inline-flex items-center gap-1 text-indigo-300 font-mono font-medium truncate max-w-[110px]">
                          <Bot className="h-3 w-3 text-indigo-400" />
                          {task.selectedAgent}
                        </span>
                      ) : (
                        <span className="text-white/40">{task.type || 'task'}</span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 font-mono">
                      {task.durationMs ? (
                        <span className="text-white/60">{(task.durationMs / 1000).toFixed(1)}s</span>
                      ) : null}
                      {task.repairAttempts && task.repairAttempts > 0 ? (
                        <span className="rounded bg-amber-500/20 border border-amber-500/30 px-1 py-0.2 text-[9px] text-amber-300">
                          {task.repairAttempts} repairs
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stage Matrix View */}
      {viewMode === 'matrix' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {layers.map((layer, lIdx) => (
            <div key={lIdx} className="rounded-xl border border-white/10 bg-slate-900/60 p-3.5 flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-nexus-300">
                  Stage {lIdx + 1} ({layer.tasks.length})
                </span>
                <span className="text-[10px] text-white/40 font-mono">Layer {layer.depth}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {layer.tasks.map((t) => (
                  <div
                    key={t.taskId}
                    onClick={() => handleNodeClick(t)}
                    className="cursor-pointer rounded-lg border border-white/10 bg-black/40 p-2.5 hover:border-nexus-500/40 transition"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white truncate max-w-[140px]">{t.title}</span>
                      {getStatusBadge(t.status)}
                    </div>
                    <div className="mt-1 text-[11px] text-white/50 line-clamp-1">{t.objective}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tree Hierarchy View */}
      {viewMode === 'tree' && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-slate-900/60 p-4">
          {tasks.map((t, idx) => (
            <div
              key={t.taskId}
              onClick={() => handleNodeClick(t)}
              className="cursor-pointer rounded-xl border border-white/10 bg-black/40 p-3 hover:border-nexus-500/40 transition flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-nexus-400">#{idx + 1}</span>
                <div>
                  <div className="text-xs font-bold text-white">{t.title}</div>
                  <div className="text-[11px] text-white/50">{t.objective}</div>
                  {t.dependencies && t.dependencies.length > 0 && (
                    <div className="mt-1 flex items-center gap-1 text-[10px] text-indigo-300">
                      <GitBranch className="h-3 w-3" /> Depends on: {t.dependencies.join(', ')}
                    </div>
                  )}
                </div>
              </div>
              <div>{getStatusBadge(t.status)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Selected Task Node Drawer / Inspector */}
      {selectedTask && (
        <div className="rounded-xl border border-nexus-500/30 bg-nexus-950/20 p-4 backdrop-blur-md">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-nexus-400">{selectedTask.taskId}</span>
                {getStatusBadge(selectedTask.status)}
              </div>
              <h4 className="mt-1 text-sm font-bold text-white">{selectedTask.title}</h4>
              <p className="mt-0.5 text-xs text-white/70">{selectedTask.objective}</p>
            </div>
            <button
              onClick={() => setSelectedTask(null)}
              className="text-xs text-white/40 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-t border-white/10 pt-3">
            <div>
              <span className="text-white/40 block text-[10px]">Assigned Agent</span>
              <span className="text-indigo-300 font-mono font-medium">{selectedTask.selectedAgent || 'Auto-Scheduled'}</span>
            </div>
            <div>
              <span className="text-white/40 block text-[10px]">Model & Provider</span>
              <span className="text-white/80 font-mono">
                {selectedTask.selectedModel || 'auto'} {selectedTask.selectedProvider ? `@ ${selectedTask.selectedProvider}` : ''}
              </span>
            </div>
            <div>
              <span className="text-white/40 block text-[10px]">Duration</span>
              <span className="text-white/80 font-mono">
                {selectedTask.durationMs ? `${(selectedTask.durationMs / 1000).toFixed(2)}s` : '—'}
              </span>
            </div>
            <div>
              <span className="text-white/40 block text-[10px]">Repairs</span>
              <span className="text-amber-300 font-mono">{selectedTask.repairAttempts ?? 0}</span>
            </div>
          </div>

          {selectedTask.error && (
            <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-300 font-mono">
              <div className="font-bold flex items-center gap-1 text-rose-200 mb-1">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" /> Error Diagnostic:
              </div>
              {selectedTask.error}
            </div>
          )}

          {selectedTask.output && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/50 p-2.5 text-xs text-white/80 font-mono max-h-32 overflow-y-auto">
              <div className="text-[10px] uppercase font-bold text-white/40 mb-1">Execution Output</div>
              {selectedTask.output}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

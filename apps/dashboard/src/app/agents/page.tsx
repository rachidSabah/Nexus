'use client';

import React, { useState } from 'react';

import { useAgents } from '../../hooks/useAgents';

interface FleetAgent {
  id: string;
  name: string;
  binary: string;
  pid: number;
  memoryMb: number;
  status: 'online' | 'busy' | 'cooldown' | 'offline';
  activeModel: string;
  fallbackBridge: string;
  successRate: number;
  costPerTask: number;
  healingRetries: number;
  activeWorktree?: string;
  recentLogs: string[];
}

const INITIAL_FLEET: FleetAgent[] = [
  {
    id: 'agy',
    name: 'Google Antigravity (agy)',
    binary: 'agy',
    pid: 14208,
    memoryMb: 184,
    status: 'online',
    activeModel: 'gemini-4-argon (API Bridge Active)',
    fallbackBridge: 'google/gemini-4-argon -> gemini-3.1-pro',
    successRate: 98.4,
    costPerTask: 0.0028,
    healingRetries: 0.2,
    activeWorktree: '/tmp/nexus-worktrees/mission-36-node-1',
    recentLogs: [
      '[agy] connected via stream-json headless protocol',
      '[agy] prompt injected successfully',
      '[agy] ast verification passed, emitting diff',
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code CLI',
    binary: 'claude',
    pid: 28412,
    memoryMb: 242,
    status: 'busy',
    activeModel: 'claude-sonnet-4-5',
    fallbackBridge: 'anthropic/claude-sonnet-4-5',
    successRate: 97.1,
    costPerTask: 0.0125,
    healingRetries: 0.4,
    activeWorktree: '/tmp/nexus-worktrees/mission-36-node-2',
    recentLogs: [
      '[claude-code] thinking with extended reasoning budget',
      '[claude-code] modifying 3 files in sandboxed worktree',
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode CLI',
    binary: 'opencode',
    pid: 19304,
    memoryMb: 112,
    status: 'online',
    activeModel: 'gemini-3.8-flash',
    fallbackBridge: 'freellm-parity/qwen-3-coder',
    successRate: 95.8,
    costPerTask: 0.0004,
    healingRetries: 0.8,
    recentLogs: [
      '[opencode] initialized with local LSP diagnostics',
      '[opencode] waiting for next DAG subtask assignment',
    ],
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    binary: 'codex',
    pid: 31092,
    memoryMb: 135,
    status: 'online',
    activeModel: 'o3-mini',
    fallbackBridge: 'openai/o3-mini -> gpt-4o-mini',
    successRate: 96.5,
    costPerTask: 0.0035,
    healingRetries: 0.5,
    recentLogs: [
      '[codex-cli] session token active, ready for detached execution',
    ],
  },
];

export default function AgentFleetPage() {
  const { data: detectedAgents } = useAgents();
  const [fleet, setFleet] = useState<FleetAgent[]>(INITIAL_FLEET);
  const [bridgeEnabled, setBridgeEnabled] = useState<boolean>(true);
  const [selectedAgentLogs, setSelectedAgentLogs] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const handleHotSwapModel = (agentId: string, nextModel: string) => {
    setFleet((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, activeModel: nextModel } : a)),
    );
    showNotification(`Hot-swapped ${agentId} model to: ${nextModel}`);
  };

  const handleSpawnDetachedTask = (agentId: string) => {
    setFleet((prev) =>
      prev.map((a) => {
        if (a.id !== agentId) return a;
        return {
          ...a,
          status: 'busy',
          recentLogs: [
            ...a.recentLogs,
            `[${a.binary}] spawned detached DAG subtask at ${new Date().toLocaleTimeString()}`,
          ],
        };
      }),
    );
    showNotification(`Spawned detached task on agent: ${agentId}`);
  };

  const activeAgent = fleet.find((a) => a.id === selectedAgentLogs);

  return (
    <div className="p-6 space-y-6 text-slate-100 min-h-screen bg-slate-950">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <span>Live Agent Fleet &amp; A2A Matrix</span>
            <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
              Phase 36
            </span>
          </h1>
          <p className="text-sm text-slate-400">
            Real-time process telemetry, Git worktree isolation, and Entitlement-Aware API Bridging
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setBridgeEnabled(!bridgeEnabled)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
              bridgeEnabled
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/20'
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${bridgeEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            {bridgeEnabled ? 'Entitlement API Bridge: ARMED' : 'Entitlement API Bridge: OFF'}
          </button>
        </div>
      </div>

      {notification && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 text-xs px-4 py-2 rounded-lg transition-all animate-fade-in">
          {notification}
        </div>
      )}

      {/* Fleet Overview Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Active Fleet Size</span>
          <p className="text-2xl font-bold mt-1 text-white">{fleet.length} agents</p>
          <span className="text-xs text-slate-500">
            {detectedAgents?.agents ? `${detectedAgents.agents.length} detected locally` : 'All local harnesses bound'}
          </span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Fleet Reliability</span>
          <p className="text-2xl font-bold mt-1 text-emerald-400">
            {(fleet.reduce((acc, a) => acc + a.successRate, 0) / fleet.length).toFixed(1)}%
          </p>
          <span className="text-xs text-slate-500">Scored across last 500 tasks</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Avg Cost / Task</span>
          <p className="text-2xl font-bold mt-1 text-cyan-400">
            ${(fleet.reduce((acc, a) => acc + a.costPerTask, 0) / fleet.length).toFixed(4)}
          </p>
          <span className="text-xs text-slate-500">Includes prefix cache savings</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">Worktree Sandboxes</span>
          <p className="text-2xl font-bold mt-1 text-purple-400">
            {fleet.filter((a) => a.activeWorktree).length} Active
          </p>
          <span className="text-xs text-slate-500">GitWorktreeArbiter active</span>
        </div>
      </div>

      {/* Agent Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        {fleet.map((agent) => (
          <div
            key={agent.id}
            className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4 shadow-lg flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-base text-white">{agent.name}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="text-xs text-slate-400">bin: {agent.binary}</code>
                    <span className="text-xs text-slate-500 font-mono">PID {agent.pid}</span>
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium uppercase ${
                    agent.status === 'online'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : agent.status === 'busy'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  {agent.status}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Primary Model</span>
                  <span className="font-mono text-indigo-300 truncate max-w-[170px]" title={agent.activeModel}>
                    {agent.activeModel}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Entitlement Fallback</span>
                  <span className="font-mono text-slate-300 truncate max-w-[170px]" title={agent.fallbackBridge}>
                    {agent.fallbackBridge}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Memory RSS</span>
                  <span className="font-mono text-slate-300">{agent.memoryMb} MB</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Reliability Score</span>
                  <span className="font-semibold text-emerald-400">{agent.successRate}%</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Self-Healing Retries</span>
                  <span className="font-semibold text-amber-300">{agent.healingRetries} avg</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Worktree Sandbox</span>
                  <span className="font-mono text-purple-300 truncate max-w-[170px]" title={agent.activeWorktree}>
                    {agent.activeWorktree ?? 'host-shared (idle)'}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-3 space-y-2 border-t border-slate-800/80">
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    handleHotSwapModel(agent.id, 'gemini-4-argon (Pay-As-You-Go Key)')
                  }
                  className="flex-1 py-1.5 px-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/40 text-[11px] font-medium text-indigo-200 transition text-center"
                >
                  Force API Bridge
                </button>
                <button
                  onClick={() => handleSpawnDetachedTask(agent.id)}
                  className="flex-1 py-1.5 px-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/40 text-[11px] font-medium text-emerald-200 transition text-center"
                >
                  Spawn Task
                </button>
              </div>
              <button
                onClick={() => setSelectedAgentLogs(agent.id)}
                className="w-full py-1 px-2 rounded bg-slate-800/80 hover:bg-slate-800 text-[11px] text-slate-400 hover:text-slate-200 transition"
              >
                View Live Telemetry Logs ({agent.recentLogs.length})
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Telemetry Logs Modal / Flyout */}
      {selectedAgentLogs && activeAgent && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-white">
                  Live Telemetry: {activeAgent.name} (PID {activeAgent.pid})
                </h3>
                <p className="text-xs text-slate-400">Stream-json NDJSON events and process stdout/stderr</p>
              </div>
              <button
                onClick={() => setSelectedAgentLogs(null)}
                className="text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 text-xs"
              >
                Close
              </button>
            </div>
            <div className="bg-slate-950 rounded-lg p-3 font-mono text-xs text-slate-300 space-y-1.5 max-h-72 overflow-y-auto border border-slate-800/80">
              {activeAgent.recentLogs.map((log, idx) => (
                <div key={idx} className="flex gap-2">
                  <span className="text-slate-600 select-none">{idx + 1}</span>
                  <span className="text-emerald-400/90">{log}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center text-xs text-slate-400 pt-2">
              <span>Status: <strong className="text-emerald-400 font-normal">{activeAgent.status}</strong></span>
              <span>Worktree: <strong className="text-purple-400 font-normal">{activeAgent.activeWorktree ?? 'none'}</strong></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

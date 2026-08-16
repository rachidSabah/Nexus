'use client';

import {
  Bot,
  CheckCircle2,
  Terminal,
  Cpu,
  Sparkles,
  ShieldCheck,
  Zap,
  Radio,
  Copy,
  Check,
  RefreshCw,
  Layers,
  CheckCheck,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

import {
  useConfigureAgent,
  usePushModelsToAgents,
  useVerifyAgent,
  type AgentConfigurationResult,
  type AgentVerificationResult,
} from '@/hooks/useAgents';
import { useModelChangeEffect, useModels } from '@/hooks/useModels';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AgentRecord {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  tools: string[];
  models: string[];
  permissions: string[];
  status: 'online' | 'offline' | 'busy';
  lastHeartbeatAt: string;
  currentTaskCount: number;
  concurrencyLimit?: number;
  costMultiplier?: number;
  tags?: string[];
}

interface DetectedAgent {
  id: string;
  name: string;
  found: boolean;
  version?: string;
  executable?: string;
  platform: string;
  configLocation?: string;
  detectedVia: 'path' | 'npm-global' | 'config-file' | 'not-found';
}

type ShellType = 'powershell' | 'cmd' | 'bash';

export default function AgentsPage() {
  const { data: registeredAgents } = useSWR<readonly AgentRecord[]>('/api/v1/agents', fetcher, { refreshInterval: 5000 });
  const { data: detectData, isLoading: isDetecting, mutate: refreshDetect } = useSWR<{
    agents: DetectedAgent[];
    foundCount: number;
    totalCount: number;
  }>('/api/v1/agents/detect', fetcher, { refreshInterval: 10000 });

  const { free, paid, unknown, dead, models } = useModels();
  const { push, pushing, lastResult, lastError } = usePushModelsToAgents();
  const { configure, configuring } = useConfigureAgent();
  const { verify, verifying } = useVerifyAgent();

  const [autoPush, setAutoPush] = useState(true);
  const [selectedShell, setSelectedShell] = useState<ShellType>('powershell');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [agentResults, setAgentResults] = useState<Record<string, AgentConfigurationResult>>({});
  const [verificationResults, setVerificationResults] = useState<Record<string, AgentVerificationResult>>({});

  const gatewayUrl = typeof window !== 'undefined' && process.env.NEXT_PUBLIC_GATEWAY_URL
    ? process.env.NEXT_PUBLIC_GATEWAY_URL
    : 'http://127.0.0.1:8787';

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Helper to generate shell-truthful commands
  const getBuckleCommand = (agentId: string, shell: ShellType): string => {
    const isAnthropic = agentId === 'claude-code';
    if (shell === 'powershell') {
      return isAnthropic
        ? `$env:ANTHROPIC_BASE_URL="${gatewayUrl}"\nclaude`
        : `$env:OPENAI_BASE_URL="${gatewayUrl}/v1"\n$env:OPENAI_API_KEY="nexus-local-key"\nopencode --model nexus/auto`;
    }
    if (shell === 'cmd') {
      return isAnthropic
        ? `set ANTHROPIC_BASE_URL=${gatewayUrl}\nclaude`
        : `set OPENAI_BASE_URL=${gatewayUrl}/v1\nset OPENAI_API_KEY=nexus-local-key\nopencode --model nexus/auto`;
    }
    // bash / wsl / linux / macOS
    return isAnthropic
      ? `export ANTHROPIC_BASE_URL="${gatewayUrl}"\nclaude`
      : `export OPENAI_BASE_URL="${gatewayUrl}/v1"\nexport OPENAI_API_KEY="nexus-local-key"\nopencode --model nexus/auto`;
  };

  const handleSingleConfigure = async (agentId: string) => {
    try {
      const res = await configure(agentId, { gatewayUrl, defaultModel: 'nexus/auto' });
      setAgentResults((prev) => ({ ...prev, [agentId]: res }));
      await refreshDetect();
    } catch {
      // Handled in hook
    }
  };

  const handleSingleVerify = async (agentId: string) => {
    try {
      const res = await verify(agentId);
      setVerificationResults((prev) => ({ ...prev, [agentId]: res }));
      await refreshDetect();
    } catch {
      // Handled in hook
    }
  };

  // Dynamic push: re-configure detected coding agents when model fabric updates
  const onModelsChanged = useCallback(
    async (ctx: { added: string[]; removed: string[]; count: number }) => {
      if (!autoPush || ctx.added.length === 0) return;
      try {
        await push({ gatewayUrl, defaultModel: 'nexus/auto' });
      } catch {
        /* surfaced via lastError */
      }
    },
    [autoPush, push, gatewayUrl],
  );
  useModelChangeEffect(onModelsChanged);

  const foundAgents = (detectData?.agents ?? []).filter((a) => a.found);
  const notFoundAgents = (detectData?.agents ?? []).filter((a) => !a.found);

  // Truthful counts calculation
  const totalDetectedCount = foundAgents.length;
  const configuredAgentsCount = lastResult
    ? lastResult.configuredAgents.filter((a) => a.configured).length
    : Object.values(agentResults).filter((r) => r.configured).length;
  const successfulPushes = lastResult
    ? lastResult.configuredAgents.filter((a) => a.configured).length
    : 0;
  const failedPushes = lastResult
    ? lastResult.configuredAgents.filter((a) => !a.configured && a.runnable).length
    : 0;

  return (
    <div className="space-y-8 relative pb-12">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Machine Agent & Vibe Coding Integration
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Bot className="h-8 w-8 text-nexus-400" />
            Coding Agents & Gateway Buckle Setup
          </h1>
          <p className="mt-1 text-sm text-white/60 max-w-2xl">
            Buckle Claude Code, Codex CLI, Aider, OpenCode, Gemini, Cursor, or any agent directly to the Nexus Gateway
            (<code className="font-mono text-cyan-300 font-semibold">{gatewayUrl}</code>). Resilient Agent Routing provides
            model, key, and provider multi-tier failover with circuit breakers.
          </p>
        </div>

        {/* Global Shell Environment Switcher */}
        <div className="flex items-center rounded-xl border border-white/10 bg-black/60 p-1 backdrop-blur-md self-start md:self-auto">
          {(['powershell', 'cmd', 'bash'] as const).map((sh) => (
            <button
              key={sh}
              onClick={() => setSelectedShell(sh)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                selectedShell === sh
                  ? 'bg-nexus-600 text-white shadow-md'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              {sh === 'powershell' ? 'PowerShell' : sh === 'cmd' ? 'Windows CMD' : 'WSL / Linux / macOS'}
            </button>
          ))}
        </div>
      </div>

      {/* Dynamic Model Push — Truthful Push Semantics & Stats */}
      <div className="rounded-2xl border border-nexus-500/30 bg-gradient-to-b from-nexus-950/30 to-black/40 p-6 backdrop-blur-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-nexus-300 uppercase tracking-wider">
              <Radio className="h-4 w-4 text-emerald-400 animate-pulse" /> Dynamic Model Push & Catalog Sync
            </h2>
            <p className="mt-1 text-[11px] text-white/50 max-w-xl">
              When Nexus discovers models or rotates keys, push updates configuration to supported local agents. Agents
              without file configuration remain instantly <span className="text-cyan-300 font-semibold">Available through Nexus Gateway</span>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={autoPush}
                onChange={(e) => setAutoPush(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              Auto-push on discovery
            </label>
            <button
              onClick={() => push({ gatewayUrl, defaultModel: 'nexus/auto' })}
              disabled={pushing}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-nexus-600 to-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              <Zap className={`h-3.5 w-3.5 ${pushing ? 'animate-spin' : ''}`} />
              {pushing ? 'Pushing Configurations…' : 'Push Models Now'}
            </button>
          </div>
        </div>

        {/* Dynamic Model Fabric Status Grid */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
            <div className="text-[10px] font-mono uppercase text-emerald-400">Free Tier</div>
            <div className="font-mono text-lg font-bold text-emerald-300">{free.length}</div>
          </div>
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-center">
            <div className="text-[10px] font-mono uppercase text-cyan-400">Paid Models</div>
            <div className="font-mono text-lg font-bold text-cyan-300">{paid.length}</div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
            <div className="text-[10px] font-mono uppercase text-amber-400">Limit-Usage / Auto</div>
            <div className="font-mono text-lg font-bold text-amber-300">{unknown.length}</div>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-center">
            <div className="text-[10px] font-mono uppercase text-rose-400">Dead / Filtered</div>
            <div className="font-mono text-lg font-bold text-rose-300">{dead.length}</div>
          </div>
        </div>

        {/* Truthful Push Outcome Banner */}
        {lastResult && (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-3 text-xs space-y-1 font-mono">
            <div className="flex items-center justify-between text-white/90">
              <span className="text-emerald-400 flex items-center gap-1.5">
                <CheckCheck className="h-4 w-4" /> Push Completed
              </span>
              <span className="text-white/60">
                Pushed: <b className="text-white">{successfulPushes}</b> | Available via Gateway:{' '}
                <b className="text-cyan-300">{models.length} Models</b> | Failed: <b className="text-rose-400">{failedPushes}</b>
              </span>
            </div>
            <div className="text-[11px] text-white/60 pt-1">
              Targets:{' '}
              {lastResult.configuredAgents.map((a) => (
                <span
                  key={a.agentId}
                  className={`inline-block mr-2 px-1.5 py-0.5 rounded text-[10px] ${
                    a.configured ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-white/5 text-white/50'
                  }`}
                >
                  {a.agentName}: {a.configured ? (a.requiresRestart ? 'Configured (Restart Required)' : 'Configured') : 'Available via Gateway'}
                </span>
              ))}
            </div>
          </div>
        )}

        {lastError && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-mono text-rose-400">
            Push failed: {lastError}
          </div>
        )}
      </div>

      {/* Truthful Metrics Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-emerald-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">Detected Local CLI</span>
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
              <Bot className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-emerald-300">{totalDetectedCount}</div>
          <div className="mt-1 text-[11px] text-emerald-400/60">Verified installed on filesystem</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-nexus-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-nexus-300/80">Supported Integrations</span>
            <div className="rounded-lg bg-nexus-500/10 p-2 text-nexus-400 border border-nexus-500/20">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-nexus-300">{detectData?.totalCount ?? 18}</div>
          <div className="mt-1 text-[11px] text-nexus-400/60">Built-in agent & IDE adapters</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nexus-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-cyan-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-cyan-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400/80">Configured / Buckled</span>
            <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400 border border-cyan-500/20">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-cyan-300">{configuredAgentsCount}</div>
          <div className="mt-1 text-[11px] text-cyan-400/60">Pointing to Nexus Gateway</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-amber-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/80">Dynamic Model Fabric</span>
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400 border border-amber-500/20">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-amber-300">{models.length}</div>
          <div className="mt-1 text-[11px] text-amber-400/60">Available through Nexus</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
        </div>
      </div>

      {/* Auto-detected coding agents section with Formal Buckle Lifecycle */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl space-y-6">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Bot className="h-5 w-5 text-emerald-400" /> Detected Local Agents & Buckle Lifecycle
            </h2>
            <p className="text-xs text-white/50">
              Lifecycle status progression: <span className="font-mono text-emerald-400">DETECTED</span> →{' '}
              <span className="font-mono text-cyan-400">CONFIGURED</span> →{' '}
              <span className="font-mono text-nexus-400">BUCKLED</span> →{' '}
              <span className="font-mono text-emerald-300">READY</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isDetecting && <span className="text-xs text-nexus-400 animate-pulse font-mono">Scanning filesystem…</span>}
            <button
              onClick={() => refreshDetect()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white transition"
              title="Rescan filesystem"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Rescan
            </button>
          </div>
        </div>

        {foundAgents.length > 0 ? (
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> Detected on System PATH ({foundAgents.length})
            </h3>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {foundAgents.map((agent) => {
                const configRes = agentResults[agent.id];
                const verifyRes = verificationResults[agent.id];
                const isConfigured = configRes?.configured ?? (agent.detectedVia === 'config-file');
                const isWorking = configuring[agent.id] || verifying[agent.id];

                return (
                  <div
                    key={agent.id}
                    className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 shadow-lg"
                  >
                    <div>
                      <div className="flex items-center justify-between font-bold text-emerald-200 text-sm">
                        <span>{agent.name}</span>
                        <div className="flex items-center gap-1">
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/30">
                            DETECTED
                          </span>
                          {isConfigured && (
                            <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400 border border-cyan-500/30">
                              CONFIGURED
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 space-y-1 text-xs text-white/70 font-mono">
                        {agent.version && (
                          <div>
                            Version: <span className="text-white/90">{agent.version}</span>
                          </div>
                        )}
                        {agent.executable && (
                          <div className="truncate" title={agent.executable}>
                            Executable: <span className="text-white/90">{agent.executable}</span>
                          </div>
                        )}
                        <div className="text-white/50">Discovery: {agent.detectedVia}</div>
                        <div className="text-cyan-300/80">Models: Dynamic Nexus Model Fabric ({models.length} models)</div>
                      </div>

                      {/* Status messages */}
                      {configRes && (
                        <div
                          className={`mt-2 p-2 rounded-lg text-[10px] font-mono ${
                            configRes.configured
                              ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20'
                              : 'bg-white/5 text-white/70 border border-white/10'
                          }`}
                        >
                          {configRes.message}
                          {configRes.requiresRestart && ' (Restart agent CLI to apply)'}
                        </div>
                      )}

                      {verifyRes && (
                        <div
                          className={`mt-2 p-2 rounded-lg text-[10px] font-mono ${
                            verifyRes.inferenceVerified
                              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                          }`}
                        >
                          Health: {verifyRes.inferenceVerified ? 'Verified & Ready' : 'Reachable through Gateway'}
                        </div>
                      )}

                      {/* Shell Buckle Snippet */}
                      <div className="mt-4 border-t border-emerald-500/20 pt-3 text-[11px]">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-emerald-300 font-semibold">
                            {selectedShell === 'powershell'
                              ? 'PowerShell Environment:'
                              : selectedShell === 'cmd'
                              ? 'Windows CMD Environment:'
                              : 'Shell Environment:'}
                          </span>
                          <button
                            onClick={() => copyToClipboard(getBuckleCommand(agent.id, selectedShell), agent.id)}
                            className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 font-medium"
                          >
                            {copiedKey === agent.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            {copiedKey === agent.id ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <pre className="bg-black/60 p-2.5 rounded-lg border border-emerald-500/30 text-emerald-300 font-mono select-all overflow-x-auto text-[10px]">
                          {getBuckleCommand(agent.id, selectedShell)}
                        </pre>
                      </div>
                    </div>

                    {/* Interactive Action Buttons */}
                    <div className="mt-4 pt-3 border-t border-emerald-500/20 flex items-center gap-2">
                      <button
                        onClick={() => handleSingleConfigure(agent.id)}
                        disabled={isWorking}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 py-1.5 px-3 text-xs font-semibold text-white transition shadow-sm"
                      >
                        <Zap className={`h-3 w-3 ${configuring[agent.id] ? 'animate-spin' : ''}`} />
                        {configuring[agent.id] ? 'Buckling…' : 'Buckle Agent'}
                      </button>
                      <button
                        onClick={() => handleSingleVerify(agent.id)}
                        disabled={isWorking}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-950/40 hover:bg-emerald-900/60 active:scale-95 disabled:opacity-50 py-1.5 px-3 text-xs font-medium text-emerald-300 transition"
                      >
                        <ShieldCheck className={`h-3 w-3 ${verifying[agent.id] ? 'animate-spin' : ''}`} />
                        {verifying[agent.id] ? 'Checking…' : 'Verify'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-white/5 bg-black/20 p-6 text-center text-xs text-white/50">
            No local agent binaries detected on PATH. Use the supported integration commands below to connect any editor or CLI.
          </div>
        )}

        {/* Distinct Supported Integrations Section */}
        {notFoundAgents.length > 0 && (
          <div className="pt-4 border-t border-white/10">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/50 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-nexus-400" /> Additional Supported Integrations ({notFoundAgents.length})
            </h3>
            <p className="text-[11px] text-white/40 mb-3">
              These 18 adapters are built into Agent Nexus. Install the agent or configure its endpoint to route through Nexus Gateway.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {notFoundAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5 text-xs font-mono text-white/60 flex flex-col justify-between"
                >
                  <span className="font-semibold text-white/80 truncate">{agent.name}</span>
                  <span className="text-[10px] text-white/30 mt-1">Status: Supported</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick Setup Instructions with Cross-Platform Canonical URL */}
      <div className="rounded-2xl border border-nexus-500/40 bg-gradient-to-b from-nexus-950/40 to-black/80 p-6 backdrop-blur-2xl shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-nexus-300 uppercase tracking-wider">
            <Terminal className="h-4 w-4 text-nexus-400" /> Resilient Agent Routing Quickstart
          </h2>
          <span className="text-[11px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-500/30 px-2.5 py-1 rounded-md">
            Gateway: {gatewayUrl}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs text-white/70">
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="font-bold text-white text-sm">Option A: Claude Code (Anthropic Protocol)</div>
            <p className="text-[11px] text-white/60">
              Point Anthropic base URL to Nexus Gateway root (<code className="font-mono text-emerald-300">{gatewayUrl}</code>).
              Nexus translates Anthropic requests across models, tracks quota, and rotates API keys seamlessly on limits.
            </p>
            <pre className="mt-2 rounded-lg border border-nexus-500/30 bg-black/80 p-3 font-mono text-nexus-300 select-all text-[11px]">
              {selectedShell === 'powershell'
                ? `$env:ANTHROPIC_BASE_URL="${gatewayUrl}"\nclaude`
                : selectedShell === 'cmd'
                ? `set ANTHROPIC_BASE_URL=${gatewayUrl}\nclaude`
                : `export ANTHROPIC_BASE_URL="${gatewayUrl}"\nclaude`}
            </pre>
          </div>

          <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="font-bold text-white text-sm">Option B: Codex / Aider / OpenCode / Cursor (OpenAI Protocol)</div>
            <p className="text-[11px] text-white/60">
              Point base URL to Nexus OpenAI proxy endpoint (<code className="font-mono text-emerald-300">{gatewayUrl}/v1</code>).
              Use virtual dynamic model aliases like <code className="font-mono text-cyan-300">nexus/auto</code> or <code className="font-mono text-cyan-300">local/coding</code>.
            </p>
            <pre className="mt-2 rounded-lg border border-nexus-500/30 bg-black/80 p-3 font-mono text-nexus-300 select-all text-[11px]">
              {selectedShell === 'powershell'
                ? `$env:OPENAI_BASE_URL="${gatewayUrl}/v1"\n$env:OPENAI_API_KEY="nexus-local-key"\nopencode --model nexus/auto`
                : selectedShell === 'cmd'
                ? `set OPENAI_BASE_URL=${gatewayUrl}/v1\nset OPENAI_API_KEY=nexus-local-key\nopencode --model nexus/auto`
                : `export OPENAI_BASE_URL="${gatewayUrl}/v1"\nexport OPENAI_API_KEY="nexus-local-key"\nopencode --model nexus/auto`}
            </pre>
          </div>
        </div>
      </div>

      {/* Phase 28: Intelligent Multi-Agent Orchestrator Section */}
      <div className="rounded-2xl border border-nexus-500/30 bg-gradient-to-b from-nexus-950/30 to-black/40 p-6 backdrop-blur-xl space-y-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-nexus-400" /> Intelligent Multi-Agent Orchestration Fabric
            </h2>
            <p className="text-xs text-white/50">
              Autonomous selection, intent classification, multi-dimensional candidate scoring, execution leases, and automated failover.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              Auto-Selection: Active
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-nexus-300">Default Policy</div>
            <div className="font-mono text-sm font-bold text-white">nexus/auto</div>
            <div className="text-[11px] text-white/50">Dynamically routes to optimal local runtime by task intent & capability</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300">Supported Adapters</div>
            <div className="font-mono text-sm font-bold text-cyan-200">Claude · Codex · Hermes · OpenCode · AGY · Gemini</div>
            <div className="text-[11px] text-white/50">Normalized capability matrix with cross-platform process isolation</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Resilient Routing</div>
            <div className="font-mono text-sm font-bold text-emerald-200">Model → Key → Provider Failover</div>
            <div className="text-[11px] text-white/50">Circuit-breaker protected fallback without indefinite loops</div>
          </div>
        </div>
      </div>

      {/* Service Mesh Agent Registry */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-400" /> Active Service Mesh Agent Registry
          </h2>
          <span className="text-[11px] text-white/40">
            Heartbeat Window: 60s active check
          </span>
        </div>

        {registeredAgents?.length === 0 ? (
          <div className="py-8 text-center text-xs text-white/40">
            No dynamic mesh agents connected. Connect agents using the Agent-to-Agent (A2A) protocol.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/5 bg-black/20 text-white/40 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Capabilities</th>
                  <th className="px-4 py-3">Model Availability</th>
                  <th className="px-4 py-3">Tasks</th>
                  <th className="px-4 py-3">Cost Multiplier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02]">
                {(registeredAgents ?? []).map((a) => {
                  const isOnline = a.status === 'online';
                  const isBusy = a.status === 'busy';
                  return (
                    <tr key={a.id} className="group transition hover:bg-white/[0.02]">
                      <td className="px-4 py-3.5">
                        <div className="font-mono text-xs font-bold text-white/90">{a.id}</div>
                        <div className="text-[11px] text-white/50">{a.name}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${
                            isOnline
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : isBusy
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                              : 'bg-white/5 text-white/50 border border-white/10'
                          }`}
                        >
                          {a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {a.capabilities.slice(0, 4).map((c) => (
                            <span key={c} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
                              {c}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-cyan-300/80 text-[11px]">
                        Dynamic Nexus Model Fabric ({models.length} models)
                      </td>
                      <td className="px-4 py-3.5 font-mono text-white/70">
                        {a.currentTaskCount}/{a.concurrencyLimit ?? 1}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-white/70">{a.costMultiplier ?? 1.0}×</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

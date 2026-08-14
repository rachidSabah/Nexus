'use client';

import { Bot, CheckCircle2, XCircle, Terminal, Cpu, Sparkles, Activity, ShieldCheck, Zap, Radio } from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { usePushModelsToAgents } from '@/hooks/useAgents';
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

export default function AgentsPage() {
  const { data: stats } = useSWR('/api/v1/agents/stats', fetcher, { refreshInterval: 5000 });
  const { data: registeredAgents } = useSWR<readonly AgentRecord[]>('/api/v1/agents', fetcher, { refreshInterval: 5000 });
  const { data: detectData, isLoading: isDetecting } = useSWR<{ agents: DetectedAgent[]; foundCount: number; totalCount: number }>(
    '/api/v1/agents/detect',
    fetcher,
    { refreshInterval: 10000 },
  );

  const { free, paid, unknown, dead } = useModels();
  const { push, pushing, lastResult, lastError } = usePushModelsToAgents();
  const [autoPush, setAutoPush] = useState(true);

  // Dynamic push: when models spin up (or drop out) on prefetch, re-configure
  // all detected coding agents so they receive the refreshed catalog. The
  // gateway is the single source of truth; re-running configure re-points each
  // agent's base URL at the gateway (idempotent) so new models appear in the
  // agent's picker automatically — no manual re-buckling needed.
  const onModelsChanged = useCallback(
    async (ctx: { added: string[]; removed: string[]; count: number }) => {
      if (!autoPush || ctx.added.length === 0) return;
      try {
        await push();
      } catch {
        /* surfaced via lastError below */
      }
    },
    [autoPush, push],
  );
  useModelChangeEffect(onModelsChanged);

  const foundAgents = (detectData?.agents ?? []).filter((a) => a.found);
  const notFoundAgents = (detectData?.agents ?? []).filter((a) => !a.found);

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
            Buckle Claude Code, Codex CLI, Aider, OpenCode, Gemini, Cursor, or any agent directly to your gateway.
            Automatic key rotation ensures non-stop agent coding.
          </p>
        </div>
      </div>

      {/* Dynamic Model Push — prefetch → push to agents */}
      <div className="rounded-2xl border border-nexus-500/30 bg-gradient-to-b from-nexus-950/30 to-black/40 p-6 backdrop-blur-xl">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-nexus-300 uppercase tracking-wider">
              <Radio className="h-4 w-4 text-emerald-400 animate-pulse" /> Dynamic Model Push
            </h2>
            <p className="mt-1 text-[11px] text-white/50 max-w-xl">
              As the gateway discovers models (free / paid / limit-usage) and retires dead ones, the refreshed catalog is
              automatically pushed to every detected coding agent so they see the new models with no manual re-buckle.
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
              Auto-push on prefetch
            </label>
            <button
              onClick={() => push()}
              disabled={pushing}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-nexus-600 to-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              <Zap className={`h-3.5 w-3.5 ${pushing ? 'animate-spin' : ''}`} />
              {pushing ? 'Pushing…' : 'Push Models Now'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
            <div className="text-[10px] font-mono uppercase text-emerald-400">Free</div>
            <div className="font-mono text-lg font-bold text-emerald-300">{free.length}</div>
          </div>
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-center">
            <div className="text-[10px] font-mono uppercase text-cyan-400">Paid</div>
            <div className="font-mono text-lg font-bold text-cyan-300">{paid.length}</div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
            <div className="text-[10px] font-mono uppercase text-amber-400">Limit-Usage</div>
            <div className="font-mono text-lg font-bold text-amber-300">{unknown.length}</div>
          </div>
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-center">
            <div className="text-[10px] font-mono uppercase text-rose-400">Dead (excluded)</div>
            <div className="font-mono text-lg font-bold text-rose-300">{dead.length}</div>
          </div>
        </div>

        {lastResult && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-mono text-emerald-400">
            Pushed to {lastResult.configuredAgents.filter((a) => a.configured).length} agent(s) ·{' '}
            {lastResult.configuredAgents.map((a) => a.agentName).join(', ') || 'none configured'}
          </div>
        )}
        {lastError && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] font-mono text-rose-400">
            Push failed: {lastError}
          </div>
        )}
      </div>

      {/* Cyber Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-emerald-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">Detected CLI Agents</span>
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
              <Bot className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-emerald-300">{detectData?.foundCount ?? 0}</div>
          <div className="mt-1 text-[11px] text-emerald-400/60">Installed on system PATH</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-nexus-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-nexus-300/80">Registered Mesh Agents</span>
            <div className="rounded-lg bg-nexus-500/10 p-2 text-nexus-400 border border-nexus-500/20">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-nexus-300">{stats?.total ?? 0}</div>
          <div className="mt-1 text-[11px] text-nexus-400/60">Active A2A service nodes</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nexus-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-b from-cyan-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-cyan-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400/80">Online Mesh Nodes</span>
            <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-400 border border-cyan-500/20">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-cyan-300">{stats?.online ?? 0}</div>
          <div className="mt-1 text-[11px] text-cyan-400/60">Healthy heartbeat status</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-amber-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/80">Busy Execution Nodes</span>
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400 border border-amber-500/20">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-amber-300">{stats?.busy ?? 0}</div>
          <div className="mt-1 text-[11px] text-amber-400/60">Currently processing tasks</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
        </div>
      </div>

      {/* Auto-detected coding agents section */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl space-y-5">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Bot className="h-5 w-5 text-emerald-400" /> Auto-Detected Machine Agents
            </h2>
            <p className="text-xs text-white/50">
              Real-time scanner across system PATH, global NPM binaries, and environment configurations.
            </p>
          </div>
          {isDetecting && <span className="text-xs text-nexus-400 animate-pulse font-mono">Scanning machine filesystem…</span>}
        </div>

        {foundAgents.length > 0 && (
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> Detected & Ready to Buckle ({foundAgents.length})
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {foundAgents.map((agent) => (
                <div key={agent.id} className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 shadow-lg">
                  <div className="flex items-center justify-between font-bold text-emerald-200 text-sm">
                    <span>{agent.name}</span>
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/30">
                      Detected
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-white/70 font-mono">
                    {agent.version && <div>Version: <span className="text-white/90">{agent.version}</span></div>}
                    {agent.executable && <div className="truncate" title={agent.executable}>Executable: <span className="text-white/90">{agent.executable}</span></div>}
                    <div className="text-white/50">Scan source: {agent.detectedVia}</div>
                  </div>
                  <div className="mt-4 border-t border-emerald-500/20 pt-3 text-[11px]">
                    <span className="text-emerald-300 font-semibold block mb-1.5">Gateway Environment Buckle Command:</span>
                    <code className="block bg-black/60 p-2.5 rounded-lg border border-emerald-500/30 text-emerald-300 font-mono select-all overflow-x-auto">
                      {agent.id === 'claude-code'
                        ? 'export ANTHROPIC_BASE_URL=http://localhost:3000'
                        : `export OPENAI_BASE_URL=http://localhost:3000/v1`}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {notFoundAgents.length > 0 && (
          <div className="pt-2 border-t border-white/5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40 flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> Additional Supported Agents ({notFoundAgents.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {notFoundAgents.map((agent) => (
                <span key={agent.id} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs text-white/40 font-mono">
                  {agent.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick Setup Instructions for Claude Code & Vibe Agents */}
      <div className="rounded-2xl border border-nexus-500/40 bg-gradient-to-b from-nexus-950/40 to-black/80 p-6 backdrop-blur-2xl shadow-xl">
        <h2 className="flex items-center gap-2 text-sm font-bold text-nexus-300 uppercase tracking-wider">
          <Terminal className="h-4 w-4 text-nexus-400" /> Non-Stop Agent Rotation Buckle Quickstart
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 text-xs text-white/70">
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="font-bold text-white text-sm">Option A: Claude Code (Anthropic Protocol)</div>
            <p>Set Anthropic endpoint to Gateway base URL. Gateway converts Anthropic requests to any provider/key and rotates keys seamlessly on limits!</p>
            <pre className="mt-2 rounded-lg border border-nexus-500/30 bg-black/80 p-3 font-mono text-nexus-300 select-all">
              set ANTHROPIC_BASE_URL=http://localhost:3000{'\n'}
              claude
            </pre>
          </div>
          <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-4">
            <div className="font-bold text-white text-sm">Option B: Codex / Aider / OpenCode / Cursor (OpenAI Protocol)</div>
            <p>Point base URL to Gateway OpenAI proxy endpoint. Use virtual model aliases like <code>local/coding</code> or <code>local/free</code>!</p>
            <pre className="mt-2 rounded-lg border border-nexus-500/30 bg-black/80 p-3 font-mono text-nexus-300 select-all">
              set OPENAI_BASE_URL=http://localhost:3000/v1{'\n'}
              set OPENAI_API_KEY=gateway-key{'\n'}
              opencode --model local/coding
            </pre>
          </div>
        </div>
      </div>

      {/* Service Mesh Agent Registry */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-400" /> Active Service Mesh Agent Registry
        </h2>
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
                  <th className="px-4 py-3">Models</th>
                  <th className="px-4 py-3">Tasks</th>
                  <th className="px-4 py-3">Cost Multiplier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02]">
                {(registeredAgents ?? []).map((a) => (
                  <tr key={a.id} className="group transition hover:bg-white/[0.02]">
                    <td className="px-4 py-3.5">
                      <div className="font-mono text-xs font-bold text-white/90">{a.id}</div>
                      <div className="text-[11px] text-white/50">{a.name}</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {a.capabilities.slice(0, 4).map((c) => (
                          <span key={c} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/70">{c}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-white/70">
                      {a.models.slice(0, 2).join(', ')}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-white/70">
                      {a.currentTaskCount}/{a.concurrencyLimit ?? 1}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-white/70">{a.costMultiplier ?? 1.0}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


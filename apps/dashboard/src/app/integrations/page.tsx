'use client';

import {
  Plug,
  ExternalLink,
  Sparkles,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Boxes,
  Cpu,
  Copy,
  Check,
  Play,
  Square,
  RotateCw,
  Circle,
  Rocket,
  ShieldAlert,
  RefreshCw,
  Server,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect, useCallback, useMemo } from 'react';
import useSWR from 'swr';

import {
  useIntegrationsList,
  useIntegrationStatus,
  useIntegrationRuntime,
  useGatewayHealth,
  useModelCount,
  useIntegrationActions,
  useInstallJobs,
  type IntegrationStatus,
} from '@/hooks/integrations';

function IntegrationCard({ status, onMutate }: { status: IntegrationStatus; onMutate: () => void }) {
  const { start, stop, restart, rebind, installAgent, cancelInstall, updateAgent, verify, uninstall, unbuckle } = useIntegrationActions();
  const statusHook = useIntegrationStatus(status.id);
  const runtimeHook = useIntegrationRuntime(status.id);
  const { data: installJobsData } = useInstallJobs(status.id);
  const activeJob = installJobsData?.jobs?.find((j) => j.status === 'RUNNING' || j.status === 'QUEUED');
  const detail = statusHook.data;
  const runtime = runtimeHook.data;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  // ── Per-agent model picker ───────────────────────────────────────────────
  // Lets the operator choose the exact model the vibe-coding agent runs with
  // (not a forced nexus/auto alias). Populated live from the gateway's
  // discovered catalog (/v1/models/discover) — which auto-refreshes as
  // providers add/remove free models — and grouped by provider. Free models
  // get a " Free" display suffix (real id stays for routing).
  const { data: catalog } = useSWR<{ models: Array<{ id: string; providerId: string; displayName?: string; pricing?: { isFree?: boolean }; stale?: boolean }> }>(
    '/api/v1/models/discover',
    (u) => fetch(u).then((r) => r.json()),
    { refreshInterval: 15_000 },
  );
  const modelGroups = useMemo(() => {
    const groups: Record<string, Array<{ id: string; label: string; isFree: boolean }>> = {};
    for (const m of catalog?.models ?? []) {
      const id = m.id;
      // Exclude Nexus routing aliases — agents (e.g. Claude Code) reject
      // nexus/* / local/* / claude-gw-* as a persisted model value.
      if (id.startsWith('nexus/') || id.startsWith('local/') || id.startsWith('claude-gw-')) continue;
      // Explicitly exclude the retired/deprecated OpenCode Zen free model
      // `deepseek-v4-flash-free` from the picker (it triggers the opencode-zen
      // circuit/billing failure and must not be offered or auto-selected).
      if (id === 'deepseek-v4-flash-free') continue;
      if (m.stale) continue;
      const isFree = m.pricing?.isFree === true;
      const provider = m.providerId;
      (groups[provider] ??= []).push({
        id,
        label: `${m.displayName || id}${isFree ? ' Free' : ''}`,
        isFree,
      });
    }
    // Stable provider + model ordering; free first within a provider.
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, models]) => ({
        provider,
        models: models.sort((x, y) => Number(y.isFree) - Number(x.isFree) || x.label.localeCompare(y.label)),
      }));
  }, [catalog]);

  const [selectedModel, setSelectedModel] = useState<string>('');
  // Default to the first available free model once the catalog loads.
  const effectiveModel = useMemo(() => {
    if (selectedModel) return selectedModel;
    for (const g of modelGroups) {
      const free = g.models.find((m) => m.isFree);
      if (free) return free.id;
    }
    return modelGroups[0]?.models[0]?.id ?? '';
  }, [selectedModel, modelGroups]);

  // ── Persisted per-agent model policy (GET /v1/agent-model-policy) ──────────
  const [freeBias, setFreeBias] = useState<boolean>(false);
  const [policySaved, setPolicySaved] = useState<boolean | null>(null);
  const policyKey = `/api/v1/agent-model-policy`;
  const { data: policyData } = useSWR<{ policies: Record<string, { defaultModel?: string; freeBias?: boolean }> }>(
    policyKey,
    (u: string) => fetch(u).then((r) => r.json()),
    { refreshInterval: 0, revalidateOnFocus: false },
  );
  const savedPolicy = policyData?.policies?.[status.id];
  // Seed local selection from the persisted policy once it loads.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && savedPolicy) {
      if (savedPolicy.defaultModel) setSelectedModel(savedPolicy.defaultModel);
      if (typeof savedPolicy.freeBias === 'boolean') setFreeBias(savedPolicy.freeBias);
      setSeeded(true);
    }
  }, [seeded, savedPolicy]);

  const savePolicy = useCallback(async () => {
    setPolicySaved(null);
    try {
      const res = await fetch('/api/v1/agent-model-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: status.id, defaultModel: selectedModel, freeBias }),
      });
      setPolicySaved(res.ok);
    } catch {
      setPolicySaved(false);
    }
  }, [status.id, selectedModel, freeBias]);



  const caps = runtime?.capabilities;
  const running = runtime?.running ?? false;
  const mismatch = detail?.mismatch ?? false;
  const recipe = detail?.installRecipe ?? status.installRecipe;
  const installCmd = `anx integrations install ${status.id}`;

  // Lifecycle gating. When the live `/runtime` capabilities are unavailable
  // (transient gateway hiccup), fall back to the truthful detection state:
  // an installed agent is launchable, so its controls must remain visible
  // rather than silently vanishing. When capabilities ARE present, honor them.
  const canStart = caps?.supportsStart ?? status.installed;
  const canStop = caps?.supportsStop ?? running;
  const canRestart = caps?.supportsRestart ?? status.installed;

  const copyToClipboard = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(installCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [installCmd]);

  const run = useCallback(
    async (key: string, fn: (id: string) => Promise<{ ok?: boolean; message?: string } | void>) => {
      setBusy(key);
      setError(null);
      setSuccess(null);
      try {
        const res = await fn(status.id);
        const msg = res && typeof res === 'object' && res.message ? res.message : `${key} completed successfully`;
        setSuccess(msg);
        setTimeout(() => setSuccess(null), 5000);
        statusHook.mutate();
        runtimeHook.mutate();
        onMutate();
        setTimeout(() => {
          statusHook.mutate();
          runtimeHook.mutate();
          onMutate();
        }, 800);
        setTimeout(() => {
          statusHook.mutate();
          runtimeHook.mutate();
          onMutate();
        }, 2000);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
        setConfirm(null);
      }
    },
    [status.id, onMutate, statusHook, runtimeHook],
  );

  const healthLabel = detail?.health ?? (running ? 'healthy' : 'exited');
  const healthColor =
    healthLabel === 'healthy'
      ? 'text-emerald-400'
      : healthLabel === 'mismatch' || healthLabel === 'not-configured'
        ? 'text-amber-400'
        : 'text-white/40';

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 backdrop-blur-xl transition hover:border-nexus-500/40 flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <div className="font-bold text-sm text-white">{status.displayName}</div>
            <div className="text-xs text-white/50 mt-0.5">{status.description}</div>
          </div>
          {status.homepage && (
            <a
              href={status.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 transition hover:text-white flex items-center gap-1 text-[11px]"
              title={`Visit official documentation for ${status.displayName}`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <code className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-nexus-300">
            {status.id}
          </code>
          {status.installed ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Installed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold text-rose-400">
              <AlertCircle className="h-3 w-3" /> Not Detected
            </span>
          )}
          {status.configured && (
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
              Configured
            </span>
          )}
          <span className={`text-[10px] font-bold uppercase ${healthColor}`}>● {healthLabel}</span>
        </div>

        {/* Key facts */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="text-white/50">
            Version: <span className="font-mono text-white/70">{detail?.version ?? '—'}</span>
          </div>
          <div className="text-white/50">
            Executable: <span className="font-mono text-white/70 truncate">{detail?.executable?.split('\\').pop() ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-white/60">
            <Circle className={`h-3 w-3 ${running ? 'text-emerald-400 animate-pulse' : 'text-white/30'}`} fill="currentColor" />
            {running ? 'Running' : 'Stopped'}
          </div>
          <div className="text-white/50">
            PID: <span className="font-mono text-white/70">{runtime?.pid ?? '—'}</span>
          </div>
        </div>

        {/* Endpoint mismatch banner */}
        {mismatch ? (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <div className="flex items-center gap-1.5 font-bold">
              <ShieldAlert className="h-3.5 w-3.5" /> Configuration Mismatch
            </div>
            <div className="mt-1 font-mono text-amber-300/90 break-all">
              Current: {detail?.configuredEndpoint ?? '—'}
            </div>
            <div className="font-mono text-amber-300/90 break-all">
              Nexus: {detail?.expectedEndpoint ?? '—'}
            </div>
          </div>
        ) : (
          detail?.configuredEndpoint && (
            <div className="mt-3 truncate font-mono text-[10px] text-white/40" title={detail.configuredEndpoint}>
              Endpoint: {detail.configuredEndpoint}
            </div>
          )
        )}
      </div>

      {/* Real-time Background Installation Progress Panel */}
      {activeJob && (
        <div className="mt-3 rounded-xl border border-nexus-500/40 bg-nexus-950/40 p-3 text-[11px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-nexus-300">
              <Rocket className="h-3.5 w-3.5 animate-pulse" />
              <span>Background Installation: {activeJob.stage}</span>
            </div>
            <button
              type="button"
              onClick={() => cancelInstall(activeJob.id)}
              className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20"
            >
              Cancel
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-white/60">
            <span>Method: {activeJob.method}</span>
            <span>PID: {activeJob.pid ?? '—'}</span>
            <span>Progress: {activeJob.percentage}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-nexus-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${activeJob.percentage}%` }}
            />
          </div>
          {activeJob.logs.length > 0 && (
            <div className="mt-2 max-h-24 overflow-y-auto rounded bg-black/60 p-2 font-mono text-[10px] text-white/70">
              {activeJob.logs.slice(-4).map((l, i) => (
                <div key={i} className={l.stream === 'stderr' ? 'text-rose-300' : 'text-white/70'}>
                  {l.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lifecycle controls — gated by adapter capabilities */}
      <div className="mt-4">
        <div className="flex flex-wrap gap-2">
          {/* Action 1: Controlled Background Installer / Connector Configurer */}
          <button
            type="button"
            disabled={busy !== null || activeJob !== undefined}
            onClick={() => run('install', installAgent)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-40"
            title={recipe?.type === 'manual' ? `Configure ${status.displayName} connector files for Nexus Gateway` : `Install ${status.displayName} package binary on your system in background`}
          >
            <Rocket className={`h-3.5 w-3.5 ${busy === 'install' || activeJob ? 'animate-pulse' : ''}`} />
            {activeJob ? `Installing (${activeJob.stage})…` : busy === 'install' ? 'Starting…' : status.installed ? (recipe?.type === 'manual' ? 'Reconfigure Connector' : 'Reinstall Agent') : (recipe?.type === 'manual' ? 'Configure Connector' : 'Install Agent')}
          </button>

          {/* Action 2: Update Agent to Latest Version */}
          {status.installed && (
            recipe?.type === 'manual' && (recipe?.guideUrl || status.homepage) ? (
              <a
                href={recipe?.guideUrl || status.homepage}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-500/20"
                title={`Open official release & update page for ${status.displayName}`}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Check Updates ↗
              </a>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run('update', updateAgent)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-500/25 disabled:opacity-40"
                title={`Update ${status.displayName} to latest release via package manager`}
              >
                <RotateCw className={`h-3.5 w-3.5 ${busy === 'update' ? 'animate-spin' : ''}`} />
                {busy === 'update' ? 'Updating…' : 'Update Agent'}
              </button>
            )
          )}

          {/* Action 3: 1-Click Buckle / Rebind to Nexus Gateway */}
          {!status.configured ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('rebind', rebind)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-nexus-500/50 bg-nexus-500/20 px-3 py-1.5 text-[11px] font-semibold text-nexus-200 transition hover:bg-nexus-500/30 disabled:opacity-40"
              title={`Configure ${status.displayName} to route through Nexus Gateway`}
            >
              <Rocket className={`h-3.5 w-3.5 ${busy === 'rebind' ? 'animate-pulse' : ''}`} />
              {busy === 'rebind' ? 'Buckling…' : '1-Click Buckle to Nexus'}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('rebind', rebind)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/20 px-3 py-1.5 text-[11px] font-semibold text-purple-200 transition hover:bg-purple-500/30 disabled:opacity-40"
              title={`Re-apply Nexus gateway configuration for ${status.displayName}`}
            >
              <RotateCw className={`h-3.5 w-3.5 ${busy === 'rebind' ? 'animate-spin' : ''}`} />
              {busy === 'rebind' ? 'Rebinding…' : 'Rebind to Nexus'}
            </button>
          )}

          {/* Per-agent model picker: choose the exact model the agent runs with. */}
          {canStart && (
            <div className="mb-2">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40">
                Model for {status.displayName}
              </label>
              <select
                value={effectiveModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={busy !== null}
                className="w-full rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-[11px] text-white/80 outline-none transition hover:border-nexus-500/40 focus:border-nexus-500/60 disabled:opacity-40"
                title="Concrete model the agent will use (free models marked Free). Updates live as providers add/remove models."
              >
                {modelGroups.length === 0 && <option value="">No models discovered yet…</option>}
                {modelGroups.map((g) => (
                  <optgroup key={g.provider} label={g.provider}>
                    {g.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          {/* Per-agent model policy persistence */}
          <div className="mb-2 flex items-center justify-between">
            <label className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-white/40">
              <input
                type="checkbox"
                checked={freeBias}
                onChange={(e) => setFreeBias(e.target.checked)}
                className="h-3.5 w-3.5 accent-violet-500"
              />
              Prefer free models
            </label>
            <button
              type="button"
              onClick={savePolicy}
              className="rounded-lg border border-violet-500/40 bg-violet-500/15 px-2.5 py-1 text-[10px] font-semibold text-violet-200 transition hover:bg-violet-500/25"
              title="Persist this agent's default model + free-bias so it applies on every launch"
            >
              Save policy
            </button>
          </div>
          {policySaved === true && <div className="mb-2 text-[10px] text-emerald-400">✓ Policy saved</div>}
          {policySaved === false && <div className="mb-2 text-[10px] text-rose-400">✗ Save failed</div>}

          {canStart && (


            <button
              type="button"
              disabled={busy !== null || running}
              onClick={() => run('start', (id: string) => start(id, effectiveModel || undefined))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              title={running ? `${status.displayName} is already running` : `Launch ${status.displayName} agent process`}
            >
              <Play className="h-3.5 w-3.5" /> {busy === 'start' ? '…' : 'Start'}
            </button>
          )}

          {canStop && (
            <button
              type="button"
              disabled={busy !== null || !running}
              onClick={() => setConfirm('stop')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              title={running ? `Stop ${status.displayName} process (PID: ${runtime?.pid ?? 'active'})` : `${status.displayName} is currently stopped (click Start to launch)`}
            >
              <Square className="h-3.5 w-3.5" /> {busy === 'stop' ? '…' : 'Stop'}
            </button>
          )}

          {canRestart && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirm('restart')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-40"
            >
              <RotateCw className={`h-3.5 w-3.5 ${busy === 'restart' ? 'animate-spin' : ''}`} /> {busy === 'restart' ? 'Restarting…' : 'Restart'}
            </button>
          )}

          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('verify', verify)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> {busy === 'verify' ? '…' : 'Verify'}
          </button>

          {status.configured && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirm('unbuckle')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-[11px] font-semibold text-amber-300/80 transition hover:bg-amber-500/15 hover:text-amber-200 disabled:opacity-40"
              title={`Revert ${status.displayName} configuration back to standalone/default upstream settings`}
            >
              <Plug className="h-3.5 w-3.5 rotate-45" /> {busy === 'unbuckle' ? 'Unbuckling…' : 'Unbuckle'}
            </button>
          )}

          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setConfirm('uninstall')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-1.5 text-[11px] font-semibold text-rose-300/80 transition hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40"
            title={`Completely uninstall package binary and remove all configurations for ${status.displayName}`}
          >
            <ShieldAlert className="h-3.5 w-3.5" /> {busy === 'uninstall' ? 'Uninstalling…' : 'Uninstall'}
          </button>
        </div>

        {success && (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>{success}</span>
          </div>
        )}

        {error && (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-medium text-rose-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="button"
          onClick={copyToClipboard}
          className="mt-2.5 flex w-full items-center justify-between rounded-xl border border-white/5 bg-black/50 p-2.5 font-mono text-[11px] text-white/70 hover:bg-black/70 hover:border-nexus-500/30 transition text-left cursor-pointer group"
          title="Click to copy shell command ($ anx integrations install <id>)"
        >
          <span className="truncate">
            <span className="text-nexus-400 mr-1.5">$</span>
            {installCmd}
          </span>
          <span className="ml-2 shrink-0 text-white/40 group-hover:text-nexus-400 transition">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </span>
        </button>
      </div>

      {/* Confirmation dialog for destructive actions */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirm(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0f1a] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
              <ShieldAlert className="h-4 w-4" />
              {confirm === 'restart'
                ? `Restart ${status.displayName}?`
                : confirm === 'stop'
                  ? `Stop ${status.displayName}?`
                  : confirm === 'unbuckle'
                    ? `Unbuckle ${status.displayName}?`
                    : `Uninstall ${status.displayName}?`}
            </div>
            <p className="mt-2 text-xs text-white/60">
              {confirm === 'restart'
                ? 'The current agent process will be terminated and relaunched using the Nexus configuration.'
                : confirm === 'stop'
                  ? 'The running agent process will be terminated.'
                  : confirm === 'unbuckle'
                    ? 'Nexus configuration endpoints and overrides will be removed from this agent, reverting it to default.'
                    : 'The agent will be stopped, package binary uninstalled via npm/pip, and all configurations removed.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetAction =
                    confirm === 'restart'
                      ? restart
                      : confirm === 'stop'
                        ? stop
                        : confirm === 'unbuckle'
                          ? unbuckle
                          : uninstall;
                  run(confirm, targetAction);
                }}
                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20"
              >
                {confirm === 'restart'
                  ? 'Restart Agent'
                  : confirm === 'stop'
                    ? 'Stop Agent'
                    : confirm === 'unbuckle'
                      ? 'Unbuckle Agent'
                      : 'Uninstall Agent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NexusRuntime() {
  const { data: gw, isLoading } = useGatewayHealth();
  const { total, free, stale } = useModelCount();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const healthy = gw?.status === 'ok' || gw?.status === 'healthy';
  const restart = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/v1/system/gateway/restart', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Gateway will briefly drop; the health poll recovers automatically.
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTimeout(() => setBusy(false), 4000);
    }
  };

  return (
    <div className="rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-500/[0.06] to-black/40 p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-nexus-400" />
          <span className="text-sm font-bold text-white">Nexus Runtime</span>
          {isLoading ? (
            <span className="text-[10px] text-white/40">checking…</span>
          ) : (
            <span className={`text-[10px] font-bold uppercase ${healthy ? 'text-emerald-400' : 'text-rose-400'}`}>
              ● {healthy ? 'Healthy' : 'Down'}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={restart}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-40"
        >
          <RotateCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Restarting…' : 'Restart Gateway'}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div className="text-white/50">
          Endpoint: <span className="font-mono text-nexus-300">127.0.0.1:8787</span>
        </div>
        <div className="text-white/50">
          Version: <span className="font-mono text-white/70">{gw?.version ?? '—'}</span>
        </div>
        <div className="text-white/50">
          Models: <span className="font-mono text-white/70">{total}</span>{' '}
          <span className="text-emerald-400/80">({free} free)</span>
        </div>
        <div className="text-white/50">
          Stale: <span className="font-mono text-white/70">{stale}</span>
        </div>
      </div>
      {err && <div className="mt-2 text-[10px] text-rose-300">{err}</div>}
    </div>
  );
}

export default function IntegrationsPage() {
  const list = useIntegrationsList();
  const { restart, verify } = useIntegrationActions();
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [bulkErr, setBulkErr] = useState<string | null>(null);

  const integrations = list.data?.integrations ?? [];

  const grouped: Array<[string, IntegrationStatus[]]> = [
    ['CLI Coding Agents', integrations.filter((i) => i.category === 'cli')],
    ['Code Editors & IDEs', integrations.filter((i) => i.category === 'editor' || i.category === 'ide')],
    ['Autonomous Agent Frameworks', integrations.filter((i) => i.category === 'agent')],
  ];

  const counts = {
    total: integrations.length,
    detected: integrations.filter((i) => i.installed).length,
    configured: integrations.filter((i) => i.configured).length,
  };

  const refreshDetection = () => list.mutate();
  const restartAll = async () => {
    setBulkBusy('restart');
    setBulkErr(null);
    try {
      await Promise.all(
        integrations
          .filter((i) => i.installed)
          .map((i) => restart(i.id).catch((e) => e)),
      );
      setTimeout(refreshDetection, 800);
    } catch (e) {
      setBulkErr((e as Error).message);
    } finally {
      setBulkBusy(null);
    }
  };
  const verifyAll = async () => {
    setBulkBusy('verify');
    setBulkErr(null);
    try {
      await Promise.all(integrations.map((i) => verify(i.id).catch((e) => e)));
      setTimeout(refreshDetection, 800);
    } catch (e) {
      setBulkErr((e as Error).message);
    } finally {
      setBulkBusy(null);
    }
  };

  return (
    <div className="space-y-8 relative pb-12 w-full max-w-full overflow-x-hidden">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Universal Coding Agent Control Center
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Plug className="h-8 w-8 text-nexus-400" />
            Agent Integrations &amp; Lifecycle
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Buckle Claude Code, Codex, Gemini, OpenCode, Aider &amp; more to your Nexus Gateway, then start / stop / restart them directly. Each agent runs as its own tracked process — restarting one never touches another.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/agents"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <Boxes className="h-3.5 w-3.5 text-nexus-400" /> Runtime Agent Matrix
          </Link>
          <Link
            href="/router-studio"
            className="inline-flex items-center gap-1.5 rounded-xl border border-nexus-500/30 bg-nexus-500/10 px-3 py-1.5 text-xs font-semibold text-nexus-300 transition hover:bg-nexus-500/20"
          >
            <Cpu className="h-3.5 w-3.5 text-nexus-300" /> Router Studio
          </Link>
        </div>
      </div>

      {/* Universal Action Bar */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
              <Terminal className="h-4 w-4 text-nexus-400" /> Coding Agents
            </div>
            <div className="mt-1 text-[11px] text-white/50">
              {counts.total} detected ·{' '}
              <span className="text-emerald-400">{counts.detected} installed</span> ·{' '}
              <span className="text-cyan-400">{counts.configured} configured</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={list.isLoading}
              onClick={refreshDetection}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10 disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${list.isLoading ? 'animate-spin' : ''}`} /> Refresh Detection
            </button>
            <button
              type="button"
              disabled={bulkBusy !== null}
              onClick={restartAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
            >
              <RotateCw className={`h-3.5 w-3.5 ${bulkBusy === 'restart' ? 'animate-spin' : ''}`} /> Restart Selected
            </button>
            <button
              type="button"
              disabled={bulkBusy !== null}
              onClick={verifyAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10 disabled:opacity-40"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Verify All
            </button>
          </div>
        </div>
        {bulkErr && <div className="mt-2 text-[10px] text-rose-300">{bulkErr}</div>}
      </div>

      {/* Nexus Runtime (separate from agent restart) */}
      <NexusRuntime />

      {list.isLoading ? (
        <div className="rounded-2xl border border-white/10 bg-black/40 py-12 text-center text-xs text-white/40">
          Scanning system for installed coding agent harnesses...
        </div>
      ) : (
        grouped.map(([label, items]) =>
          items.length === 0 ? null : (
            <div key={label} className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
                <Terminal className="h-4 w-4 text-nexus-400" /> {label} ({items.length})
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((i) => (
                  <IntegrationCard key={i.id} status={i} onMutate={refreshDetection} />
                ))}
              </div>
            </div>
          ),
        )
      )}
    </div>
  );
}

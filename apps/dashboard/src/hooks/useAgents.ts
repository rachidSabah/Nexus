'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface RuntimeAgent {
  id: string;
  name: string;
  found: boolean;
  runnable: boolean;
  liveVerified: boolean;
  version?: string;
  executable?: string;
  platform: string;
  configLocation?: string;
  detectedVia?: 'path' | 'npm-global' | 'config-file' | 'not-found';
}

export interface AgentConfigurationResult {
  agentId: string;
  agentName: string;
  configured: boolean;
  runnable: boolean;
  liveVerified: boolean;
  dryRun: boolean;
  backupPath?: string;
  protocol: string;
  gatewayUrl: string;
  requiresRestart: boolean;
  message: string;
}

export interface ConfigureAllResponse {
  configuredAgents: AgentConfigurationResult[];
}

/**
 * Lists coding agents detected on the machine (Claude Code, Codex, Gemini,
 * OpenCode, Cline, Roo, Aider, Hermes, etc.) via the gateway's detector.
 */
export function useAgents(refreshIntervalMs = 10000) {
  return useSWR<{ agents: RuntimeAgent[] }>('/api/v1/runtime-agents', fetcher, {
    refreshInterval: refreshIntervalMs,
  });
}

/**
 * Dynamic agent-model push.
 *
 * When models spin up (discovered/prefetched by the gateway), connected coding
 * agents must receive the refreshed catalog automatically. The gateway is the
 * model source of truth: every agent whose base URL points at the gateway sees
 * /v1/models live. `pushModelsToAgents` re-runs the gateway's per-agent
 * `configure` (idempotent per the integration contract) so each detected
 * agent's config is re-pointed at the gateway with the current default model
 * alias — guaranteeing newly-discovered models show up without the user
 * manually re-buckling each agent.
 *
 * The default model is left as the dynamic alias (nexus/auto) so the agent
 * always resolves to whatever the fabric currently considers best — free,
 * paid, or limit-usage models are all reachable through the gateway.
 */
export function usePushModelsToAgents() {
  const [pushing, setPushing] = useState(false);
  const [lastResult, setLastResult] = useState<ConfigureAllResponse | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const push = useCallback(async (opts?: { gatewayUrl?: string; defaultModel?: string }) => {
    setPushing(true);
    setLastError(null);
    try {
      const res = await fetch('/api/v1/runtime-agents/configure-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl: opts?.gatewayUrl ?? 'http://127.0.0.1:8787',
          defaultModel: opts?.defaultModel ?? 'nexus/auto',
        }),
      });
      if (!res.ok) {
        throw new Error(`configure-all failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as ConfigureAllResponse;
      setLastResult(body);
      return body;
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown error';
      setLastError(msg);
      throw err;
    } finally {
      setPushing(false);
    }
  }, []);

  return { push, pushing, lastResult, lastError };
}

/**
 * Detect + configure a single agent (explicit buckle). Returns the result of
 * the gateway's integration install step.
 */
export function useConfigureAgent() {
  const [configuring, setConfiguring] = useState(false);
  const configure = useCallback(
    async (agentId: string, opts?: { gatewayUrl?: string; defaultModel?: string; dryRun?: boolean }) => {
      setConfiguring(true);
      try {
        const res = await fetch(`/api/v1/runtime-agents/${agentId}/configure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts ?? {}),
        });
        if (!res.ok) throw new Error(`configure ${agentId} failed: HTTP ${res.status}`);
        return (await res.json()) as AgentConfigurationResult;
      } finally {
        setConfiguring(false);
      }
    },
    [],
  );
  return { configure, configuring };
}

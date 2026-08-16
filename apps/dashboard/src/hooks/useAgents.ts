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

export interface AgentVerificationResult {
  id: string;
  name: string;
  detected: boolean;
  configured: boolean;
  runnable: boolean;
  gatewayReachable: boolean;
  catalogReachable: boolean;
  inferenceVerified: boolean;
  streamingVerified: boolean;
  toolCallingVerified: boolean;
  lastVerification: string | null;
  failureReason: string | null;
  executable?: string;
  configLocation?: string;
  protocol: string;
  version?: string;
  platform: string;
  detectedVia: string;
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
 * Distinguishes pushable local file configurations from gateway-level dynamic availability.
 * Computes truthful stats without collapsing detected into pushed.
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
  const [configuring, setConfiguring] = useState<Record<string, boolean>>({});
  const configure = useCallback(
    async (agentId: string, opts?: { gatewayUrl?: string; defaultModel?: string; dryRun?: boolean }) => {
      setConfiguring((prev) => ({ ...prev, [agentId]: true }));
      try {
        const res = await fetch(`/api/v1/runtime-agents/${agentId}/configure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts ?? {}),
        });
        if (!res.ok) throw new Error(`configure ${agentId} failed: HTTP ${res.status}`);
        return (await res.json()) as AgentConfigurationResult;
      } finally {
        setConfiguring((prev) => ({ ...prev, [agentId]: false }));
      }
    },
    [],
  );
  return { configure, configuring };
}

/**
 * Run active multi-stage health & readiness verification on a specific agent.
 */
export function useVerifyAgent() {
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const verify = useCallback(async (agentId: string) => {
    setVerifying((prev) => ({ ...prev, [agentId]: true }));
    try {
      const res = await fetch(`/api/v1/runtime-agents/${agentId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`verify ${agentId} failed: HTTP ${res.status}`);
      return (await res.json()) as AgentVerificationResult;
    } finally {
      setVerifying((prev) => ({ ...prev, [agentId]: false }));
    }
  }, []);
  return { verify, verifying };
}

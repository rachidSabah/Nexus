'use client';

import { useCallback } from 'react';
import useSWR from 'swr';

import { useModels } from './useModels';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface IntegrationStatus {
  id: string;
  displayName: string;
  description: string;
  category: 'cli' | 'editor' | 'ide' | 'agent';
  homepage?: string;
  installed: boolean;
  configured: boolean;
  configPath?: string;
  details?: string;
  /** Endpoint the agent's config currently points at (raw, e.g. http://localhost:8787/v1). */
  configuredEndpoint?: string;
  /** The Nexus gateway endpoint the integration expects. */
  expectedEndpoint?: string;
  /** True when configuredEndpoint differs from expectedEndpoint (normalized). */
  mismatch?: boolean;
  executable?: string;
  version?: string;
  health?: 'unknown' | 'healthy' | 'mismatch' | 'not-configured';
  installRecipe?: {
    type: 'npm' | 'pip' | 'binary' | 'manual';
    packageName?: string;
    guideUrl?: string;
  };
}

export interface RuntimeState {
  id: string;
  running: boolean;
  pid?: number;
  executable?: string;
  startedAt?: string;
  gatewayTarget?: string;
  health: 'unknown' | 'healthy' | 'unhealthy' | 'exited';
  exitCode?: number;
  lastError?: string;
  capabilities?: {
    supportsStart: boolean;
    supportsStop: boolean;
    supportsRestart: boolean;
    supportsInstall: boolean;
    supportsUninstall: boolean;
    supportsGatewayBinding: boolean;
    interactive: boolean;
  };
}

export interface VerifyResult {
  ok: boolean;
  message: string;
  actions?: string[];
}

/** Fetches the integration list from the gateway. */
export function useIntegrationsList() {
  return useSWR<{ count: number; integrations: IntegrationStatus[] }>(
    '/api/v1/integrations',
    fetcher,
    { refreshInterval: 30_000 },
  );
}

/** Fetches the rich per-integration status (endpoint mismatch, version, executable, health). */
export function useIntegrationStatus(id: string) {
  return useSWR<IntegrationStatus>(
    `/api/v1/integrations/${id}/status`,
    fetcher,
    { refreshInterval: 15_000, keepPreviousData: true },
  );
}

/** Fetches the live runtime state (running / pid / capabilities). */
export function useIntegrationRuntime(id: string) {
  return useSWR<RuntimeState>(
    `/api/v1/integrations/${id}/runtime`,
    fetcher,
    { refreshInterval: 8_000, keepPreviousData: true },
  );
}

/** Gateway health for the Nexus Runtime section. */
export function useGatewayHealth() {
  return useSWR<{ status: string; version?: string; uptime?: number }>(
    '/api/health',
    fetcher,
    { refreshInterval: 5_000 },
  );
}

/** Real model-catalog count (never hardcoded). */
export function useModelCount() {
  const { stats } = useModels(20_000);
  return {
    total: stats?.totalModels ?? 0,
    free: stats?.freeModels ?? 0,
    paid: stats?.totalModels != null && stats?.freeModels != null
      ? stats.totalModels - stats.freeModels
      : 0,
    stale: stats?.staleModels ?? 0,
  };
}

async function action(url: string, body?: unknown): Promise<{ ok?: boolean; message?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string; error?: { message?: string } }).message || (data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`);
  }
  return data as { ok?: boolean; message?: string };
}

export interface InstallationLogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface InstallationJob {
  readonly id: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly method: string;
  readonly platform: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  stage: string;
  pid?: number;
  startTime: number;
  completionTime?: number;
  durationMs?: number;
  percentage: number;
  logs: InstallationLogEntry[];
  error?: string;
  exitCode?: number;
  result?: {
    ok: boolean;
    installed: boolean;
    configured: boolean;
    version?: string;
    executable?: string;
    message: string;
    actions: string[];
    errors?: string[];
  };
}

export function useInstallJobs(agentId?: string) {
  return useSWR<{ jobs: InstallationJob[]; count: number }>(
    agentId ? `/api/v1/agents/install-jobs?agentId=${agentId}` : '/api/v1/agents/install-jobs',
    fetcher,
    { refreshInterval: 1500 },
  );
}

export function useInstallJob(jobId?: string) {
  return useSWR<InstallationJob>(
    jobId ? `/api/v1/agents/install-jobs/${jobId}` : null,
    fetcher,
    { refreshInterval: 1000 },
  );
}

/** Generic, agent-agnostic lifecycle actions. id is the integration id. */
export function useIntegrationActions() {
  const start = useCallback(
    (id: string, defaultModel?: string) =>
      action(`/api/v1/integrations/${id}/start`, defaultModel ? { defaultModel } : undefined),
    [],
  );
  const stop = useCallback((id: string) => action(`/api/v1/integrations/${id}/stop`), []);
  const restart = useCallback((id: string) => action(`/api/v1/integrations/${id}/restart`), []);
  const rebind = useCallback(
    (id: string) => action(`/api/v1/integrations/${id}/install`, { force: true }),
    [],
  );
  const installAgent = useCallback(
    (id: string) => action(`/api/v1/agents/${id}/install`, { force: true }),
    [],
  );
  const cancelInstall = useCallback(
    (jobId: string) => action(`/api/v1/agents/install-jobs/${jobId}/cancel`),
    [],
  );
  const updateAgent = useCallback(
    (id: string) => action(`/api/v1/agents/${id}/update`),
    [],
  );
  const verify = useCallback(
    (id: string) => action(`/api/v1/integrations/${id}/verify`),
    [],
  );
  const uninstall = useCallback(
    (id: string) => action(`/api/v1/integrations/${id}/uninstall`),
    [],
  );
  const unbuckle = useCallback(
    (id: string) => action(`/api/v1/agents/${id}/unbuckle`),
    [],
  );
  const restartGateway = useCallback(() => action('/api/v1/system/gateway/restart'), []);

  return { start, stop, restart, rebind, installAgent, cancelInstall, updateAgent, verify, uninstall, unbuckle, restartGateway };
}

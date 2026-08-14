'use client';

import { useEffect, useRef } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface DiscoveredModel {
  id: string;
  providerId: string;
  nativeModelId?: string;
  isFree?: boolean;
  freeTier?: 'FREE' | 'FREE_TIER' | 'PAID' | 'ZERO_INPUT_PAID_OUTPUT' | 'UNKNOWN';
  pricingSource?: string;
  availability?: string;
  contextWindow?: number;
  pricing?: {
    inputPer1K?: number;
    outputPer1K?: number;
    isFree?: boolean;
    freeTier?: string;
  };
  capabilities?: Record<string, unknown>;
  /** Set when the fabric marked the model unhealthy (e.g. upstream 401/404). */
  stale?: boolean;
  staleReason?: 'disappeared' | 'unhealthy';
  lastError?: string;
}

export interface ModelsDiscoverResponse {
  models: DiscoveredModel[];
}

export interface ModelsStatsResponse {
  totalModels?: number;
  freeModels?: number;
  staleModels?: number;
  byProvider?: Record<string, number>;
  lastRefreshAt?: number;
  refreshing?: boolean;
  pricingBySource?: Record<string, number>;
  freeTiers?: Record<string, number>;
}

/**
 * Shared dynamic model-catalog hook.
 *
 * Prefetches the gateway's discovered model catalog on mount and on a 15s
 * interval. The gateway is the single source of truth — it dynamically
 * discovers models from every provider, classifies FREE/PAID/UNKNOWN, and
 * drops dead (stale/unhealthy) models. This hook surfaces that live state to
 * any dashboard surface that needs it (model picker, agents push, telemetry).
 */
export function useModels(refreshIntervalMs = 15000) {
  const { data, isLoading, error, mutate } = useSWR<ModelsDiscoverResponse>(
    '/api/v1/models/discover',
    fetcher,
    { refreshInterval: refreshIntervalMs, revalidateOnFocus: true },
  );
  const { data: stats } = useSWR<ModelsStatsResponse>('/api/v1/models/stats', fetcher, {
    refreshInterval: refreshIntervalMs,
  });

  const models = data?.models ?? [];

  // Derive buckets the UI + agent-push logic need.
  const free = models.filter(
    (m) => m.isFree === true || m.freeTier === 'FREE' || m.freeTier === 'FREE_TIER' || m.pricing?.isFree === true,
  );
  const paid = models.filter((m) => m.freeTier === 'PAID' || m.freeTier === 'ZERO_INPUT_PAID_OUTPUT');
  const unknown = models.filter((m) => m.freeTier === 'UNKNOWN');
  const dead = models.filter((m) => m.stale === true);
  const available = models.filter((m) => m.stale !== true);

  return {
    models,
    available,
    free,
    paid,
    unknown,
    dead,
    stats,
    isLoading,
    error,
    mutate,
  };
}

/**
 * Returns a stable callback that triggers an immediate gateway model refresh
 * (re-runs provider discovery) and revalidates the local SWR cache.
 */
export function useTriggerModelRefresh() {
  const { mutate } = useSWR<ModelsDiscoverResponse>('/api/v1/models/discover', fetcher, {
    refreshInterval: 15000,
  });
  return async () => {
    try {
      await fetch('/api/v1/models/refresh', { method: 'POST' });
    } catch {
      /* gateway may be mid-refresh; next poll picks it up */
    } finally {
      await mutate();
    }
  };
}

/**
 * Subscribes to the live model catalog and invokes `onModelsChanged` whenever
 * the set of *available* (non-stale) model ids changes — i.e. when models
 * spin up (discovered) or drop out (dead/retired). This is the dynamic-push
 * trigger: the dashboard can re-configure connected coding agents so they
 * receive the new catalog without manual intervention.
 */
export function useModelChangeEffect(
  onModelsChanged: (ctx: { availableIds: string[]; added: string[]; removed: string[]; count: number }) => void,
  refreshIntervalMs = 15000,
) {
  const { models } = useModels(refreshIntervalMs);
  const prevRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const availableIds = models.filter((m) => m.stale !== true).map((m) => m.id);
    const current = new Set(availableIds);
    const prev = prevRef.current;

    if (prev === null) {
      // First load — establish baseline, don't fire a change event.
      prevRef.current = current;
      return;
    }

    const added: string[] = [];
    const removed: string[] = [];
    for (const id of current) if (!prev.has(id)) added.push(id);
    for (const id of prev) if (!current.has(id)) removed.push(id);

    if (added.length > 0 || removed.length > 0) {
      prevRef.current = current;
      onModelsChanged({ availableIds: availableIds, added, removed, count: current.size });
    }
  }, [models, onModelsChanged]);
}

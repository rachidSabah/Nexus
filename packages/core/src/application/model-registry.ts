/**
 * ───────────────────────────────────────────────────────────────────────────
 * ModelRegistry — aggregates discovered models from all provider adapters,
 * classifies free-tier models, and runs a background refresh loop.
 *
 * The master prompt's most-repeated requirement: "Do NOT hard-code today's
 * free models. The system should discover them dynamically."
 *
 * This registry:
 *   1. Calls each provider adapter's `discoverModels()` on startup
 *   2. Re-runs discovery on a configurable interval (default: 1 hour)
 *   3. Aggregates all discovered models into a unified `ModelDescriptor[]`
 *   4. Classifies free models (provider metadata OR `:free` suffix OR
 *      zero pricing) into a separate filterable view
 *   5. Marks disappeared models as `stale` for one cycle (so the dashboard
 *      can show "recently removed" rather than silently dropping them)
 *   6. Exposes lookup by id, by provider, by capability, by free status
 *
 * The registry does NOT call providers on the request hot path — discovery
 * is purely background. The routing engine reads from the in-memory
 * snapshot (refreshed hourly).
 *
 * Master prompt #5: dynamic model discovery
 * Master prompt #6: free model discovery (no hard-coded list)
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ModelDescriptor, ProviderEndpoint } from '../domain/types.js';

import type { ProviderAdapter, RoutingEnginePort } from './ports.js';

export interface ModelRegistryOptions {
  /** Refresh interval in ms. Default: 1 hour. */
  refreshIntervalMs?: number;
  /** Max concurrent provider discoveries per refresh cycle. Default: 5. */
  maxConcurrency?: number;
  /** Per-provider discovery timeout in ms. Default: 15s. */
  discoveryTimeoutMs?: number;
}

export class ModelRegistry {
  private readonly models = new Map<string, ModelDescriptor>();
  /** providerId → set of model ids (for fast lookup). */
  private readonly byProvider = new Map<string, Set<string>>();
  /** Refresh loop handle. */
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  /** Whether a refresh is currently in progress. */
  private refreshing = false;
  /** Last refresh timestamp (epoch ms). */
  private lastRefreshAt = 0;
  /** Last refresh error per provider (empty = success). */
  private readonly lastErrors = new Map<string, string>();

  private readonly routing: RoutingEnginePort;
  private readonly adapters: Map<string, ProviderAdapter>;
  private readonly refreshIntervalMs: number;
  private readonly maxConcurrency: number;
  private readonly discoveryTimeoutMs: number;

  constructor(
    routing: RoutingEnginePort,
    adapters: Map<string, ProviderAdapter>,
    opts: ModelRegistryOptions = {},
  ) {
    this.routing = routing;
    this.adapters = adapters;
    this.refreshIntervalMs = opts.refreshIntervalMs ?? 60 * 60 * 1000;
    this.maxConcurrency = opts.maxConcurrency ?? 5;
    this.discoveryTimeoutMs = opts.discoveryTimeoutMs ?? 15_000;
  }

  /**
   * Starts the background refresh loop. Calls `refresh()` once immediately
   * so the registry has data on startup, then schedules periodic refreshes.
   */
  async start(): Promise<void> {
    // Initial discovery — don't block startup on slow providers.
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), this.refreshIntervalMs);
  }

  /** Stops the background refresh loop. */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Triggers an immediate refresh. Returns when all provider discoveries
   * have completed (or timed out). Safe to call concurrently — only one
   * refresh runs at a time; concurrent callers await the in-flight one.
   */
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const endpoints = this.routing.listEndpoints();
      // Group endpoints by providerId so we only discover once per provider
      // (not once per endpoint — multiple endpoints for the same provider
      // would just return the same model list).
      const discoveredByProvider = new Map<string, readonly ModelDescriptor[]>();
      // Limit concurrency to avoid hammering all providers simultaneously.
      const queue: ProviderEndpoint[] = [...endpoints];
      const workers: Promise<void>[] = [];
      for (let w = 0; w < this.maxConcurrency; w++) {
        workers.push(this.discoveryWorker(queue, discoveredByProvider));
      }
      await Promise.all(workers);

      // Merge: mark disappeared models as stale, add new ones, update existing.
      const now = Date.now();
      const newIds = new Set<string>();
      for (const [providerId, models] of discoveredByProvider) {
        for (const m of models) {
          const key = `${providerId}:${m.id}`;
          newIds.add(key);
          this.models.set(key, { ...m, discoveredAt: now, stale: false });
          let set = this.byProvider.get(providerId);
          if (!set) {
            set = new Set();
            this.byProvider.set(providerId, set);
          }
          set.add(m.id);
        }
      }
      // Mark disappeared models as stale (kept for one cycle).
      for (const [key, m] of this.models) {
        if (!newIds.has(key) && !m.stale) {
          this.models.set(key, { ...m, stale: true });
        } else if (newIds.has(key) && m.stale) {
          // Reappeared — clear stale flag.
          this.models.set(key, { ...m, stale: false, discoveredAt: now });
        } else if (!newIds.has(key) && m.stale) {
          // Was stale last cycle, still gone — drop it.
          this.models.delete(key);
        }
      }
      this.lastRefreshAt = now;
    } finally {
      this.refreshing = false;
    }
  }

  /** Worker that pulls endpoints off the queue and discovers models. */
  private async discoveryWorker(
    queue: ProviderEndpoint[],
    results: Map<string, readonly ModelDescriptor[]>,
  ): Promise<void> {
    while (queue.length > 0) {
      const endpoint = queue.shift();
      if (!endpoint) break;
      const adapter = this.adapters.get(endpoint.providerId);
      if (!adapter?.discoverModels) {
        // Adapter doesn't support discovery — skip silently.
        continue;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.discoveryTimeoutMs);
        try {
          const models = await adapter.discoverModels(endpoint, controller.signal);
          results.set(endpoint.providerId, models);
          this.lastErrors.delete(endpoint.providerId);
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        // Don't fail the whole refresh — just record the error and move on.
        this.lastErrors.set(endpoint.providerId, (err as Error).message);
      }
    }
  }

  /** Returns all discovered models (including stale ones). */
  list(): readonly ModelDescriptor[] {
    return Array.from(this.models.values());
  }

  /** Returns all models for a specific provider. */
  listByProvider(providerId: string): readonly ModelDescriptor[] {
    return this.list().filter((m) => m.providerId === providerId);
  }

  /** Returns all models marked as free (pricing.isFree === true). */
  listFree(): readonly ModelDescriptor[] {
    return this.list().filter((m) => m.pricing?.isFree === true && !m.stale);
  }

  /**
   * Returns all models with a specific capability. Master prompt #34:
   * capability-aware routing.
   */
  listByCapability(cap: keyof NonNullable<ModelDescriptor['capabilities']>): readonly ModelDescriptor[] {
    return this.list().filter((m) => m.capabilities?.[cap] === true && !m.stale);
  }

  /** Returns models with context window >= the given threshold. */
  listByContextWindow(minTokens: number): readonly ModelDescriptor[] {
    return this.list().filter((m) => (m.contextWindow ?? 0) >= minTokens && !m.stale);
  }

  /** Looks up a single model by provider + id. */
  get(providerId: string, modelId: string): ModelDescriptor | undefined {
    return this.models.get(`${providerId}:${modelId}`);
  }

  /** True if the model is currently known and not stale. */
  isAvailable(providerId: string, modelId: string): boolean {
    const m = this.get(providerId, modelId);
    return !!m && !m.stale;
  }

  /** Returns registry stats for the dashboard. */
  stats(): {
    totalModels: number;
    freeModels: number;
    staleModels: number;
    byProvider: Record<string, number>;
    lastRefreshAt: number;
    refreshing: boolean;
    errors: Record<string, string>;
  } {
    const all = this.list();
    const byProvider: Record<string, number> = {};
    for (const m of all) {
      byProvider[m.providerId] = (byProvider[m.providerId] ?? 0) + 1;
    }
    return {
      totalModels: all.length,
      freeModels: all.filter((m) => m.pricing?.isFree && !m.stale).length,
      staleModels: all.filter((m) => m.stale).length,
      byProvider,
      lastRefreshAt: this.lastRefreshAt,
      refreshing: this.refreshing,
      errors: Object.fromEntries(this.lastErrors),
    };
  }
}

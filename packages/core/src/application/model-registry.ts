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
 *   4. Classifies free models (provider metadata OR free-id suffix OR
 *      zero pricing) into a separate filterable view — LIVE pricing from
 *      provider metadata always beats adapter fallbacks (§7 hierarchy)
 *   5. Marks disappeared models as `stale` for one cycle (so the dashboard
 *      can show "recently removed" rather than silently dropping them)
 *   6. Exposes lookup by id, by provider, by capability, by free status
 *   7. Publishes model-fabric events (§22): model.discovered / model.updated
 *      / model.removed / model.pricing.changed / provider.prefetch.completed
 *
 * The registry does NOT call providers on the request hot path — discovery
 * is purely background. The routing engine reads from the in-memory
 * snapshot (refreshed hourly).
 *
 * Master prompt #5: dynamic model discovery
 * Master prompt #6: free model discovery (no hard-coded list)
 * ───────────────────────────────────────────────────────────────────────────
 */

import { buildEvent } from '../domain/events.js';
import type { ModelDescriptor, ProviderEndpoint } from '../domain/types.js';

import type { EventBusPort, ProviderAdapter, RoutingEnginePort } from './ports.js';
import { classifyPricing, mergePricing } from './pricing.js';

export interface ProviderDiscoveryInfo {
  providerId: string;
  connectivity: 'CONNECTED' | 'UNREACHABLE' | 'AUTHENTICATION_FAILED' | 'UNKNOWN';
  modelDiscovery: 'READY' | 'CONNECTED_BUT_DISCOVERY_FAILED' | 'DISCOVERY_PARTIAL' | 'UNREACHABLE' | 'AUTHENTICATION_FAILED';
  modelCount: number;
  lastDiscovery: number;
  lastSuccess: number;
  lastError?: string;
}

export interface ModelRegistryOptions {
  /** Refresh interval in ms. Default: 1 hour. */
  refreshIntervalMs?: number;
  /** Max concurrent provider discoveries per refresh cycle. Default: 5. */
  maxConcurrency?: number;
  /** Per-provider discovery timeout in ms. Default: 15s. */
  discoveryTimeoutMs?: number;
  /** Optional event bus — model fabric events are published here. */
  events?: EventBusPort;
  /** Optional resolver to retrieve API keys for background model discovery. */
  keyGetter?: (providerId: string) => Promise<string | undefined> | string | undefined;
}

export class ModelRegistry {
  private readonly models = new Map<string, ModelDescriptor>();
  /** Dynamic catalog version incremented on every model registry mutation. */
  private catalogVersion = 1024;
  /**
   * Bounded change-log for delta catalog sync (Phase 13 §10/§18).
   * Records the most recent mutation per model key since the last version the
   * client consumed. Capped to BOUNDED_LOG_MAX entries; when a model mutates
   * again its prior entry is updated in place so the log never grows unbounded.
   */
  private readonly changeLog = new Map<string, { version: number; op: 'added' | 'updated' | 'removed' }>();
  private static readonly CHANGE_LOG_MAX = 20000;
  /** Detailed discovery telemetry per provider. */
  private readonly providerDiagnostics = new Map<string, ProviderDiscoveryInfo>();
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
  private readonly events: EventBusPort | undefined;

  private readonly keyGetter?: (providerId: string) => Promise<string | undefined> | string | undefined;

  /**
   * Explicitly-registered models that are NOT subject to discovery. These
   * survive refresh cycles (re-seeded every refresh) and are exempt from the
   * stale-sweep and from `markModelUnhealthy`, so an operator can pin a model
   * the upstream `/models` API doesn't expose (e.g. a provider showcase model
   * published on the website before it appears via API). Keyed by
   * `providerId:modelId`. Used for manual/explicit model registration only —
   * never for the dynamic free-model discovery mandated by the master prompt.
   */
  private readonly explicit = new Map<string, ModelDescriptor>();

  constructor(
    routing: RoutingEnginePort,
    adapters: Map<string, ProviderAdapter>,
    opts: ModelRegistryOptions = {},
  ) {
    this.routing = routing;
    this.adapters = adapters;
    this.keyGetter = opts.keyGetter;
    this.refreshIntervalMs = opts.refreshIntervalMs ?? 60 * 60 * 1000;
    this.maxConcurrency = opts.maxConcurrency ?? 5;
    this.discoveryTimeoutMs = opts.discoveryTimeoutMs ?? 15_000;
    this.events = opts.events;
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
      const emittedFree = new Set<string>();
      let mutated = false;

      for (const [providerId, models] of discoveredByProvider) {
        const discoveredCount = models.length;
        let freeCount = 0;
        for (const raw of models) {
          const key = `${providerId}:${raw.id}`;
          const existing = this.models.get(key);
          const merged = mergePricing(existing?.pricing, raw.pricing);
          const classification = classifyPricing(merged);
          const normalized: ModelDescriptor = {
            ...raw,
            providerId,
            pricing: merged
              ? { ...merged, isFree: classification.isFree, freeTier: classification.freeTier }
              : undefined,
            discoveredAt: now,
          };
          newIds.add(key);

          const isFree = classification.isFree;
          if (isFree) freeCount += 1;

          if (!existing) {
            mutated = true;
            this.models.set(key, { ...normalized, stale: false });
            this.publish('model.discovered', {
              providerId,
              modelId: normalized.id,
              isFree,
              freeTier: classification.freeTier,
            });
          } else {
            const wasFree = existing.pricing?.isFree === true;
            const pricingChanged =
              wasFree !== isFree ||
              JSON.stringify(existing.pricing ?? null) !== JSON.stringify(normalized.pricing ?? null);
            if (pricingChanged || existing.stale || existing.displayName !== normalized.displayName) {
              mutated = true;
            }
            this.models.set(key, {
              ...existing,
              ...normalized,
              stale: false,
              discoveredAt: now,
            });
            if (pricingChanged) {
              this.publish('model.pricing.changed', {
                providerId,
                modelId: normalized.id,
                wasFree,
                isFree,
                freeTier: classification.freeTier,
                source: normalized.pricing?.source,
              });
            }
            if (wasFree) emittedFree.add(key);
          }
        }

        this.providerDiagnostics.set(providerId, {
          providerId,
          connectivity: 'CONNECTED',
          modelDiscovery: discoveredCount > 0 ? 'READY' : 'CONNECTED_BUT_DISCOVERY_FAILED',
          modelCount: discoveredCount,
          lastDiscovery: now,
          lastSuccess: now,
        });

        this.publish('provider.prefetch.completed', {
          providerId,
          discovered: discoveredCount,
          total: discoveredCount,
          free: freeCount,
        });
      }

      // Mark disappeared models as stale (kept for one cycle).
      for (const [key, m] of this.models) {
        // Explicit models are exempt from the stale-sweep — they're pinned by
        // the operator and must not be evicted just because discovery didn't
        // return them (e.g. a provider showcase model absent from /models).
        if (this.explicit.has(key)) continue;
        if (!newIds.has(key) && !m.stale) {
          mutated = true;
          this.models.set(key, { ...m, stale: true });
          this.publish('model.removed', {
            providerId: m.providerId,
            modelId: m.id,
            reason: 'stale',
          });
        } else if (newIds.has(key) && m.stale) {
          // A discovered model that reappears is normally re-enabled.
          // BUT if it was marked stale by a runtime upstream failure
          // ('unhealthy' — e.g. HTTP 401/403/404/410 because the model was
          // retired or the key is invalid for it), do NOT auto-reinstate it
          // just because the provider still lists it. It stays excluded until
          // markModelHealthy() clears the failure (or it disappears entirely).
          if (m.staleReason === 'unhealthy') {
            continue; // keep excluded; catalogVersion unchanged for this entry
          }
          mutated = true;
          this.models.set(key, { ...m, stale: false, staleReason: undefined, lastError: undefined, discoveredAt: now });
          this.recordChange(key, 'updated');
        } else if (!newIds.has(key) && m.stale) {
          mutated = true;
          this.models.delete(key);
          this.recordChange(key, 'removed');
        }
      }

      if (mutated) {
        this.catalogVersion++;
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
        continue;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.discoveryTimeoutMs);
        try {
          let ep = endpoint;
          if (this.keyGetter && !(endpoint as ProviderEndpoint & { apiKey?: string }).apiKey) {
            const key = await this.keyGetter(endpoint.providerId);
            if (key) {
              ep = { ...endpoint, apiKey: key } as ProviderEndpoint;
            }
          }
          const models = await adapter.discoverModels(ep, controller.signal);
          results.set(endpoint.providerId, models);
          this.lastErrors.delete(endpoint.providerId);
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        const msg = (err as Error).message;
        this.lastErrors.set(endpoint.providerId, msg);
        const isAuth = msg.includes('401') || msg.includes('403') || msg.includes('API key');
        this.providerDiagnostics.set(endpoint.providerId, {
          providerId: endpoint.providerId,
          connectivity: isAuth ? 'AUTHENTICATION_FAILED' : 'UNREACHABLE',
          modelDiscovery: isAuth ? 'AUTHENTICATION_FAILED' : 'CONNECTED_BUT_DISCOVERY_FAILED',
          modelCount: this.listByProvider(endpoint.providerId).length,
          lastDiscovery: Date.now(),
          lastSuccess: this.providerDiagnostics.get(endpoint.providerId)?.lastSuccess ?? 0,
          lastError: msg,
        });
      }
    }
  }

  /** Discovers models for a single provider on demand. */
  async discoverProvider(providerId: string): Promise<{
    providerId: string;
    status: 'completed' | 'failed';
    discovered: number;
    added: number;
    updated: number;
    removed: number;
    catalogVersion: number;
    error?: string;
  }> {
    const adapter = this.adapters.get(providerId);
    const endpoints = this.routing.listEndpoints().filter((e) => e.providerId === providerId);
    if (!adapter || endpoints.length === 0) {
      return {
        providerId,
        status: 'failed',
        discovered: 0,
        added: 0,
        updated: 0,
        removed: 0,
        catalogVersion: this.catalogVersion,
        error: `No registered adapter/endpoint for provider '${providerId}'`,
      };
    }

    if (!adapter.discoverModels) {
      return {
        providerId,
        status: 'completed',
        discovered: 0,
        added: 0,
        updated: 0,
        removed: 0,
        catalogVersion: this.catalogVersion,
      };
    }

    const endpoint = endpoints[0]!;
    let ep = endpoint;
    if (this.keyGetter && !(endpoint as ProviderEndpoint & { apiKey?: string }).apiKey) {
      const key = await this.keyGetter(providerId);
      if (key) ep = { ...endpoint, apiKey: key } as ProviderEndpoint;
    }

    const beforeCount = this.listByProvider(providerId).length;
    let discoveredModels: readonly ModelDescriptor[] = [];
    let errorMsg: string | undefined;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.discoveryTimeoutMs);
      try {
        discoveredModels = await adapter.discoverModels(ep, controller.signal);
        this.lastErrors.delete(providerId);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      errorMsg = (err as Error).message;
      this.lastErrors.set(providerId, errorMsg);
    }

    const now = Date.now();
    let added = 0;
    let updated = 0;
    let mutated = false;

    if (!errorMsg) {
      for (const raw of discoveredModels) {
        const key = `${providerId}:${raw.id}`;
        const existing = this.models.get(key);
        const merged = mergePricing(existing?.pricing, raw.pricing);
        const classification = classifyPricing(merged);
        const normalized: ModelDescriptor = {
          ...raw,
          providerId,
          pricing: merged
            ? { ...merged, isFree: classification.isFree, freeTier: classification.freeTier }
            : undefined,
          discoveredAt: now,
        };

        if (!existing) {
          added++;
          mutated = true;
          this.models.set(key, { ...normalized, stale: false });
          this.recordChange(key, 'added');
        } else {
          updated++;
          if (existing.stale) mutated = true;
          this.models.set(key, { ...existing, ...normalized, stale: false, discoveredAt: now });
          this.recordChange(key, 'updated');
        }
      }

      this.providerDiagnostics.set(providerId, {
        providerId,
        connectivity: 'CONNECTED',
        modelDiscovery: discoveredModels.length > 0 ? 'READY' : 'CONNECTED_BUT_DISCOVERY_FAILED',
        modelCount: discoveredModels.length,
        lastDiscovery: now,
        lastSuccess: now,
      });
    } else {
      const isAuth = errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('API key');
      this.providerDiagnostics.set(providerId, {
        providerId,
        connectivity: isAuth ? 'AUTHENTICATION_FAILED' : 'UNREACHABLE',
        modelDiscovery: isAuth ? 'AUTHENTICATION_FAILED' : 'CONNECTED_BUT_DISCOVERY_FAILED',
        modelCount: beforeCount,
        lastDiscovery: now,
        lastSuccess: this.providerDiagnostics.get(providerId)?.lastSuccess ?? 0,
        lastError: errorMsg,
      });
    }

    if (mutated) {
      this.catalogVersion++;
    }

    return {
      providerId,
      status: errorMsg ? 'failed' : 'completed',
      discovered: discoveredModels.length,
      added,
      updated,
      removed: 0,
      catalogVersion: this.catalogVersion,
      error: errorMsg,
    };
  }

  /** Returns current catalog version. */
  getCatalogVersion(): number {
    return this.catalogVersion;
  }

  /**
   * Returns a bounded delta of catalog mutations since `sinceVersion`.
   * (Phase 13 §10/§18) — lets the dashboard fetch only models that changed
   * instead of re-downloading the entire catalog. If the gap between
   * `sinceVersion` and the current version exceeds what the bounded change-log
   * remembers, callers should fall back to a full `list()` sync (the delta
   * response sets `fullSyncRequired: true`).
   */
  getDelta(sinceVersion: number): {
    fromVersion: number;
    toVersion: number;
    fullSyncRequired: boolean;
    added: readonly ModelDescriptor[];
    updated: readonly ModelDescriptor[];
    removed: string[];
  } {
    const toVersion = this.catalogVersion;
    if (sinceVersion >= toVersion) {
      return { fromVersion: sinceVersion, toVersion, fullSyncRequired: false, added: [], updated: [], removed: [] };
    }
    const added: ModelDescriptor[] = [];
    const updated: ModelDescriptor[] = [];
    const removed: string[] = [];
    for (const [key, entry] of this.changeLog) {
      if (entry.version > sinceVersion) {
        if (entry.op === 'removed') removed.push(key);
        else {
          const m = this.models.get(key);
          if (m) (entry.op === 'added' ? added : updated).push(m);
        }
      }
    }
    // If the change-log was truncated (size cap) the client may have missed
    // entries, so force a full resync rather than ship a partial delta.
    const fullSyncRequired = this.changeLog.size >= ModelRegistry.CHANGE_LOG_MAX;
    if (fullSyncRequired) {
      return {
        fromVersion: sinceVersion,
        toVersion,
        fullSyncRequired: true,
        added: this.list(),
        updated: [],
        removed: [],
      };
    }
    return { fromVersion: sinceVersion, toVersion, fullSyncRequired: false, added, updated, removed };
  }

  /** Removes all models belonging to a provider (e.g. when provider is deleted). */
  removeProvider(providerId: string): number {
    let count = 0;
    for (const [key, m] of this.models) {
      if (m.providerId === providerId) {
        this.models.delete(key);
        this.explicit.delete(key);
        this.recordChange(key, 'removed');
        this.publish('model.removed', {
          providerId,
          modelId: m.id,
          reason: 'provider_removed',
        });
        count++;
      }
    }
    this.providerDiagnostics.delete(providerId);
    this.lastErrors.delete(providerId);
    if (count > 0) {
      this.catalogVersion++;
    }
    return count;
  }

  private recordChange(key: string, op: 'added' | 'updated' | 'removed'): void {
    if (this.changeLog.size >= ModelRegistry.CHANGE_LOG_MAX && !this.changeLog.has(key)) {
      // Bound the log: drop the oldest remembered entry to make room.
      const firstKey = this.changeLog.keys().next().value;
      if (firstKey !== undefined) this.changeLog.delete(firstKey);
    }
    this.changeLog.set(key, { version: this.catalogVersion, op });
  }

  /** Returns provider discovery telemetry per provider. */
  getProviderDiagnostics(): Record<string, ProviderDiscoveryInfo> {
    return Object.fromEntries(this.providerDiagnostics);
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

  /**
   * Marks a specific model as unhealthy/stale after a hard upstream failure
   * (e.g. HTTP 401/403/404/410 indicating the model was retired or the
   * credential is invalid for that model). The model is excluded from
   * routing and agent projections until the next successful discovery
   * cycle re-confirms it. Emits `model.availability.changed` for observability.
   *
   * This is how retired models like `deepseek-v4-flash-free` (EOL upstream)
   * are automatically dropped from the routable set without waiting for the
   * provider to stop listing them.
   */
  markModelUnhealthy(providerId: string, modelId: string, reason: string): void {
    // Explicit models are operator-pinned and must not be auto-retired by a
    // transient upstream failure (they may not even be served by the provider's
    // API yet). Leave them available for manual routing/testing.
    const explicitKey = `${providerId}:${modelId}`;
    if (this.explicit.has(explicitKey)) return;
    const key = `${providerId}:${modelId}`;
    const existing = this.models.get(key);
    if (!existing) return;
    if (existing.stale && existing.staleReason === 'unhealthy' && existing.lastError === reason) return; // idempotent
    this.models.set(key, { ...existing, stale: true, staleReason: 'unhealthy', lastError: reason });
    this.events?.publish(
      buildEvent('model.availability.changed' as never, {
        providerId,
        modelId,
        available: false,
        reason,
        at: Date.now(),
      } as never),
    );
  }

  /**
   * Clears a prior 'unhealthy' stale mark (e.g. after a successful probe or
   * when the user manually re-enables the model). A disappeared model that
   * reappears is cleared automatically by the refresh merge.
   */
  markModelHealthy(providerId: string, modelId: string): void {
    const key = `${providerId}:${modelId}`;
    const existing = this.models.get(key);
    if (!existing || !existing.stale || existing.staleReason !== 'unhealthy') return;
    this.models.set(key, { ...existing, stale: false, staleReason: undefined, lastError: undefined });
  }

  /**
   * Records a model's true context window, typically learned from an upstream
   * `context_length_exceeded` error that states the limit (e.g. "limit is
   * 8192"). Once known, the ContextWindowManager can proactively trim
   * conversations to fit instead of letting every oversized request 400.
   */
  setContextWindow(providerId: string, modelId: string, contextWindow: number): void {
    const key = `${providerId}:${modelId}`;
    const existing = this.models.get(key);
    if (!existing || existing.contextWindow === contextWindow) return;
    this.models.set(key, { ...existing, contextWindow });
    this.catalogVersion++;
    this.recordChange(key, 'updated');
  }

  /**
   * Registers one or more explicit (non-discovered) models. These are merged
   * into the catalog on every refresh cycle and are exempt from the
   * stale-sweep and from `markModelUnhealthy`, so they remain available for
   * manual routing/testing even when the upstream provider's `/models` API
   * never lists them. The caller supplies the full `ModelDescriptor` (id,
   * providerId, pricing, capabilities, contextWindow) — nothing is hard-coded
   * by the registry itself.
   */
  addExplicit(models: readonly ModelDescriptor[]): void {
    for (const m of models) {
      const key = `${m.providerId}:${m.id}`;
      this.explicit.set(key, {
        ...m,
        // Tag the source so projections/stats can distinguish explicit models.
        pricing: m.pricing ? { ...m.pricing, source: 'explicit' as const } : m.pricing,
        discoveredAt: m.discoveredAt ?? Date.now(),
      });
    }
    this.reseedExplicit();
  }

  /** Re-merges explicit models into the live catalog (idempotent). */
  private reseedExplicit(): void {
    if (this.explicit.size === 0) return;
    let mutated = false;
    for (const [key, m] of this.explicit) {
      const existing = this.models.get(key);
      // Never overwrite a discovered (non-stale) entry's pricing/source.
      if (!existing || existing.stale) {
        this.models.set(key, { ...m, stale: false });
        mutated = true;
      }
    }
    if (mutated) this.catalogVersion++;
  }

  /**
   * Returns registry stats for the dashboard, including pricing classification
   * breakdown by source.
   */
  stats(): {
    catalogVersion: number;
    totalModels: number;
    freeModels: number;
    staleModels: number;
    byProvider: Record<string, number>;
    lastRefreshAt: number;
    refreshing: boolean;
    errors: Record<string, string>;
    pricingBySource: Record<string, number>;
    freeTiers: Record<string, number>;
    providerDiscovery: Record<string, ProviderDiscoveryInfo>;
  } {
    const all = this.list();
    const byProvider: Record<string, number> = {};
    const pricingBySource: Record<string, number> = {};
    const freeTiers: Record<string, number> = {};
    for (const m of all) {
      byProvider[m.providerId] = (byProvider[m.providerId] ?? 0) + 1;
      const source = m.pricing?.source ?? 'unknown';
      pricingBySource[source] = (pricingBySource[source] ?? 0) + 1;
      const tier = m.pricing?.freeTier ?? 'UNKNOWN';
      freeTiers[tier] = (freeTiers[tier] ?? 0) + 1;
    }
    return {
      catalogVersion: this.catalogVersion,
      totalModels: all.length,
      freeModels: all.filter((m) => m.pricing?.isFree && !m.stale).length,
      staleModels: all.filter((m) => m.stale).length,
      byProvider,
      lastRefreshAt: this.lastRefreshAt,
      refreshing: this.refreshing,
      errors: Object.fromEntries(this.lastErrors),
      pricingBySource,
      freeTiers,
      providerDiscovery: this.getProviderDiagnostics(),
    };
  }

  /** Publish an event to the optional event bus (no-op when absent). */
  private publish<T extends { type: string; payload: unknown }>(type: T['type'], payload: T['payload']): void {
    this.events?.publish(buildEvent(type as never, payload as never));
  }
}

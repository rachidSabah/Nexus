import { randomUUID } from 'node:crypto';

import { canTransition, isSelectable, NoEligibleProviderError } from '../domain/errors.js';
import { buildEvent, type RouteResolvedEvent } from '../domain/events.js';
import type { RoutingRequest, RoutingDecision, ProviderEndpoint } from '../domain/types.js';

import type { EventBusPort, RoutingEnginePort } from './ports.js';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * RoutingEngine — default implementation of RoutingEnginePort.
 *
 * Supports 8 strategies:
 *   weighted, round_robin, least_latency, least_cost, highest_quality,
 *   capability_match, priority, budget_aware
 *
 * Maintains EWMA latency per endpoint and a sliding-window failure counter
 * for circuit breaking.
 * ───────────────────────────────────────────────────────────────────────────
 */
export class RoutingEngine implements RoutingEnginePort {
  private readonly endpoints = new Map<string, ProviderEndpoint>();
  private readonly latency = new Map<string, number>(); // EWMA ms
  private readonly failures = new Map<string, number[]>();
  private rrCursor = 0;

  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly cooldownMs: number;
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly events: EventBusPort,
    opts: {
      failureThreshold?: number;
      failureWindowMs?: number;
      cooldownMs?: number;
    } = {},
  ) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.failureWindowMs = opts.failureWindowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
  }

  async resolve(request: RoutingRequest): Promise<RoutingDecision> {
    const candidates = this.filterEligible(request);
    if (candidates.length === 0) {
      throw new NoEligibleProviderError(request.model, undefined, { request });
    }

    const strategy = request.strategy ?? 'weighted';
    const sorted = this.applyStrategy(strategy, candidates, request);
    if (sorted.length === 0) {
      throw new NoEligibleProviderError(request.model, undefined, { request, strategy });
    }

    const primary = sorted[0]!;
    const alternatives = sorted.slice(1, 5);

    await this.events.publish(
      buildEvent<RouteResolvedEvent>(
        'route.resolved',
        {
          requestId: (request as { requestId?: string }).requestId ?? randomUUID(),
          endpointId: primary.id,
          providerId: primary.providerId,
          strategy,
          alternativesCount: alternatives.length,
        },
        (request as { correlationId?: string }).correlationId,
      ),
    );

    return {
      endpoint: primary,
      strategy,
      reason: this.explain(strategy, primary),
      alternatives,
      resolvedAt: new Date(),
    };
  }

  recordSuccess(endpointId: string, latencyMs: number): void {
    const prev = this.latency.get(endpointId) ?? latencyMs;
    this.latency.set(endpointId, prev * 0.7 + latencyMs * 0.3); // EWMA
    this.failures.set(endpointId, []);
  }

  recordFailure(endpointId: string, _error: Error, retryable: boolean): void {
    if (!retryable) return;
    const now = Date.now();
    const window = (this.failures.get(endpointId) ?? []).filter((t) => now - t < this.failureWindowMs);
    window.push(now);
    this.failures.set(endpointId, window);

    if (window.length >= this.failureThreshold) {
      const endpoint = this.endpoints.get(endpointId);
      if (endpoint && canTransition(endpoint.health, 'circuit_open')) {
        this.setHealth(endpoint, 'circuit_open', `failure threshold reached (${window.length})`);
        this.cooldowns.set(endpointId, now + this.cooldownMs);
        void this.events.publish(
          buildEvent(
            'circuit_breaker.tripped',
            {
              endpointId,
              failureCount: window.length,
              threshold: this.failureThreshold,
              retryAfterMs: this.cooldownMs,
            },
          ),
        );
      }
    }
  }

  registerEndpoint(endpoint: ProviderEndpoint): void {
    this.endpoints.set(endpoint.id, { ...endpoint });
  }

  unregisterEndpoint(endpointId: string): void {
    this.endpoints.delete(endpointId);
    this.latency.delete(endpointId);
    this.failures.delete(endpointId);
    this.cooldowns.delete(endpointId);
  }

  /**
   * Live-updates mutable fields of an endpoint (e.g. `baseUrl` corrected from
   * the dashboard, or a manual health override). Re-keys the endpoint in place
   * so in-flight routing decisions pick up the change immediately. Use this
   * for operator-driven corrections (wrong base URL, broken region) without a
   * gateway restart.
   */
  updateEndpoint(endpointId: string, patch: Partial<Pick<ProviderEndpoint, 'baseUrl' | 'displayName' | 'health' | 'region' | 'tags' | 'priority' | 'weight'>>): void {
    const existing = this.endpoints.get(endpointId);
    if (!existing) return;
    // ProviderEndpoint marks most fields readonly; construct a fresh object so
    // operator-driven corrections (e.g. a fixed baseUrl) take effect live.
    const next = {
      ...existing,
      ...patch,
    } as ProviderEndpoint;
    this.endpoints.set(endpointId, next);
  }

  listEndpoints(): readonly ProviderEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private filterEligible(request: RoutingRequest): ProviderEndpoint[] {
    const now = Date.now();
    return this.listEndpoints().filter((e) => {
      if (!isSelectable(e)) return false;

      // Cooldown check for circuit_open endpoints that have cooled down.
      const cooldownUntil = this.cooldowns.get(e.id);
      if (cooldownUntil && now < cooldownUntil) return false;
      if (cooldownUntil && now >= cooldownUntil && e.health === 'circuit_open') {
        // Half-open: allow it back into the pool.
        this.setHealth(e, 'degraded', 'circuit half-open probe');
        this.cooldowns.delete(e.id);
      }

      if (request.preferredProviders && !request.preferredProviders.includes(e.providerId)) {
        return false;
      }
      if (request.excludedProviders?.includes(e.providerId)) return false;
      if (request.region && e.region !== request.region) return false;
      if (request.tags && !request.tags.every((t) => e.tags.includes(t))) return false;
      if (request.maxLatencyMs && (this.latency.get(e.id) ?? 9999) > request.maxLatencyMs) {
        return false;
      }
      if (
        request.maxCostPer1K &&
        e.pricing &&
        e.pricing.inputPer1K + e.pricing.outputPer1K > request.maxCostPer1K
      ) {
        return false;
      }
      if (request.capabilities) {
        for (const [k, v] of Object.entries(request.capabilities)) {
          if (v === true && (e.capabilities as unknown as Record<string, unknown>)[k] !== true) return false;
        }
      }
      return true;
    });
  }

  private applyStrategy(
    strategy: string,
    candidates: ProviderEndpoint[],
    request: RoutingRequest,
  ): ProviderEndpoint[] {
    let copy = [...candidates];

    // Priority sort: preferred providers are always placed first for initial attempt
    if (request.preferredProviders && request.preferredProviders.length > 0) {
      const prefSet = new Set(request.preferredProviders);
      copy.sort((a, b) => {
        const aPref = prefSet.has(a.providerId) ? 1 : 0;
        const bPref = prefSet.has(b.providerId) ? 1 : 0;
        return bPref - aPref;
      });
    }
    switch (strategy) {
      case 'round_robin':
        return copy.sort((a, b) => {
          const ai = this.indexOf(a.id);
          const bi = this.indexOf(b.id);
          return ((ai + this.rrCursor) % copy.length) - ((bi + this.rrCursor) % copy.length);
        });
      case 'least_latency':
        return copy.sort(
          (a, b) => (this.latency.get(a.id) ?? 9999) - (this.latency.get(b.id) ?? 9999),
        );
      case 'least_cost':
        return copy.sort(
          (a, b) =>
            ((a.pricing?.inputPer1K ?? 0) + (a.pricing?.outputPer1K ?? 0)) -
            ((b.pricing?.inputPer1K ?? 0) + (b.pricing?.outputPer1K ?? 0)),
        );
      case 'highest_quality':
        return copy.sort((a, b) => b.priority - a.priority);
      case 'capability_match':
        return copy.sort((a, b) => this.capabilityScore(b, request) - this.capabilityScore(a, request));
      case 'priority':
        return copy.sort((a, b) => a.priority - b.priority);
      case 'budget_aware':
        return copy.sort((a, b) => {
          const remaining = request.budgetRemainingUsd ?? Number.MAX_SAFE_INTEGER;
          const costA = (a.pricing?.inputPer1K ?? 0) + (a.pricing?.outputPer1K ?? 0);
          const costB = (b.pricing?.inputPer1K ?? 0) + (b.pricing?.outputPer1K ?? 0);
          // Within budget: prefer cheaper. Over budget: prefer least-over.
          const overA = Math.max(0, costA - remaining);
          const overB = Math.max(0, costB - remaining);
          if (overA === 0 && overB === 0) return costA - costB;
          return overA - overB;
        });
      case 'weighted':
      default: {
        // Weighted reservoir: sort by descending weight with random jitter.
        return copy
          .map((e) => ({ e, score: e.weight * (0.5 + Math.random()) }))
          .sort((a, b) => b.score - a.score)
          .map(({ e }) => e);
      }
    }
  }

  private indexOf(endpointId: string): number {
    const ids = Array.from(this.endpoints.keys());
    return ids.indexOf(endpointId);
  }

  private capabilityScore(endpoint: ProviderEndpoint, request: RoutingRequest): number {
    if (!request.capabilities) return endpoint.priority;
    let score = 0;
    for (const [k, v] of Object.entries(request.capabilities)) {
      if (v === true && (endpoint.capabilities as unknown as Record<string, unknown>)[k] === true) score++;
    }
    return score;
  }

  private explain(strategy: string, endpoint: ProviderEndpoint): string {
    switch (strategy) {
      case 'least_latency':
        return `Selected ${endpoint.id} (EWMA ${this.latency.get(endpoint.id)?.toFixed(0) ?? '?'}ms)`;
      case 'least_cost':
        return `Selected ${endpoint.id} ($${endpoint.pricing?.inputPer1K ?? 0}/1K in, $${endpoint.pricing?.outputPer1K ?? 0}/1K out)`;
      case 'priority':
        return `Selected ${endpoint.id} (priority ${endpoint.priority})`;
      default:
        return `Selected ${endpoint.id} via ${strategy}`;
    }
  }

  private setHealth(endpoint: ProviderEndpoint, to: ProviderEndpoint['health'], reason?: string): void {
    if (!canTransition(endpoint.health, to)) return;
    const updated: ProviderEndpoint = { ...endpoint, health: to, updatedAt: new Date() };
    this.endpoints.set(endpoint.id, updated);
    void this.events.publish(
      buildEvent(
        'health.changed',
        {
          endpointId: endpoint.id,
          providerId: endpoint.providerId,
          from: endpoint.health,
          to,
          reason,
        },
      ),
    );
  }
}

/**
 * @anx/routing — routing engine extensions and additional strategies.
 *
 * Re-exports the core routing engine, and adds:
 *   - `CompositeRoutingEngine` — chains multiple strategies with fallback
 *   - `AffinityRouter` — sticky routing by principal / session
 *   - `QualityRouter` — quality-score-based routing using model benchmarks
 */
import { NoEligibleProviderError, RoutingEngine } from '@anx/core';
import type { ProviderEndpoint, RoutingDecision, RoutingEnginePort, RoutingRequest } from '@anx/core';

export { RoutingEngine };
export type { RoutingEnginePort, RoutingRequest, RoutingDecision };

/**
 * Composite engine — tries each child engine in order until one returns a
 * decision. Used when you want a primary strategy with a fallback (e.g.
 * least_cost first, then weighted).
 */
export class CompositeRoutingEngine implements RoutingEnginePort {
  constructor(private readonly engines: readonly RoutingEnginePort[]) {}

  async resolve(request: RoutingRequest): Promise<RoutingDecision> {
    let lastError: unknown;
    for (const engine of this.engines) {
      try {
        return await engine.resolve(request);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new NoEligibleProviderError(request.model);
  }

  recordSuccess(endpointId: string, latencyMs: number): void {
    for (const e of this.engines) e.recordSuccess(endpointId, latencyMs);
  }
  recordFailure(
    endpointId: string,
    error: Error,
    retryable: boolean,
    action?: 'mark_unavailable' | 'mark_degraded' | 'record_failure' | 'none',
  ): void {
    for (const e of this.engines) e.recordFailure(endpointId, error, retryable, action);
  }
  registerEndpoint(endpoint: ProviderEndpoint): void {
    for (const e of this.engines) e.registerEndpoint(endpoint);
  }
  unregisterEndpoint(endpointId: string): void {
    for (const e of this.engines) e.unregisterEndpoint(endpointId);
  }
  updateEndpoint(endpointId: string, patch: Partial<Pick<ProviderEndpoint, 'baseUrl' | 'displayName' | 'health' | 'region' | 'tags' | 'priority' | 'weight'>>): void {
    for (const e of this.engines) e.updateEndpoint(endpointId, patch);
  }
  listEndpoints(): readonly ProviderEndpoint[] {
    return this.engines[0]?.listEndpoints() ?? [];
  }
  getSelectableProviders(): readonly string[] {
    return this.engines[0]?.getSelectableProviders() ?? [];
  }
}

/**
 * Affinity router — wraps another engine and sticks requests to the same
 * endpoint based on a key extractor (e.g. user ID or session ID). Falls
 * back to the wrapped engine when no affinity exists or the sticky endpoint
 * is unhealthy.
 */
export class AffinityRouter implements RoutingEnginePort {
  private readonly affinity = new Map<string, string>(); // key -> endpointId

  constructor(
    private readonly inner: RoutingEnginePort,
    private readonly keyExtractor: (req: RoutingRequest) => string | undefined,
  ) {}

  async resolve(request: RoutingRequest): Promise<RoutingDecision> {
    const key = this.keyExtractor(request);
    if (key) {
      const stickyId = this.affinity.get(key);
      if (stickyId) {
        const ep = this.listEndpoints().find((e) => e.id === stickyId && e.health !== 'circuit_open');
        if (ep) {
          return {
            endpoint: ep,
            strategy: 'weighted',
            reason: `sticky endpoint ${ep.id} for key ${key} (affinity)`,
            alternatives: [],
            resolvedAt: new Date(),
          };
        }
      }
    }
    const decision = await this.inner.resolve(request);
    if (key) this.affinity.set(key, decision.endpoint.id);
    return decision;
  }

  recordSuccess(endpointId: string, latencyMs: number): void {
    this.inner.recordSuccess(endpointId, latencyMs);
  }
  recordFailure(
    endpointId: string,
    error: Error,
    retryable: boolean,
    action?: 'mark_unavailable' | 'mark_degraded' | 'record_failure' | 'none',
  ): void {
    this.inner.recordFailure(endpointId, error, retryable, action);
  }
  registerEndpoint(endpoint: ProviderEndpoint): void {
    this.inner.registerEndpoint(endpoint);
  }
  unregisterEndpoint(endpointId: string): void {
    this.inner.unregisterEndpoint(endpointId);
    for (const [k, v] of Array.from(this.affinity)) {
      if (v === endpointId) this.affinity.delete(k);
    }
  }
  updateEndpoint(endpointId: string, patch: Partial<Pick<ProviderEndpoint, 'baseUrl' | 'displayName' | 'health' | 'region' | 'tags' | 'priority' | 'weight'>>): void {
    this.inner.updateEndpoint(endpointId, patch);
  }
  listEndpoints(): readonly ProviderEndpoint[] {
    return this.inner.listEndpoints();
  }
  getSelectableProviders(): readonly string[] {
    return this.inner.getSelectableProviders();
  }

  clearAffinity(): void {
    this.affinity.clear();
  }
}

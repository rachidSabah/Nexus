import type { RoutingDecision, ProviderEndpoint } from '../domain/types.js';

import type { FailoverPort, FailoverContext } from './ports.js';

/**
 * Default failover implementation.
 *
 * Walks the alternatives list, but — when given failure context — biases the
 * choice by error *scope* (master prompt #19):
 *   - provider-wide failure (5xx, 429, network, billing) → prefer a candidate
 *     on a DIFFERENT provider before re-trying the same one, so a single
 *     provider's outage doesn't burn all retries on its siblings.
 *   - credential failure (401/403 invalid key) → prefer staying on the SAME
 *     provider (a different, still-valid key is selected downstream by the
 *     KeyRegistry) before switching providers.
 * With no context it preserves the original "first viable alternative" order.
 */
export class DefaultFailover implements FailoverPort {
  private readonly failed = new Set<string>();

  next(
    decision: RoutingDecision,
    failedEndpointId: string,
    context?: FailoverContext,
  ): ProviderEndpoint | null {
    this.failed.add(failedEndpointId);

    const viable = (): ProviderEndpoint[] =>
      decision.alternatives.filter(
        (e) => !this.failed.has(e.id) && e.health !== 'circuit_open',
      );

    const pool = viable();

    // Scope-aware diversity.
    if (context?.scope && context.failedProviderId) {
      const avoidProvider = context.scope === 'provider'; // avoid same provider
      const preferProvider = context.scope === 'credential'; // prefer same provider
      const sameProv = pool.filter((e) => e.providerId === context.failedProviderId);
      const diffProv = pool.filter((e) => e.providerId !== context.failedProviderId);

      if (preferProvider && sameProv.length > 0) return sameProv[0] ?? null;
      if (avoidProvider && diffProv.length > 0) return diffProv[0] ?? null;
      if (pool.length > 0) return pool[0] ?? null;

      // If credential failure and no alternative endpoints exist, allow retrying
      // the same endpoint (KeyRegistry will rotate to the next key downstream).
      if (preferProvider) {
        const targetEp =
          decision.endpoint.id === failedEndpointId
            ? decision.endpoint
            : decision.alternatives.find((e) => e.id === failedEndpointId);
        if (targetEp && targetEp.health !== 'circuit_open') {
          return targetEp;
        }
      }
    }

    if (pool.length === 0) {
      return (
        decision.alternatives.find(
          (e) => e.id !== failedEndpointId && e.health !== 'circuit_open',
        ) ?? null
      );
    }

    // Default: first viable alternative (original behavior).
    return pool[0] ?? null;
  }
}

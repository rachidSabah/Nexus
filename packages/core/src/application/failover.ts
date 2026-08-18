import type { RoutingDecision, ProviderEndpoint } from '../domain/types.js';

import type { FailoverPort } from './ports.js';

/**
 * Default failover implementation — walks the alternatives list in order.
 *
 * More sophisticated implementations could:
 *  - consult circuit-breaker state
 *  - re-run routing with relaxed constraints
 *  - prefer endpoints in different regions from the failed one
 */
export class DefaultFailover implements FailoverPort {
  private readonly failed = new Set<string>();

  next(decision: RoutingDecision, failedEndpointId: string): ProviderEndpoint | null {
    this.failed.add(failedEndpointId);

    // 1. Find candidates that have not failed yet in this request
    const viable = decision.alternatives.filter((e) => !this.failed.has(e.id) && e.health !== 'circuit_open');
    if (viable.length === 0) {
      return decision.alternatives.find((e) => e.id !== failedEndpointId && e.health !== 'circuit_open') ?? null;
    }

    // 2. Return first viable alternative
    return viable[0] ?? null;
  }
}

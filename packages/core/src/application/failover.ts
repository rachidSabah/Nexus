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
  next(decision: RoutingDecision, failedEndpointId: string): ProviderEndpoint | null {
    return decision.alternatives.find((e) => e.id !== failedEndpointId) ?? null;
  }
}

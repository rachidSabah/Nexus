import type { ProviderEndpoint, ProviderHealthStatus } from './types.js';

/**
 * Domain error hierarchy. Each error carries a stable code so plugins,
 * dashboard, and clients can branch on it without regex matching messages.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  readonly isDomainError = true;
  constructor(message: string, readonly context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ProviderUnavailableError extends DomainError {
  readonly code = 'PROVIDER_UNAVAILABLE';
  constructor(
    readonly endpointId: string,
    message = `Provider endpoint ${endpointId} is unavailable`,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
  }
}

export class NoEligibleProviderError extends DomainError {
  readonly code = 'NO_ELIGIBLE_PROVIDER';
  constructor(
    readonly model: string,
    message = `No eligible provider for model ${model}`,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
  }
}

export class AllProvidersExhaustedError extends DomainError {
  readonly code = 'ALL_PROVIDERS_EXHAUSTED';
  constructor(
    readonly model: string,
    readonly attempted: readonly string[],
    message = `All providers exhausted for model ${model}`,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
  }
}

export class CircuitBreakerOpenError extends DomainError {
  readonly code = 'CIRCUIT_BREAKER_OPEN';
  constructor(readonly endpointId: string, readonly retryAfterMs: number) {
    super(`Circuit breaker open for ${endpointId}; retry in ${retryAfterMs}ms`);
  }
}

export class BudgetExceededError extends DomainError {
  readonly code = 'BUDGET_EXCEEDED';
  constructor(readonly remaining: number, readonly required: number) {
    super(`Budget exceeded: ${remaining} remaining, ${required} required`);
  }
}

export class ProviderResponseError extends DomainError {
  readonly code = 'PROVIDER_RESPONSE_ERROR';
  constructor(
    readonly endpointId: string,
    readonly status: number,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { endpointId, status, ...context });
  }
}

export class PluginError extends DomainError {
  readonly code = 'PLUGIN_ERROR';
  constructor(readonly pluginName: string, message: string, context?: Record<string, unknown>) {
    super(message, { pluginName, ...context });
  }
}

export class AuthenticationError extends DomainError {
  readonly code = 'AUTHENTICATION_ERROR';
  constructor(message = 'Authentication failed', context?: Record<string, unknown>) {
    super(message, context);
  }
}

export class AuthorizationError extends DomainError {
  readonly code = 'AUTHORIZATION_ERROR';
  constructor(
    readonly principal: string,
    readonly action: string,
    message = `Principal ${principal} is not authorized to ${action}`,
    context?: Record<string, unknown>,
  ) {
    super(message, context);
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  constructor(
    readonly field: string,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message, { field, ...context });
  }
}

/**
 * Health-state transitions are guarded by this state machine so we don't
 * accidentally go from "circuit_open" back to "healthy" without a probe.
 */
export const HEALTH_TRANSITIONS: Record<ProviderHealthStatus, readonly ProviderHealthStatus[]> = {
  unknown: ['healthy', 'degraded', 'unhealthy'],
  healthy: ['degraded', 'unhealthy', 'circuit_open', 'unknown'],
  degraded: ['healthy', 'unhealthy', 'circuit_open'],
  unhealthy: ['degraded', 'circuit_open', 'healthy'],
  circuit_open: ['unhealthy', 'healthy'],
};

export function canTransition(from: ProviderHealthStatus, to: ProviderHealthStatus): boolean {
  return HEALTH_TRANSITIONS[from].includes(to);
}

/**
 * Invariant: an endpoint with `health === 'circuit_open'` MUST NOT be selected
 * by the routing engine. The routing engine consults this guard.
 */
export function isSelectable(endpoint: ProviderEndpoint): boolean {
  return endpoint.health === 'healthy' || endpoint.health === 'degraded';
}

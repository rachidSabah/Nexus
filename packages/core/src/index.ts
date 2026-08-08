/**
 * @anx/core — the heart of Agent Nexus Gateway.
 *
 * Hexagonal architecture layers:
 *   domain/         — pure value objects, entities, events, errors
 *   application/    — ports (interfaces) + use cases (orchestration)
 *   infrastructure/ — default in-memory adapters (swap for prod)
 *
 * The gateway server, providers, plugins, dashboard, and CLI depend ONLY on
 * the public surface exported here. No internal file should be imported from
 * outside this package.
 */

// ── Domain ──────────────────────────────────────────────────────────────────
export * from './domain/types.js';
export * from './domain/events.js';
export * from './domain/errors.js';
export * from './domain/branded.js';

// ── Ports ───────────────────────────────────────────────────────────────────
export * from './application/ports.js';

// ── Use cases & default implementations ─────────────────────────────────────
export { ChatCompletionUseCase, computeCost, classifyFailure, type FailureClassification } from './application/chat-completion.usecase.js';
export { RoutingEngine } from './application/routing-engine.js';
export { DefaultFailover } from './application/failover.js';
export { DefaultCostCalculator } from './application/cost-calculator.js';
export { InMemoryEventBus } from './application/event-bus.js';
export { InMemoryAuditLog } from './application/audit-log.js';
export { InMemoryCache, cosineSimilarity, type InMemoryCacheOptions } from './application/cache.js';
export { KeyRegistry, type KeyDescriptor, type KeyRotationStrategy, type KeyRegistryOptions, type SelectKeyOptions } from './application/key-registry.js';
export { ModelRegistry, type ModelRegistryOptions } from './application/model-registry.js';

// ── Version ─────────────────────────────────────────────────────────────────
export const CORE_VERSION = '0.1.0';

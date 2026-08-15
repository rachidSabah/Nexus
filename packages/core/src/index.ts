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
export { classifyPricing, hasFreeSuffix, isZeroPriced, mergePricing, type FreeClassification, type FreeTier, type GatewayPricing, type PricingSource } from './application/pricing.js';

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
export {
  redactForLog,
  fingerprint,
  sanitizeForLog,
  DEFAULT_PRIVACY,
  type PrivacyLevel,
  type PrivacyConfig,
} from './application/privacy.js';
export { RequestTracer, type RequestTrace, type TraceAttempt, type RequestTracerOptions } from './application/request-tracer.js';
export { BudgetManager, type BudgetConfig, type BudgetMode, type BudgetPeriod, type BudgetSnapshot, DEFAULT_BUDGET_CONFIG } from './application/budget-manager.js';
export { PromptCompressor, type CompressionConfig, type CompressionResult, DEFAULT_COMPRESSION_CONFIG } from './application/prompt-compressor.js';
export { ProactiveRateLimitTracker, type RateLimitInfo } from './application/rate-limit-tracker.js';
export { TaskClassifier, type TaskType, type TaskClassification } from './application/task-classifier.js';
export { ContextWindowManager, type ContextWindowConfig, type ContextCheckResult, DEFAULT_CONTEXT_CONFIG } from './application/context-window-manager.js';
export { CostPredictor, type CostPredictorConfig, type CostEstimate, type CostPredictionResult, DEFAULT_COST_CONFIG } from './application/cost-predictor.js';
export { NaiveTokenCounter, CodeAwareTokenCounter, defaultTokenCounter, type TokenCounter } from './application/token-counter.js';

// ── Phase 5/6/7 Orchestration & Workflow Fabric ──────────────────────────────
export * from './domain/orchestration.js';
export * from './domain/workflow.js';
export { AgentSelector, type AgentCandidate, type AgentSelectionResult } from './application/agent-selector.js';
export { InMemoryTaskStore, type TaskStorePort } from './application/task-store.js';
export { SubprocessAgentExecutor, type AgentExecutorPort, type AgentExecutionResult } from './application/agent-executor.js';
export { TaskOrchestrator, type CreateTaskOptions } from './application/task-orchestrator.js';
export { ConcurrencyManager, type ConcurrencyStatus } from './application/concurrency-manager.js';
export { DAGEngine, type DAGValidationResult } from './application/dag-engine.js';
export { WorkflowOrchestrator } from './application/workflow-orchestrator.js';
export { BUILT_IN_WORKFLOWS } from './application/builtin-workflows.js';
export { RiskEngine, type RiskAnalysis, type RiskLevel } from './application/risk-engine.js';
export { AutonomousPlanner, type AutonomousPlanResult } from './application/autonomous-planner.js';
export * from './domain/application.js';
export * from './domain/agy-builder.js';
export { ApplicationEngine, type ApplicationEngineOptions } from './application/application-engine.js';
export { AgyBuilderAdapter } from './application/agy-builder-adapter.js';
// ── Phase 11: Application Verifier & AGY events ──────────────────────────────
export { ApplicationVerifier } from './application/application-verifier.js';

// ── Phase 16: SSRF guard (security) ─────────────────────────────────────────
export { isSsrfSafe, assertSsrfSafe } from './security/ssrf.js';
export type { SsrfOptions } from './security/ssrf.js';

// ── Phase 17: Agent Session Fabric ───────────────────────────────────────────
export {
  type AgentSession,
  type SessionStatus,
  type SessionCheckpoint,
  SESSION_STATUSES,
  canTransition,
  assertTransition,
} from './domain/session.js';
export { InMemorySessionStore, type SessionStorePort } from './application/session-store.js';
export {
  SessionManager,
  type CreateSessionInput,
} from './application/session-manager.js';
export {
  SubprocessSessionRuntime,
  type AgentSessionRuntime,
  type RuntimeOptions,
} from './application/session-runtime.js';

// ── Version ─────────────────────────────────────────────────────────────────
export const CORE_VERSION = '0.5.0';

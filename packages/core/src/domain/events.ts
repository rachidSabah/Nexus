import type { ProviderEndpoint } from './types.js';

/**
 * Domain events. These are the only thing other modules are allowed to
 * subscribe to — they form the public domain contract.
 *
 * All events are immutable snapshots; consumers must not mutate them.
 */
export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
  readonly correlationId?: string;
  readonly payload: unknown;
}

export interface RequestReceivedEvent extends DomainEvent {
  readonly type: 'request.received';
  readonly payload: {
    readonly requestId: string;
    readonly model: string;
    readonly streaming: boolean;
    readonly userId?: string;
    readonly timestamp: number;
  };
}

export interface RouteResolvedEvent extends DomainEvent {
  readonly type: 'route.resolved';
  readonly payload: {
    readonly requestId: string;
    readonly endpointId: string;
    readonly providerId: string;
    readonly strategy: string;
    readonly alternativesCount: number;
  };
}

export interface ProviderRequestStartedEvent extends DomainEvent {
  readonly type: 'provider.request.started';
  readonly payload: {
    readonly requestId: string;
    readonly endpointId: string;
    readonly providerId: string;
    readonly attempt: number;
  };
}

export interface ProviderRequestSucceededEvent extends DomainEvent {
  readonly type: 'provider.request.succeeded';
  readonly payload: {
    readonly requestId: string;
    readonly endpointId: string;
    readonly providerId: string;
    readonly attempt: number;
    readonly latencyMs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd: number;
  };
}

export interface ProviderRequestFailedEvent extends DomainEvent {
  readonly type: 'provider.request.failed';
  readonly payload: {
    readonly requestId: string;
    readonly endpointId: string;
    readonly providerId: string;
    readonly attempt: number;
    readonly error: string;
    readonly code: string;
    readonly retryable: boolean;
  };
}

export interface FailoverTriggeredEvent extends DomainEvent {
  readonly type: 'failover.triggered';
  readonly payload: {
    readonly requestId: string;
    readonly fromEndpointId: string;
    readonly toEndpointId: string;
    readonly reason: string;
  };
}

export interface HealthChangedEvent extends DomainEvent {
  readonly type: 'health.changed';
  readonly payload: {
    readonly endpointId: string;
    readonly providerId: string;
    readonly from: string;
    readonly to: string;
    readonly reason?: string;
  };
}

export interface CircuitBreakerTrippedEvent extends DomainEvent {
  readonly type: 'circuit_breaker.tripped';
  readonly payload: {
    readonly endpointId: string;
    readonly failureCount: number;
    readonly threshold: number;
    readonly retryAfterMs: number;
  };
}

export interface PluginLoadedEvent extends DomainEvent {
  readonly type: 'plugin.loaded';
  readonly payload: { readonly pluginId: string; readonly version: string };
}

export interface CacheHitEvent extends DomainEvent {
  readonly type: 'cache.hit';
  readonly payload: {
    readonly requestId: string;
    readonly cacheKey: string;
    readonly cacheType: 'prompt' | 'semantic';
  };
}

export interface CacheMissEvent extends DomainEvent {
  readonly type: 'cache.miss';
  readonly payload: {
    readonly requestId: string;
    readonly cacheKey: string;
    readonly cacheType: 'prompt' | 'semantic';
  };
}

export interface SpeculativeRaceWonEvent extends DomainEvent {
  readonly type: 'speculative.race.won';
  readonly payload: {
    readonly requestId: string;
    readonly winnerEndpointId: string;
    readonly loserEndpointId: string;
    readonly winnerProviderId: string;
    readonly loserProviderId: string;
    readonly hedgedDelayMs: number;
    readonly timeSavedMs: number;
  };
}

export interface BudgetThresholdEvent extends DomainEvent {
  readonly type: 'budget.threshold';
  readonly payload: {
    readonly budgetId: string;
    readonly remainingUsd: number;
    readonly thresholdPercent: number;
  };
}

export interface AuditEvent extends DomainEvent {
  readonly type: 'audit';
  readonly payload: {
    readonly principal: string;
    readonly action: string;
    readonly resource: string;
    readonly result: 'allow' | 'deny';
    readonly reason?: string;
  };
}

// ─── Phase 4: Agent / Workflow / Memory / Tool events ────────────────────────

export interface AgentCreatedEvent extends DomainEvent {
  readonly type: 'agent.created';
  readonly payload: {
    readonly agentId: string;
    readonly name: string;
    readonly capabilities: readonly string[];
    readonly permissions: readonly string[];
  };
}

export interface AgentStartedEvent extends DomainEvent {
  readonly type: 'agent.started';
  readonly payload: {
    readonly agentId: string;
    readonly taskId: string;
    readonly sessionId: string;
  };
}

export interface AgentCompletedEvent extends DomainEvent {
  readonly type: 'agent.completed';
  readonly payload: {
    readonly agentId: string;
    readonly taskId: string;
    readonly sessionId: string;
    readonly durationMs: number;
    readonly tokensUsed: number;
    readonly costUsd: number;
    readonly success: boolean;
  };
}

export interface AgentFailedEvent extends DomainEvent {
  readonly type: 'agent.failed';
  readonly payload: {
    readonly agentId: string;
    readonly taskId: string;
    readonly sessionId: string;
    readonly error: string;
    readonly code: string;
    readonly attempt: number;
  };
}

export interface AgentStatusChangedEvent extends DomainEvent {
  readonly type: 'agent.status.changed';
  readonly payload: {
    readonly agentId: string;
    readonly from: string;
    readonly to: string;
  };
}

export interface WorkflowStartedEvent extends DomainEvent {
  readonly type: 'workflow.started';
  readonly payload: {
    readonly workflowId: string;
    readonly executionId: string;
    readonly name: string;
    readonly version: number;
    readonly stepCount: number;
  };
}

export interface WorkflowStepStartedEvent extends DomainEvent {
  readonly type: 'workflow.step.started';
  readonly payload: {
    readonly workflowId: string;
    readonly executionId: string;
    readonly stepIndex: number;
    readonly stepName: string;
    readonly agentId: string;
  };
}

export interface WorkflowStepCompletedEvent extends DomainEvent {
  readonly type: 'workflow.step.completed';
  readonly payload: {
    readonly workflowId: string;
    readonly executionId: string;
    readonly stepIndex: number;
    readonly stepName: string;
    readonly agentId: string;
    readonly durationMs: number;
    readonly success: boolean;
  };
}

export interface WorkflowCompletedEvent extends DomainEvent {
  readonly type: 'workflow.completed';
  readonly payload: {
    readonly workflowId: string;
    readonly executionId: string;
    readonly durationMs: number;
    readonly stepsCompleted: number;
    readonly stepsFailed: number;
    readonly totalCostUsd: number;
    readonly success: boolean;
  };
}

export interface WorkflowPausedEvent extends DomainEvent {
  readonly type: 'workflow.paused';
  readonly payload: { readonly workflowId: string; readonly executionId: string; readonly atStepIndex: number };
}

export interface WorkflowResumedEvent extends DomainEvent {
  readonly type: 'workflow.resumed';
  readonly payload: { readonly workflowId: string; readonly executionId: string; readonly fromStepIndex: number };
}

export interface MemoryCreatedEvent extends DomainEvent {
  readonly type: 'memory.created';
  readonly payload: {
    readonly memoryId: string;
    readonly scope: 'short' | 'long';
    readonly namespace: string;
    readonly contentType: string;
    readonly tokenCount: number;
  };
}

export interface MemoryRetrievedEvent extends DomainEvent {
  readonly type: 'memory.retrieved';
  readonly payload: {
    readonly namespace: string;
    readonly query: string;
    readonly matches: number;
    readonly topScore: number;
  };
}

export interface ToolExecutedEvent extends DomainEvent {
  readonly type: 'tool.executed';
  readonly payload: {
    readonly toolName: string;
    readonly agentId: string;
    readonly executionId: string;
    readonly durationMs: number;
    readonly success: boolean;
    readonly error?: string;
  };
}

export interface TeamFormedEvent extends DomainEvent {
  readonly type: 'team.formed';
  readonly payload: {
    readonly teamId: string;
    readonly name: string;
    readonly memberCount: number;
    readonly members: readonly string[];
  };
}

export interface TeamVoteEvent extends DomainEvent {
  readonly type: 'team.vote';
  readonly payload: {
    readonly teamId: string;
    readonly proposalId: string;
    readonly voterId: string;
    readonly vote: 'yes' | 'no' | 'abstain';
  };
}

// ── Model Fabric events (§22) ───────────────────────────────────────────────
export interface ModelDiscoveredEvent extends DomainEvent {
  readonly type: 'model.discovered';
  readonly payload: {
    readonly providerId: string;
    readonly modelId: string;
    readonly isFree: boolean;
    readonly freeTier?: string;
  };
}

export interface ModelUpdatedEvent extends DomainEvent {
  readonly type: 'model.updated';
  readonly payload: {
    readonly providerId: string;
    readonly modelId: string;
    readonly isFree: boolean;
    readonly freeTier?: string;
  };
}

export interface ModelRemovedEvent extends DomainEvent {
  readonly type: 'model.removed';
  readonly payload: {
    readonly providerId: string;
    readonly modelId: string;
    /** Why it left: 'stale' (provider stopped returning it) or 'provider_disabled'. */
    readonly reason: 'stale' | 'provider_disabled';
  };
}

export interface ModelPricingChangedEvent extends DomainEvent {
  readonly type: 'model.pricing.changed';
  readonly payload: {
    readonly providerId: string;
    readonly modelId: string;
    readonly wasFree: boolean;
    readonly isFree: boolean;
    readonly freeTier?: string;
    readonly source?: string;
  };
}

export interface ProviderPrefetchCompletedEvent extends DomainEvent {
  readonly type: 'provider.prefetch.completed';
  readonly payload: {
    readonly providerId: string;
    readonly discovered: number;
    readonly total: number;
    readonly free: number;
  };
}

// ── Phase 11: Application Build & AGY Execution Events ──────────────────────

export interface ApplicationBuildStartedEvent extends DomainEvent {
  readonly type: 'application.build.started';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly buildSessionId: string;
    readonly objective: string;
    readonly riskLevel: string;
    readonly requiresApproval: boolean;
  };
}

export interface ApplicationBuildCompletedEvent extends DomainEvent {
  readonly type: 'application.build.completed';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly buildSessionId: string;
    readonly durationMs: number;
    readonly repairAttempts: number;
    readonly artifacts: readonly string[];
  };
}

export interface ApplicationBuildFailedEvent extends DomainEvent {
  readonly type: 'application.build.failed';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly buildSessionId: string;
    readonly error: string;
    readonly stage: string;
    readonly repairAttempts: number;
  };
}

export interface AgyExecutionStartedEvent extends DomainEvent {
  readonly type: 'agy.execution.started';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly buildSessionId: string;
    readonly taskId: string;
    readonly nodeId?: string;
    readonly kind: string;
    readonly model: string;
    readonly policy: string;
  };
}

export interface AgyExecutionCompletedEvent extends DomainEvent {
  readonly type: 'agy.execution.completed';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly buildSessionId: string;
    readonly taskId: string;
    readonly nodeId?: string;
    readonly kind: string;
    readonly durationMs: number;
    readonly exitCode: number;
    readonly artifacts: readonly string[];
  };
}

export interface AgyExecutionFailedEvent extends DomainEvent {
  readonly type: 'agy.execution.failed';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly buildSessionId: string;
    readonly taskId: string;
    readonly nodeId?: string;
    readonly kind: string;
    readonly error: string;
    readonly exitCode: number;
  };
}

export interface AgyTestStartedEvent extends DomainEvent {
  readonly type: 'agy.test.started';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly taskId: string;
    readonly repairAttempt: number;
  };
}

export interface AgyTestCompletedEvent extends DomainEvent {
  readonly type: 'agy.test.completed';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly taskId: string;
    readonly success: boolean;
    readonly testsRan: number;
    readonly testsPassed: number;
    readonly testsFailed: number;
    readonly durationMs: number;
  };
}

export interface AgyRepairStartedEvent extends DomainEvent {
  readonly type: 'agy.repair.started';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly taskId: string;
    readonly attempt: number;
    readonly maxAttempts: number;
  };
}

export interface AgyRepairCompletedEvent extends DomainEvent {
  readonly type: 'agy.repair.completed';
  readonly payload: {
    readonly applicationId: string;
    readonly workspaceId: string;
    readonly taskId: string;
    readonly attempt: number;
    readonly success: boolean;
    readonly durationMs: number;
  };
}

export type AllDomainEvents =
  | RequestReceivedEvent
  | RouteResolvedEvent
  | ProviderRequestStartedEvent
  | ProviderRequestSucceededEvent
  | ProviderRequestFailedEvent
  | FailoverTriggeredEvent
  | HealthChangedEvent
  | CircuitBreakerTrippedEvent
  | PluginLoadedEvent
  | CacheHitEvent
  | CacheMissEvent
  | BudgetThresholdEvent
  | AuditEvent
  // Phase 4
  | AgentCreatedEvent
  | AgentStartedEvent
  | AgentCompletedEvent
  | AgentFailedEvent
  | AgentStatusChangedEvent
  | WorkflowStartedEvent
  | WorkflowStepStartedEvent
  | WorkflowStepCompletedEvent
  | WorkflowCompletedEvent
  | WorkflowPausedEvent
  | WorkflowResumedEvent
  | MemoryCreatedEvent
  | MemoryRetrievedEvent
  | ToolExecutedEvent
  | TeamFormedEvent
  | TeamVoteEvent
  // Model Fabric
  | ModelDiscoveredEvent
  | ModelUpdatedEvent
  | ModelRemovedEvent
  | ModelPricingChangedEvent
  | ProviderPrefetchCompletedEvent
  // Task Orchestration
  | TaskCreatedEvent
  | TaskAgentSelectedEvent
  | TaskModelSelectedEvent
  | TaskExecutionStartedEvent
  | TaskExecutionCompletedEvent
  | TaskExecutionFailedEvent
  | TaskCancelledEvent
  // Phase 11: Application Build & AGY
  | ApplicationBuildStartedEvent
  | ApplicationBuildCompletedEvent
  | ApplicationBuildFailedEvent
  | AgyExecutionStartedEvent
  | AgyExecutionCompletedEvent
  | AgyExecutionFailedEvent
  | AgyTestStartedEvent
  | AgyTestCompletedEvent
  | AgyRepairStartedEvent
  | AgyRepairCompletedEvent
  // Phase 34: Runtime Intelligence & Bounded Self-Healing
  | RuntimeSignalEvent
  | RuntimeAnomalyDetectedEvent
  | RuntimeDiagnosisCreatedEvent
  | RuntimeRemediationStartedEvent
  | RuntimeRemediationCompletedEvent
  | RuntimeRemediationFailedEvent
  | RuntimeIncidentCreatedEvent
  | RuntimeIncidentResolvedEvent
  | RuntimeIncidentAcknowledgedEvent
  | RuntimeIncidentEscalatedEvent;

// Model Fabric (kept for backward compat location)
export interface TaskCreatedEvent extends DomainEvent {
  readonly type: 'task.created';
  readonly payload: {
    readonly taskId: string;
    readonly prompt: string;
    readonly category: string;
    readonly priority: string;
    readonly timestamp: number;
  };
}

export interface TaskAgentSelectedEvent extends DomainEvent {
  readonly type: 'task.agent.selected';
  readonly payload: {
    readonly taskId: string;
    readonly agentId: string;
    readonly score: number;
    readonly reasons: readonly string[];
  };
}

export interface TaskModelSelectedEvent extends DomainEvent {
  readonly type: 'task.model.selected';
  readonly payload: {
    readonly taskId: string;
    readonly modelId: string;
    readonly providerId: string;
    readonly policy: string;
  };
}

export interface TaskExecutionStartedEvent extends DomainEvent {
  readonly type: 'task.execution.started';
  readonly payload: {
    readonly taskId: string;
    readonly runId: string;
    readonly agentId: string;
    readonly modelId: string;
    readonly attempt: number;
  };
}

export interface TaskExecutionCompletedEvent extends DomainEvent {
  readonly type: 'task.execution.completed';
  readonly payload: {
    readonly taskId: string;
    readonly runId: string;
    readonly agentId: string;
    readonly modelId: string;
    readonly durationMs: number;
  };
}

export interface TaskExecutionFailedEvent extends DomainEvent {
  readonly type: 'task.execution.failed';
  readonly payload: {
    readonly taskId: string;
    readonly runId: string;
    readonly agentId: string;
    readonly error: string;
    readonly willRetry: boolean;
  };
}

export interface TaskCancelledEvent extends DomainEvent {
  readonly type: 'task.cancelled';
  readonly payload: {
    readonly taskId: string;
    readonly timestamp: number;
  };
}

// ── Phase 34: Runtime Intelligence & Bounded Self-Healing Events ────────────

export interface RuntimeSignalEvent extends DomainEvent {
  readonly type: 'runtime.signal';
  readonly payload: {
    readonly id: string;
    readonly timestamp: number;
    readonly subsystem: string;
    readonly signalType: string;
    readonly value: number;
    readonly metadata?: Record<string, unknown>;
  };
}

export interface RuntimeAnomalyDetectedEvent extends DomainEvent {
  readonly type: 'runtime.anomaly.detected';
  readonly payload: {
    readonly id: string;
    readonly anomalyType: string;
    readonly subsystem: string;
    readonly severity: string;
    readonly detectedAt: number;
    readonly evidence: string;
    readonly threshold: number;
    readonly observedValue: number;
    readonly targetId?: string;
  };
}

export interface RuntimeDiagnosisCreatedEvent extends DomainEvent {
  readonly type: 'runtime.diagnosis.created';
  readonly payload: {
    readonly incidentId: string;
    readonly subsystem: string;
    readonly signal: string;
    readonly severity: string;
    readonly probableCause: string;
    readonly confidence: number;
    readonly recommendedRemediation: string;
    readonly autoRemediationPermitted: boolean;
  };
}

export interface RuntimeRemediationStartedEvent extends DomainEvent {
  readonly type: 'runtime.remediation.started';
  readonly payload: {
    readonly executionId: string;
    readonly incidentId: string;
    readonly actionType: string;
    readonly targetSubsystem: string;
    readonly targetId?: string;
    readonly policyTier: string;
    readonly attemptNumber: number;
    readonly initiatedBy: 'AUTONOMOUS' | 'OPERATOR';
  };
}

export interface RuntimeRemediationCompletedEvent extends DomainEvent {
  readonly type: 'runtime.remediation.completed';
  readonly payload: {
    readonly executionId: string;
    readonly incidentId: string;
    readonly actionType: string;
    readonly targetSubsystem: string;
    readonly targetId?: string;
    readonly verified: boolean;
    readonly message: string;
  };
}

export interface RuntimeRemediationFailedEvent extends DomainEvent {
  readonly type: 'runtime.remediation.failed';
  readonly payload: {
    readonly executionId: string;
    readonly incidentId: string;
    readonly actionType: string;
    readonly targetSubsystem: string;
    readonly targetId?: string;
    readonly attemptNumber: number;
    readonly error: string;
  };
}

export interface RuntimeIncidentCreatedEvent extends DomainEvent {
  readonly type: 'runtime.incident.created';
  readonly payload: {
    readonly incidentId: string;
    readonly subsystem: string;
    readonly severity: string;
    readonly anomalyType: string;
    readonly diagnosis: string;
  };
}

export interface RuntimeIncidentResolvedEvent extends DomainEvent {
  readonly type: 'runtime.incident.resolved';
  readonly payload: {
    readonly incidentId: string;
    readonly subsystem: string;
    readonly resolvedAt: number;
    readonly verificationEvidence: string;
  };
}

export interface RuntimeIncidentAcknowledgedEvent extends DomainEvent {
  readonly type: 'runtime.incident.acknowledged';
  readonly payload: {
    readonly incidentId: string;
    readonly acknowledgedAt: number;
    readonly operatorNotes?: string;
  };
}

export interface RuntimeIncidentEscalatedEvent extends DomainEvent {
  readonly type: 'runtime.incident.escalated';
  readonly payload: {
    readonly incidentId: string;
    readonly subsystem: string;
    readonly reason: string;
    readonly escalatedAt: number;
  };
}

/**
 * Internal helper: build a typed event.
 */
export function buildEvent<T extends DomainEvent>(
  type: T['type'],
  payload: T['payload'],
  correlationId?: string,
): T {
  return {
    type,
    occurredAt: new Date(),
    correlationId,
    payload,
  } as T;
}

/**
 * Re-export so consumers don't have to dig into types.ts for the endpoint shape.
 */
export type { ProviderEndpoint };

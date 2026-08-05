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
  | TeamVoteEvent;

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

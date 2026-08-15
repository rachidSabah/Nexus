/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Agent Orchestrator Domain Models — Phase 28
 *
 * Defines the abstractions for multi-agent intent classification, capability
 * matching, explainable scoring, execution leases, and failover plans.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type OrchestrationPolicy =
  | 'nexus/auto'
  | 'nexus/best-agent'
  | 'nexus/best-coding-agent'
  | 'nexus/application-builder'
  | 'nexus/fastest-agent'
  | 'nexus/most-reliable'
  | 'nexus/prefer-claude'
  | 'nexus/prefer-codex'
  | 'nexus/prefer-hermes'
  | 'nexus/prefer-opencode'
  | 'nexus/prefer-agy'
  | 'nexus/prefer-gemini';

export type TaskIntentCategory =
  | 'application-building'
  | 'debugging'
  | 'refactoring'
  | 'code-review'
  | 'testing-debugging'
  | 'feature-implementation'
  | 'repository-analysis'
  | 'general-coding';

export type AgentCapabilityTag =
  | 'coding'
  | 'repository-edit'
  | 'repository-read'
  | 'terminal'
  | 'debugging'
  | 'refactoring'
  | 'scaffolding'
  | 'application-building'
  | 'testing'
  | 'verification'
  | 'analysis'
  | 'tool-usage'
  | 'multi-model';

export interface TaskIntentClassification {
  readonly category: TaskIntentCategory;
  readonly confidence: number;
  readonly requiredCapabilities: readonly AgentCapabilityTag[];
  readonly suggestedPolicy: OrchestrationPolicy;
  readonly suggestedTimeoutMs: number;
  readonly explanation: string;
}

export interface AgentScoreBreakdown {
  readonly capabilityScore: number;
  readonly healthScore: number;
  readonly reliabilityScore: number;
  readonly latencyScore: number;
  readonly modelAvailabilityScore: number;
  readonly failurePenalty: number;
  readonly loadPenalty: number;
  readonly finalScore: number;
  readonly rationale: string;
}

export interface AgentCandidateScore {
  readonly agentId: string;
  readonly agentName: string;
  readonly isHealthy: boolean;
  readonly isExecutable: boolean;
  readonly score: number;
  readonly breakdown: AgentScoreBreakdown;
}

export interface AgentSelection {
  readonly selectedAgentId: string;
  readonly selectedAgentName: string;
  readonly policy: OrchestrationPolicy;
  readonly intent: TaskIntentClassification;
  readonly candidateScores: readonly AgentCandidateScore[];
  readonly fallbackChain: readonly string[];
  readonly reason: string;
  readonly timestamp: number;
}

export interface ExecutionLease {
  readonly leaseId: string;
  readonly executionId: string;
  readonly agentId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly status: 'ACTIVE' | 'RELEASED' | 'EXPIRED';
}

export interface OrchestratedExecutionRequest {
  readonly prompt: string;
  readonly workspace?: string;
  readonly policy?: OrchestrationPolicy;
  readonly targetModel?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly allowFailover?: boolean;
  readonly env?: Record<string, string>;
  readonly userPreferences?: {
    readonly preferredAgents?: readonly string[];
    readonly excludedAgents?: readonly string[];
  };
}

export interface FailoverAttemptRecord {
  readonly agentId: string;
  readonly error: string;
  readonly durationMs: number;
  readonly timestamp: number;
}

export interface OrchestratedExecutionResult {
  readonly executionId: string;
  readonly prompt: string;
  readonly status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';
  readonly selectedAgentId: string;
  readonly selectedAgentName: string;
  readonly selectedModel: string;
  readonly policy: OrchestrationPolicy;
  readonly attempts: number;
  readonly durationMs: number;
  readonly output: string;
  readonly error?: string;
  readonly failoverHistory: readonly FailoverAttemptRecord[];
  readonly selection: AgentSelection;
}

export interface OrchestratorMetrics {
  readonly totalOrchestrations: number;
  readonly successfulExecutions: number;
  readonly failedExecutions: number;
  readonly failoverCount: number;
  readonly averageSelectionLatencyMs: number;
  readonly activeLeases: number;
  readonly selectionDistribution: Record<string, number>;
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Phase 34 Runtime Intelligence, Anomaly Detection & Self-Healing
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { SubsystemName, SystemHealthStatus } from './system-health.js';

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AnomalyType =
  | 'PROVIDER_DEGRADED'
  | 'MODEL_DEGRADED'
  | 'KEY_EXHAUSTION_PATTERN'
  | 'RATE_LIMIT_SPIKE'
  | 'AUTH_FAILURE_SPIKE'
  | 'LATENCY_SPIKE'
  | 'ERROR_RATE_SPIKE'
  | 'AGENT_DEGRADED'
  | 'AGENT_UNAVAILABLE'
  | 'MISSION_STALLED'
  | 'MISSION_FAILURE_SPIKE'
  | 'REPAIR_LOOP_EXHAUSTION'
  | 'PERSISTENCE_DEGRADED'
  | 'NETWORK_DEGRADED'
  | 'TOKEN_COST_SPIKE'
  | 'ROUTING_DEGRADED';

export type RemediationPolicyTier = 'AUTO_SAFE' | 'APPROVAL_REQUIRED' | 'NEVER_AUTOMATE';

export type RemediationActionType =
  | 'TRIGGER_MODEL_REDISCOVERY'
  | 'MARK_STALE_MODEL'
  | 'REFRESH_PROVIDER_HEALTH'
  | 'DEPRIORITIZE_PROVIDER'
  | 'RESTORE_PROVIDER_PRIORITY'
  | 'ROTATE_TO_HEALTHY_KEY'
  | 'ENFORCE_KEY_COOLDOWN'
  | 'PROBE_AGENT_HEALTH'
  | 'RELEASE_AGENT_LEASE'
  | 'RECONCILE_INTERRUPTED_MISSION'
  | 'RELEASE_MISSION_LEASE'
  | 'INVALIDATE_CORRUPT_CACHE'
  | 'FLUSH_RATE_LIMIT_TRACKER'
  // Explicit Unsafe / Approval-Gated Actions:
  | 'INSTALL_AGENT_EXECUTABLE'
  | 'MODIFY_CREDENTIALS'
  | 'DELETE_PROVIDER'
  | 'DELETE_API_KEY'
  | 'DROP_PERSISTENCE_STORE'
  | 'MODIFY_FIREWALL_NETWORK'
  | 'EXECUTE_ARBITRARY_COMMAND'
  | 'ALTER_SECURITY_POLICY';

export type IncidentStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'REMEDIATING'
  | 'RESOLVED'
  | 'ESCALATED';

export type RemediationExecutionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED'
  | 'BLOCKED_BY_POLICY';

export interface RuntimeSignal {
  readonly id: string;
  readonly timestamp: number;
  readonly subsystem: SubsystemName;
  readonly signalType: string;
  readonly value: number;
  readonly metadata?: Record<string, unknown>;
  readonly correlationId?: string;
}

export interface RuntimeAnomaly {
  readonly id: string;
  readonly anomalyType: AnomalyType;
  readonly subsystem: SubsystemName;
  readonly severity: AnomalySeverity;
  readonly detectedAt: number;
  readonly evidence: string;
  readonly threshold: number;
  readonly observedValue: number;
  readonly targetId?: string;
  readonly correlationId?: string;
}

export interface RuntimeDiagnosis {
  readonly incidentId: string;
  readonly subsystem: SubsystemName;
  readonly signal: string;
  readonly severity: AnomalySeverity;
  readonly probableCause: string;
  readonly evidence: string[];
  readonly confidence: number; // 0.0 - 1.0
  readonly recommendedRemediation: RemediationActionType;
  readonly autoRemediationPermitted: boolean;
  readonly policyTier: RemediationPolicyTier;
}

export interface RemediationPolicyRule {
  readonly actionType: RemediationActionType;
  readonly policyTier: RemediationPolicyTier;
  readonly maxAttempts: number;
  readonly cooldownSeconds: number;
  readonly requiresVerification: boolean;
  readonly description: string;
  enabled: boolean;
}

export interface RemediationAction {
  readonly actionType: RemediationActionType;
  readonly targetSubsystem: SubsystemName;
  readonly targetId?: string;
  readonly parameters?: Record<string, unknown>;
  readonly initiatedBy: 'AUTONOMOUS' | 'OPERATOR';
  readonly timestamp: number;
}

export interface RemediationExecution {
  readonly id: string;
  readonly incidentId: string;
  readonly action: RemediationAction;
  readonly policy: RemediationPolicyTier;
  readonly attemptNumber: number;
  status: RemediationExecutionStatus;
  readonly startedAt: number;
  completedAt?: number;
  verificationResult?: {
    verified: boolean;
    evidence: string;
    targetHealth?: SystemHealthStatus;
  };
  error?: string;
  operatorNotes?: string;
}

export interface RemediationResult {
  readonly success: boolean;
  readonly actionType: RemediationActionType;
  readonly targetId?: string;
  readonly verified: boolean;
  readonly message: string;
  readonly timestamp: number;
  readonly details?: Record<string, unknown>;
}

export interface RuntimeIncident {
  readonly id: string;
  readonly timestamp: number;
  readonly subsystem: SubsystemName;
  severity: AnomalySeverity;
  readonly anomalyType: AnomalyType;
  diagnosis: RuntimeDiagnosis;
  readonly evidence: string[];
  status: IncidentStatus;
  remediationHistory: RemediationExecution[];
  verificationResult?: {
    verified: boolean;
    evidence: string;
    resolvedAt: number;
  };
  readonly correlationId?: string;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly createdAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  escalatedAt?: number;
  operatorNotes?: string;
}

export interface RuntimeIntelligenceOverview {
  readonly systemState: SystemHealthStatus;
  readonly activeIncidentsCount: number;
  readonly resolvedIncidentsCount: number;
  readonly activeAnomaliesCount: number;
  readonly totalRemediationsCount: number;
  readonly successfulRemediationsCount: number;
  readonly failedRemediationsCount: number;
  readonly escalatedIncidentsCount: number;
  readonly incidents: readonly RuntimeIncident[];
  readonly activeAnomalies: readonly RuntimeAnomaly[];
  readonly policies: readonly RemediationPolicyRule[];
  readonly statisticalTrends: {
    readonly errorRateP95: number;
    readonly latencyP95Ms: number;
    readonly rateLimitCount1m: number;
    readonly tokenCost1hUsd: number;
  };
}

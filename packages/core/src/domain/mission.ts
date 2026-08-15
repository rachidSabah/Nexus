/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 29: Unified Agent Mission Orchestration & Autonomous Execution
 * Domain Models, Lifecycle States, Task Specifications, and Event Schemas.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type MissionStatus =
  | 'CREATED'
  | 'DISCOVERING'
  | 'PLANNING'
  | 'RISK_ANALYSIS'
  | 'AWAITING_APPROVAL'
  | 'READY'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'REPAIRING'
  | 'REASSIGNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED';

export type MissionTaskType =
  | 'ANALYSIS'
  | 'PLANNING'
  | 'CODING'
  | 'REFACTORING'
  | 'TESTING'
  | 'DEBUGGING'
  | 'DOCUMENTATION'
  | 'REVIEW'
  | 'BUILD'
  | 'VERIFICATION'
  | 'APPLICATION_BUILD';

export type MissionTaskStatus =
  | 'PENDING'
  | 'BLOCKED'
  | 'READY'
  | 'ASSIGNED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

export type MissionFailureType =
  | 'AGENT_FAILURE'
  | 'MODEL_FAILURE'
  | 'PROVIDER_FAILURE'
  | 'KEY_FAILURE'
  | 'TIMEOUT'
  | 'BUILD_FAILURE'
  | 'TEST_FAILURE'
  | 'WORKSPACE_FAILURE'
  | 'SECURITY_FAILURE'
  | 'UNKNOWN';

export type MissionPolicy =
  | 'nexus/auto'
  | 'nexus/fast'
  | 'nexus/quality'
  | 'nexus/low-cost'
  | 'nexus/best-coding'
  | 'nexus/application-builder';

export type MissionRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface MissionTask {
  taskId: string;
  type: MissionTaskType;
  title: string;
  objective: string;
  requiredCapabilities: string[];
  risk: MissionRiskLevel;
  dependencies: string[];
  workspace?: string;
  preferredAgent?: string;
  selectedAgent?: string;
  selectedModel?: string;
  selectedProvider?: string;
  modelPolicy?: string;
  providerPolicy?: string;
  status: MissionTaskStatus;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  durationMs?: number;
  output?: string;
  error?: string;
  repairAttempts?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface MissionTaskDependency {
  fromTaskId: string;
  toTaskId: string;
}

export interface MissionPlan {
  missionId: string;
  objective: string;
  tasks: MissionTask[];
  dependencies: MissionTaskDependency[];
  estimatedDurationMs: number;
  riskLevel: MissionRiskLevel;
  requiresApproval: boolean;
  approvalReason?: string;
  maxParallelTasks: number;
  plannedAt: number;
}

export interface MissionSpecification {
  objective: string;
  workspace?: string;
  policy?: MissionPolicy;
  type?: 'STANDARD' | 'APPLICATION_BUILD';
  applicationSpec?: Record<string, unknown>;
  userPreferences?: {
    preferredAgent?: string;
    maxCost?: number;
    timeoutMs?: number;
    maxRepairCycles?: number;
    maxParallelTasks?: number;
  };
  env?: Record<string, string>;
  autoExecute?: boolean;
}

export interface MissionVerificationCheck {
  name: string;
  passed: boolean;
  message: string;
  durationMs?: number;
}

export interface MissionVerification {
  status: 'PASSED' | 'FAILED' | 'PARTIAL' | 'BLOCKED';
  checks: MissionVerificationCheck[];
  verifiedAt: number;
  details?: string;
}

export interface MissionCheckpoint {
  checkpointId: string;
  missionId: string;
  timestamp: number;
  status: MissionStatus;
  completedTasks: string[];
  activeTasks: string[];
  failedTasks: string[];
  dagState: Record<string, MissionTaskStatus>;
  agentAssignments: Record<string, { agentId: string; model?: string; provider?: string }>;
  verificationState?: MissionVerification;
  totalTokens: number;
  estimatedCost: number;
}

export interface Mission {
  id: string;
  spec: MissionSpecification;
  status: MissionStatus;
  plan?: MissionPlan;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  approvedAt?: number;
  approvedBy?: string;
  currentTaskId?: string;
  activeTaskIds: string[];
  completedTaskIds: string[];
  failedTaskIds: string[];
  totalTokens: number;
  estimatedCost: number;
  tokenSavings: number;
  failoverCount: number;
  repairCount: number;
  verification?: MissionVerification;
  error?: string;
  checkpointsCount: number;
}

export interface MissionEvent {
  id: string;
  missionId: string;
  type: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface MissionExecutionOptions {
  autoApprove?: boolean;
  onEvent?: (event: MissionEvent) => void;
  signal?: AbortSignal;
}

export interface MissionOrchestratorMetrics {
  totalMissions: number;
  activeMissions: number;
  completedMissions: number;
  failedMissions: number;
  cancelledMissions: number;
  totalTasksExecuted: number;
  totalFailovers: number;
  totalRepairs: number;
  totalTokensConsumed: number;
  totalEstimatedCost: number;
  averageMissionDurationMs: number;
}

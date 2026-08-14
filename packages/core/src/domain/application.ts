/**
 * Application domain — Phase 11 extended lifecycle.
 *
 * Stages follow the mandated Phase 11 pipeline:
 * DISCOVER → SPECIFY → ARCHITECT → PLAN → APPROVAL →
 * SCAFFOLD → BUILD → TEST → VERIFY → REPAIR → FINALIZE → COMPLETED
 */

export type ApplicationStage =
  | 'DISCOVER'
  | 'SPECIFY'
  | 'ARCHITECT'
  | 'PLAN'
  | 'APPROVAL'         // Risk gate — may be auto-satisfied for LOW risk
  | 'SCAFFOLD'         // AGY_SCAFFOLD node
  | 'BUILD'            // AGY_IMPLEMENT node
  | 'TEST'             // AGY_TEST node
  | 'VERIFY'           // ApplicationVerifier check
  | 'REPAIR'           // AGY_FIX + re-test loop
  | 'FINALIZE'         // Index artifacts, write state.json
  | 'COMPLETED'
  | 'FAILED'
  // Legacy aliases (kept for backward compatibility)
  | 'DIAGNOSE'
  | 'RETEST'
  | 'SECURITY_REVIEW'
  | 'FINAL_VALIDATION';

export interface ApplicationSpec {
  readonly title: string;
  readonly summary: string;
  readonly techStack: readonly string[];
  readonly features: readonly string[];
}

export interface ApplicationArchitecture {
  readonly pattern: string;
  readonly components: readonly string[];
  readonly dataStore: string;
}

export interface ApplicationWorkspace {
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly buildSessionId: string;
  readonly createdAt: number;
}

export interface ApplicationBuildContext {
  /** Whether this build requires human approval before AGY runs. */
  readonly requiresApproval: boolean;
  readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly riskFlags: readonly string[];
  /** Selected model policy for AGY execution. */
  readonly selectedPolicy?: string;
  readonly selectedModel?: string;
  readonly selectedProvider?: string;
  /** Number of repair cycles completed. */
  repairAttempts: number;
  readonly maxRepairAttempts: number;
  /** IDs of the last AGY task runs. */
  readonly buildTaskId?: string;
  readonly testTaskId?: string;
  readonly lastTestResult?: {
    readonly success: boolean;
    readonly testsRan: number;
    readonly testsPassed: number;
    readonly testsFailed: number;
    readonly output: string;
  };
}

export interface ApplicationState {
  readonly appId: string;
  readonly objective: string;
  stage: ApplicationStage;
  readonly createdAt: number;
  updatedAt: number;
  spec?: ApplicationSpec;
  architecture?: ApplicationArchitecture;
  workspace?: ApplicationWorkspace;
  buildContext?: ApplicationBuildContext;
  workflowId?: string;
  runId?: string;
  repairAttempts: number;
  error?: string;
  /** Accumulated domain event log for this application. */
  readonly eventLog: ApplicationEvent[];
}

export interface ApplicationEvent {
  readonly type: string;
  readonly occurredAt: number;
  readonly payload: Record<string, unknown>;
}

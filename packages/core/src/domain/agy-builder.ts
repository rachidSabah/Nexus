/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AGY Builder Domain — Phase 11
 *
 * Pure value objects and port interfaces for the AGY application-building
 * integration. No infrastructure imports allowed here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Workspace ─────────────────────────────────────────────────────────────────

export interface WorkspaceConfig {
  readonly applicationId: string;
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly repositoryPath?: string;
  readonly buildSessionId?: string;
}

// ── AGY-specific workflow node types ──────────────────────────────────────────

export type AgyNodeKind =
  | 'AGY_SCAFFOLD'
  | 'AGY_IMPLEMENT'
  | 'AGY_TEST'
  | 'AGY_INSPECT'
  | 'AGY_FIX'
  | 'AGY_VERIFY';

// ── Routing policy aliases matched to Nexus routing policies ─────────────────

export type AgyPolicy =
  | 'nexus/best-coding'   // AGY implementation
  | 'nexus/fast'          // AGY quick repair
  | 'nexus/long-context'  // AGY large repository
  | 'nexus/best'          // AGY reasoning-heavy architecture
  | 'nexus/auto';

// ── Build Task ────────────────────────────────────────────────────────────────

export interface AgyBuildTask {
  readonly taskId: string;
  readonly nodeId?: string;
  readonly applicationId: string;
  readonly workspaceId: string;
  readonly workspace: WorkspaceConfig;
  readonly objective: string;
  readonly kind?: AgyNodeKind;
  readonly specSummary?: string;
  readonly architectureConstraints?: string;
  readonly allowedPaths?: readonly string[];
  readonly forbiddenPaths?: readonly string[];
  readonly targetModel?: string;
  readonly policy?: AgyPolicy;
  readonly timeoutMs?: number;
  readonly maxRepairAttempts?: number;
  readonly currentRepairAttempt?: number;
  readonly repairAttempt?: number;
  readonly gatewayBaseUrl?: string;
  readonly gatewayPort?: number;
  readonly metadata?: Record<string, unknown>;
}

// ── Build Result ──────────────────────────────────────────────────────────────

export interface AgyBuildResult {
  readonly success: boolean;
  readonly output: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly artifacts: readonly string[];
  readonly testsRan?: number;
  readonly testsPassed?: number;
  readonly testsFailed?: number;
  readonly repairAttempt?: number;
  readonly error?: string;
}

// ── Workspace Verification ────────────────────────────────────────────────────

export interface WorkspaceVerificationResult {
  readonly valid: boolean;
  readonly workspaceExists: boolean;
  readonly manifestExists: boolean;
  readonly sourceFilesPresent: boolean;
  readonly pathTraversalClean: boolean;
  readonly buildResultCaptured: boolean;
  readonly testResultCaptured: boolean;
  readonly artifacts: readonly string[];
  readonly issues: readonly string[];
}

// ── Runtime health ────────────────────────────────────────────────────────────

export interface AgyHealthStatus {
  readonly installed: boolean;
  readonly version?: string;
  readonly executablePath?: string;
  readonly runtimeHealthy: boolean;
  readonly checkedAt: number;
}

// ── AGY Builder Port (hexagonal boundary) ────────────────────────────────────

/**
 * The port through which the Application Engine talks to AGY.
 * Implementations must not leak subprocess or OS details into the domain.
 */
export interface AgyBuilderPort {
  /** Detect whether AGY is available on this machine. */
  detect(): Promise<boolean>;

  /** Full health check — detect + version query + quick sanity. */
  healthCheck(): Promise<AgyHealthStatus>;

  /** Prepare the isolated workspace directory structure. */
  initializeProject(workspace: WorkspaceConfig): Promise<void>;

  /** Run AGY to build/scaffold the application. */
  build(task: AgyBuildTask): Promise<AgyBuildResult>;

  /** Run the test suite inside the workspace. */
  test(task: AgyBuildTask): Promise<AgyBuildResult>;

  /** Inspect the workspace for issues (pre-repair analysis). */
  inspect(task: AgyBuildTask): Promise<AgyBuildResult>;

  /** Repair failing tests or broken code. */
  fix(task: AgyBuildTask): Promise<AgyBuildResult>;

  /**
   * Verify workspace artifact completeness — returns a structured result
   * describing whether the build output is valid and complete.
   */
  verify(workspace: WorkspaceConfig): Promise<WorkspaceVerificationResult>;

  /** Return the current status of the AGY executable path. */
  status(): Promise<AgyHealthStatus>;

  /** Cancel any running AGY process for the given task ID. */
  cancel(taskId: string): Promise<void>;
}

// ── Repair Loop Config ────────────────────────────────────────────────────────

export interface RepairLoopConfig {
  readonly maxRepairAttempts: number;
  /** Whether to emit a checkpoint after every repair cycle. */
  readonly checkpointEachAttempt: boolean;
}

export const DEFAULT_REPAIR_CONFIG: RepairLoopConfig = {
  maxRepairAttempts: 3,
  checkpointEachAttempt: true,
};

// ── Phase 22 AGY Build Session & Checkpointing ────────────────────────────────

export type AgyBuildStage =
  | 'CREATED'
  | 'INITIALIZING'
  | 'SCAFFOLDING'
  | 'IMPLEMENTING'
  | 'TESTING'
  | 'INSPECTING'
  | 'REPAIRING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'PAUSED'
  | 'FAILED'
  | 'CANCELLED';

export interface AgyTokenMetrics {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostUsd: number;
  readonly savedTokens: number;
  readonly compressionPercent: number;
}

export interface AgyCheckpoint {
  readonly checkpointId: string;
  readonly buildSessionId: string;
  readonly stage: AgyBuildStage;
  readonly timestamp: number;
  readonly changedFiles: readonly string[];
  readonly testStatus?: {
    readonly passed: boolean;
    readonly testsRan: number;
    readonly testsPassed: number;
    readonly testsFailed: number;
  };
  readonly model: string;
  readonly provider: string;
  readonly tokenUsage: AgyTokenMetrics;
  readonly outputSummary: string;
}

export interface AgyBuildSession {
  readonly buildSessionId: string;
  readonly applicationId: string;
  readonly workspaceId: string;
  readonly agentId: string;
  readonly selectedModel: string;
  readonly providerId: string;
  readonly routingPolicy: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly currentStage: AgyBuildStage;
  readonly status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly tokensUsed: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number;
  readonly filesCreated: readonly string[];
  readonly filesModified: readonly string[];
  readonly testsRun: number;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly lastError?: string;
  readonly checkpoints: readonly AgyCheckpoint[];
  readonly startedBy?: string;
}


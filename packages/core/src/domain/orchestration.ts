export type TaskStatus =
  | 'CREATED'
  | 'PLANNING'
  | 'PLANNED'
  | 'QUEUED'
  | 'STARTING'
  | 'RUNNING'
  | 'WAITING'
  | 'RETRYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export type TaskCategory =
  | 'GENERAL'
  | 'CODING'
  | 'DEBUGGING'
  | 'REFACTORING'
  | 'TESTING'
  | 'DOCUMENTATION'
  | 'RESEARCH'
  | 'ARCHITECTURE'
  | 'SECURITY'
  | 'PERFORMANCE';

export type TaskPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export interface AgentTask {
  readonly taskId: string;
  status: TaskStatus;
  readonly prompt: string;
  readonly createdAt: number;
  updatedAt: number;
  readonly priority: TaskPriority;
  readonly category: TaskCategory;
  readonly requestedAgent?: string;
  selectedAgent?: string;
  readonly requestedModel?: string;
  selectedModel?: string;
  provider?: string;
  executionAttempts: number;
  readonly timeoutMs: number;
  readonly workingDirectory?: string;
  readonly metadata?: Record<string, unknown>;
  readonly parentTaskId?: string;
  readonly childTaskIds?: readonly string[];
  result?: {
    output: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    tokensUsed?: number;
    costUsd?: number;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AgentRun {
  readonly runId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly startTime: number;
  endTime?: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  output?: string;
  error?: string;
}

export interface TaskArtifact {
  readonly artifactId: string;
  readonly taskId: string;
  readonly type: 'log' | 'patch' | 'report' | 'file';
  readonly path: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly createdAt: number;
}

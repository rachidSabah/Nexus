import { BuildJob } from '../../models/build-job.js';
import { PipelineStep, StepResult } from '../../models/step.js';

export interface StepOutputCallback {
  (chunk: string, isStderr: boolean): void;
}

export interface StepExecutionOptions {
  workspaceDir: string;
  step: PipelineStep;
  env: Record<string, string>;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onOutput?: StepOutputCallback;
}

export interface WorkspaceContext {
  workspaceDir: string;
  buildId: string;
  projectId: string;
}

export interface IExecutionEnginePort {
  prepareWorkspace(job: BuildJob): Promise<WorkspaceContext>;
  executeStep(options: StepExecutionOptions): Promise<StepResult>;
  cleanupWorkspace(context: WorkspaceContext): Promise<void>;
  cancelExecution(buildId: string): Promise<void>;
}

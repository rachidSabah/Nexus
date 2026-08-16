import { BuildStatus, BuildMetrics } from './types.js';
import { PipelineStep, StepConfig, StepResult } from './step.js';
import { Artifact } from './artifact.js';

export interface BuildJobProps {
  id: string;
  projectId: string;
  projectName?: string;
  commitHash?: string;
  branch?: string;
  status?: BuildStatus;
  steps: StepConfig[];
  environment?: Record<string, string>;
  workspacePath?: string;
  artifacts?: Artifact[];
  error?: string;
  queuedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  metrics?: BuildMetrics;
}

export class BuildJob {
  public readonly id: string;
  public readonly projectId: string;
  public readonly projectName?: string;
  public readonly commitHash?: string;
  public readonly branch: string;
  public readonly environment: Record<string, string>;
  public workspacePath?: string;

  private _status: BuildStatus = 'queued';
  private _steps: PipelineStep[] = [];
  private _artifacts: Artifact[] = [];
  private _logs: string[] = [];
  private _error?: string;
  private _queuedAt: Date;
  private _startedAt?: Date;
  private _completedAt?: Date;
  private _metrics?: BuildMetrics;

  constructor(props: BuildJobProps) {
    this.id = props.id;
    this.projectId = props.projectId;
    this.projectName = props.projectName;
    this.commitHash = props.commitHash;
    this.branch = props.branch || 'main';
    this._status = props.status || 'queued';
    this.environment = props.environment || {};
    this.workspacePath = props.workspacePath;
    this._error = props.error;
    this._queuedAt = props.queuedAt || new Date();
    this._startedAt = props.startedAt;
    this._completedAt = props.completedAt;
    this._metrics = props.metrics;

    this._steps = props.steps.map((s) => new PipelineStep(s));
    if (props.artifacts) {
      this._artifacts = [...props.artifacts];
    }
  }

  public start(workspacePath?: string): void {
    if (this._status !== 'queued') {
      throw new Error(`Cannot start build in status: ${this._status}`);
    }
    this._status = 'running';
    this._startedAt = new Date();
    if (workspacePath) {
      this.workspacePath = workspacePath;
    }
    this.appendLog(`Build ${this.id} started at ${this._startedAt.toISOString()}`);
  }

  public complete(artifacts: Artifact[] = []): void {
    if (this._status !== 'running') {
      return;
    }
    this._status = 'completed';
    this._completedAt = new Date();
    this._artifacts.push(...artifacts);
    const duration = this._startedAt ? this._completedAt.getTime() - this._startedAt.getTime() : 0;
    this._metrics = {
      durationMs: duration,
      exitCode: 0,
    };
    this.appendLog(`Build ${this.id} completed successfully in ${duration}ms`);
  }

  public fail(errorMessage: string, exitCode = 1): void {
    if (this._status === 'completed' || this._status === 'cancelled') {
      return;
    }
    this._status = 'failed';
    this._completedAt = new Date();
    this._error = errorMessage;
    const duration = this._startedAt ? this._completedAt.getTime() - this._startedAt.getTime() : 0;
    this._metrics = {
      durationMs: duration,
      exitCode,
    };
    this.appendLog(`Build ${this.id} failed: ${errorMessage}`);
  }

  public cancel(reason = 'Build cancelled by user'): void {
    if (this._status === 'completed' || this._status === 'failed') {
      return;
    }
    this._status = 'cancelled';
    this._completedAt = new Date();
    this._error = reason;
    const duration = this._startedAt ? this._completedAt.getTime() - this._startedAt.getTime() : 0;
    this._metrics = {
      durationMs: duration,
      exitCode: 130,
    };
    this.appendLog(`Build ${this.id} cancelled: ${reason}`);
  }

  public timeout(): void {
    if (this._status === 'completed' || this._status === 'failed' || this._status === 'cancelled') {
      return;
    }
    this._status = 'timed_out';
    this._completedAt = new Date();
    this._error = 'Build timed out';
    const duration = this._startedAt ? this._completedAt.getTime() - this._startedAt.getTime() : 0;
    this._metrics = {
      durationMs: duration,
      exitCode: 124,
    };
    this.appendLog(`Build ${this.id} exceeded maximum runtime and timed out`);
  }

  public appendLog(message: string): void {
    const timestamp = new Date().toISOString();
    this._logs.push(`[${timestamp}] ${message}`);
  }

  public addArtifact(artifact: Artifact): void {
    this._artifacts.push(artifact);
  }

  public get status(): BuildStatus {
    return this._status;
  }

  public get steps(): PipelineStep[] {
    return this._steps;
  }

  public get artifacts(): Artifact[] {
    return this._artifacts;
  }

  public get logs(): string[] {
    return [...this._logs];
  }

  public get error(): string | undefined {
    return this._error;
  }

  public get queuedAt(): Date {
    return this._queuedAt;
  }

  public get startedAt(): Date | undefined {
    return this._startedAt;
  }

  public get completedAt(): Date | undefined {
    return this._completedAt;
  }

  public get metrics(): BuildMetrics | undefined {
    return this._metrics;
  }

  public getStepResults(): StepResult[] {
    return this._steps.map((s) => s.toResult());
  }

  public toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      projectId: this.projectId,
      projectName: this.projectName,
      commitHash: this.commitHash,
      branch: this.branch,
      status: this._status,
      workspacePath: this.workspacePath,
      environment: this.environment,
      error: this._error,
      queuedAt: this._queuedAt.toISOString(),
      startedAt: this._startedAt?.toISOString(),
      completedAt: this._completedAt?.toISOString(),
      metrics: this._metrics,
      stepCount: this._steps.length,
      steps: this.getStepResults(),
      artifacts: this._artifacts.map((a) => a.toJSON()),
      logCount: this._logs.length,
    };
  }
}

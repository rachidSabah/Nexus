import { StepStatus } from './types.js';

export interface StepConfig {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  continueOnError?: boolean;
  timeoutMs?: number;
}

export interface StepResult {
  stepId: string;
  name: string;
  command: string;
  status: StepStatus;
  exitCode?: number;
  stdout: string;
  stderr: string;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  error?: string;
}

export class PipelineStep {
  public readonly id: string;
  public readonly name: string;
  public readonly command: string;
  public readonly cwd?: string;
  public readonly env: Record<string, string>;
  public readonly continueOnError: boolean;
  public readonly timeoutMs?: number;

  private status: StepStatus = 'pending';
  private exitCode?: number;
  private stdout = '';
  private stderr = '';
  private startedAt?: Date;
  private completedAt?: Date;
  private error?: string;

  constructor(config: StepConfig) {
    this.id = config.id;
    this.name = config.name;
    this.command = config.command;
    this.cwd = config.cwd;
    this.env = config.env ?? {};
    this.continueOnError = config.continueOnError ?? false;
    this.timeoutMs = config.timeoutMs;
  }

  public start(): void {
    this.status = 'running';
    this.startedAt = new Date();
  }

  public complete(exitCode: number, stdout: string, stderr: string): void {
    this.completedAt = new Date();
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    this.status = exitCode === 0 ? 'success' : this.continueOnError ? 'success' : 'failed';
    if (exitCode !== 0 && !this.continueOnError) {
      this.error = `Step execution failed with exit code ${exitCode}`;
    }
  }

  public fail(errorMessage: string): void {
    this.completedAt = new Date();
    this.status = 'failed';
    this.error = errorMessage;
  }

  public skip(): void {
    this.status = 'skipped';
  }

  public appendOutput(chunk: string, isStderr = false): void {
    if (isStderr) {
      this.stderr += chunk;
    } else {
      this.stdout += chunk;
    }
  }

  public toResult(): StepResult {
    const duration = this.startedAt && this.completedAt
      ? this.completedAt.getTime() - this.startedAt.getTime()
      : undefined;

    return {
      stepId: this.id,
      name: this.name,
      command: this.command,
      status: this.status,
      exitCode: this.exitCode,
      stdout: this.stdout,
      stderr: this.stderr,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      durationMs: duration,
      error: this.error,
    };
  }

  public getStatus(): StepStatus {
    return this.status;
  }
}

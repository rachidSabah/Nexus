import * as child_process from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { BuildJob } from '../../domain/models/build-job.js';
import { StepResult } from '../../domain/models/step.js';
import {
  IExecutionEnginePort,
  StepExecutionOptions,
  WorkspaceContext,
} from '../../domain/ports/outbound/execution-engine.port.js';

export interface DockerSandboxConfig {
  image?: string;
  memoryLimitMb?: number;
  cpuQuota?: string; // e.g., '1.0'
  networkMode?: 'none' | 'bridge';
  timeoutMs?: number;
  workspaceRoot?: string;
}

export interface ExecutionRequest {
  command: string;
  workingDirectory: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class DockerSandboxExecutionAdapter implements IExecutionEnginePort {
  private readonly config: Required<DockerSandboxConfig>;
  private readonly activeProcesses = new Map<string, child_process.ChildProcess>();

  constructor(config: DockerSandboxConfig = {}) {
    this.config = {
      image: config.image ?? 'node:22-alpine',
      memoryLimitMb: config.memoryLimitMb ?? 512,
      cpuQuota: config.cpuQuota ?? '1.0',
      networkMode: config.networkMode ?? 'none',
      timeoutMs: config.timeoutMs ?? 120_000,
      workspaceRoot: path.resolve(config.workspaceRoot ?? './workspaces'),
    };
  }

  public async prepareWorkspace(job: BuildJob): Promise<WorkspaceContext> {
    const buildWorkspace = path.join(this.config.workspaceRoot, job.projectId, job.id);
    await fsp.mkdir(buildWorkspace, { recursive: true });

    return {
      workspaceDir: job.workspacePath ? path.resolve(job.workspacePath) : buildWorkspace,
      buildId: job.id,
      projectId: job.projectId,
    };
  }

  public async executeStep(options: StepExecutionOptions): Promise<StepResult> {
    const { step, workspaceDir, env, timeoutMs = this.config.timeoutMs, abortSignal, onOutput } = options;
    const workingDirectory = step.cwd ? path.resolve(workspaceDir, step.cwd) : workspaceDir;
    const startedAt = new Date();

    const procKey = `${options.env['BUILD_ID'] || 'unknown'}:${step.id}`;

    // Normalize Windows path for Docker volume mounting
    const hostMountPath = path.resolve(workingDirectory).replace(/\\/g, '/');

    const args = [
      'run',
      '--rm',
      '--network',
      this.config.networkMode,
      '--memory',
      `${this.config.memoryLimitMb}m`,
      '--cpus',
      this.config.cpuQuota,
      '--pids-limit',
      '64',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '-v',
      `${hostMountPath}:/workspace:rw`,
      '-w',
      '/workspace',
    ];

    // Pass environment variables into docker run
    const mergedEnv = { ...env, ...step.env };
    for (const [k, v] of Object.entries(mergedEnv)) {
      args.push('-e', `${k}=${v}`);
    }

    args.push(this.config.image, '/bin/sh', '-c', step.command);

    return new Promise<StepResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let isDone = false;

      const child = child_process.spawn('docker', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcesses.set(procKey, child);

      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (!isDone) {
            isDone = true;
            this.killChild(child);
            const completedAt = new Date();
            const errorMsg = `[NEXUS_BUILDER_SANDBOX] Step timed out after ${timeoutMs}ms`;
            step.fail(errorMsg);
            resolve({
              stepId: step.id,
              name: step.name,
              command: step.command,
              status: 'failed',
              exitCode: 124,
              stdout,
              stderr: stderr + `\n${errorMsg}\n`,
              startedAt,
              completedAt,
              durationMs: completedAt.getTime() - startedAt.getTime(),
              error: errorMsg,
            });
          }
        }, timeoutMs);
      }

      const abortHandler = () => {
        if (!isDone) {
          isDone = true;
          this.killChild(child);
          const completedAt = new Date();
          step.fail('Step cancelled');
          resolve({
            stepId: step.id,
            name: step.name,
            command: step.command,
            status: 'failed',
            exitCode: 130,
            stdout,
            stderr: stderr + '\n[Abort]: Step was cancelled by abort signal\n',
            startedAt,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            error: 'Step was cancelled',
          });
        }
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          abortHandler();
          return;
        }
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        onOutput?.(text, false);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        onOutput?.(text, true);
      });

      child.on('error', (err) => {
        if (isDone) return;
        isDone = true;
        if (timer) clearTimeout(timer);
        this.activeProcesses.delete(procKey);
        const completedAt = new Date();
        step.fail(`Container execution error: ${err.message}`);
        resolve({
          stepId: step.id,
          name: step.name,
          command: step.command,
          status: 'failed',
          exitCode: 1,
          stdout,
          stderr: stderr + `\n[Docker Error]: ${err.message}\n`,
          startedAt,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          error: err.message,
        });
      });

      child.on('close', (code) => {
        if (isDone) return;
        isDone = true;
        if (timer) clearTimeout(timer);
        this.activeProcesses.delete(procKey);
        const completedAt = new Date();
        const exitCode = code ?? 0;
        const durationMs = completedAt.getTime() - startedAt.getTime();

        if (exitCode === 0) {
          step.complete(0, stdout, stderr);
        } else {
          step.fail(stderr || `Step failed with exit code ${exitCode}`);
        }

        resolve({
          stepId: step.id,
          name: step.name,
          command: step.command,
          status: exitCode === 0 ? 'success' : 'failed',
          exitCode,
          stdout,
          stderr,
          startedAt,
          completedAt,
          durationMs,
          error: exitCode === 0 ? undefined : stderr || `Exit code ${exitCode}`,
        });
      });
    });
  }

  /** Direct execution helper for single commands */
  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const hostMountPath = path.resolve(request.workingDirectory).replace(/\\/g, '/');

    const args = [
      'run',
      '--rm',
      '--network',
      this.config.networkMode,
      '--memory',
      `${this.config.memoryLimitMb}m`,
      '--cpus',
      this.config.cpuQuota,
      '--pids-limit',
      '64',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '-v',
      `${hostMountPath}:/workspace:rw`,
      '-w',
      '/workspace',
    ];

    if (request.env) {
      for (const [k, v] of Object.entries(request.env)) {
        args.push('-e', `${k}=${v}`);
      }
    }

    args.push(this.config.image, '/bin/sh', '-c', request.command);

    return new Promise<ExecutionResult>((resolve) => {
      const child = child_process.spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      const timeout = request.timeoutMs ?? this.config.timeoutMs;
      const timer = setTimeout(() => {
        this.killChild(child);
        stderr += '\n[NEXUS_BUILDER_SANDBOX] Execution timed out and container was killed.';
      }, timeout);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({
          exitCode: exitCode ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  public async cleanupWorkspace(context: WorkspaceContext): Promise<void> {
    try {
      await fsp.rm(context.workspaceDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  public async cancelExecution(buildId: string): Promise<void> {
    for (const [key, proc] of this.activeProcesses.entries()) {
      if (key.startsWith(`${buildId}:`)) {
        this.killChild(proc);
        this.activeProcesses.delete(key);
      }
    }
  }

  private killChild(proc: child_process.ChildProcess): void {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

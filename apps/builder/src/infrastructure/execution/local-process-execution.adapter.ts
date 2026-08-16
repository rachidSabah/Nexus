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

export class LocalProcessExecutionAdapter implements IExecutionEnginePort {
  private readonly workspaceRoot: string;
  private readonly activeProcesses = new Map<string, child_process.ChildProcess>();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  public async prepareWorkspace(job: BuildJob): Promise<WorkspaceContext> {
    const buildWorkspace = path.join(this.workspaceRoot, job.projectId, job.id);
    await fsp.mkdir(buildWorkspace, { recursive: true });

    return {
      workspaceDir: job.workspacePath ? path.resolve(job.workspacePath) : buildWorkspace,
      buildId: job.id,
      projectId: job.projectId,
    };
  }

  public async executeStep(options: StepExecutionOptions): Promise<StepResult> {
    const { step, workspaceDir, env, timeoutMs = 120000, abortSignal, onOutput } = options;
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
    const shellArg = isWindows ? '/c' : '-c';

    const workingDirectory = step.cwd ? path.resolve(workspaceDir, step.cwd) : workspaceDir;

    return new Promise<StepResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let isDone = false;
      const startedAt = new Date();

      const mergedEnv = {
        ...process.env,
        ...env,
        ...step.env,
      };

      const proc = child_process.spawn(shell, [shellArg, step.command], {
        cwd: workingDirectory,
        env: mergedEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const procKey = `${options.env.BUILD_ID || 'unknown'}:${step.id}`;
      this.activeProcesses.set(procKey, proc);

      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (!isDone) {
            isDone = true;
            this.killProcessTree(proc);
            const completedAt = new Date();
            step.fail(`Step timed out after ${timeoutMs}ms`);
            resolve({
              stepId: step.id,
              name: step.name,
              command: step.command,
              status: 'failed',
              exitCode: 124,
              stdout,
              stderr: stderr + `\n[Timeout Error]: Step timed out after ${timeoutMs}ms\n`,
              startedAt,
              completedAt,
              durationMs: completedAt.getTime() - startedAt.getTime(),
              error: `Step timed out after ${timeoutMs}ms`,
            });
          }
        }, timeoutMs);
      }

      const abortHandler = () => {
        if (!isDone) {
          isDone = true;
          this.killProcessTree(proc);
          const completedAt = new Date();
          step.fail('Step cancelled');
          resolve({
            stepId: step.id,
            name: step.name,
            command: step.command,
            status: 'failed',
            exitCode: 130,
            stdout,
            stderr: stderr + '\n[Abort]: Step was cancelled\n',
            startedAt,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            error: 'Step cancelled',
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

      proc.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString('utf-8');
        stdout += chunk;
        if (onOutput) {
          onOutput(chunk, false);
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString('utf-8');
        stderr += chunk;
        if (onOutput) {
          onOutput(chunk, true);
        }
      });

      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        this.activeProcesses.delete(procKey);
        if (!isDone) {
          isDone = true;
          const completedAt = new Date();
          step.fail(err.message);
          resolve({
            stepId: step.id,
            name: step.name,
            command: step.command,
            status: 'failed',
            exitCode: 1,
            stdout,
            stderr: stderr + `\n${err.message}\n`,
            startedAt,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            error: err.message,
          });
        }
      });

      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        this.activeProcesses.delete(procKey);
        if (!isDone) {
          isDone = true;
          const completedAt = new Date();
          const exitCode = code ?? 0;
          step.complete(exitCode, stdout, stderr);
          resolve({
            stepId: step.id,
            name: step.name,
            command: step.command,
            status: exitCode === 0 ? 'success' : step.continueOnError ? 'success' : 'failed',
            exitCode,
            stdout,
            stderr,
            startedAt,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            error: exitCode !== 0 && !step.continueOnError ? `Exit code ${exitCode}` : undefined,
          });
        }
      });
    });
  }

  public async cleanupWorkspace(_context: WorkspaceContext): Promise<void> {
    // Optionally clean up build temporary workspace
  }

  public async cancelExecution(buildId: string): Promise<void> {
    for (const [key, proc] of this.activeProcesses.entries()) {
      if (key.startsWith(`${buildId}:`)) {
        this.killProcessTree(proc);
        this.activeProcesses.delete(key);
      }
    }
  }

  private killProcessTree(proc: child_process.ChildProcess): void {
    try {
      if (process.platform === 'win32' && proc.pid) {
        child_process.execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
      } else {
        proc.kill('SIGKILL');
      }
    } catch {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    }
  }
}

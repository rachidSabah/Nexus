import { spawn } from 'node:child_process';

import { type AgentTask } from '../domain/orchestration.js';

export interface AgentExecutionResult {
  readonly output: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface AgentExecutorPort {
  execute(
    task: AgentTask,
    agentExecutable: string,
    opts: { gatewayUrl: string; modelId: string }
  ): Promise<AgentExecutionResult>;
}

export class SubprocessAgentExecutor implements AgentExecutorPort {
  async execute(
    task: AgentTask,
    agentExecutable: string,
    opts: { gatewayUrl: string; modelId: string }
  ): Promise<AgentExecutionResult> {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      let stdout = '';
      let stderr = '';

      // Prepare command invocation with environment variables pointing to Nexus gateway
      const childEnv = {
        ...process.env,
        OPENAI_BASE_URL: opts.gatewayUrl,
        ANTHROPIC_BASE_URL: opts.gatewayUrl,
        NEXUS_TARGET_MODEL: opts.modelId,
      };

      const proc = spawn(agentExecutable, ['--help'], {
        cwd: task.workingDirectory || process.cwd(),
        env: childEnv,
        shell: isWin,
      });

      const timer = setTimeout(() => {
        proc.kill();
        resolve({
          output: `[TIMEOUT] Process execution exceeded ${task.timeoutMs}ms`,
          stdout,
          stderr: stderr + '\nProcess killed due to timeout',
          exitCode: 124,
        });
      }, task.timeoutMs || 60000);

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          output: stdout.trim() || stderr.trim() || `Agent process exited with code ${code}`,
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          output: `[ERROR] Failed to spawn agent process: ${err.message}`,
          stdout,
          stderr: err.message,
          exitCode: 1,
        });
      });
    });
  }
}

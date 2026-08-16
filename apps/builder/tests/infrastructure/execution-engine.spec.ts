import { describe, it, expect } from 'vitest';
import { LocalProcessExecutionAdapter } from '../../src/infrastructure/execution/local-process-execution.adapter.js';
import { PipelineStep } from '../../src/domain/models/step.js';

describe('LocalProcessExecutionAdapter', () => {
  const adapter = new LocalProcessExecutionAdapter('./.test-workspaces');

  it('should execute a simple echo command successfully', async () => {
    const step = new PipelineStep({
      id: 'step-echo',
      name: 'Echo Test',
      command: 'echo "BUILD_OK"',
    });

    const result = await adapter.executeStep({
      workspaceDir: process.cwd(),
      step,
      env: {},
      timeoutMs: 10000,
    });

    expect(result.status).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('BUILD_OK');
  });

  it('should report failure on invalid command execution', async () => {
    const step = new PipelineStep({
      id: 'step-fail',
      name: 'Fail Command',
      command: 'non_existent_command_12345_xyz',
    });

    const result = await adapter.executeStep({
      workspaceDir: process.cwd(),
      step,
      env: {},
      timeoutMs: 10000,
    });

    expect(result.status).toBe('failed');
    expect(result.exitCode).not.toBe(0);
  });
});

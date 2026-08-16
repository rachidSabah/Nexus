import { describe, it, expect } from 'vitest';
import { BuildJob } from '../../src/domain/models/build-job.js';
import { Artifact } from '../../src/domain/models/artifact.js';

describe('BuildJob Entity', () => {
  it('should initialize with queued state and steps', () => {
    const job = new BuildJob({
      id: 'build-1',
      projectId: 'proj-1',
      steps: [
        { id: 'step-1', name: 'Compile', command: 'tsc' },
        { id: 'step-2', name: 'Bundle', command: 'tsup' },
      ],
    });

    expect(job.status).toBe('queued');
    expect(job.steps.length).toBe(2);
    expect(job.logs).toEqual([]);
    expect(job.artifacts).toEqual([]);
  });

  it('should transition to running when started', () => {
    const job = new BuildJob({
      id: 'build-1',
      projectId: 'proj-1',
      steps: [{ id: 'step-1', name: 'Compile', command: 'tsc' }],
    });

    job.start('/workspace/path');
    expect(job.status).toBe('running');
    expect(job.workspacePath).toBe('/workspace/path');
    expect(job.startedAt).toBeInstanceOf(Date);
    expect(job.logs.length).toBeGreaterThan(0);
  });

  it('should complete build and record metrics and artifacts', () => {
    const job = new BuildJob({
      id: 'build-1',
      projectId: 'proj-1',
      steps: [{ id: 'step-1', name: 'Compile', command: 'tsc' }],
    });

    job.start();
    const artifact = new Artifact({
      id: 'art-1',
      buildId: 'build-1',
      projectId: 'proj-1',
      name: 'dist.zip',
      type: 'zip',
      path: '/path/dist.zip',
      sizeBytes: 1024,
    });

    job.complete([artifact]);
    expect(job.status).toBe('completed');
    expect(job.completedAt).toBeInstanceOf(Date);
    expect(job.artifacts.length).toBe(1);
    expect(job.metrics?.exitCode).toBe(0);
  });

  it('should fail properly when fail() is invoked', () => {
    const job = new BuildJob({
      id: 'build-1',
      projectId: 'proj-1',
      steps: [{ id: 'step-1', name: 'Compile', command: 'tsc' }],
    });

    job.start();
    job.fail('Syntax error in line 42', 1);

    expect(job.status).toBe('failed');
    expect(job.error).toBe('Syntax error in line 42');
    expect(job.metrics?.exitCode).toBe(1);
  });

  it('should cancel running build when cancel() is invoked', () => {
    const job = new BuildJob({
      id: 'build-1',
      projectId: 'proj-1',
      steps: [{ id: 'step-1', name: 'Compile', command: 'tsc' }],
    });

    job.start();
    job.cancel('User requested abort');

    expect(job.status).toBe('cancelled');
    expect(job.error).toBe('User requested abort');
  });
});

export type BuildStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped';

export type ArtifactType =
  | 'binary'
  | 'tarball'
  | 'zip'
  | 'directory'
  | 'docker_image'
  | 'manifest'
  | 'log'
  | 'coverage'
  | 'bundle';

export type ProjectFramework =
  | 'node'
  | 'typescript'
  | 'react'
  | 'nextjs'
  | 'python'
  | 'rust'
  | 'go'
  | 'custom';

export interface BuildEnvironment {
  [key: string]: string;
}

export interface BuildMetrics {
  durationMs: number;
  cpuUsagePercent?: number;
  memoryPeakBytes?: number;
  exitCode?: number;
}

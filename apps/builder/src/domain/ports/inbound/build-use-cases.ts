import { BuildJob } from '../../models/build-job.js';
import { StepConfig } from '../../models/step.js';
import { BuildStatus } from '../../models/types.js';
import { Artifact } from '../../models/artifact.js';

export interface TriggerBuildCommand {
  projectId: string;
  templateId?: string;
  commitHash?: string;
  branch?: string;
  customSteps?: StepConfig[];
  environmentOverrides?: Record<string, string>;
  workspaceDir?: string;
  timeoutMs?: number;
}

export interface ITriggerBuildUseCase {
  execute(command: TriggerBuildCommand): Promise<BuildJob>;
}

export interface IGetBuildUseCase {
  execute(buildId: string): Promise<BuildJob>;
}

export interface IListBuildsUseCase {
  execute(filters?: { projectId?: string; status?: BuildStatus; limit?: number; offset?: number }): Promise<{
    items: BuildJob[];
    total: number;
  }>;
}

export interface ICancelBuildUseCase {
  execute(buildId: string, reason?: string): Promise<BuildJob>;
}

export interface IGetBuildLogsUseCase {
  execute(buildId: string): Promise<{ buildId: string; logs: string[] }>;
}

export interface IListArtifactsUseCase {
  execute(buildId: string): Promise<Artifact[]>;
}

export interface IDownloadArtifactUseCase {
  execute(artifactId: string): Promise<{ artifact: Artifact; stream: NodeJS.ReadableStream }>;
}

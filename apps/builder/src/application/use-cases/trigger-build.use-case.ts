import { v4 as uuidv4 } from 'uuid';
import { BuildJob } from '../../domain/models/build-job.js';
import { StepConfig } from '../../domain/models/step.js';
import { IBuildRepository } from '../../domain/ports/outbound/build-repository.port.js';
import { IProjectRepository } from '../../domain/ports/outbound/project-repository.port.js';
import { IExecutionEnginePort } from '../../domain/ports/outbound/execution-engine.port.js';
import { IArtifactStoragePort } from '../../domain/ports/outbound/artifact-storage.port.js';
import { IEventPublisherPort } from '../../domain/ports/outbound/event-publisher.port.js';
import {
  ITriggerBuildUseCase,
  TriggerBuildCommand,
} from '../../domain/ports/inbound/build-use-cases.js';
import { ProjectNotFoundError } from '../../domain/errors/not-found.error.js';
import { ValidationError } from '../../domain/errors/domain-error.js';

export interface TriggerBuildDependencies {
  buildRepository: IBuildRepository;
  projectRepository: IProjectRepository;
  executionEngine: IExecutionEnginePort;
  artifactStorage: IArtifactStoragePort;
  eventPublisher: IEventPublisherPort;
  maxConcurrentBuilds: number;
  defaultTimeoutMs: number;
}

export class TriggerBuildUseCase implements ITriggerBuildUseCase {
  constructor(private readonly deps: TriggerBuildDependencies) {}

  public async execute(command: TriggerBuildCommand): Promise<BuildJob> {
    const project = await this.deps.projectRepository.findById(command.projectId);
    if (!project) {
      throw new ProjectNotFoundError(command.projectId);
    }

    let stepsToRun: StepConfig[] = [];

    if (command.customSteps && command.customSteps.length > 0) {
      stepsToRun = command.customSteps;
    } else if (project.defaultSteps && project.defaultSteps.length > 0) {
      stepsToRun = project.defaultSteps;
    } else {
      // Default fallback build step based on framework
      stepsToRun = this.getDefaultStepsForFramework(project.framework);
    }

    if (stepsToRun.length === 0) {
      throw new ValidationError('No build steps defined for project or build command');
    }

    const mergedEnv: Record<string, string> = {
      ...project.environment,
      ...(command.environmentOverrides || {}),
      PROJECT_ID: project.id,
      PROJECT_NAME: project.name,
      PROJECT_FRAMEWORK: project.framework,
    };

    const buildId = uuidv4();
    const buildJob = new BuildJob({
      id: buildId,
      projectId: project.id,
      projectName: project.name,
      commitHash: command.commitHash,
      branch: command.branch || project.branch,
      steps: stepsToRun,
      environment: mergedEnv,
      workspacePath: command.workspaceDir || project.rootDirectory,
    });

    await this.deps.buildRepository.save(buildJob);

    await this.deps.eventPublisher.publish({
      eventId: uuidv4(),
      eventType: 'build.created',
      timestamp: new Date(),
      buildId: buildJob.id,
      projectId: project.id,
    });

    // Asynchronously kick off the build execution loop
    this.runBuildPipeline(buildJob, command.timeoutMs || this.deps.defaultTimeoutMs).catch(
      (err) => {
        // pipeline logs already handled
        buildJob.appendLog(`Pipeline execution encountered unexpected error: ${err.message}`);
      }
    );

    return buildJob;
  }

  private async runBuildPipeline(job: BuildJob, timeoutMs: number): Promise<void> {
    const activeBuilds = await this.deps.buildRepository.findActiveBuilds();
    if (activeBuilds.length > this.deps.maxConcurrentBuilds) {
      job.appendLog('Waiting for available worker slot...');
    }

    const abortController = new AbortController();
    const timeoutTimer = setTimeout(() => {
      abortController.abort();
      job.timeout();
      this.deps.buildRepository.save(job);
      this.deps.eventPublisher.publish({
        eventId: uuidv4(),
        eventType: 'build.completed',
        timestamp: new Date(),
        buildId: job.id,
        projectId: job.projectId,
        status: 'timed_out',
        durationMs: timeoutMs,
        error: 'Build execution timed out',
      });
    }, timeoutMs);

    try {
      const workspaceContext = await this.deps.executionEngine.prepareWorkspace(job);
      job.start(workspaceContext.workspaceDir);
      await this.deps.buildRepository.save(job);

      await this.deps.eventPublisher.publish({
        eventId: uuidv4(),
        eventType: 'build.started',
        timestamp: new Date(),
        buildId: job.id,
        projectId: job.projectId,
        workspacePath: workspaceContext.workspaceDir,
      });

      let hasFailure = false;

      for (const step of job.steps) {
        if (abortController.signal.aborted || job.status !== 'running') {
          step.skip();
          continue;
        }

        step.start();
        await this.deps.eventPublisher.publish({
          eventId: uuidv4(),
          eventType: 'build.step.started',
          timestamp: new Date(),
          buildId: job.id,
          stepId: step.id,
          stepName: step.name,
          command: step.command,
        });

        job.appendLog(`[Step: ${step.name}] Running: ${step.command}`);

        const result = await this.deps.executionEngine.executeStep({
          workspaceDir: workspaceContext.workspaceDir,
          step,
          env: {
            ...job.environment,
            BUILD_ID: job.id,
            STEP_ID: step.id,
          },
          timeoutMs: step.timeoutMs || 120000,
          abortSignal: abortController.signal,
          onOutput: (chunk, isStderr) => {
            step.appendOutput(chunk, isStderr);
            this.deps.eventPublisher.publish({
              eventId: uuidv4(),
              eventType: 'build.step.output',
              timestamp: new Date(),
              buildId: job.id,
              stepId: step.id,
              chunk,
              isStderr,
            });
          },
        });

        await this.deps.eventPublisher.publish({
          eventId: uuidv4(),
          eventType: 'build.step.completed',
          timestamp: new Date(),
          buildId: job.id,
          stepId: step.id,
          stepName: step.name,
          status: result.status,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });

        if (result.status === 'failed') {
          hasFailure = true;
          job.appendLog(`[Step: ${step.name}] Failed with exit code ${result.exitCode}`);
          if (!step.continueOnError) {
            break;
          }
        } else {
          job.appendLog(`[Step: ${step.name}] Succeeded`);
        }
      }

      if (hasFailure) {
        job.fail('One or more pipeline steps failed');
      } else if (job.status === 'running') {
        job.complete();
      }

      await this.deps.buildRepository.save(job);
      await this.deps.executionEngine.cleanupWorkspace(workspaceContext);

      await this.deps.eventPublisher.publish({
        eventId: uuidv4(),
        eventType: 'build.completed',
        timestamp: new Date(),
        buildId: job.id,
        projectId: job.projectId,
        status: job.status,
        durationMs: job.metrics?.durationMs,
        error: job.error,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      job.fail(msg);
      await this.deps.buildRepository.save(job);
      await this.deps.eventPublisher.publish({
        eventId: uuidv4(),
        eventType: 'build.completed',
        timestamp: new Date(),
        buildId: job.id,
        projectId: job.projectId,
        status: 'failed',
        error: msg,
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  private getDefaultStepsForFramework(framework: string): StepConfig[] {
    switch (framework) {
      case 'node':
      case 'typescript':
        return [
          { id: 'install', name: 'Install Dependencies', command: 'npm install' },
          { id: 'build', name: 'Build Project', command: 'npm run build --if-present' },
          { id: 'test', name: 'Run Tests', command: 'npm test --if-present', continueOnError: true },
        ];
      case 'react':
      case 'nextjs':
        return [
          { id: 'install', name: 'Install Dependencies', command: 'npm install' },
          { id: 'build', name: 'Next/React Build', command: 'npm run build' },
        ];
      case 'python':
        return [
          { id: 'install', name: 'Install Requirements', command: 'pip install -r requirements.txt' },
          { id: 'test', name: 'Pytest Suite', command: 'pytest', continueOnError: true },
        ];
      case 'rust':
        return [
          { id: 'check', name: 'Cargo Check', command: 'cargo check' },
          { id: 'build', name: 'Cargo Build Release', command: 'cargo build --release' },
          { id: 'test', name: 'Cargo Test', command: 'cargo test', continueOnError: true },
        ];
      default:
        return [
          { id: 'echo', name: 'Echo Status', command: 'echo "Default pipeline executed"' },
        ];
    }
  }
}

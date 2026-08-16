import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryProjectRepository } from '../../src/infrastructure/persistence/memory-project.repository.js';
import { MemoryBuildRepository } from '../../src/infrastructure/persistence/memory-build.repository.js';
import { EventEmitterPublisherAdapter } from '../../src/infrastructure/events/event-emitter-publisher.adapter.js';
import { LocalArtifactStorageAdapter } from '../../src/infrastructure/storage/local-artifact-storage.adapter.js';
import { LocalProcessExecutionAdapter } from '../../src/infrastructure/execution/local-process-execution.adapter.js';
import { TriggerBuildUseCase } from '../../src/application/use-cases/trigger-build.use-case.js';
import { GetBuildUseCase } from '../../src/application/use-cases/get-build.use-case.js';
import { CancelBuildUseCase } from '../../src/application/use-cases/cancel-build.use-case.js';
import { ListBuildsUseCase } from '../../src/application/use-cases/list-builds.use-case.js';
import { GetBuildLogsUseCase } from '../../src/application/use-cases/get-build-logs.use-case.js';
import { Project } from '../../src/domain/models/project.js';

describe('Build Use Cases', () => {
  let projectRepo: MemoryProjectRepository;
  let buildRepo: MemoryBuildRepository;
  let eventPublisher: EventEmitterPublisherAdapter;
  let artifactStorage: LocalArtifactStorageAdapter;
  let executionEngine: LocalProcessExecutionAdapter;
  let triggerBuildUseCase: TriggerBuildUseCase;
  let getBuildUseCase: GetBuildUseCase;
  let cancelBuildUseCase: CancelBuildUseCase;
  let listBuildsUseCase: ListBuildsUseCase;
  let getBuildLogsUseCase: GetBuildLogsUseCase;
  let project: Project;

  beforeEach(async () => {
    projectRepo = new MemoryProjectRepository();
    buildRepo = new MemoryBuildRepository();
    eventPublisher = new EventEmitterPublisherAdapter();
    artifactStorage = new LocalArtifactStorageAdapter('./.test-artifacts');
    executionEngine = new LocalProcessExecutionAdapter('./.test-workspaces');

    triggerBuildUseCase = new TriggerBuildUseCase({
      buildRepository: buildRepo,
      projectRepository: projectRepo,
      executionEngine,
      artifactStorage,
      eventPublisher,
      maxConcurrentBuilds: 4,
      defaultTimeoutMs: 30000,
    });

    getBuildUseCase = new GetBuildUseCase(buildRepo);
    cancelBuildUseCase = new CancelBuildUseCase(buildRepo, executionEngine, eventPublisher);
    listBuildsUseCase = new ListBuildsUseCase(buildRepo);
    getBuildLogsUseCase = new GetBuildLogsUseCase(buildRepo);

    project = new Project({
      id: 'proj-test',
      name: 'Test Project',
      framework: 'typescript',
      defaultSteps: [{ id: 'step-echo', name: 'Echo', command: 'echo "Hello Nexus"' }],
    });
    await projectRepo.save(project);
  });

  it('should trigger and queue a build job', async () => {
    const job = await triggerBuildUseCase.execute({
      projectId: project.id,
      branch: 'main',
    });

    expect(job.id).toBeDefined();
    expect(job.projectId).toBe(project.id);
    expect(job.steps.length).toBe(1);

    const fetched = await getBuildUseCase.execute(job.id);
    expect(fetched.id).toBe(job.id);
  });

  it('should cancel a running/queued build job', async () => {
    const job = await triggerBuildUseCase.execute({
      projectId: project.id,
      customSteps: [{ id: 'step-sleep', name: 'Wait', command: 'node -e "setTimeout(()=>{}, 5000)"' }],
    });

    const cancelled = await cancelBuildUseCase.execute(job.id, 'User test cancellation');
    expect(cancelled.status).toBe('cancelled');
  });

  it('should list and paginate build jobs', async () => {
    await triggerBuildUseCase.execute({ projectId: project.id });
    await triggerBuildUseCase.execute({ projectId: project.id });

    const result = await listBuildsUseCase.execute({ projectId: project.id, limit: 10, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.items.length).toBe(2);
  });

  it('should retrieve build logs', async () => {
    const job = await triggerBuildUseCase.execute({ projectId: project.id });
    const logsResult = await getBuildLogsUseCase.execute(job.id);
    expect(logsResult.buildId).toBe(job.id);
    expect(Array.isArray(logsResult.logs)).toBe(true);
  });
});

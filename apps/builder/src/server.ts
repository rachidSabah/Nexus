import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { AppConfig } from './config/config.js';
import { MemoryProjectRepository } from './infrastructure/persistence/memory-project.repository.js';
import { FileProjectRepository } from './infrastructure/persistence/file-project.repository.js';
import { MemoryBuildRepository } from './infrastructure/persistence/memory-build.repository.js';
import { LocalArtifactStorageAdapter } from './infrastructure/storage/local-artifact-storage.adapter.js';
import { LocalProcessExecutionAdapter } from './infrastructure/execution/local-process-execution.adapter.js';
import { EventEmitterPublisherAdapter } from './infrastructure/events/event-emitter-publisher.adapter.js';
import { DEFAULT_BUILD_TEMPLATES } from './infrastructure/templates/default-templates.js';

import {
  CreateProjectUseCase,
  GetProjectUseCase,
  ListProjectsUseCase,
  DeleteProjectUseCase,
  TriggerBuildUseCase,
  GetBuildUseCase,
  ListBuildsUseCase,
  CancelBuildUseCase,
  GetBuildLogsUseCase,
  ListArtifactsUseCase,
  DownloadArtifactUseCase,
  TemplateCatalogUseCase,
} from './application/index.js';

import {
  ProjectController,
  BuildController,
  ArtifactController,
  TemplateController,
  HealthController,
  errorHandler,
  registerProjectRoutes,
  registerBuildRoutes,
  registerArtifactRoutes,
  registerTemplateRoutes,
  registerHealthRoutes,
} from './api/index.js';
import { IProjectRepository } from './domain/ports/outbound/project-repository.port.js';

export interface AppContainer {
  config: AppConfig;
  projectRepository: IProjectRepository;
  buildRepository: MemoryBuildRepository;
  artifactStorage: LocalArtifactStorageAdapter;
  executionEngine: LocalProcessExecutionAdapter;
  eventPublisher: EventEmitterPublisherAdapter;
  useCases: {
    createProject: CreateProjectUseCase;
    getProject: GetProjectUseCase;
    listProjects: ListProjectsUseCase;
    deleteProject: DeleteProjectUseCase;
    triggerBuild: TriggerBuildUseCase;
    getBuild: GetBuildUseCase;
    listBuilds: ListBuildsUseCase;
    cancelBuild: CancelBuildUseCase;
    getBuildLogs: GetBuildLogsUseCase;
    listArtifacts: ListArtifactsUseCase;
    downloadArtifact: DownloadArtifactUseCase;
    templateCatalog: TemplateCatalogUseCase;
  };
  controllers: {
    project: ProjectController;
    build: BuildController;
    artifact: ArtifactController;
    template: TemplateController;
    health: HealthController;
  };
}

export function createContainer(configOverrides?: Partial<AppConfig['values']>): AppContainer {
  const config = AppConfig.load(configOverrides);

  const projectRepository: IProjectRepository = config.values.ENABLE_FILE_PERSISTENCE
    ? new FileProjectRepository(config.values.PERSISTENCE_FILE_PATH)
    : new MemoryProjectRepository();

  const buildRepository = new MemoryBuildRepository();
  const artifactStorage = new LocalArtifactStorageAdapter(config.values.ARTIFACT_STORAGE_DIR);
  const executionEngine = new LocalProcessExecutionAdapter(config.values.WORKSPACE_ROOT);
  const eventPublisher = new EventEmitterPublisherAdapter();

  const createProject = new CreateProjectUseCase(projectRepository);
  const getProject = new GetProjectUseCase(projectRepository);
  const listProjects = new ListProjectsUseCase(projectRepository);
  const deleteProject = new DeleteProjectUseCase(projectRepository);

  const triggerBuild = new TriggerBuildUseCase({
    buildRepository,
    projectRepository,
    executionEngine,
    artifactStorage,
    eventPublisher,
    maxConcurrentBuilds: config.values.MAX_CONCURRENT_BUILDS,
    defaultTimeoutMs: config.values.DEFAULT_BUILD_TIMEOUT_MS,
  });

  const getBuild = new GetBuildUseCase(buildRepository);
  const listBuilds = new ListBuildsUseCase(buildRepository);
  const cancelBuild = new CancelBuildUseCase(buildRepository, executionEngine, eventPublisher);
  const getBuildLogs = new GetBuildLogsUseCase(buildRepository);
  const listArtifacts = new ListArtifactsUseCase(artifactStorage, buildRepository);
  const downloadArtifact = new DownloadArtifactUseCase(artifactStorage);
  const templateCatalog = new TemplateCatalogUseCase(DEFAULT_BUILD_TEMPLATES);

  const projectController = new ProjectController(
    createProject,
    getProject,
    listProjects,
    deleteProject
  );
  const buildController = new BuildController(
    triggerBuild,
    getBuild,
    listBuilds,
    cancelBuild,
    getBuildLogs
  );
  const artifactController = new ArtifactController(listArtifacts, downloadArtifact);
  const templateController = new TemplateController(templateCatalog);
  const healthController = new HealthController(projectRepository, buildRepository);

  return {
    config,
    projectRepository,
    buildRepository,
    artifactStorage,
    executionEngine,
    eventPublisher,
    useCases: {
      createProject,
      getProject,
      listProjects,
      deleteProject,
      triggerBuild,
      getBuild,
      listBuilds,
      cancelBuild,
      getBuildLogs,
      listArtifacts,
      downloadArtifact,
      templateCatalog,
    },
    controllers: {
      project: projectController,
      build: buildController,
      artifact: artifactController,
      template: templateController,
      health: healthController,
    },
  };
}

export async function createServer(container?: AppContainer): Promise<{
  app: FastifyInstance;
  container: AppContainer;
}> {
  const currentContainer = container || createContainer();
  const { config, controllers } = currentContainer;

  const app = Fastify({
    logger: {
      level: config.values.LOG_LEVEL,
    },
    disableRequestLogging: config.values.NODE_ENV === 'test',
  });

  await app.register(cors, {
    origin: config.values.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  app.setErrorHandler(errorHandler);

  registerHealthRoutes(app, controllers.health);
  registerProjectRoutes(app, controllers.project);
  registerBuildRoutes(app, controllers.build);
  registerArtifactRoutes(app, controllers.artifact);
  registerTemplateRoutes(app, controllers.template);

  return { app, container: currentContainer };
}

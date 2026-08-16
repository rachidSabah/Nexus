import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryProjectRepository } from '../../src/infrastructure/persistence/memory-project.repository.js';
import { CreateProjectUseCase } from '../../src/application/use-cases/create-project.use-case.js';
import { GetProjectUseCase } from '../../src/application/use-cases/get-project.use-case.js';
import { ListProjectsUseCase } from '../../src/application/use-cases/list-projects.use-case.js';
import { DeleteProjectUseCase } from '../../src/application/use-cases/delete-project.use-case.js';
import { ValidationError } from '../../src/domain/errors/domain-error.js';
import { ProjectNotFoundError } from '../../src/domain/errors/not-found.error.js';

describe('Project Use Cases', () => {
  let projectRepo: MemoryProjectRepository;
  let createProjectUseCase: CreateProjectUseCase;
  let getProjectUseCase: GetProjectUseCase;
  let listProjectsUseCase: ListProjectsUseCase;
  let deleteProjectUseCase: DeleteProjectUseCase;

  beforeEach(() => {
    projectRepo = new MemoryProjectRepository();
    createProjectUseCase = new CreateProjectUseCase(projectRepo);
    getProjectUseCase = new GetProjectUseCase(projectRepo);
    listProjectsUseCase = new ListProjectsUseCase(projectRepo);
    deleteProjectUseCase = new DeleteProjectUseCase(projectRepo);
  });

  it('should create a project successfully', async () => {
    const project = await createProjectUseCase.execute({
      name: 'AgentNexus Gateway',
      framework: 'typescript',
      description: 'Universal Gateway',
    });

    expect(project.id).toBeDefined();
    expect(project.name).toBe('AgentNexus Gateway');
    expect(project.framework).toBe('typescript');

    const retrieved = await getProjectUseCase.execute(project.id);
    expect(retrieved.id).toBe(project.id);
  });

  it('should reject creating duplicate project names', async () => {
    await createProjectUseCase.execute({
      name: 'UniqueApp',
      framework: 'node',
    });

    await expect(
      createProjectUseCase.execute({
        name: 'UniqueApp',
        framework: 'node',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should throw ProjectNotFoundError when fetching non-existent project', async () => {
    await expect(getProjectUseCase.execute('non-existent-id')).rejects.toThrow(ProjectNotFoundError);
  });

  it('should list all created projects', async () => {
    await createProjectUseCase.execute({ name: 'Proj1', framework: 'node' });
    await createProjectUseCase.execute({ name: 'Proj2', framework: 'python' });

    const list = await listProjectsUseCase.execute();
    expect(list.length).toBe(2);
  });

  it('should delete project by id', async () => {
    const project = await createProjectUseCase.execute({ name: 'To Delete', framework: 'custom' });
    const result = await deleteProjectUseCase.execute(project.id);
    expect(result).toBe(true);

    await expect(getProjectUseCase.execute(project.id)).rejects.toThrow(ProjectNotFoundError);
  });
});

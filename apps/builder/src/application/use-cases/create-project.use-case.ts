import { v4 as uuidv4 } from 'uuid';
import { Project } from '../../domain/models/project.js';
import { IProjectRepository } from '../../domain/ports/outbound/project-repository.port.js';
import {
  CreateProjectCommand,
  ICreateProjectUseCase,
} from '../../domain/ports/inbound/project-use-cases.js';
import { ValidationError } from '../../domain/errors/domain-error.js';

export class CreateProjectUseCase implements ICreateProjectUseCase {
  constructor(private readonly projectRepository: IProjectRepository) {}

  public async execute(command: CreateProjectCommand): Promise<Project> {
    if (!command.name || command.name.trim().length === 0) {
      throw new ValidationError('Project name is required');
    }

    const existing = await this.projectRepository.findByName(command.name.trim());
    if (existing) {
      throw new ValidationError(`Project with name '${command.name}' already exists`);
    }

    const project = new Project({
      id: uuidv4(),
      name: command.name.trim(),
      description: command.description,
      repositoryUrl: command.repositoryUrl,
      branch: command.branch || 'main',
      framework: command.framework,
      rootDirectory: command.rootDirectory,
      defaultSteps: command.defaultSteps || [],
      environment: command.environment || {},
    });

    await this.projectRepository.save(project);
    return project;
  }
}

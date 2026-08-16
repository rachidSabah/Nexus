import { Project } from '../../domain/models/project.js';
import { IProjectRepository } from '../../domain/ports/outbound/project-repository.port.js';
import { IGetProjectUseCase } from '../../domain/ports/inbound/project-use-cases.js';
import { ProjectNotFoundError } from '../../domain/errors/not-found.error.js';

export class GetProjectUseCase implements IGetProjectUseCase {
  constructor(private readonly projectRepository: IProjectRepository) {}

  public async execute(projectId: string): Promise<Project> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }
}

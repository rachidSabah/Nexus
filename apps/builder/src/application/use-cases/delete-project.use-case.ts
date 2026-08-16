import { IProjectRepository } from '../../domain/ports/outbound/project-repository.port.js';
import { IDeleteProjectUseCase } from '../../domain/ports/inbound/project-use-cases.js';
import { ProjectNotFoundError } from '../../domain/errors/not-found.error.js';

export class DeleteProjectUseCase implements IDeleteProjectUseCase {
  constructor(private readonly projectRepository: IProjectRepository) {}

  public async execute(projectId: string): Promise<boolean> {
    const exists = await this.projectRepository.exists(projectId);
    if (!exists) {
      throw new ProjectNotFoundError(projectId);
    }
    return this.projectRepository.delete(projectId);
  }
}

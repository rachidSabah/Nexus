import { Project } from '../../domain/models/project.js';
import { IProjectRepository } from '../../domain/ports/outbound/project-repository.port.js';
import { IListProjectsUseCase } from '../../domain/ports/inbound/project-use-cases.js';

export class ListProjectsUseCase implements IListProjectsUseCase {
  constructor(private readonly projectRepository: IProjectRepository) {}

  public async execute(): Promise<Project[]> {
    return this.projectRepository.findAll();
  }
}

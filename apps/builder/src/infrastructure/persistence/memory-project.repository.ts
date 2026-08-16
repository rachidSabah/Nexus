import { Project } from '../../domain/models/project.js';
import { IProjectRepository } from '../../domain/ports/outbound/project-repository.port.js';

export class MemoryProjectRepository implements IProjectRepository {
  private readonly projects = new Map<string, Project>();

  public async save(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }

  public async findById(id: string): Promise<Project | null> {
    return this.projects.get(id) || null;
  }

  public async findByName(name: string): Promise<Project | null> {
    for (const project of this.projects.values()) {
      if (project.name.toLowerCase() === name.toLowerCase()) {
        return project;
      }
    }
    return null;
  }

  public async findAll(): Promise<Project[]> {
    return Array.from(this.projects.values());
  }

  public async delete(id: string): Promise<boolean> {
    return this.projects.delete(id);
  }

  public async exists(id: string): Promise<boolean> {
    return this.projects.has(id);
  }

  public clear(): void {
    this.projects.clear();
  }
}

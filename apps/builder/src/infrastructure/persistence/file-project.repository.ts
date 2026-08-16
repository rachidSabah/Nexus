import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Project, ProjectProps } from '../../domain/models/project.js';
import { IProjectRepository } from '../../domain/ports/outbound/project-repository.port.js';

export class FileProjectRepository implements IProjectRepository {
  private readonly filePath: string;
  private cache: Map<string, Project> = new Map();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed: ProjectProps[] = JSON.parse(data);
      this.cache = new Map(
        parsed.map((p) => [
          p.id,
          new Project({
            ...p,
            createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
            updatedAt: p.updatedAt ? new Date(p.updatedAt) : undefined,
          }),
        ])
      );
    } catch {
      this.cache = new Map();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const list = Array.from(this.cache.values()).map((p) => p.toJSON());
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
  }

  public async save(project: Project): Promise<void> {
    await this.ensureLoaded();
    this.cache.set(project.id, project);
    await this.persist();
  }

  public async findById(id: string): Promise<Project | null> {
    await this.ensureLoaded();
    return this.cache.get(id) || null;
  }

  public async findByName(name: string): Promise<Project | null> {
    await this.ensureLoaded();
    for (const project of this.cache.values()) {
      if (project.name.toLowerCase() === name.toLowerCase()) {
        return project;
      }
    }
    return null;
  }

  public async findAll(): Promise<Project[]> {
    await this.ensureLoaded();
    return Array.from(this.cache.values());
  }

  public async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const removed = this.cache.delete(id);
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  public async exists(id: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.cache.has(id);
  }
}

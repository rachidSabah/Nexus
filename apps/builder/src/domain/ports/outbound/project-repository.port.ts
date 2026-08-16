import { Project } from '../../models/project.js';

export interface IProjectRepository {
  save(project: Project): Promise<void>;
  findById(id: string): Promise<Project | null>;
  findByName(name: string): Promise<Project | null>;
  findAll(): Promise<Project[]>;
  delete(id: string): Promise<boolean>;
  exists(id: string): Promise<boolean>;
}

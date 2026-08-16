import { Project, ProjectProps } from '../../models/project.js';

export interface CreateProjectCommand {
  name: string;
  description?: string;
  repositoryUrl?: string;
  branch?: string;
  framework: ProjectProps['framework'];
  rootDirectory?: string;
  defaultSteps?: ProjectProps['defaultSteps'];
  environment?: Record<string, string>;
}

export interface UpdateProjectCommand {
  id: string;
  name?: string;
  description?: string;
  repositoryUrl?: string;
  branch?: string;
  framework?: ProjectProps['framework'];
  rootDirectory?: string;
  defaultSteps?: ProjectProps['defaultSteps'];
  environment?: Record<string, string>;
}

export interface ICreateProjectUseCase {
  execute(command: CreateProjectCommand): Promise<Project>;
}

export interface IGetProjectUseCase {
  execute(projectId: string): Promise<Project>;
}

export interface IListProjectsUseCase {
  execute(): Promise<Project[]>;
}

export interface IUpdateProjectUseCase {
  execute(command: UpdateProjectCommand): Promise<Project>;
}

export interface IDeleteProjectUseCase {
  execute(projectId: string): Promise<boolean>;
}

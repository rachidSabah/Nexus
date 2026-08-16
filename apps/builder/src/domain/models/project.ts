import { ProjectFramework } from './types.js';
import { StepConfig } from './step.js';

export interface ProjectProps {
  id: string;
  name: string;
  description?: string;
  repositoryUrl?: string;
  branch?: string;
  framework: ProjectFramework;
  rootDirectory?: string;
  defaultSteps?: StepConfig[];
  environment?: Record<string, string>;
  createdAt?: Date;
  updatedAt?: Date;
}

export class Project {
  public readonly id: string;
  public name: string;
  public description: string;
  public repositoryUrl?: string;
  public branch: string;
  public framework: ProjectFramework;
  public rootDirectory?: string;
  public defaultSteps: StepConfig[];
  public environment: Record<string, string>;
  public readonly createdAt: Date;
  public updatedAt: Date;

  constructor(props: ProjectProps) {
    this.id = props.id;
    this.name = props.name;
    this.description = props.description || '';
    this.repositoryUrl = props.repositoryUrl;
    this.branch = props.branch || 'main';
    this.framework = props.framework;
    this.rootDirectory = props.rootDirectory;
    this.defaultSteps = props.defaultSteps || [];
    this.environment = props.environment || {};
    this.createdAt = props.createdAt || new Date();
    this.updatedAt = props.updatedAt || new Date();
  }

  public update(props: Partial<Omit<ProjectProps, 'id' | 'createdAt'>>): void {
    if (props.name !== undefined) this.name = props.name;
    if (props.description !== undefined) this.description = props.description;
    if (props.repositoryUrl !== undefined) this.repositoryUrl = props.repositoryUrl;
    if (props.branch !== undefined) this.branch = props.branch;
    if (props.framework !== undefined) this.framework = props.framework;
    if (props.rootDirectory !== undefined) this.rootDirectory = props.rootDirectory;
    if (props.defaultSteps !== undefined) this.defaultSteps = props.defaultSteps;
    if (props.environment !== undefined) this.environment = props.environment;
    this.updatedAt = new Date();
  }

  public toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      repositoryUrl: this.repositoryUrl,
      branch: this.branch,
      framework: this.framework,
      rootDirectory: this.rootDirectory,
      defaultSteps: this.defaultSteps,
      environment: this.environment,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}

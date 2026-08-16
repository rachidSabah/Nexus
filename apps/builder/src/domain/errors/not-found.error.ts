import { DomainError } from './domain-error.js';

export class NotFoundError extends DomainError {
  public readonly statusCode = 404;
  public readonly errorCode = 'RESOURCE_NOT_FOUND';

  constructor(resource: string, id?: string) {
    super(id ? `${resource} with ID '${id}' was not found.` : `${resource} not found.`);
  }
}

export class ProjectNotFoundError extends NotFoundError {
  constructor(projectId: string) {
    super('Project', projectId);
  }
}

export class BuildJobNotFoundError extends NotFoundError {
  constructor(buildId: string) {
    super('BuildJob', buildId);
  }
}

export class ArtifactNotFoundError extends NotFoundError {
  constructor(artifactId: string) {
    super('Artifact', artifactId);
  }
}

export class TemplateNotFoundError extends NotFoundError {
  constructor(templateId: string) {
    super('Template', templateId);
  }
}

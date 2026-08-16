import { describe, it, expect } from 'vitest';
import { Project } from '../../src/domain/models/project.js';

describe('Project Entity', () => {
  it('should initialize a project with correct defaults', () => {
    const project = new Project({
      id: 'proj-123',
      name: 'Nexus Engine',
      framework: 'typescript',
    });

    expect(project.id).toBe('proj-123');
    expect(project.name).toBe('Nexus Engine');
    expect(project.branch).toBe('main');
    expect(project.framework).toBe('typescript');
    expect(project.defaultSteps).toEqual([]);
    expect(project.environment).toEqual({});
    expect(project.createdAt).toBeInstanceOf(Date);
  });

  it('should allow updating project properties and update timestamp', () => {
    const project = new Project({
      id: 'proj-123',
      name: 'Old Name',
      framework: 'node',
    });

    const originalUpdatedAt = project.updatedAt;
    project.update({ name: 'New Name', branch: 'develop' });

    expect(project.name).toBe('New Name');
    expect(project.branch).toBe('develop');
    expect(project.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
  });

  it('should serialize to JSON properly', () => {
    const project = new Project({
      id: 'proj-123',
      name: 'Nexus Engine',
      framework: 'typescript',
      description: 'Core gateway',
    });

    const json = project.toJSON();
    expect(json.id).toBe('proj-123');
    expect(json.name).toBe('Nexus Engine');
    expect(json.description).toBe('Core gateway');
    expect(json.framework).toBe('typescript');
  });
});

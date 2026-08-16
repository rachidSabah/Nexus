import { BuildJob } from '../../domain/models/build-job.js';
import {
  BuildQueryFilters,
  IBuildRepository,
} from '../../domain/ports/outbound/build-repository.port.js';

export class MemoryBuildRepository implements IBuildRepository {
  private readonly builds = new Map<string, BuildJob>();

  public async save(job: BuildJob): Promise<void> {
    this.builds.set(job.id, job);
  }

  public async findById(id: string): Promise<BuildJob | null> {
    return this.builds.get(id) || null;
  }

  public async findMany(filters?: BuildQueryFilters): Promise<BuildJob[]> {
    let result = Array.from(this.builds.values());

    if (filters?.projectId) {
      result = result.filter((b) => b.projectId === filters.projectId);
    }
    if (filters?.status) {
      result = result.filter((b) => b.status === filters.status);
    }

    result.sort((a, b) => b.queuedAt.getTime() - a.queuedAt.getTime());

    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;

    return result.slice(offset, offset + limit);
  }

  public async count(filters?: BuildQueryFilters): Promise<number> {
    let result = Array.from(this.builds.values());

    if (filters?.projectId) {
      result = result.filter((b) => b.projectId === filters.projectId);
    }
    if (filters?.status) {
      result = result.filter((b) => b.status === filters.status);
    }

    return result.length;
  }

  public async delete(id: string): Promise<boolean> {
    return this.builds.delete(id);
  }

  public async findActiveBuilds(): Promise<BuildJob[]> {
    return Array.from(this.builds.values()).filter(
      (b) => b.status === 'running' || b.status === 'queued'
    );
  }

  public clear(): void {
    this.builds.clear();
  }
}

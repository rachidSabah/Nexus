import { BuildJob } from '../../models/build-job.js';
import { BuildStatus } from '../../models/types.js';

export interface BuildQueryFilters {
  projectId?: string;
  status?: BuildStatus;
  limit?: number;
  offset?: number;
}

export interface IBuildRepository {
  save(job: BuildJob): Promise<void>;
  findById(id: string): Promise<BuildJob | null>;
  findMany(filters?: BuildQueryFilters): Promise<BuildJob[]>;
  count(filters?: BuildQueryFilters): Promise<number>;
  delete(id: string): Promise<boolean>;
  findActiveBuilds(): Promise<BuildJob[]>;
}

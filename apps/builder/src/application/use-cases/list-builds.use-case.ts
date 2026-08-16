import { BuildJob } from '../../domain/models/build-job.js';
import { BuildStatus } from '../../domain/models/types.js';
import { IBuildRepository } from '../../domain/ports/outbound/build-repository.port.js';
import { IListBuildsUseCase } from '../../domain/ports/inbound/build-use-cases.js';

export interface ListBuildsFilter {
  projectId?: string;
  status?: BuildStatus;
  limit?: number;
  offset?: number;
}

export class ListBuildsUseCase implements IListBuildsUseCase {
  constructor(private readonly buildRepository: IBuildRepository) {}

  public async execute(filters?: ListBuildsFilter): Promise<{ items: BuildJob[]; total: number }> {
    const items = await this.buildRepository.findMany(filters);
    const total = await this.buildRepository.count(filters);
    return { items, total };
  }
}

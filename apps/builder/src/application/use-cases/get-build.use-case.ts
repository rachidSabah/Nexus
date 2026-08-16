import { BuildJob } from '../../domain/models/build-job.js';
import { IBuildRepository } from '../../domain/ports/outbound/build-repository.port.js';
import { IGetBuildUseCase } from '../../domain/ports/inbound/build-use-cases.js';
import { BuildJobNotFoundError } from '../../domain/errors/not-found.error.js';

export class GetBuildUseCase implements IGetBuildUseCase {
  constructor(private readonly buildRepository: IBuildRepository) {}

  public async execute(buildId: string): Promise<BuildJob> {
    const job = await this.buildRepository.findById(buildId);
    if (!job) {
      throw new BuildJobNotFoundError(buildId);
    }
    return job;
  }
}

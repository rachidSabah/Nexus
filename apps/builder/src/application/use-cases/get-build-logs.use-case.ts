import { IBuildRepository } from '../../domain/ports/outbound/build-repository.port.js';
import { IGetBuildLogsUseCase } from '../../domain/ports/inbound/build-use-cases.js';
import { BuildJobNotFoundError } from '../../domain/errors/not-found.error.js';

export class GetBuildLogsUseCase implements IGetBuildLogsUseCase {
  constructor(private readonly buildRepository: IBuildRepository) {}

  public async execute(buildId: string): Promise<{ buildId: string; logs: string[] }> {
    const job = await this.buildRepository.findById(buildId);
    if (!job) {
      throw new BuildJobNotFoundError(buildId);
    }
    return {
      buildId: job.id,
      logs: job.logs,
    };
  }
}

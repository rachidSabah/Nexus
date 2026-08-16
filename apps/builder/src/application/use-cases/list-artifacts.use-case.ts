import { Artifact } from '../../domain/models/artifact.js';
import { IArtifactStoragePort } from '../../domain/ports/outbound/artifact-storage.port.js';
import { IBuildRepository } from '../../domain/ports/outbound/build-repository.port.js';
import { IListArtifactsUseCase } from '../../domain/ports/inbound/build-use-cases.js';
import { BuildJobNotFoundError } from '../../domain/errors/not-found.error.js';

export class ListArtifactsUseCase implements IListArtifactsUseCase {
  constructor(
    private readonly artifactStorage: IArtifactStoragePort,
    private readonly buildRepository: IBuildRepository
  ) {}

  public async execute(buildId: string): Promise<Artifact[]> {
    const job = await this.buildRepository.findById(buildId);
    if (!job) {
      throw new BuildJobNotFoundError(buildId);
    }
    return this.artifactStorage.listByBuildId(buildId);
  }
}

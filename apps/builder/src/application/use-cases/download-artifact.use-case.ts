import { Artifact } from '../../domain/models/artifact.js';
import { IArtifactStoragePort } from '../../domain/ports/outbound/artifact-storage.port.js';
import { IDownloadArtifactUseCase } from '../../domain/ports/inbound/build-use-cases.js';
import { ArtifactNotFoundError } from '../../domain/errors/not-found.error.js';

export class DownloadArtifactUseCase implements IDownloadArtifactUseCase {
  constructor(private readonly artifactStorage: IArtifactStoragePort) {}

  public async execute(artifactId: string): Promise<{ artifact: Artifact; stream: NodeJS.ReadableStream }> {
    const artifact = await this.artifactStorage.get(artifactId);
    if (!artifact) {
      throw new ArtifactNotFoundError(artifactId);
    }
    const stream = await this.artifactStorage.getReadStream(artifactId);
    return { artifact, stream };
  }
}

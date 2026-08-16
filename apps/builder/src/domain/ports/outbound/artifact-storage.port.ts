import { Readable } from 'node:stream';
import { Artifact, ArtifactProps } from '../../models/artifact.js';

export interface StoreArtifactInput {
  buildId: string;
  projectId: string;
  name: string;
  sourcePathOrBuffer: string | Buffer;
  type: ArtifactProps['type'];
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface IArtifactStoragePort {
  store(input: StoreArtifactInput): Promise<Artifact>;
  get(artifactId: string): Promise<Artifact | null>;
  listByBuildId(buildId: string): Promise<Artifact[]>;
  getReadStream(artifactId: string): Promise<Readable>;
  delete(artifactId: string): Promise<boolean>;
  deleteByBuildId(buildId: string): Promise<number>;
}

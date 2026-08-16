import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Readable } from 'node:stream';
const uuidv4 = () => crypto.randomUUID();
import { Artifact } from '../../domain/models/artifact.js';
import {
  IArtifactStoragePort,
  StoreArtifactInput,
} from '../../domain/ports/outbound/artifact-storage.port.js';
import { ArtifactNotFoundError } from '../../domain/errors/not-found.error.js';

export class LocalArtifactStorageAdapter implements IArtifactStoragePort {
  private readonly baseDir: string;
  private readonly metadataMap = new Map<string, Artifact>();

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  public async init(): Promise<void> {
    await fsp.mkdir(this.baseDir, { recursive: true });
  }

  public async store(input: StoreArtifactInput): Promise<Artifact> {
    await this.init();
    const artifactId = uuidv4();
    const targetDir = path.join(this.baseDir, input.projectId, input.buildId);
    await fsp.mkdir(targetDir, { recursive: true });

    const safeName = path.basename(input.name);
    const targetPath = path.join(targetDir, `${artifactId}-${safeName}`);

    let sizeBytes = 0;
    let sha256 = '';

    if (Buffer.isBuffer(input.sourcePathOrBuffer)) {
      await fsp.writeFile(targetPath, input.sourcePathOrBuffer);
      sizeBytes = input.sourcePathOrBuffer.length;
      sha256 = crypto.createHash('sha256').update(input.sourcePathOrBuffer).digest('hex');
    } else if (typeof input.sourcePathOrBuffer === 'string') {
      const sourceExists = fs.existsSync(input.sourcePathOrBuffer);
      if (sourceExists) {
        const stat = await fsp.stat(input.sourcePathOrBuffer);
        if (stat.isFile()) {
          await fsp.copyFile(input.sourcePathOrBuffer, targetPath);
          sizeBytes = stat.size;
          const content = await fsp.readFile(targetPath);
          sha256 = crypto.createHash('sha256').update(content).digest('hex');
        } else {
          // If it's a directory, record the path
          sizeBytes = 0;
        }
      } else {
        // Create an empty placeholder file
        await fsp.writeFile(targetPath, '');
        sizeBytes = 0;
      }
    }

    const artifact = new Artifact({
      id: artifactId,
      buildId: input.buildId,
      projectId: input.projectId,
      name: input.name,
      type: input.type,
      path: targetPath,
      sizeBytes,
      sha256,
      mimeType: input.mimeType || 'application/octet-stream',
      metadata: input.metadata,
      createdAt: new Date(),
    });

    this.metadataMap.set(artifactId, artifact);
    return artifact;
  }

  public async get(artifactId: string): Promise<Artifact | null> {
    return this.metadataMap.get(artifactId) || null;
  }

  public async listByBuildId(buildId: string): Promise<Artifact[]> {
    return Array.from(this.metadataMap.values()).filter((a) => a.buildId === buildId);
  }

  public async getReadStream(artifactId: string): Promise<Readable> {
    const artifact = await this.get(artifactId);
    if (!artifact) {
      throw new ArtifactNotFoundError(artifactId);
    }

    if (!fs.existsSync(artifact.path)) {
      throw new ArtifactNotFoundError(`Physical file missing for artifact ${artifactId}`);
    }

    return fs.createReadStream(artifact.path);
  }

  public async delete(artifactId: string): Promise<boolean> {
    const artifact = this.metadataMap.get(artifactId);
    if (!artifact) return false;

    try {
      if (fs.existsSync(artifact.path)) {
        await fsp.unlink(artifact.path);
      }
    } catch {
      // ignore unlink errors
    }

    return this.metadataMap.delete(artifactId);
  }

  public async deleteByBuildId(buildId: string): Promise<number> {
    const artifacts = await this.listByBuildId(buildId);
    let count = 0;
    for (const art of artifacts) {
      const deleted = await this.delete(art.id);
      if (deleted) count++;
    }
    return count;
  }
}

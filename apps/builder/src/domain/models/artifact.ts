import { ArtifactType } from './types.js';

export interface ArtifactProps {
  id: string;
  buildId: string;
  projectId: string;
  name: string;
  type: ArtifactType;
  path: string;
  sizeBytes: number;
  sha256?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export class Artifact {
  public readonly id: string;
  public readonly buildId: string;
  public readonly projectId: string;
  public readonly name: string;
  public readonly type: ArtifactType;
  public readonly path: string;
  public readonly sizeBytes: number;
  public readonly sha256?: string;
  public readonly mimeType: string;
  public readonly metadata: Record<string, unknown>;
  public readonly createdAt: Date;

  constructor(props: ArtifactProps) {
    this.id = props.id;
    this.buildId = props.buildId;
    this.projectId = props.projectId;
    this.name = props.name;
    this.type = props.type;
    this.path = props.path;
    this.sizeBytes = props.sizeBytes;
    this.sha256 = props.sha256;
    this.mimeType = props.mimeType || 'application/octet-stream';
    this.metadata = props.metadata ?? {};
    this.createdAt = props.createdAt || new Date();
  }

  public toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      buildId: this.buildId,
      projectId: this.projectId,
      name: this.name,
      type: this.type,
      path: this.path,
      sizeBytes: this.sizeBytes,
      sha256: this.sha256,
      mimeType: this.mimeType,
      metadata: this.metadata,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

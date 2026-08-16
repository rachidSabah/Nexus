import { describe, it, expect, afterAll } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { LocalArtifactStorageAdapter } from '../../src/infrastructure/storage/local-artifact-storage.adapter.js';

describe('LocalArtifactStorageAdapter', () => {
  const testStorageDir = path.resolve('./.test-storage-tmp');
  const adapter = new LocalArtifactStorageAdapter(testStorageDir);

  afterAll(async () => {
    try {
      await fsp.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should store a buffer artifact and compute sha256', async () => {
    const buffer = Buffer.from('Nexus Build Artifact Content 123');
    const artifact = await adapter.store({
      buildId: 'build-abc',
      projectId: 'proj-xyz',
      name: 'bundle.js',
      sourcePathOrBuffer: buffer,
      type: 'bundle',
      mimeType: 'application/javascript',
    });

    expect(artifact.id).toBeDefined();
    expect(artifact.name).toBe('bundle.js');
    expect(artifact.sizeBytes).toBe(buffer.length);
    expect(artifact.sha256).toBeDefined();
    expect(artifact.sha256?.length).toBe(64);

    const list = await adapter.listByBuildId('build-abc');
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(artifact.id);
  });

  it('should read stored artifact as stream', async () => {
    const buffer = Buffer.from('Streaming Artifact Test Content');
    const artifact = await adapter.store({
      buildId: 'build-stream',
      projectId: 'proj-stream',
      name: 'stream-test.txt',
      sourcePathOrBuffer: buffer,
      type: 'log',
    });

    const stream = await adapter.getReadStream(artifact.id);
    let collected = '';
    for await (const chunk of stream) {
      collected += chunk.toString('utf-8');
    }

    expect(collected).toBe('Streaming Artifact Test Content');
  });
});

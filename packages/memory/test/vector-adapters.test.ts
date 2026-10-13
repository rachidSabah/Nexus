import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryEventBus } from '@anx/core';
import {
  LocalFileVectorStoreAdapter,
  PgVectorStoreAdapter,
  PineconeVectorStoreAdapter,
  WeaviateVectorStoreAdapter,
  SessionMemory,
  UserMemory,
  AgentMemory,
  DefaultMemory,
  InMemoryVectorStore,
  FakeEmbeddingsProvider,
} from '../src/index.js';

describe('Vector Store Adapters & Memory Primitives', () => {
  it('LocalFileVectorStoreAdapter upserts and searches by cosine similarity', async () => {
    const file = join(tmpdir(), `vec-test-${Date.now()}.json`);
    const store = new LocalFileVectorStoreAdapter(file);

    await store.upsert({
      id: 'doc-1',
      namespace: 'test-ns',
      scope: 'long',
      contentType: 'text',
      content: 'TypeScript and Node.js backend guide',
      embedding: [1, 0, 0],
      metadata: {},
      createdAt: new Date(),
      tokenCount: 10,
    });

    const searchHits = await store.search([0.9, 0.1, 0], {
      namespace: 'test-ns',
      limit: 2,
      threshold: 0.8,
    });

    expect(searchHits.length).toBe(1);
    expect(searchHits[0]?.record.id).toBe('doc-1');
    expect(searchHits[0]?.score).toBeGreaterThan(0.9);
  });

  it('PgVectorStoreAdapter, Pinecone and Weaviate adapters conform to VectorStorePort', async () => {
    const pg = new PgVectorStoreAdapter();
    const pinecone = new PineconeVectorStoreAdapter();
    const weaviate = new WeaviateVectorStoreAdapter();

    for (const adapter of [pg, pinecone, weaviate]) {
      await adapter.upsert({
        id: 'rec-1',
        namespace: 'common',
        scope: 'long',
        contentType: 'text',
        content: 'Vector record test',
        embedding: [0, 1, 0],
        metadata: {},
        createdAt: new Date(),
        tokenCount: 5,
      });

      const found = await adapter.get('rec-1');
      expect(found).toBeDefined();

      const hits = await adapter.search([0, 0.95, 0], {
        namespace: 'common',
        limit: 1,
        threshold: 0.8,
      });
      expect(hits.length).toBe(1);
      expect(hits[0]?.score).toBeGreaterThan(0.9);
    }
  });

  it('SessionMemory, UserMemory and AgentMemory scope memory records properly', async () => {
    const bus = new InMemoryEventBus();
    const embeddings = new FakeEmbeddingsProvider();
    const baseMemory = new DefaultMemory(new InMemoryVectorStore(), embeddings, bus);

    const sessionMem = new SessionMemory(baseMemory, 'sess-123');
    const sRec = await sessionMem.remember('Current task is building user authentication');
    expect(sRec.namespace).toBe('session:sess-123');
    expect(sRec.scope).toBe('short');

    const userMem = new UserMemory(baseMemory, 'user-999');
    const uRec = await userMem.recordPreference('Prefers dark mode and concise comments');
    expect(uRec.namespace).toBe('user:user-999');
    expect(uRec.scope).toBe('long');

    const agentMem = new AgentMemory(baseMemory, 'agent-coder');
    const aRec = await agentMem.recordLearning('Avoid mutating global arrays when parsing AST');
    expect(aRec.namespace).toBe('agent:agent-coder');
    expect(aRec.scope).toBe('long');
  });
});

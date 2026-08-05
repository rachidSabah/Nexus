import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryEventBus } from '@anx/core';

import {
  DefaultMemory,
  InMemoryVectorStore,
  FakeEmbeddingsProvider,
  NaiveTokenCounter,
  cosineSimilarity,
  type MemoryRecord,
} from '../src/index.js';

describe('Memory System', () => {
  let bus: InMemoryEventBus;
  let store: InMemoryVectorStore;
  let embeddings: FakeEmbeddingsProvider;
  let memory: DefaultMemory;

  beforeEach(() => {
    bus = new InMemoryEventBus();
    store = new InMemoryVectorStore();
    embeddings = new FakeEmbeddingsProvider();
    memory = new DefaultMemory(store, embeddings, bus);
  });

  it('stores and retrieves short-term memory by substring', async () => {
    await memory.store('Hello world', {
      namespace: 'session-1',
      scope: 'short',
      contentType: 'text',
    });
    const results = await memory.search('Hello', { namespace: 'session-1', scope: 'short' });
    expect(results.length).toBe(1);
    expect(results[0]?.record.content).toBe('Hello world');
    expect(results[0]?.score).toBe(1.0);
  });

  it('stores and retrieves long-term memory by vector similarity', async () => {
    await memory.store('The user prefers TypeScript over JavaScript', {
      namespace: 'user-preferences',
      scope: 'long',
      contentType: 'text',
    });
    await memory.store('Python is great for data science', {
      namespace: 'user-preferences',
      scope: 'long',
    });
    const results = await memory.search('programming language preference', {
      namespace: 'user-preferences',
      scope: 'long',
      threshold: 0.0, // low threshold to ensure matches
    });
    expect(results.length).toBeGreaterThan(0);
  });

  it('emits memory.created event on store', async () => {
    const events: unknown[] = [];
    bus.subscribe('memory.created', (e) => events.push(e));

    await memory.store('test content', { namespace: 'ns', scope: 'short' });
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
    expect((events[0] as { payload: { namespace: string } }).payload.namespace).toBe('ns');
  });

  it('emits memory.retrieved event on long-term search', async () => {
    const events: unknown[] = [];
    bus.subscribe('memory.retrieved', (e) => events.push(e));

    await memory.store('long-term data', { namespace: 'ns', scope: 'long' });
    await memory.search('long-term', { namespace: 'ns', scope: 'long', threshold: 0.0 });
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
  });

  it('delete removes the record', async () => {
    const record = await memory.store('delete me', { namespace: 'ns', scope: 'short' });
    expect(await memory.get(record.id)).toBeDefined();
    expect(await memory.delete(record.id)).toBe(true);
    expect(await memory.get(record.id)).toBeUndefined();
  });

  it('summarize returns concatenated records', async () => {
    await memory.store('Record 1', { namespace: 'ns', scope: 'short' });
    await memory.store('Record 2', { namespace: 'ns', scope: 'short' });
    const summary = await memory.summarize('ns', { scope: 'short' });
    expect(summary).toContain('Record 1');
    expect(summary).toContain('Record 2');
    expect(summary).toContain('2 records');
  });

  it('respects TTL for short-term memories (sweep)', async () => {
    await memory.store('expires soon', { namespace: 'ns', scope: 'short', ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const swept = memory.sweepExpired();
    expect(swept).toBe(1);
    const results = await memory.search('expires', { namespace: 'ns', scope: 'short' });
    expect(results.length).toBe(0);
  });

  it('list returns records in a namespace', async () => {
    await memory.store('A', { namespace: 'ns1', scope: 'short' });
    await memory.store('B', { namespace: 'ns1', scope: 'short' });
    await memory.store('C', { namespace: 'ns2', scope: 'short' });
    const ns1 = await memory.list('ns1', { scope: 'short' });
    const ns2 = await memory.list('ns2', { scope: 'short' });
    expect(ns1.length).toBe(2);
    expect(ns2.length).toBe(1);
  });

  it('isolates namespaces', async () => {
    await memory.store('secret', { namespace: 'private', scope: 'short' });
    const results = await memory.search('secret', { namespace: 'other', scope: 'short' });
    expect(results.length).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns 0 for different-length vectors', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('NaiveTokenCounter', () => {
  it('estimates tokens as length / 4', () => {
    const counter = new NaiveTokenCounter();
    expect(counter.count('hello world!')).toBe(3); // 12 / 4 = 3
    expect(counter.count('')).toBe(0);
  });
});

describe('FakeEmbeddingsProvider', () => {
  it('produces deterministic 8-dim normalized vectors', async () => {
    const provider = new FakeEmbeddingsProvider();
    const v1 = await provider.embed('hello');
    const v2 = await provider.embed('hello');
    expect(v1.length).toBe(8);
    expect(v1).toEqual(v2);
    const norm = Math.sqrt(v1.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('embedBatch returns one vector per input', async () => {
    const provider = new FakeEmbeddingsProvider();
    const vectors = await provider.embedBatch(['a', 'b', 'c']);
    expect(vectors.length).toBe(3);
  });
});

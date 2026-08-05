import { describe, it, expect } from 'vitest';

import type { ProviderEndpoint } from '@anx/core';

import {
  InMemoryEndpointRepository,
  InMemoryAuditLogRepository,
  createPersistence,
  type PersistenceConfig,
} from '../src/index.js';

function makeEndpoint(id: string): ProviderEndpoint {
  return {
    id,
    providerId: 'openai',
    displayName: id,
    baseUrl: 'https://api.openai.com/v1',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      audio: false,
      speech: false,
      embeddings: false,
      reasoning: false,
      jsonMode: true,
      maxOutputTokens: 4096,
      maxInputTokens: 32768,
      supportedModalities: ['text'],
    },
    pricing: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
    priority: 1,
    weight: 1,
    region: 'us-east',
    tags: [],
    timeoutMs: 30_000,
    maxRetries: 2,
    concurrencyLimit: 10,
    health: 'healthy',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('InMemoryEndpointRepository', () => {
  it('saves, gets, lists, and deletes endpoints', async () => {
    const repo = new InMemoryEndpointRepository();
    const ep = makeEndpoint('ep-1');
    await repo.save(ep);
    expect((await repo.get('ep-1'))?.id).toBe('ep-1');
    expect((await repo.list()).length).toBe(1);
    await repo.delete('ep-1');
    expect(await repo.get('ep-1')).toBeUndefined();
  });
});

describe('InMemoryAuditLogRepository', () => {
  it('appends and queries entries', async () => {
    const log = new InMemoryAuditLogRepository();
    await log.append({
      principal: 'user-1',
      action: 'gateway:chat',
      resource: 'gpt-4',
      result: 'allow',
    });
    await log.append({
      principal: 'user-2',
      action: 'providers:write',
      resource: 'ep-1',
      result: 'deny',
    });
    const all = await log.query({ limit: 10 });
    expect(all.length).toBe(2);
    const user1 = await log.query({ principal: 'user-1' });
    expect(user1.length).toBe(1);
    const denies = await log.query({ action: 'providers:write' });
    expect(denies.length).toBe(1);
  });

  it('respects since filter', async () => {
    const log = new InMemoryAuditLogRepository();
    await log.append({ principal: 'u', action: 'a', resource: 'r', result: 'allow' });
    const future = new Date(Date.now() + 10_000);
    const results = await log.query({ since: future });
    expect(results.length).toBe(0);
  });
});

describe('createPersistence', () => {
  it('creates memory backend', () => {
    const layer = createPersistence({ backend: 'memory' } as PersistenceConfig);
    expect(layer.endpoints).toBeInstanceOf(InMemoryEndpointRepository);
    expect(layer.auditLog).toBeInstanceOf(InMemoryAuditLogRepository);
  });

  it('throws for sqlite without path', () => {
    expect(() => createPersistence({ backend: 'sqlite' } as PersistenceConfig)).toThrow('sqlitePath required');
  });

  it('throws for postgres without url', () => {
    expect(() => createPersistence({ backend: 'postgres' } as PersistenceConfig)).toThrow('postgresUrl required');
  });

  it('throws for redis without url', () => {
    expect(() => createPersistence({ backend: 'redis' } as PersistenceConfig)).toThrow('redisUrl required');
  });

  it('throws for unknown backend', () => {
    expect(() => createPersistence({ backend: 'unknown' as never } as PersistenceConfig)).toThrow('Unknown backend');
  });
});

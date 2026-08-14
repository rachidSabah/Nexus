import { describe, it, expect } from 'vitest';
import { ModelAliasRegistry } from '../src/model-aliases.js';
import type { ModelDescriptor, ModelRegistry } from '@anx/core';

function fakeRegistry(models: ModelDescriptor[]): ModelRegistry {
  return { list: () => models } as unknown as ModelRegistry;
}

function freeModel(id: string): ModelDescriptor {
  return {
    id,
    providerId: 'test-provider',
    stale: false,
    pricing: { isFree: true, freeTier: 'FREE', currency: 'USD' },
    capabilities: { toolCalling: true },
  } as unknown as ModelDescriptor;
}

function paidModel(id: string): ModelDescriptor {
  return {
    id,
    providerId: 'test-provider',
    stale: false,
    pricing: { isFree: false, freeTier: 'PAID', currency: 'USD' },
    capabilities: { toolCalling: true },
  } as unknown as ModelDescriptor;
}

describe('ModelAliasRegistry free-tier exhaustion', () => {
  it('reports exhausted when a free-only alias has no free candidates', () => {
    const registry = new ModelAliasRegistry(fakeRegistry([paidModel('paid/model-1')]));
    expect(registry.isExhaustedFreeOnlyAlias('nexus/free')).toBe(true);
    expect(registry.isExhaustedFreeOnlyAlias('nexus/free-coding')).toBe(true);
    expect(registry.isExhaustedFreeOnlyAlias('local/free')).toBe(true);
  });

  it('does not report exhausted when free candidates exist', () => {
    const registry = new ModelAliasRegistry(fakeRegistry([freeModel('free/model-1')]));
    expect(registry.isExhaustedFreeOnlyAlias('nexus/free')).toBe(false);
    expect(registry.isExhaustedFreeOnlyAlias('nexus/free-coding')).toBe(false);
  });

  it('does not report exhausted for non-free aliases or non-aliases', () => {
    const registry = new ModelAliasRegistry(fakeRegistry([]));
    expect(registry.isExhaustedFreeOnlyAlias('nexus/best-coding')).toBe(false);
    expect(registry.isExhaustedFreeOnlyAlias('gpt-4o')).toBe(false);
    expect(registry.isExhaustedFreeOnlyAlias('')).toBe(false);
  });
});

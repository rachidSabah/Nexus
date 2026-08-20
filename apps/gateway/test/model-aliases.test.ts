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

// ── WS3: capability-aware cheapest-model selector ──────────────────────
function capModel(id: string, caps: Record<string, boolean>, pricing: { isFree: boolean; freeTier: 'FREE' | 'PAID' | 'UNKNOWN'; inputPer1M?: number; outputPer1M?: number }): ModelDescriptor {
  return {
    id,
    providerId: 'test-provider',
    stale: false,
    pricing: { currency: 'USD', ...pricing },
    capabilities: { toolCalling: true, ...caps },
  } as unknown as ModelDescriptor;
}

describe('WS3 capability-aware cheapest-capable selector', () => {
  it('filters to models satisfying ALL required capabilities (multi-cap)', () => {
    const models = [
      capModel('cheap.toolcall', { toolCalling: true }, { isFree: true, freeTier: 'FREE' }),
      capModel('vision.toolcall', { toolCalling: true, vision: true }, { isFree: true, freeTier: 'FREE' }),
      capModel('allthree', { toolCalling: true, vision: true, jsonMode: true }, { isFree: true, freeTier: 'FREE' }),
      capModel('none', {}, { isFree: true, freeTier: 'FREE' }),
    ];
    const registry = new ModelAliasRegistry(fakeRegistry(models));
    registry.register({
      alias: 'test/multi',
      description: 'multi-cap',
      filter: { capabilities: ['toolCalling', 'vision', 'jsonMode'] },
      ranking: 'cheapest_capable',
      builtin: false,
    });
    const res = registry.resolve('test/multi');
    expect(res?.modelId).toBe('allthree'); // only model with all 3 caps
  });

  it('cheapest_capable ranks free + known-priced before UNKNOWN and prefers lower cost among known', () => {
    const models = [
      capModel('unknown.priced', { vision: true }, { isFree: false, freeTier: 'UNKNOWN', inputPer1M: 0, outputPer1M: 0 }),
      capModel('paid.dear', { vision: true }, { isFree: false, freeTier: 'PAID', inputPer1M: 5, outputPer1M: 5 }),
      capModel('paid.cheap', { vision: true }, { isFree: false, freeTier: 'PAID', inputPer1M: 1, outputPer1M: 1 }),
      capModel('free.one', { vision: true }, { isFree: true, freeTier: 'FREE' }),
    ];
    const registry = new ModelAliasRegistry(fakeRegistry(models));
    registry.register({
      alias: 'test/cap',
      description: 'cap',
      filter: { capability: 'vision' },
      ranking: 'cheapest_capable',
      builtin: false,
    });
    const res = registry.resolve('test/cap');
    expect(res?.modelId).toBe('free.one'); // free beats paid beats unknown
  });
});

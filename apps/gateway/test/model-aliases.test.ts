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

describe('WS5 routing strategies', () => {
  function rankWith(strategy: string, models: ModelDescriptor[]) {
    const registry = new ModelAliasRegistry(fakeRegistry(models));
    registry.register({ alias: 'test/strat', description: 's', filter: {}, ranking: strategy as never, builtin: false });
    return registry.resolve('test/strat')?.modelId;
  }

  it('balanced prefers a free model over an expensive paid one', () => {
    const models = [
      capModel('paid.big', { toolCalling: true, vision: true }, { isFree: false, freeTier: 'PAID', inputPer1M: 20, outputPer1M: 20 }),
      capModel('free.small', { toolCalling: true }, { isFree: true, freeTier: 'FREE' }),
    ];
    expect(rankWith('balanced', models)).toBe('free.small');
  });

  it('most_reliable deprioritizes a stale model with a lastError', () => {
    const healthy = capModel('healthy.m', { toolCalling: true }, { isFree: false, freeTier: 'PAID', inputPer1M: 1, outputPer1M: 1 });
    const sick = { ...capModel('sick.m', { toolCalling: true }, { isFree: false, freeTier: 'PAID', inputPer1M: 1, outputPer1M: 1 }), stale: true, lastError: 'upstream 500' };
    expect(rankWith('most_reliable', [healthy, sick])).toBe('healthy.m');
  });

  it('least_loaded spreads to the less-crowded provider', () => {
    // Two providers: "crowded" has 2 candidates, "lonely" has 1. least_loaded
    // should prefer the model from the provider with fewer candidates.
    const crowdedA = capModel('crowded.a', { toolCalling: true }, { isFree: false, freeTier: 'PAID', inputPer1M: 1, outputPer1M: 1 });
    crowdedA.providerId = 'crowded';
    const crowdedB = capModel('crowded.b', { toolCalling: true }, { isFree: false, freeTier: 'PAID', inputPer1M: 1, outputPer1M: 1 });
    crowdedB.providerId = 'crowded';
    const lonely = capModel('lonely.a', { toolCalling: true }, { isFree: false, freeTier: 'PAID', inputPer1M: 1, outputPer1M: 1 });
    lonely.providerId = 'lonely';
    expect(rankWith('least_loaded', [crowdedA, crowdedB, lonely])).toBe('lonely.a');
  });

  it('registers the three new built-in aliases', () => {
    const models = [
      capModel('free.a', { toolCalling: true }, { isFree: true, freeTier: 'FREE' }),
      capModel('paid.b', { toolCalling: true }, { isFree: false, freeTier: 'PAID', inputPer1M: 1, outputPer1M: 1 }),
    ];
    const registry = new ModelAliasRegistry(fakeRegistry(models));
    expect(registry.resolve('nexus/balanced')?.modelId).toBeDefined();
    expect(registry.resolve('nexus/least-loaded')?.modelId).toBeDefined();
    expect(registry.resolve('nexus/reliable')?.modelId).toBeDefined();
  });
});

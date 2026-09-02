import { describe, it, expect } from 'vitest';
import { ModelAliasRegistry, type ContextEligibilityPort } from '../src/model-aliases.js';
import { ModelCapabilityService } from '@anx/core';
import type { ModelDescriptor, ModelRegistry } from '@anx/core';

function fakeRegistry(models: ModelDescriptor[]): ModelRegistry {
  return { list: () => models } as unknown as ModelRegistry;
}

function model(id: string, providerId: string, contextWindow?: number): ModelDescriptor {
  return {
    id,
    providerId,
    contextWindow,
    stale: false,
    pricing: { isFree: false, freeTier: 'PAID', currency: 'USD' },
    capabilities: { toolCalling: true, streaming: true },
    discoveredAt: 1_000,
  } as unknown as ModelDescriptor;
}

describe('ModelAliasRegistry — context-aware virtual model resolution', () => {
  it('hard-excludes models whose KNOWN effective context cannot hold the request', () => {
    const service = new ModelCapabilityService();
    service.ingestCatalog('big', [{ model: model('big/context-128k', 'big', 128000) }]);
    service.ingestCatalog('small', [{ model: model('small/context-8k', 'small', 8000) }]);

    const registry = new ModelAliasRegistry(
      fakeRegistry([
        model('big/context-128k', 'big', 128000),
        model('small/context-8k', 'small', 8000),
      ]),
      undefined,
      {},
      undefined,
      service as unknown as ContextEligibilityPort,
    );

    // A 100K-token request must not land on the 8K model.
    const res = registry.resolve('local/coding', 100_000);
    expect(res).toBeDefined();
    expect(res!.modelId).toBe('big/context-128k');
    expect(res!.providerId).toBe('big');
  });

  it('never excludes models with UNKNOWN context (labeled, not guessed)', () => {
    const service = new ModelCapabilityService();
    service.ingestCatalog('mystery', [{ model: model('mystery/no-metadata', 'mystery') }]);

    const registry = new ModelAliasRegistry(
      fakeRegistry([model('mystery/no-metadata', 'mystery')]),
      undefined,
      {},
      undefined,
      service as unknown as ContextEligibilityPort,
    );
    const res = registry.resolve('local/coding', 200_000);
    expect(res).toBeDefined();
    expect(res!.modelId).toBe('mystery/no-metadata');
  });

  it('returns undefined (truthful no-eligible-model) when every KNOWN candidate is too small', () => {
    const service = new ModelCapabilityService();
    service.ingestCatalog('small', [{ model: model('small/context-8k', 'small', 8000) }]);
    service.ingestCatalog('tiny', [{ model: model('tiny/context-4k', 'tiny', 4000) }]);

    const registry = new ModelAliasRegistry(
      fakeRegistry([
        model('small/context-8k', 'small', 8000),
        model('tiny/context-4k', 'tiny', 4000),
      ]),
      undefined,
      {},
      undefined,
      service as unknown as ContextEligibilityPort,
    );
    expect(registry.resolve('local/coding', 100_000)).toBeUndefined();
  });

  it('without requiredInputTokens the behavior is bit-for-bit unchanged (no-regression guard)', () => {
    const service = new ModelCapabilityService();
    service.ingestCatalog('small', [{ model: model('small/context-8k', 'small', 8000) }]);

    const registry = new ModelAliasRegistry(
      fakeRegistry([model('small/context-8k', 'small', 8000)]),
      undefined,
      {},
      undefined,
      service as unknown as ContextEligibilityPort,
    );
    // No request size supplied → context eligibility is not consulted.
    expect(registry.resolve('local/coding')).toBeDefined();
  });

  it('without a capability service wired, requiredInputTokens is ignored (legacy parity)', () => {
    const registry = new ModelAliasRegistry(fakeRegistry([model('small/context-8k', 'small', 8000)]));
    expect(registry.resolve('local/coding', 100_000)).toBeDefined();
  });
});

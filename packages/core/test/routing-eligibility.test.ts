import { describe, expect, it } from 'vitest';

import { RoutingEngine } from '../src/application/routing-engine.js';
import { InMemoryEventBus } from '../src/application/event-bus.js';
import type { ProviderEndpoint } from '../src/domain/types.js';

function makeEndpoint(over: Partial<ProviderEndpoint>): ProviderEndpoint {
  return {
    id: 'ep',
    providerId: 'prov',
    displayName: 'Prov',
    baseUrl: 'http://localhost',
    capabilities: { streaming: true, toolCalling: true, jsonMode: true, vision: false, reasoning: false },
    priority: 1,
    weight: 1,
    tags: [],
    timeoutMs: 30_000,
    maxRetries: 2,
    concurrencyLimit: 4,
    health: 'healthy',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function freshEngine(): RoutingEngine {
  return new RoutingEngine(new InMemoryEventBus());
}

describe('RoutingEngine.getSelectableProviders', () => {
  it('returns only providers with a healthy/degraded endpoint', () => {
    const engine = freshEngine();
    engine.registerEndpoint(makeEndpoint({ id: 'a', providerId: 'openai', health: 'healthy' }));
    engine.registerEndpoint(makeEndpoint({ id: 'b', providerId: 'nvidia', health: 'degraded' }));
    engine.registerEndpoint(makeEndpoint({ id: 'c', providerId: 'dead', health: 'circuit_open' }));

    const selectable = engine.getSelectableProviders();
    expect(selectable).toContain('openai');
    expect(selectable).toContain('nvidia');
    expect(selectable).not.toContain('dead');
  });

  it('excludes providers whose only endpoint is circuit_open', () => {
    const engine = freshEngine();
    engine.registerEndpoint(makeEndpoint({ id: 'x', providerId: 'ghost', health: 'circuit_open' }));
    expect(engine.getSelectableProviders()).not.toContain('ghost');
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InMemoryEventBus, RoutingEngine } from '../src/index.js';
import { ModelRegistry } from '../src/index.js';

describe('ModelRegistry', () => {
  let routing: RoutingEngine;
  let adapters: Map<string, any>;

  beforeEach(() => {
    const events = new InMemoryEventBus();
    routing = new RoutingEngine(events, {
      failureThreshold: 5,
      failureWindowMs: 60_000,
      cooldownMs: 30_000,
    });
    adapters = new Map();
  });

  function registerEndpoint(providerId: string) {
    routing.registerEndpoint({
      id: `e-${providerId}`,
      providerId,
      displayName: providerId,
      baseUrl: 'https://example.com',
      capabilities: {
        streaming: true, toolCalling: true, vision: false, audio: false,
        speech: false, embeddings: false, reasoning: false, jsonMode: true,
        maxOutputTokens: 4096, maxInputTokens: 32768, supportedModalities: ['text'],
      } as never,
      pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
      priority: 1, weight: 1, region: 'us', tags: [],
      timeoutMs: 30_000, maxRetries: 2, concurrencyLimit: 10,
      health: 'healthy', createdAt: new Date(), updatedAt: new Date(),
    } as never);
  }

  it('returns empty list before first refresh', () => {
    const registry = new ModelRegistry(routing, adapters);
    expect(registry.list().length).toBe(0);
    expect(registry.listFree().length).toBe(0);
  });

  it('discovers models from adapters with discoverModels()', async () => {
    registerEndpoint('openai');
    adapters.set('openai', {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4o', providerId: 'openai', pricing: { isFree: false }, discoveredAt: 0 },
        { id: 'gpt-3.5-turbo', providerId: 'openai', pricing: { isFree: false }, discoveredAt: 0 },
      ]),
    });
    const registry = new ModelRegistry(routing, adapters);
    await registry.refresh();
    expect(registry.list().length).toBe(2);
    expect(registry.listByProvider('openai').length).toBe(2);
  });

  it('classifies free models correctly', async () => {
    registerEndpoint('openrouter');
    adapters.set('openrouter', {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'meta-llama/llama-3.1-8b-instruct:free', providerId: 'openrouter', pricing: { isFree: true }, discoveredAt: 0 },
        { id: 'anthropic/claude-3.5-sonnet', providerId: 'openrouter', pricing: { isFree: false }, discoveredAt: 0 },
      ]),
    });
    const registry = new ModelRegistry(routing, adapters);
    await registry.refresh();
    expect(registry.listFree().length).toBe(1);
    expect(registry.listFree()[0].id).toBe('meta-llama/llama-3.1-8b-instruct:free');
  });

  it('marks disappeared models as stale for one cycle', async () => {
    registerEndpoint('openai');
    const adapter = {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', providerId: 'openai', pricing: { isFree: false }, discoveredAt: 0 },
        { id: 'gpt-3.5', providerId: 'openai', pricing: { isFree: false }, discoveredAt: 0 },
      ]),
    };
    adapters.set('openai', adapter);
    const registry = new ModelRegistry(routing, adapters);
    await registry.refresh();
    expect(registry.list().length).toBe(2);

    // gpt-3.5 disappears.
    adapter.discoverModels.mockResolvedValue([
      { id: 'gpt-4', providerId: 'openai', pricing: { isFree: false }, discoveredAt: 0 },
    ]);
    await registry.refresh();
    // Both still present — gpt-3.5 is stale.
    expect(registry.list().length).toBe(2);
    const stale = registry.list().find((m) => m.id === 'gpt-3.5');
    expect(stale?.stale).toBe(true);

    // One more cycle — gpt-3.5 is dropped.
    await registry.refresh();
    expect(registry.list().length).toBe(1);
    expect(registry.list()[0].id).toBe('gpt-4');
  });

  it('re-cleared stale flag when a model reappears', async () => {
    registerEndpoint('openai');
    const adapter = {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', providerId: 'openai', pricing: { isFree: false }, discoveredAt: 0 },
      ]),
    };
    adapters.set('openai', adapter);
    const registry = new ModelRegistry(routing, adapters);
    await registry.refresh();
    expect(registry.list().length).toBe(1);

    // Disappears → stale.
    adapter.discoverModels.mockResolvedValue([]);
    await registry.refresh();
    expect(registry.list()[0].stale).toBe(true);

    // Reappears → stale cleared.
    adapter.discoverModels.mockResolvedValue([
      { id: 'gpt-4', providerId: 'openai', pricing: { isFree: false }, discoveredAt: 0 },
    ]);
    await registry.refresh();
    expect(registry.list()[0].stale).toBe(false);
  });

  it('filters by capability', async () => {
    registerEndpoint('openai');
    adapters.set('openai', {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4o', providerId: 'openai', capabilities: { vision: true, toolCalling: true }, pricing: {}, discoveredAt: 0 },
        { id: 'gpt-3.5', providerId: 'openai', capabilities: { vision: false, toolCalling: true }, pricing: {}, discoveredAt: 0 },
      ]),
    });
    const registry = new ModelRegistry(routing, adapters);
    await registry.refresh();
    expect(registry.listByCapability('vision').length).toBe(1);
    expect(registry.listByCapability('toolCalling').length).toBe(2);
  });

  it('filters by context window', async () => {
    registerEndpoint('openai');
    adapters.set('openai', {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4o', providerId: 'openai', contextWindow: 128_000, pricing: {}, discoveredAt: 0 },
        { id: 'gpt-3.5', providerId: 'openai', contextWindow: 16_000, pricing: {}, discoveredAt: 0 },
      ]),
    });
    const registry = new ModelRegistry(routing, adapters);
    await registry.refresh();
    expect(registry.listByContextWindow(100_000).length).toBe(1);
    expect(registry.listByContextWindow(10_000).length).toBe(2);
  });

  it('records per-provider discovery errors without failing the refresh', async () => {
    registerEndpoint('openai');
    registerEndpoint('anthropic');
    adapters.set('openai', {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', providerId: 'openai', pricing: {}, discoveredAt: 0 },
      ]),
    });
    adapters.set('anthropic', {
      discoverModels: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    const registry = new ModelRegistry(routing, adapters);
    await registry.refresh();
    expect(registry.list().length).toBe(1); // openai's model only
    const stats = registry.stats();
    expect(stats.errors['anthropic']).toContain('connection refused');
    expect(stats.errors['openai']).toBeUndefined();
  });

  it('excludes stale models from free + capability views', async () => {
    registerEndpoint('openrouter');
    const adapter = {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'model-a:free', providerId: 'openrouter', pricing: { isFree: true }, capabilities: { toolCalling: true }, discoveredAt: 0 },
        { id: 'model-b:free', providerId: 'openrouter', pricing: { isFree: true }, capabilities: { toolCalling: true }, discoveredAt: 0 },
      ]),
    };
    adapters.set('openrouter', adapter);
    const registry = new ModelRegistry(routing, adapters);
    await registry.refresh();
    expect(registry.listFree().length).toBe(2);

    // model-b disappears → stale.
    adapter.discoverModels.mockResolvedValue([
      { id: 'model-a:free', providerId: 'openrouter', pricing: { isFree: true }, capabilities: { toolCalling: true }, discoveredAt: 0 },
    ]);
    await registry.refresh();
    // list() still returns both (one stale), but listFree() excludes stale.
    expect(registry.list().length).toBe(2);
    expect(registry.listFree().length).toBe(1);
    expect(registry.listByCapability('toolCalling').length).toBe(1);
  });

  it('stats returns aggregated counts', async () => {
    registerEndpoint('openai');
    registerEndpoint('openrouter');
    adapters.set('openai', {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'gpt-4', providerId: 'openai', pricing: { isFree: false }, discoveredAt: 0 },
        { id: 'gpt-4o', providerId: 'openai', pricing: { isFree: false }, discoveredAt: 0 },
      ]),
    });
    adapters.set('openrouter', {
      discoverModels: vi.fn().mockResolvedValue([
        { id: 'llama:free', providerId: 'openrouter', pricing: { isFree: true }, discoveredAt: 0 },
      ]),
    });
    const registry = new ModelRegistry(routing, adapters);
    await registry.refresh();
    const stats = registry.stats();
    expect(stats.totalModels).toBe(3);
    expect(stats.freeModels).toBe(1);
    expect(stats.staleModels).toBe(0);
    expect(stats.byProvider['openai']).toBe(2);
    expect(stats.byProvider['openrouter']).toBe(1);
    expect(stats.refreshing).toBe(false);
    expect(stats.lastRefreshAt).toBeGreaterThan(0);
  });
});

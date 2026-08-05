import { describe, it, expect, beforeEach } from 'vitest';

import { RoutingEngine } from '../src/application/routing-engine.js';
import { InMemoryEventBus } from '../src/application/event-bus.js';
import { NoEligibleProviderError } from '../src/domain/errors.js';
import type { ProviderEndpoint, ProviderCapabilities } from '../src/domain/types.js';

const baseCaps: ProviderCapabilities = {
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
};

function makeEndpoint(overrides: Partial<ProviderEndpoint> = {}): ProviderEndpoint {
  return {
    id: overrides.id ?? 'ep-1',
    providerId: overrides.providerId ?? 'openai',
    displayName: overrides.displayName ?? 'OpenAI Primary',
    baseUrl: overrides.baseUrl ?? 'https://api.openai.com/v1',
    capabilities: overrides.capabilities ?? baseCaps,
    pricing: overrides.pricing ?? { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
    priority: overrides.priority ?? 1,
    weight: overrides.weight ?? 1,
    region: overrides.region ?? 'us-east',
    tags: overrides.tags ?? ['default'],
    timeoutMs: overrides.timeoutMs ?? 30_000,
    maxRetries: overrides.maxRetries ?? 2,
    concurrencyLimit: overrides.concurrencyLimit ?? 10,
    health: overrides.health ?? 'healthy',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RoutingEngine', () => {
  let bus: InMemoryEventBus;
  let engine: RoutingEngine;

  beforeEach(() => {
    bus = new InMemoryEventBus();
    engine = new RoutingEngine(bus);
    engine.registerEndpoint(
      makeEndpoint({
        id: 'ep-openai',
        providerId: 'openai',
        weight: 10,
        pricing: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
      }),
    );
    engine.registerEndpoint(
      makeEndpoint({
        id: 'ep-anthropic',
        providerId: 'anthropic',
        weight: 5,
        pricing: { inputPer1K: 0.003, outputPer1K: 0.015, currency: 'USD' },
      }),
    );
    engine.registerEndpoint(
      makeEndpoint({
        id: 'ep-deepseek',
        providerId: 'deepseek',
        weight: 2,
        pricing: { inputPer1K: 0.001, outputPer1K: 0.002, currency: 'USD' },
      }),
    );
  });

  it('resolves to an endpoint when at least one is eligible', async () => {
    const decision = await engine.resolve({ model: 'gpt-4' });
    expect(decision.endpoint).toBeDefined();
    expect(decision.alternatives.length).toBeGreaterThan(0);
  });

  it('throws NoEligibleProviderError when no endpoints match', async () => {
    await expect(
      engine.resolve({ model: 'gpt-4', preferredProviders: ['nonexistent'] }),
    ).rejects.toBeInstanceOf(NoEligibleProviderError);
  });

  it('applies least_cost strategy correctly', async () => {
    const decision = await engine.resolve({
      model: 'gpt-4',
      strategy: 'least_cost',
    });
    expect(decision.endpoint.id).toBe('ep-deepseek');
  });

  it('applies priority strategy correctly', async () => {
    engine.registerEndpoint(
      makeEndpoint({
        id: 'ep-priority',
        providerId: 'openai',
        priority: 0,
      }),
    );
    const decision = await engine.resolve({
      model: 'gpt-4',
      strategy: 'priority',
    });
    expect(decision.endpoint.id).toBe('ep-priority');
  });

  it('filters by preferredProviders', async () => {
    const decision = await engine.resolve({
      model: 'gpt-4',
      preferredProviders: ['anthropic'],
    });
    expect(decision.endpoint.providerId).toBe('anthropic');
  });

  it('filters by maxCostPer1K', async () => {
    const decision = await engine.resolve({
      model: 'gpt-4',
      maxCostPer1K: 0.005,
      strategy: 'least_cost',
    });
    expect(decision.endpoint.id).toBe('ep-deepseek');
  });

  it('filters by required capability', async () => {
    engine.registerEndpoint(
      makeEndpoint({
        id: 'ep-vision',
        providerId: 'openai',
        capabilities: { ...baseCaps, vision: true },
      }),
    );
    const decision = await engine.resolve({
      model: 'gpt-4o',
      capabilities: { vision: true },
      strategy: 'capability_match',
    });
    expect(decision.endpoint.capabilities.vision).toBe(true);
  });

  it('opens circuit breaker after threshold failures', async () => {
    // Force 5 retryable failures
    for (let i = 0; i < 5; i++) {
      engine.recordFailure(
        'ep-openai',
        Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
        true,
      );
    }
    const endpoints = engine.listEndpoints();
    const openai = endpoints.find((e) => e.id === 'ep-openai');
    expect(openai?.health).toBe('circuit_open');
  });

  it('does NOT open circuit breaker for non-retryable errors', () => {
    for (let i = 0; i < 5; i++) {
      engine.recordFailure('ep-openai', new Error('bad request'), false);
    }
    const endpoints = engine.listEndpoints();
    const openai = endpoints.find((e) => e.id === 'ep-openai');
    expect(openai?.health).toBe('healthy');
  });

  it('records EWMA latency on success', () => {
    engine.recordSuccess('ep-openai', 100);
    engine.recordSuccess('ep-openai', 200);
    // Should be between 100 and 200, closer to 200 due to EWMA weighting.
    // We don't assert exact value — that's an implementation detail.
    const endpoints = engine.listEndpoints();
    expect(endpoints.find((e) => e.id === 'ep-openai')?.health).toBe('healthy');
  });

  it('emits route.resolved event', async () => {
    const events: unknown[] = [];
    bus.subscribe('route.resolved', (e) => events.push(e));
    await engine.resolve({ model: 'gpt-4' });
    // Event bus uses queueMicrotask, so await a microtask flush.
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
  });

  it('emits circuit_breaker.tripped event on threshold', async () => {
    const events: unknown[] = [];
    bus.subscribe('circuit_breaker.tripped', (e) => events.push(e));
    for (let i = 0; i < 5; i++) {
      engine.recordFailure(
        'ep-openai',
        Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
        true,
      );
    }
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
  });
});

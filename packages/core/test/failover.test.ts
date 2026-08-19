import { describe, it, expect } from 'vitest';

import { DefaultFailover } from '../src/index.js';
import type { ProviderEndpoint, RoutingDecision } from '../src/index.js';

function ep(id: string, providerId: string, health: ProviderEndpoint['health'] = 'healthy'): ProviderEndpoint {
  return {
    id,
    providerId,
    displayName: providerId,
    baseUrl: `https://${providerId}.example.com/v1`,
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      audio: false,
      speech: false,
      embeddings: true,
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
    health,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function decision(endpoints: ProviderEndpoint[]): RoutingDecision {
  return {
    endpoint: endpoints[0]!,
    strategy: 'least_latency',
    reason: 'test',
    alternatives: endpoints,
  };
}

describe('DefaultFailover', () => {
  it('returns the first viable alternative when no context is given (legacy behavior)', () => {
    const f = new DefaultFailover();
    const d = decision([ep('a1', 'openai'), ep('b1', 'anthropic'), ep('c1', 'groq')]);
    const next = f.next(d, 'a1');
    expect(next?.id).toBe('b1');
  });

  it('on a PROVIDER-wide failure, prefers a different provider over same-provider siblings', () => {
    // Three OpenAI endpoints (a1, a2) + one Anthropic (b1). Failure is provider-wide.
    const f = new DefaultFailover();
    const d = decision([ep('a1', 'openai'), ep('a2', 'openai'), ep('b1', 'anthropic')]);
    const next = f.next(d, 'a1', { scope: 'provider', failedProviderId: 'openai' });
    expect(next?.providerId).toBe('anthropic');
    expect(next?.id).toBe('b1');
  });

  it('on a CREDENTIAL failure, prefers staying on the same provider (different key chosen downstream)', () => {
    // Same provider (openai) has two endpoints; a different provider (anthropic) is available.
    const f = new DefaultFailover();
    const d = decision([ep('a1', 'openai'), ep('a2', 'openai'), ep('b1', 'anthropic')]);
    const next = f.next(d, 'a1', { scope: 'credential', failedProviderId: 'openai' });
    expect(next?.providerId).toBe('openai');
    expect(next?.id).toBe('a2');
  });

  it('falls back to any viable candidate when the preferred diversity set is exhausted', () => {
    const f = new DefaultFailover();
    // Only OpenAI candidates; a provider-wide failure with no other provider → still returns a viable OpenAI one.
    const d = decision([ep('a1', 'openai'), ep('a2', 'openai')]);
    const next = f.next(d, 'a1', { scope: 'provider', failedProviderId: 'openai' });
    expect(next?.id).toBe('a2');
  });

  it('never re-selects an endpoint already failed in this request', () => {
    const f = new DefaultFailover();
    const d = decision([ep('a1', 'openai'), ep('b1', 'anthropic'), ep('c1', 'groq')]);
    const first = f.next(d, 'a1', { scope: 'provider', failedProviderId: 'openai' });
    expect(first?.id).not.toBe('a1');
    const second = f.next(d, first!.id, { scope: 'provider', failedProviderId: first!.providerId });
    expect(second?.id).not.toBe('a1');
    expect(second?.id).not.toBe(first!.id);
  });

  it('skips endpoints in circuit_open state during diversity selection', () => {
    const f = new DefaultFailover();
    const d = decision([ep('a1', 'openai'), ep('b1', 'anthropic', 'circuit_open'), ep('c1', 'groq')]);
    const next = f.next(d, 'a1', { scope: 'provider', failedProviderId: 'openai' });
    expect(next?.id).toBe('c1');
  });
});

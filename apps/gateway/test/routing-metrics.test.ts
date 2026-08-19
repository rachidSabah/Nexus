import { describe, it, expect } from 'vitest';

import { computeRoutingMetrics } from '../src/routing-metrics.js';
import type { KeyLike, FreeModelLike, RateLimitTrackerLike } from '../src/routing-metrics.js';

function key(providerId: string, status: KeyLike['status'], extra: Partial<KeyLike> = {}): KeyLike {
  return { providerId, status, ...extra };
}

describe('computeRoutingMetrics', () => {
  it('aggregates per-provider key health truthfully', () => {
    const keys: KeyLike[] = [
      key('openai', 'active', { requests: 10, errors: 1, rateLimitedCount: 2 }),
      key('openai', 'cooldown', { requests: 5, errors: 5, rateLimitedCount: 5 }),
      key('anthropic', 'invalid', { requests: 3, errors: 3, rateLimitedCount: 0 }),
    ];
    const freeModels: FreeModelLike[] = [
      { providerId: 'openai' },
      { providerId: 'openai' },
      { providerId: 'anthropic' },
    ];
    const tracker: RateLimitTrackerLike = { getAll: () => ({ 'k1': {}, 'k2': {} }) };

    const m = computeRoutingMetrics({ listAll: () => keys }, freeModels, tracker);

    expect(m.providers).toHaveLength(2);
    const openai = m.providers.find((p) => p.providerId === 'openai')!;
    expect(openai.totalKeys).toBe(2);
    expect(openai.active).toBe(1);
    expect(openai.cooldown).toBe(1);
    expect(openai.invalid).toBe(0);
    expect(openai.rateLimitedTotal).toBe(7);
    expect(openai.requestsTotal).toBe(15);
    expect(openai.freeModels).toBe(2);
    // 7 / 15 = 0.4667
    expect(openai.rateLimitRate).toBe(0.4667);

    const anthropic = m.providers.find((p) => p.providerId === 'anthropic')!;
    expect(anthropic.invalid).toBe(1);
    expect(anthropic.freeModels).toBe(1);

    expect(m.totals.totalKeys).toBe(3);
    expect(m.totals.active).toBe(1);
    expect(m.totals.cooldown).toBe(1);
    expect(m.totals.invalid).toBe(1);
    expect(m.totals.freeModels).toBe(3);
    expect(m.rateLimitsTracked).toBe(2);
  });

  it('reports rateLimitRate as UNKNOWN (not 0) when no requests recorded', () => {
    const keys: KeyLike[] = [key('openai', 'active')];
    const m = computeRoutingMetrics({ listAll: () => keys }, [], undefined);
    const p = m.providers[0]!;
    expect(p.requestsTotal).toBe(0);
    expect(p.rateLimitRate).toBe('UNKNOWN');
  });

  it('handles missing registries gracefully (no crash, empty result)', () => {
    const m = computeRoutingMetrics(undefined, [], undefined);
    expect(m.providers).toEqual([]);
    expect(m.totals.totalKeys).toBe(0);
    expect(m.totals.freeModels).toBe(0);
    expect(m.rateLimitsTracked).toBe(0);
  });

  it('counts rate-limit-tracked keys from the tracker without faking', () => {
    const tracker: RateLimitTrackerLike = { getAll: () => ({}) };
    const m = computeRoutingMetrics({ listAll: () => [] }, [], tracker);
    expect(m.rateLimitsTracked).toBe(0);
  });
});

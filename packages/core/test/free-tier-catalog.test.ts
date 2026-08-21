import { describe, it, expect } from 'vitest';
import { FREE_TIER_CATALOG, aggregateFreeTier } from '../src/application/free-tier-catalog.js';

describe('free-tier catalog (sourced, honest aggregation)', () => {
  it('every entry carries a source URL and a verified date', () => {
    expect(FREE_TIER_CATALOG.length).toBeGreaterThan(0);
    for (const p of FREE_TIER_CATALOG) {
      expect(p.source.startsWith('http')).toBe(true);
      expect(p.verified).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('does not fabricate a single monthly-token number; aggregate is a transparent sum-of-ceilings', () => {
    const agg = aggregateFreeTier();
    // sum-of-ceilings must equal the literal sum of documented RPD values
    const expectedRpd = FREE_TIER_CATALOG.reduce((s, p) => s + (p.requestsPerDay ?? 0), 0);
    expect(agg.sumRequestsPerDayCeiling).toBe(expectedRpd);
    expect(agg.providersCovered).toBe(FREE_TIER_CATALOG.length);
    // At least one provider requires no card (so "free" claim is honest)
    expect(agg.cardRequiredAnywhere).toBe(false);
  });

  it('aggregate is stable regardless of provider order', () => {
    const shuffled = [...FREE_TIER_CATALOG].reverse();
    expect(aggregateFreeTier(shuffled)).toEqual(aggregateFreeTier(FREE_TIER_CATALOG));
  });
});

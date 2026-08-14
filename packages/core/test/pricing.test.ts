import { describe, it, expect } from 'vitest';
import {
  classifyPricing,
  hasFreeSuffix,
  isZeroPriced,
  mergePricing,
} from '../src/application/pricing.js';

describe('Pricing Module', () => {
  it('detects free suffixes correctly', () => {
    expect(hasFreeSuffix('deepseek-v4-flash-free')).toBe(true);
    expect(hasFreeSuffix('llama-3.1:free')).toBe(true);
    expect(hasFreeSuffix('qwen_free')).toBe(true);
    expect(hasFreeSuffix('gpt-4-free-style')).toBe(false);
  });

  it('classifies pricing correctly', () => {
    expect(classifyPricing({ isFree: true }).freeTier).toBe('FREE');
    expect(classifyPricing({ inputPer1M: 0, outputPer1M: 0 }).freeTier).toBe('FREE');
    expect(classifyPricing({ inputPer1M: 0, outputPer1M: 1 }).freeTier).toBe('ZERO_INPUT_PAID_OUTPUT');
    expect(classifyPricing({ inputPer1M: 1, outputPer1M: 1 }).freeTier).toBe('PAID');
    expect(classifyPricing({}).freeTier).toBe('UNKNOWN');
  });

  it('detects zero priced', () => {
    expect(isZeroPriced(0, 0)).toBe(true);
    expect(isZeroPriced(0, 1)).toBe(false);
    expect(isZeroPriced(undefined, undefined)).toBe(true); // From implementation
  });

  it('merges pricing with correct hierarchy (live > provider_metadata > adapter_fallback > unknown)', () => {
    const fallback = { inputPer1M: 5, outputPer1M: 5, source: 'adapter_fallback' as const };
    const meta = { inputPer1M: 3, outputPer1M: 3, source: 'provider_metadata' as const };
    const live = { inputPer1M: 1, outputPer1M: 1, source: 'live' as const };

    // live wins
    expect(mergePricing(fallback, live)).toEqual(expect.objectContaining({ source: 'live', inputPer1M: 1 }));
    // meta beats fallback
    expect(mergePricing(fallback, meta)).toEqual(expect.objectContaining({ source: 'provider_metadata', inputPer1M: 3 }));
    // live beats meta
    expect(mergePricing(meta, live)).toEqual(expect.objectContaining({ source: 'live', inputPer1M: 1 }));
    // undefined works
    expect(mergePricing(undefined, fallback)).toEqual(expect.objectContaining({ source: 'adapter_fallback' }));
  });
});

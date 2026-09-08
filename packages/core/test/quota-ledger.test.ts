import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InMemoryDailyQuotaLedger,
  currentDayUtc,
  nextUtcMidnight,
  msUntilUtcMidnight,
  KeyRegistry,
} from '../src/index.js';

describe('Daily Quota Ledger & UTC midnight reset (Phase 35)', () => {
  it('computes currentDayUtc and nextUtcMidnight accurately', () => {
    // 2026-09-08 14:30:00 UTC
    const date = new Date(Date.UTC(2026, 8, 8, 14, 30, 0));
    expect(currentDayUtc(date)).toBe('2026-09-08');

    const midnight = nextUtcMidnight(date);
    expect(new Date(midnight).toISOString()).toBe('2026-09-09T00:00:00.000Z');
    expect(msUntilUtcMidnight(date)).toBe(9.5 * 3600 * 1000);
  });

  it('records requests and tokens per (keyId, providerId, modelId, dayUtc)', async () => {
    const ledger = new InMemoryDailyQuotaLedger();
    await ledger.recordUsage({
      keyId: 'k1',
      providerId: 'anyapi',
      modelId: 'm1',
      tokens: 1500,
    });
    await ledger.recordUsage({
      keyId: 'k1',
      providerId: 'anyapi',
      modelId: 'm2',
      tokens: 2500,
    });
    await ledger.recordUsage({
      keyId: 'k1',
      providerId: 'anyapi',
      modelId: 'm1',
      tokens: 0,
      isError: true,
    });

    const usage = await ledger.getKeyDailyUsage('k1');
    expect(usage.requests).toBe(3);
    expect(usage.tokens).toBe(4000);
    expect(usage.errors).toBe(1);

    const providerUsage = await ledger.getProviderDailyUsage('anyapi');
    expect(providerUsage.requests).toBe(3);
    expect(providerUsage.tokens).toBe(4000);
  });

  it('checks quota limits accurately', async () => {
    const ledger = new InMemoryDailyQuotaLedger();
    await ledger.recordUsage({
      keyId: 'key-anyapi',
      providerId: 'anyapi',
      tokens: 95000,
    });

    const check1 = await ledger.checkQuota('key-anyapi', { maxDailyTokens: 100000 });
    expect(check1.allowed).toBe(true);
    expect(check1.remainingTokens).toBe(5000);

    await ledger.recordUsage({
      keyId: 'key-anyapi',
      providerId: 'anyapi',
      tokens: 6000,
    });

    const check2 = await ledger.checkQuota('key-anyapi', { maxDailyTokens: 100000 });
    expect(check2.allowed).toBe(false);
    expect(check2.remainingTokens).toBe(0);
    expect(check2.tokensToday).toBe(101000);
  });

  it('KeyRegistry integrates with daily quota and marks key exhausted when limit is reached', async () => {
    const fakeVault = {
      get: vi.fn().mockResolvedValue('sk-test'),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue([]),
    };
    const ledger = new InMemoryDailyQuotaLedger();
    const registry = new KeyRegistry(fakeVault as any, { quotaLedger: ledger });

    // Register an AnyAPI key (defaults to 100K token limit)
    const desc = await registry.register({
      id: 'anyapi-key-1',
      providerId: 'anyapi',
      plaintext: 'sk-anyapi-1234',
    });
    expect(desc.dailyTokenLimit).toBe(100_000);

    // Initial select works
    const chosen1 = registry.select('anyapi');
    expect(chosen1).toBe('anyapi-key-1');

    // Record usage near limit
    registry.recordSuccess('anyapi-key-1', 100, 90_000);
    const chosen2 = registry.select('anyapi');
    expect(chosen2).toBe('anyapi-key-1');

    // Record usage exceeding limit
    registry.recordSuccess('anyapi-key-1', 100, 15_000);
    const key = registry.get('anyapi-key-1');
    expect(key?.status).toBe('exhausted');
    expect(key?.quotaResetAt).toBeDefined();

    // Now select should skip this exhausted key
    const chosen3 = registry.select('anyapi');
    expect(chosen3).toBeUndefined();
  });
});

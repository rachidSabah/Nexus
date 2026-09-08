import { describe, it, expect } from 'vitest';
import { DurableQuotaLedger, createPersistence } from '../src/index.js';

describe('DurableQuotaLedger', () => {
  it('records usage and retrieves daily stats', async () => {
    const ledger = new DurableQuotaLedger({ path: ':memory:' });

    await ledger.recordUsage({
      keyId: 'key-test-1',
      providerId: 'anyapi',
      modelId: 'meta-llama/llama-3.3-70b-instruct',
      tokens: 2500,
    });

    await ledger.recordUsage({
      keyId: 'key-test-1',
      providerId: 'anyapi',
      modelId: 'deepseek/deepseek-r1',
      tokens: 3500,
      isError: true,
    });

    const stats = await ledger.getKeyDailyUsage('key-test-1');
    expect(stats.requests).toBe(2);
    expect(stats.tokens).toBe(6000);
    expect(stats.errors).toBe(1);

    const providerStats = await ledger.getProviderDailyUsage('anyapi');
    expect(providerStats.requests).toBe(2);
    expect(providerStats.tokens).toBe(6000);

    const check1 = await ledger.checkQuota('key-test-1', { maxDailyTokens: 10000 });
    expect(check1.allowed).toBe(true);
    expect(check1.remainingTokens).toBe(4000);

    const check2 = await ledger.checkQuota('key-test-1', { maxDailyTokens: 5000 });
    expect(check2.allowed).toBe(false);
    expect(check2.remainingTokens).toBe(0);

    const entries = await ledger.listEntries({ keyId: 'key-test-1' });
    expect(entries.length).toBe(2);

    await ledger.resetDay(stats.dayUtc);
    const afterReset = await ledger.getKeyDailyUsage('key-test-1');
    expect(afterReset.requests).toBe(0);
    expect(afterReset.tokens).toBe(0);
  });

  it('is accessible via createPersistence', () => {
    const memory = createPersistence({ backend: 'memory' });
    expect(memory.quotaLedger).toBeDefined();
    expect(memory.quotaLedger).toBeInstanceOf(DurableQuotaLedger);
  });
});

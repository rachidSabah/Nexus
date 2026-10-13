import { describe, expect, it } from 'vitest';

import { RequestCoalescer } from '../src/application/request-coalescer.js';

describe('RequestCoalescer (In-flight Request Deduplication)', () => {
  it('executes a single request normally when no concurrent requests exist', async () => {
    const coalescer = new RequestCoalescer();
    let executions = 0;

    const res = await coalescer.coalesce('key-1', async () => {
      executions++;
      return { ok: true, data: 42 };
    });

    expect(res.coalesced).toBe(false);
    expect(res.result).toEqual({ ok: true, data: 42 });
    expect(res.waitersCount).toBe(1);
    expect(executions).toBe(1);

    const stats = coalescer.getStats();
    expect(stats.totalExecutions).toBe(1);
    expect(stats.totalCoalesced).toBe(0);
    expect(stats.inFlightCount).toBe(0);
  });

  it('coalesces concurrent requests for the same key onto a single underlying execution', async () => {
    const coalescer = new RequestCoalescer();
    let executions = 0;

    // Simulate an async provider call taking 50ms
    const task = async () => {
      executions++;
      await new Promise((r) => setTimeout(r, 50));
      return { payload: 'model response', timestamp: Date.now() };
    };

    // Fire 4 concurrent requests for the same key
    const [r1, r2, r3, r4] = await Promise.all([
      coalescer.coalesce('req-canonical-key-1', task, { requestId: 'req-1', model: 'claude-3-5-sonnet' }),
      coalescer.coalesce('req-canonical-key-1', task, { requestId: 'req-2', model: 'claude-3-5-sonnet' }),
      coalescer.coalesce('req-canonical-key-1', task, { requestId: 'req-3', model: 'claude-3-5-sonnet' }),
      coalescer.coalesce('req-canonical-key-1', task, { requestId: 'req-4', model: 'claude-3-5-sonnet' }),
    ]);

    // Exactly one underlying execution occurred!
    expect(executions).toBe(1);

    // Primary request was not coalesced; 3 secondary requests were coalesced!
    expect(r1.coalesced).toBe(false);
    expect(r2.coalesced).toBe(true);
    expect(r3.coalesced).toBe(true);
    expect(r4.coalesced).toBe(true);

    // All received the same underlying payload
    expect(r1.result.payload).toBe('model response');
    expect(r2.result.payload).toBe('model response');
    expect(r3.result.payload).toBe('model response');
    expect(r4.result.payload).toBe('model response');

    // Waiters reference original request ID
    expect(r2.originalRequestId).toBe('req-1');
    expect(r3.originalRequestId).toBe('req-1');
    expect(r4.originalRequestId).toBe('req-1');

    // Stats reflect 1 execution, 3 coalesced, 0 left in-flight
    const stats = coalescer.getStats();
    expect(stats.totalExecutions).toBe(1);
    expect(stats.totalCoalesced).toBe(3);
    expect(stats.inFlightCount).toBe(0);
    expect(stats.savedLatencyMs).toBeGreaterThan(0);
  });

  it('does NOT coalesce requests with different keys', async () => {
    const coalescer = new RequestCoalescer();
    let executions = 0;

    const task = async (val: string) => {
      executions++;
      await new Promise((r) => setTimeout(r, 30));
      return val;
    };

    const [rA, rB] = await Promise.all([
      coalescer.coalesce('key-A', () => task('A')),
      coalescer.coalesce('key-B', () => task('B')),
    ]);

    expect(executions).toBe(2);
    expect(rA.coalesced).toBe(false);
    expect(rB.coalesced).toBe(false);
    expect(rA.result).toBe('A');
    expect(rB.result).toBe('B');

    const stats = coalescer.getStats();
    expect(stats.totalExecutions).toBe(2);
    expect(stats.totalCoalesced).toBe(0);
  });

  it('propagates failure to all coalesced callers and cleans up in-flight map', async () => {
    const coalescer = new RequestCoalescer();
    let executions = 0;

    const failingTask = async () => {
      executions++;
      await new Promise((r) => setTimeout(r, 30));
      throw new Error('Provider 500 Overloaded');
    };

    const results = await Promise.allSettled([
      coalescer.coalesce('fail-key', failingTask),
      coalescer.coalesce('fail-key', failingTask),
    ]);

    expect(executions).toBe(1);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    if (results[0].status === 'rejected') {
      expect((results[0].reason as Error).message).toBe('Provider 500 Overloaded');
    }
    if (results[1].status === 'rejected') {
      expect((results[1].reason as Error).message).toBe('Provider 500 Overloaded');
    }

    // Key is cleaned up so subsequent calls can retry
    expect(coalescer.getStats().inFlightCount).toBe(0);

    const retry = await coalescer.coalesce('fail-key', async () => 'recovered');
    expect(retry.coalesced).toBe(false);
    expect(retry.result).toBe('recovered');
  });

  it('handles client abort signals without canceling shared in-flight task for other waiters', async () => {
    const coalescer = new RequestCoalescer();
    const abortCtrl = new AbortController();

    const longTask = async (signal?: AbortSignal) => {
      await new Promise((r, reject) => {
        const timeout = setTimeout(r, 60);
        signal?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Underlying task aborted'));
        });
      });
      return 'completed';
    };

    // Caller 1 starts without abort
    const p1 = coalescer.coalesce('abort-key', longTask);

    // Caller 2 starts with an abort signal, and aborts after 10ms
    const p2 = coalescer.coalesce('abort-key', longTask, { signal: abortCtrl.signal });
    setTimeout(() => abortCtrl.abort(), 10);

    // p2 should reject due to abort, while p1 should succeed!
    await expect(p2).rejects.toThrow();
    const res1 = await p1;
    expect(res1.result).toBe('completed');
  });
});

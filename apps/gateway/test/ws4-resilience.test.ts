import { describe, it, expect } from 'vitest';
import { DetachedTaskStore } from '../src/detached-task-store.js';
import { newStreamState } from '../src/anthropic-compat.js';

describe('WS4-C DetachedTaskStore', () => {
  it('tracks pending → running → completed with content + usage', () => {
    const store = new DetachedTaskStore();
    const job = store.create('opencode-zen/hy3-free');
    expect(job.status).toBe('pending');
    store.start(job.id);
    expect(store.get(job.id)!.status).toBe('running');
    store.complete(job.id, 'hello world', { promptTokens: 3, completionTokens: 2, totalTokens: 5 });
    const done = store.get(job.id)!;
    expect(done.status).toBe('completed');
    expect(done.content).toBe('hello world');
    expect(done.usage!.totalTokens).toBe(5);
  });

  it('records failure with message', () => {
    const store = new DetachedTaskStore();
    const job = store.create('m');
    store.fail(job.id, 'upstream 401');
    expect(store.get(job.id)!.status).toBe('failed');
    expect(store.get(job.id)!.error).toBe('upstream 401');
  });

  it('gc drops finished jobs older than maxAgeMs', () => {
    const store = new DetachedTaskStore();
    const job = store.create('m');
    store.complete(job.id, 'x');
    // Force finishedAt into the past beyond the GC window.
    store.get(job.id)!.finishedAt = Date.now() - 7 * 60 * 60 * 1000;
    store.gc(6 * 60 * 60 * 1000);
    expect(store.get(job.id)).toBeUndefined();
  });
});

describe('WS4-A newStreamState', () => {
  it('initializes committedBytes + midStreamRetried for mid-stream failover', () => {
    const s = newStreamState('m');
    expect(s.committedBytes).toBe(0);
    expect(s.midStreamRetried).toBe(false);
  });
});

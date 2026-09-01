import { describe, it, expect } from 'vitest';

import {
  KeyRegistry,
  RoutingEngine,
  InMemoryEventBus,
  ProviderResponseError,
  NoEligibleProviderError,
  classifyFailure,
} from '../src/index.js';

/** Minimal in-memory CredentialVaultPort implementation for tests. */
class FakeVault {
  private store = new Map<string, string>();
  async get(id: string): Promise<string | undefined> { return this.store.get(id); }
  async set(id: string, secret: string): Promise<void> { this.store.set(id, secret); }
  async delete(id: string): Promise<void> { this.store.delete(id); }
  async list(): Promise<readonly string[]> { return Array.from(this.store.keys()); }
}

function endpoint(id: string, providerId: string, health: 'healthy' | 'degraded' | 'circuit_open' = 'healthy') {
  return {
    id, providerId, displayName: providerId,
    capabilities: {}, pricing: {}, priority: 1, weight: 1, health,
    tags: [], timeoutMs: 30000, maxRetries: 2, concurrencyLimit: 10,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

describe('failure injection: error classification (TEST 2-6, 8)', () => {
  it('TEST 3: 401 → invalidate key, retryable for failover/rotation', () => {
    const c = classifyFailure(new ProviderResponseError('e', 401, 'bad key'));
    expect(c.keyAction).toBe('invalidate');
    expect(c.retryable).toBe(true);
  });

  it('TEST 2: 429 → cooldown key, retryable', () => {
    const c = classifyFailure(new ProviderResponseError('e', 429, 'rate limited'));
    expect(c.keyAction).toBe('cooldown');
    expect(c.retryable).toBe(true);
  });

  it('TEST 5: 404 → NO key action, endpoint degraded (not circuit broken), retryable failover', () => {
    const c = classifyFailure(new ProviderResponseError('e', 404, 'model not found'));
    expect(c.keyAction).toBe('none');
    expect(c.endpointAction).toBe('record_failure');
    expect(c.retryable).toBe(true);
  });

  it('TEST 4: 500 → key is NOT revoked, endpoint marked degraded, retryable', () => {
    const c = classifyFailure(new ProviderResponseError('e', 500, 'server error'));
    expect(c.keyAction).toBe('none');
    expect(c.endpointAction).toBe('mark_degraded');
    expect(c.retryable).toBe(true);
  });

  it('TEST 8: 503 → provider availability failure, retryable (failover)', () => {
    const c = classifyFailure(new ProviderResponseError('e', 503, 'unavailable'));
    expect(c.keyAction).toBe('none');
    expect(c.retryable).toBe(true);
  });
});

describe('failure injection: key lifecycle (TEST 1-4, 7)', () => {
  async function registryWith(keys: { id: string; provider: string }[]) {
    const vault = new FakeVault();
    const r = new KeyRegistry(vault as never, { cooldownMs: 60000 });
    for (const k of keys) await r.register({ id: k.id, providerId: k.provider, plaintext: `sk-${k.id}` });
    return r;
  }

  it('TEST 1: success keeps the key eligible', async () => {
    const r = await registryWith([{ id: 'k1', provider: 'opencode-zen' }]);
    r.recordSuccess('k1', 300, 100);
    expect(r.select('opencode-zen')).toBe('k1');
  });

  it('TEST 2: 429 on k1 → cooldown, next request uses k2', async () => {
    const r = await registryWith([
      { id: 'k1', provider: 'opencode-zen' },
      { id: 'k2', provider: 'opencode-zen' },
    ]);
    r.recordFailure('k1', 429, true);
    const picks = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const id = r.select('opencode-zen');
      if (id) picks.add(id);
    }
    expect(picks.has('k1')).toBe(false);
    expect(picks.has('k2')).toBe(true);
  });

  it('TEST 3: 401 on k1 → permanently excluded from rotation', async () => {
    const r = await registryWith([
      { id: 'k1', provider: 'opencode-zen' },
      { id: 'k2', provider: 'opencode-zen' },
    ]);
    r.recordFailure('k1', 401, false);
    expect(r.get('k1')!.status).toBe('invalid');
    for (let i = 0; i < 5; i++) expect(r.select('opencode-zen')).toBe('k2');
  });

  it('TEST 4: 500 on k1 → key stays active (NOT revoked)', async () => {
    const r = await registryWith([{ id: 'k1', provider: 'opencode-zen' }]);
    r.recordFailure('k1', 500, true);
    expect(r.get('k1')!.status).toBe('active');
    expect(r.select('opencode-zen')).toBe('k1');
  });

  it('TEST 7: all keys cooldown → select() returns undefined (clean 503 path)', async () => {
    const r = await registryWith([
      { id: 'k1', provider: 'opencode-zen' },
      { id: 'k2', provider: 'opencode-zen' },
    ]);
    r.recordFailure('k1', 429, true);
    r.recordFailure('k2', 429, true);
    expect(r.select('opencode-zen')).toBeUndefined();
  });

  it('TEST 6: per-provider isolation — cooldown on one provider does not affect another', async () => {
    const r = await registryWith([
      { id: 'zen-k', provider: 'opencode-zen' },
      { id: 'nvidia-k', provider: 'nvidia-nim' },
    ]);
    r.recordFailure('zen-k', 429, true);
    expect(r.select('opencode-zen')).toBeUndefined();
    expect(r.select('nvidia-nim')).toBe('nvidia-k');
  });
});

describe('failure injection: routing must not leak concrete models cross-provider', () => {
  it('preferredProviders locks candidates to the owning provider when healthy', async () => {
    const bus = new InMemoryEventBus();
    const engine = new RoutingEngine(bus);
    engine.registerEndpoint(endpoint('auto-opencode-zen', 'opencode-zen'));
    engine.registerEndpoint(endpoint('auto-nvidia-nim', 'nvidia-nim'));

    const decision = await engine.resolve({
      model: 'big-pickle',
      preferredProviders: ['opencode-zen'],
      requestId: 'r1',
    });
    expect(decision.endpoint.providerId).toBe('opencode-zen');
    expect(decision.alternatives).toHaveLength(0);
  });

  it('owner circuit_open + provider lock → clean NoEligibleProviderError (no leak to nvidia)', async () => {
    const bus = new InMemoryEventBus();
    const engine = new RoutingEngine(bus);
    engine.registerEndpoint(endpoint('auto-opencode-zen', 'opencode-zen', 'circuit_open'));
    engine.registerEndpoint(endpoint('auto-nvidia-nim', 'nvidia-nim'));

    await expect(
      engine.resolve({ model: 'big-pickle', preferredProviders: ['opencode-zen'], requestId: 'r2' }),
    ).rejects.toBeInstanceOf(NoEligibleProviderError);
  });

  it('without a lock hint the engine may pick any healthy provider', async () => {
    const bus = new InMemoryEventBus();
    const engine = new RoutingEngine(bus);
    engine.registerEndpoint(endpoint('auto-opencode-zen', 'opencode-zen'));
    engine.registerEndpoint(endpoint('auto-nvidia-nim', 'nvidia-nim'));

    const decision = await engine.resolve({ model: 'deepseek-v4-flash-free', requestId: 'r3' });
    expect(['opencode-zen', 'nvidia-nim']).toContain(decision.endpoint.providerId);
  });
});

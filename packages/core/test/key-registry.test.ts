import { describe, it, expect, beforeEach } from 'vitest';

import { KeyRegistry } from '../src/index.js';
import { InMemoryEventBus } from '../src/index.js';

/** Minimal in-memory CredentialVaultPort implementation for tests. */
class FakeVault {
  private store = new Map<string, string>();
  async get(id: string): Promise<string | undefined> { return this.store.get(id); }
  async set(id: string, secret: string): Promise<void> { this.store.set(id, secret); }
  async delete(id: string): Promise<void> { this.store.delete(id); }
  async list(): Promise<readonly string[]> { return Array.from(this.store.keys()); }
}

describe('KeyRegistry', () => {
  let registry: KeyRegistry;
  let vault: FakeVault;

  beforeEach(() => {
    vault = new FakeVault();
    registry = new KeyRegistry(vault as never, { cooldownMs: 100 });
  });

  it('registers keys and stores plaintext in the vault', async () => {
    const desc = await registry.register({
      id: 'openai-key-1',
      providerId: 'openai',
      plaintext: 'sk-test-1234567890',
      label: 'work',
    });
    expect(desc.id).toBe('openai-key-1');
    expect(desc.providerId).toBe('openai');
    expect(desc.lastFour).toBe('7890');
    expect(desc.status).toBe('active');
    expect(await vault.get('openai-key-1')).toBe('sk-test-1234567890');
  });

  it('rejects duplicate key ids', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    await expect(registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-bbb' }))
      .rejects.toThrow(/already registered/);
  });

  it('lists keys by provider', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    await registry.register({ id: 'k2', providerId: 'openai', plaintext: 'sk-bbb' });
    await registry.register({ id: 'k3', providerId: 'anthropic', plaintext: 'sk-ccc' });
    expect(registry.listByProvider('openai').length).toBe(2);
    expect(registry.listByProvider('anthropic').length).toBe(1);
    expect(registry.listAll().length).toBe(3);
  });

  it('selects the only active key', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    expect(registry.select('openai')).toBe('k1');
  });

  it('returns undefined when no keys are registered', () => {
    expect(registry.select('openai')).toBeUndefined();
  });

  it('returns undefined when all keys are on cooldown', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    registry.recordFailure('k1', 429, true);
    expect(registry.select('openai')).toBeUndefined();
  });

  it('expires cooldown after the configured duration', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    registry.recordFailure('k1', 429, true);
    expect(registry.select('openai')).toBeUndefined();
    // Wait for cooldown to expire.
    await new Promise((r) => setTimeout(r, 150));
    expect(registry.select('openai')).toBe('k1');
  });

  it('round-robin rotates through active keys', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    await registry.register({ id: 'k2', providerId: 'openai', plaintext: 'sk-bbb' });
    await registry.register({ id: 'k3', providerId: 'openai', plaintext: 'sk-ccc' });
    const picks: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = registry.select('openai', { strategy: 'round_robin' });
      if (id) picks.push(id);
    }
    // Round-robin should produce a repeating 3-key pattern.
    expect(picks.length).toBe(6);
    expect(new Set(picks).size).toBe(3);
    expect(picks[0]).not.toBe(picks[1]);
  });

  it('least-used picks the key with fewest requests', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    await registry.register({ id: 'k2', providerId: 'openai', plaintext: 'sk-bbb' });
    // Make k1 look used.
    registry.recordSuccess('k1', 500, 100);
    registry.recordSuccess('k1', 600, 200);
    // k2 has 0 requests — should be picked.
    expect(registry.select('openai', { strategy: 'least_used' })).toBe('k2');
  });

  it('latency strategy prefers the faster key', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    await registry.register({ id: 'k2', providerId: 'openai', plaintext: 'sk-bbb' });
    registry.recordSuccess('k1', 2000, 100); // slow
    registry.recordSuccess('k2', 200, 100); // fast
    expect(registry.select('openai', { strategy: 'latency' })).toBe('k2');
  });

  it('health strategy prefers the key with higher success rate', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    await registry.register({ id: 'k2', providerId: 'openai', plaintext: 'sk-bbb' });
    // k1: 4 successes, 6 failures (40% success)
    for (let i = 0; i < 4; i++) registry.recordSuccess('k1', 500, 10);
    for (let i = 0; i < 6; i++) registry.recordFailure('k1', 500, true);
    // k2: 8 successes, 2 failures (80% success)
    for (let i = 0; i < 8; i++) registry.recordSuccess('k2', 500, 10);
    for (let i = 0; i < 2; i++) registry.recordFailure('k2', 500, true);
    expect(registry.select('openai', { strategy: 'health' })).toBe('k2');
  });

  it('adaptive strategy gives new keys priority (exploration)', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    registry.recordSuccess('k1', 200, 10); // make k1 look established
    await registry.register({ id: 'k2', providerId: 'openai', plaintext: 'sk-bbb' });
    // k2 has 0 requests — adaptive should pick it first to explore.
    expect(registry.select('openai', { strategy: 'adaptive' })).toBe('k2');
  });

  it('401 marks a key as invalid (removed from rotation)', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    await registry.register({ id: 'k2', providerId: 'openai', plaintext: 'sk-bbb' });
    registry.recordFailure('k1', 401, false);
    // k1 should be skipped; only k2 remains.
    const picks = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const id = registry.select('openai');
      if (id) picks.add(id);
    }
    expect(picks.has('k1')).toBe(false);
    expect(picks.has('k2')).toBe(true);
  });

  it('unregister removes the key from the vault', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    expect(await vault.get('k1')).toBe('sk-aaa');
    const ok = await registry.unregister('k1');
    expect(ok).toBe(true);
    expect(await vault.get('k1')).toBeUndefined();
    expect(registry.get('k1')).toBeUndefined();
  });

  it('reset clears cooldown and invalid state', async () => {
    await registry.register({ id: 'k1', providerId: 'openai', plaintext: 'sk-aaa' });
    registry.recordFailure('k1', 429, true);
    expect(registry.get('k1')!.status).toBe('cooldown');
    registry.reset('k1');
    expect(registry.get('k1')!.status).toBe('active');
    expect(registry.get('k1')!.cooldownUntil).toBe(0);
  });

  it('§18 concurrency: 10 concurrent selections with 3 active keys are distributed', async () => {
    for (const id of ['k1', 'k2', 'k3']) {
      await registry.register({ id, providerId: 'openai', plaintext: `sk-${id}` });
    }
    const picks = await Promise.all(
      Array.from({ length: 10 }, async () => registry.select('openai', { strategy: 'round_robin' })),
    );
    const byKey = new Map<string, number>();
    for (const p of picks) {
      expect(p).toBeDefined();
      byKey.set(p!, (byKey.get(p!) ?? 0) + 1);
    }
    expect(byKey.size).toBe(3);
    for (const [, count] of byKey) expect(count).toBeGreaterThanOrEqual(1);
  });

  it('§18: concurrent picks never return a key in cooldown', async () => {
    for (const id of ['k1', 'k2', 'k3']) {
      await registry.register({ id, providerId: 'openai', plaintext: `sk-${id}` });
    }
    registry.recordFailure('k1', 429, true);
    const picks = await Promise.all(
      Array.from({ length: 10 }, async () => registry.select('openai', { strategy: 'round_robin' })),
    );
    expect(picks.every((p) => p !== 'k1')).toBe(true);
  });

  it('handles multi-key pools of 1, 3, 5, 10, 50, 100 keys with automatic failover and rotation (Phase 21 §7)', async () => {
    for (const poolSize of [1, 3, 5, 10, 50, 100]) {
      const poolRegistry = new KeyRegistry(vault as never, { cooldownMs: 50 });
      const pId = `provider-pool-${poolSize}`;

      // Register N keys
      for (let i = 0; i < poolSize; i++) {
        await poolRegistry.register({
          id: `key-${poolSize}-${i}`,
          providerId: pId,
          plaintext: `sk-pool-${poolSize}-${i}`,
        });
      }

      expect(poolRegistry.listByProvider(pId).length).toBe(poolSize);

      // Verify selection distributes properly
      const picked = new Set<string>();
      const iterations = Math.min(poolSize * 2, 200);
      for (let j = 0; j < iterations; j++) {
        const selected = poolRegistry.select(pId, { strategy: 'round_robin' });
        expect(selected).toBeDefined();
        picked.add(selected!);
      }
      expect(picked.size).toBe(poolSize);

      if (poolSize > 1) {
        // Cooldown first key (429)
        poolRegistry.recordFailure(`key-${poolSize}-0`, 429, true);
        const nextPick = poolRegistry.select(pId, { strategy: 'round_robin' });
        expect(nextPick).toBeDefined();
        expect(nextPick).not.toBe(`key-${poolSize}-0`);

        // Invalidate second key (401)
        if (poolSize > 2) {
          poolRegistry.recordFailure(`key-${poolSize}-1`, 401, false);
          expect(poolRegistry.get(`key-${poolSize}-1`)?.status).toBe('invalid');
          const safePick = poolRegistry.select(pId);
          expect(safePick).toBeDefined();
          expect(safePick).not.toBe(`key-${poolSize}-1`);
        }
      }
    }
  });

  it('honors provider Retry-After for a precise 429 cooldown (master prompt #5)', async () => {
    await registry.register({ id: 'openai-key-1', providerId: 'openai', plaintext: 'sk-aaa' });
    registry.recordFailure('openai-key-1', 429, true, 30_000);
    const k = registry.get('openai-key-1')!;
    expect(k.status).toBe('cooldown');
    // Cooldown should end ~30s out, NOT the default 100ms.
    expect(k.cooldownUntil).toBeGreaterThan(Date.now() + 20_000);
  });

  it('falls back to the configured default cooldown when no Retry-After is given', async () => {
    await registry.register({ id: 'openai-key-1', providerId: 'openai', plaintext: 'sk-aaa' });
    registry.recordFailure('openai-key-1', 429, true);
    const k = registry.get('openai-key-1')!;
    expect(k.status).toBe('cooldown');
    // Default cooldownMs is 100 in this suite.
    expect(k.cooldownUntil).toBeGreaterThanOrEqual(Date.now());
    expect(k.cooldownUntil).toBeLessThanOrEqual(Date.now() + 200);
  });

  it('escalates a repeated 429 cooldown while already cooling down', async () => {
    await registry.register({ id: 'openai-key-1', providerId: 'openai', plaintext: 'sk-aaa' });
    registry.recordFailure('openai-key-1', 429, true, 5_000);
    const first = registry.get('openai-key-1')!;
    expect(first.cooldownUntil).toBeGreaterThan(Date.now() + 4_000);
    // Second 429 before cooldown expires → escalate (>= 5s, capped logic).
    registry.recordFailure('openai-key-1', 429, true, 5_000);
    const second = registry.get('openai-key-1')!;
    // Should be at least as far out as the first window.
    expect(second.cooldownUntil).toBeGreaterThanOrEqual(first.cooldownUntil);
    expect(second.status).toBe('cooldown');
  });

  it('a successful request clears a Retry-After cooldown immediately', async () => {
    await registry.register({ id: 'openai-key-1', providerId: 'openai', plaintext: 'sk-aaa' });
    registry.recordFailure('openai-key-1', 429, true, 60_000);
    expect(registry.get('openai-key-1')!.status).toBe('cooldown');
    registry.recordSuccess('openai-key-1', 200, 10);
    expect(registry.get('openai-key-1')!.status).toBe('active');
    expect(registry.get('openai-key-1')!.cooldownUntil).toBe(0);
  });
});

describe('KeyRegistry concurrency cap (P5, master prompt #15)', () => {
  it('acquire/release track in-flight requests without going negative', async () => {
    const vault = new FakeVault();
    const reg = new KeyRegistry(vault as never, { defaultConcurrencyLimit: 2 });
    await reg.register({ id: 'k1', providerId: 'p', plaintext: 'sk-1' });
    expect(reg.acquire('k1')).toBe(true);
    expect(reg.acquire('k1')).toBe(true);
    expect(reg.acquire('k1')).toBe(false); // at cap
    reg.release('k1');
    expect(reg.acquire('k1')).toBe(true); // freed a slot
    reg.release('k1');
    reg.release('k1');
    reg.release('k1'); // clamp at 0
  });

  it('select() skips a saturated key and picks an available one', async () => {
    const vault = new FakeVault();
    const reg = new KeyRegistry(vault as never, { defaultConcurrencyLimit: 1 });
    await reg.register({ id: 'k1', providerId: 'p', plaintext: 'sk-1' });
    await reg.register({ id: 'k2', providerId: 'p', plaintext: 'sk-2' });

    const first = reg.select('p', { strategy: 'round_robin' });
    expect(first).toBe('k1');
    // k1 is reserved (activeRequests=1 == cap=1). select must skip it and pick k2.
    const second = reg.select('p', { strategy: 'round_robin' });
    expect(second).toBe('k2');

    reg.release('k1');
    reg.release('k2');
    // Now both free again; round-robin advanced so the next pick is k2.
    const third = reg.select('p', { strategy: 'round_robin' });
    expect(third).toBe('k2');
  });

  it('select() returns undefined when every key is saturated (caller fails over)', async () => {
    const vault = new FakeVault();
    const reg = new KeyRegistry(vault as never, { defaultConcurrencyLimit: 1 });
    await reg.register({ id: 'k1', providerId: 'p', plaintext: 'sk-1' });
    reg.select('p'); // reserves k1
    expect(reg.select('p')).toBeUndefined(); // k1 saturated, no other key
  });

  it('respects a per-key concurrencyLimit over the registry default', async () => {
    const vault = new FakeVault();
    const reg = new KeyRegistry(vault as never, { defaultConcurrencyLimit: 5 });
    await reg.register({ id: 'k1', providerId: 'p', plaintext: 'sk-1', concurrencyLimit: 1 });
    expect(reg.select('p')).toBe('k1');
    expect(reg.acquire('k1')).toBe(false); // per-key cap is 1, not 5
  });

  it('is uncapped when no default and no per-key limit are set', async () => {
    const vault = new FakeVault();
    const reg = new KeyRegistry(vault as never);
    await reg.register({ id: 'k1', providerId: 'p', plaintext: 'sk-1' });
    for (let i = 0; i < 50; i++) expect(reg.acquire('k1')).toBe(true);
    for (let i = 0; i < 50; i++) reg.release('k1');
  });
});

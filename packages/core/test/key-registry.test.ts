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
});

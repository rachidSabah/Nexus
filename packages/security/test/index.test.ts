import { describe, it, expect, beforeEach } from 'vitest';

import {
  EncryptedCredentialVault,
  RbacService,
  BUILTIN_ROLES,
  JwtService,
  hashApiKey,
} from '../src/index.js';

describe('EncryptedCredentialVault', () => {
  it('encrypts and decrypts secrets with the same master key', async () => {
    const v1 = new EncryptedCredentialVault('master-key-123');
    const v2 = new EncryptedCredentialVault('master-key-123');
    await v1.set('openai', 'sk-secret');
    const list = await v1.list();
    expect(list).toContain('openai');
    // We can't read from v2 because v1's storage is in-memory only.
    expect(await v1.get('openai')).toBe('sk-secret');
    expect(await v2.get('openai')).toBeUndefined();
  });

  it('returns undefined for unknown provider', async () => {
    const v = new EncryptedCredentialVault('master-key-123');
    expect(await v.get('unknown')).toBeUndefined();
  });

  it('deletes secrets', async () => {
    const v = new EncryptedCredentialVault('master-key-123');
    await v.set('openai', 'sk-secret');
    await v.delete('openai');
    expect(await v.get('openai')).toBeUndefined();
  });

  it('cannot decrypt with wrong master key', async () => {
    const v1 = new EncryptedCredentialVault('master-key-123');
    const v2 = new EncryptedCredentialVault('different-key');
    await v1.set('openai', 'sk-secret');
    // Steal v1's encrypted blob and try to decrypt with v2's key.
    const encrypted = (v1 as unknown as { store: Map<string, string> }).store.get('openai')!;
    (v2 as unknown as { store: Map<string, string> }).store.set('openai', encrypted);
    await expect(v2.get('openai')).rejects.toThrow();
  });
});

describe('RbacService', () => {
  let rbac: RbacService;

  beforeEach(() => {
    rbac = new RbacService();
    for (const role of Object.values(BUILTIN_ROLES)) rbac.registerRole(role);
    rbac.registerPrincipal({ id: 'admin-user', roles: ['admin'] });
    rbac.registerPrincipal({ id: 'dev-user', roles: ['developer'] });
    rbac.registerPrincipal({ id: 'viewer-user', roles: ['viewer'] });
  });

  it('admin has access to everything', () => {
    expect(rbac.authorize('admin-user', 'gateway:chat', '/v1/chat/completions')).toBe(true);
    expect(rbac.authorize('admin-user', 'providers:write', '/v1/providers')).toBe(true);
    expect(rbac.authorize('admin-user', 'anything:else', '/x')).toBe(true);
  });

  it('developer has limited access', () => {
    expect(rbac.authorize('dev-user', 'gateway:chat', '/v1/chat/completions')).toBe(true);
    expect(rbac.authorize('dev-user', 'gateway:stream', '/v1/chat/completions')).toBe(true);
    expect(rbac.authorize('dev-user', 'providers:write', '/v1/providers')).toBe(false);
  });

  it('viewer is read-only', () => {
    expect(rbac.authorize('viewer-user', 'providers:read', '/v1/providers')).toBe(true);
    expect(rbac.authorize('viewer-user', 'metrics:read', '/metrics')).toBe(true);
    expect(rbac.authorize('viewer-user', 'gateway:chat', '/v1/chat/completions')).toBe(false);
  });

  it('returns false for unknown principal', () => {
    expect(rbac.authorize('unknown', 'gateway:chat', '/')).toBe(false);
  });

  it('supports wildcard permissions', () => {
    expect(rbac.authorize('admin-user', 'some:new:action', '/')).toBe(true);
  });
});

describe('JwtService', () => {
  it('issues and verifies a valid token', () => {
    const jwt = new JwtService('super-secret');
    const token = jwt.issue({ sub: 'user-1', roles: ['developer'] }, 3600);
    const payload = jwt.verify(token);
    expect(payload).not.toBeNull();
    expect(payload?.['sub']).toBe('user-1');
    expect(payload?.['exp']).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects token signed with different secret', () => {
    const jwt1 = new JwtService('secret-1');
    const jwt2 = new JwtService('secret-2');
    const token = jwt1.issue({ sub: 'user-1' });
    expect(jwt2.verify(token)).toBeNull();
  });

  it('rejects expired token', () => {
    const jwt = new JwtService('super-secret');
    const token = jwt.issue({ sub: 'user-1' }, -1); // expired 1 second ago
    expect(jwt.verify(token)).toBeNull();
  });

  it('rejects malformed token', () => {
    const jwt = new JwtService('super-secret');
    expect(jwt.verify('not.a.jwt')).toBeNull();
    expect(jwt.verify('')).toBeNull();
    expect(jwt.verify('aaa.bbb.ccc.ddd')).toBeNull();
  });
});

describe('hashApiKey', () => {
  it('produces a stable SHA-256 hex hash', () => {
    expect(hashApiKey('sk-test')).toBe(hashApiKey('sk-test'));
    expect(hashApiKey('sk-test')).not.toBe(hashApiKey('sk-other'));
    expect(hashApiKey('sk-test')).toMatch(/^[a-f0-9]{64}$/);
  });
});

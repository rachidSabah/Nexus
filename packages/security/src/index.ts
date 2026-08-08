import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { CredentialVaultPort } from '@anx/core';

/**
 * AES-256-GCM credential vault. Secrets are encrypted at rest with a master
 * key derived from `AGENT_NEXUS_VAULT_KEY` (env) via scrypt. If no key is
 * provided, a derived ephemeral key is generated and the vault is in-memory
 * only (lost on restart).
 */
export class EncryptedCredentialVault implements CredentialVaultPort {
  private readonly store = new Map<string, string>(); // providerId -> base64 ciphertext
  private readonly key: Buffer;

  constructor(masterKey?: string, private readonly persistencePath?: string) {
    this.key = scryptSync(masterKey ?? randomBytes(32).toString('hex'), 'anx-vault-salt-v1', 32);
  }

  async get(providerId: string): Promise<string | undefined> {
    const encrypted = this.store.get(providerId);
    if (!encrypted) return undefined;
    return this.decrypt(encrypted);
  }

  async set(providerId: string, secret: string): Promise<void> {
    this.store.set(providerId, this.encrypt(secret));
    await this.persist();
  }

  async delete(providerId: string): Promise<void> {
    this.store.delete(providerId);
    await this.persist();
  }

  async list(): Promise<readonly string[]> {
    return Array.from(this.store.keys());
  }

  // ─────────────────────────────────────────────────────────────────────────

  private encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
  }

  private decrypt(b64: string): string {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  private async persist(): Promise<void> {
    if (!this.persistencePath) return;
    const data = JSON.stringify(Array.from(this.store.entries()));
    await mkdir(dirname(this.persistencePath), { recursive: true });
    await writeFile(this.persistencePath, data, 'utf8');
  }

  async restore(): Promise<void> {
    if (!this.persistencePath) return;
    try {
      const data = await readFile(this.persistencePath, 'utf8');
      const entries = JSON.parse(data) as [string, string][];
      for (const [k, v] of entries) this.store.set(k, v);
    } catch {
      // File doesn't exist yet — that's fine.
    }
  }
}

/**
 * Role-Based Access Control. Roles bundle permissions; principals are
 * assigned one or more roles. The `authorize` method is the single source
 * of truth for "can P do action A on resource R?".
 */
export type Permission = string; // e.g. "gateway:chat", "providers:write"

export interface Role {
  readonly name: string;
  readonly permissions: readonly Permission[];
}

export interface Principal {
  readonly id: string;
  readonly roles: readonly string[];
  readonly apiKeyHash?: string;
}

export class RbacService {
  private readonly roles = new Map<string, Role>();
  private readonly principals = new Map<string, Principal>();

  registerRole(role: Role): void {
    this.roles.set(role.name, role);
  }

  registerPrincipal(principal: Principal): void {
    this.principals.set(principal.id, principal);
  }

  /** Returns all registered principals. Used by the gateway to detect "open install" mode. */
  listPrincipals(): readonly Principal[] {
    return Array.from(this.principals.values());
  }

  /** Returns a principal by id, or undefined. */
  getPrincipal(principalId: string): Principal | undefined {
    return this.principals.get(principalId);
  }

  authorize(principalId: string, action: string, _resource: string): boolean {
    const principal = this.principals.get(principalId);
    if (!principal) return false;
    for (const roleName of principal.roles) {
      const role = this.roles.get(roleName);
      if (!role) continue;
      for (const p of role.permissions) {
        if (this.matches(p, action)) return true;
      }
    }
    return false;
  }

  /**
   * Wildcard permission match. "gateway:*" matches "gateway:chat".
   */
  private matches(permission: string, action: string): boolean {
    if (permission === action) return true;
    // A bare '*' matches everything (admin wildcard).
    if (permission === '*') return true;
    if (permission.endsWith(':*')) {
      return action.startsWith(permission.slice(0, -1));
    }
    return false;
  }
}

/**
 * Built-in roles.
 */
export const BUILTIN_ROLES: Record<string, Role> = {
  admin: {
    name: 'admin',
    permissions: ['*'],
  },
  developer: {
    name: 'developer',
    permissions: ['gateway:chat', 'gateway:embed', 'gateway:stream', 'providers:read'],
  },
  viewer: {
    name: 'viewer',
    permissions: ['providers:read', 'metrics:read'],
  },
  service: {
    name: 'service',
    permissions: ['gateway:*', 'embed:*'],
  },
};

/**
 * JWT issuance / verification using HS256.
 *
 * For production, swap to RS256 / EdDSA. The interface stays the same.
 */
export class JwtService {
  private readonly secret: Buffer;
  private readonly issuer: string;

  constructor(secret: string, issuer = 'agent-nexus-gateway') {
    this.secret = Buffer.from(secret, 'utf8');
    this.issuer = issuer;
  }

  issue(payload: Record<string, unknown>, ttlSeconds = 3600): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      ...payload,
      iss: this.issuer,
      iat: now,
      exp: now + ttlSeconds,
    };
    const h = this.b64url(JSON.stringify(header));
    const p = this.b64url(JSON.stringify(fullPayload));
    const sig = createHmac('sha256', this.secret).update(`${h}.${p}`).digest();
    return `${h}.${p}.${sig.toString('base64url')}`;
  }

  verify(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const h = parts[0]!;
    const p = parts[1]!;
    const sig = parts[2]!;
    const expectedSig = createHmac('sha256', this.secret).update(`${h}.${p}`).digest();
    if (!this.constantTimeEqual(this.b64urlDecode(sig), expectedSig)) return null;
    try {
      const payload = JSON.parse(this.b64urlDecode(p).toString('utf8')) as Record<string, unknown>;
      if (typeof payload['exp'] === 'number' && payload['exp'] < Math.floor(Date.now() / 1000)) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private b64url(s: string): string {
    return Buffer.from(s, 'utf8').toString('base64url');
  }

  private b64urlDecode(s: string): Buffer {
    return Buffer.from(s, 'base64url');
  }

  private constantTimeEqual(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i]! ^ b[i]!;
    }
    return result === 0;
  }
}

/**
 * SHA-256 helper for hashing API keys before storage / lookup.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

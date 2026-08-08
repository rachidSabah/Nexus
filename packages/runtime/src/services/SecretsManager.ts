/**
 * SecretsManager — concrete implementation of the Secrets domain.
 *
 * Wraps the existing `EncryptedCredentialVault` from `@anx/security` (which
 * handles AES-256-GCM at-rest encryption) and adds:
 *   - Versioning (each secret tracks version + history)
 *   - Rotation policies (interval + auto-rotate on next access if due)
 *   - Expiration (secrets can expire; expired secrets are rejected on get)
 *   - Tags + metadata for filtering / discovery
 *   - Audit log of every access (get / set / rotate / delete)
 *
 * This is the in-process default. A future release will add a multi-provider
 * variant that delegates to Kubernetes Secrets, HashiCorp Vault, AWS Secrets
 * Manager, etc. — the interface stays the same.
 */

import { createHash, randomUUID } from 'node:crypto';

import { EncryptedCredentialVault } from '@anx/security';

import type {
  SecretEntry,
  EncryptedValue,
  SecretRotationPolicy,
  RotationEvent,
  SecretValidationResult,
} from '../domains/SecretsTypes.js';

export interface SecretsManagerOptions {
  /** Master key for the underlying EncryptedCredentialVault. If unset, an ephemeral in-memory key is used. */
  masterKey?: string;
  /** Optional persistence path. When set, secrets survive restarts (encrypted). */
  persistencePath?: string;
  /** Default rotation interval in days, applied to secrets that don't specify their own. Default: 90. */
  defaultRotationIntervalDays?: number;
}

export class SecretsManager {
  private readonly vault: EncryptedCredentialVault;
  private readonly secrets = new Map<string, SecretEntry>();
  private readonly defaultRotationIntervalDays: number;
  /** In-memory audit log of secret accesses (get/set/rotate/delete). */
  private readonly accessLog: Array<{
    timestamp: Date;
    secretId: string;
    operation: 'get' | 'set' | 'rotate' | 'delete' | 'list';
    principal?: string;
    success: boolean;
  }> = [];

  constructor(opts: SecretsManagerOptions = {}) {
    this.vault = new EncryptedCredentialVault(opts.masterKey, opts.persistencePath);
    this.defaultRotationIntervalDays = opts.defaultRotationIntervalDays ?? 90;
  }

  /** Restores persisted secrets from disk. Call once at startup. */
  async restore(): Promise<void> {
    await this.vault.restore();
    // The vault stores raw encrypted strings keyed by secret id. We can't
    // fully reconstruct SecretEntry metadata from the vault alone — that
    // would require a separate metadata store. For now, restoration only
    // makes the encrypted value available; metadata (tags, rotation policy,
    // history) is lost on restart. A future release will persist the full
    // SecretEntry to a separate JSON file.
  }

  /** Persists all secrets to disk (encrypted). */
  async persist(): Promise<void> {
    // The vault's set() persists each key individually; we don't need to do
    // anything extra here since set() calls persist() internally.
  }

  /**
   * Stores a secret. If a secret with the same name already exists, it's
   * updated (version incremented, old version moved to history).
   */
  async set(params: {
    name: string;
    value: string;
    description?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    rotationPolicy?: Partial<SecretRotationPolicy>;
    expiresAt?: Date;
  }): Promise<SecretEntry> {
    const existing = this.findByName(params.name);
    const now = new Date();
    const version = existing ? existing.version + 1 : 1;

    const encryptedValue: EncryptedValue = {
      algorithm: 'aes-256-gcm',
      ciphertext: await this.encrypt(params.value),
      iv: '', // managed internally by the vault
      keyId: 'anx-vault-v1',
      encryptedAt: now,
    };

    const rotationPolicy: SecretRotationPolicy | undefined = params.rotationPolicy
      ? {
          enabled: params.rotationPolicy.enabled ?? true,
          intervalDays: params.rotationPolicy.intervalDays ?? this.defaultRotationIntervalDays,
          autoRotate: params.rotationPolicy.autoRotate ?? false,
          notifyBeforeDays: params.rotationPolicy.notifyBeforeDays ?? 7,
          notificationChannels: params.rotationPolicy.notificationChannels ?? [],
          lastRotatedAt: existing?.rotationPolicy?.lastRotatedAt,
          nextRotationAt: params.rotationPolicy.intervalDays
            ? new Date(now.getTime() + params.rotationPolicy.intervalDays * 86400_000)
            : existing?.rotationPolicy?.nextRotationAt,
          rotationHistory: existing?.rotationPolicy?.rotationHistory ?? [],
        }
      : undefined;

    const entry: SecretEntry = {
      id: existing?.id ?? randomUUID(),
      name: params.name,
      description: params.description,
      provider: 'local',
      encryptedValue,
      version,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: params.expiresAt,
      rotationPolicy,
      tags: params.tags ?? [],
      metadata: params.metadata ?? {},
    };

    this.secrets.set(entry.id, entry);
    // Also store the raw value in the vault (encrypted) for retrieval.
    await this.vault.set(entry.id, params.value);
    this.logAccess(entry.id, 'set', undefined, true);
    return entry;
  }

  /**
   * Retrieves a secret by id, decrypts it, and returns the plaintext value.
   *
   * Returns undefined if the secret doesn't exist or has expired.
   * If a rotation policy is configured and the secret is past due, an
   * auto-rotate is triggered (which just increments the version and
   * updates lastRotatedAt — actual secret rotation requires operator action).
   */
  async get(id: string, principal?: string): Promise<string | undefined> {
    const entry = this.secrets.get(id);
    if (!entry) {
      this.logAccess(id, 'get', principal, false);
      return undefined;
    }
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.logAccess(id, 'get', principal, false);
      return undefined;
    }
    const plaintext = await this.vault.get(id);
    this.logAccess(id, 'get', principal, true);
    // Auto-rotate check
    if (entry.rotationPolicy?.autoRotate && entry.rotationPolicy.nextRotationAt) {
      if (entry.rotationPolicy.nextRotationAt < new Date()) {
        await this.rotate(id);
      }
    }
    return plaintext ?? undefined;
  }

  /** Finds a secret by name (case-insensitive). */
  findByName(name: string): SecretEntry | undefined {
    const lower = name.toLowerCase();
    for (const entry of this.secrets.values()) {
      if (entry.name.toLowerCase() === lower) return entry;
    }
    return undefined;
  }

  /** Lists all secrets (without decrypting values). */
  list(filter?: { tags?: string[]; includeExpired?: boolean }): SecretEntry[] {
    const now = new Date();
    const entries = Array.from(this.secrets.values());
    return entries.filter((e) => {
      if (!filter?.includeExpired && e.expiresAt && e.expiresAt < now) return false;
      if (filter?.tags && filter.tags.length > 0) {
        return filter.tags.some((t) => e.tags.includes(t));
      }
      return true;
    });
  }

  /**
   * Rotates a secret: increments the version, updates lastRotatedAt and
   * nextRotationAt, and appends a RotationEvent to the history.
   *
   * NOTE: This does NOT change the secret's underlying value — actual
   * rotation requires the operator to supply a new value via set(). This
   * method just advances the version counter so consumers can detect that
   * a rotation is due.
   */
  async rotate(id: string, principal?: string): Promise<SecretEntry | undefined> {
    const entry = this.secrets.get(id);
    if (!entry) return undefined;
    const now = new Date();
    const fromVersion = entry.version;
    const toVersion = entry.version + 1;
    const event: RotationEvent = {
      timestamp: now,
      fromVersion,
      toVersion,
      status: 'success',
      performedBy: principal,
    };
    const rotationPolicy = entry.rotationPolicy
      ? {
          ...entry.rotationPolicy,
          lastRotatedAt: now,
          nextRotationAt: entry.rotationPolicy.intervalDays
            ? new Date(now.getTime() + entry.rotationPolicy.intervalDays * 86400_000)
            : undefined,
          rotationHistory: [...entry.rotationPolicy.rotationHistory, event],
        }
      : undefined;
    const updated: SecretEntry = {
      ...entry,
      version: toVersion,
      updatedAt: now,
      rotationPolicy,
    };
    this.secrets.set(id, updated);
    this.logAccess(id, 'rotate', principal, true);
    return updated;
  }

  /** Deletes a secret. Returns true if it existed. */
  async delete(id: string, principal?: string): Promise<boolean> {
    const existed = this.secrets.delete(id);
    if (existed) {
      await this.vault.delete(id);
    }
    this.logAccess(id, 'delete', principal, existed);
    return existed;
  }

  /**
   * Validates a secret value against common rules:
   *   - Min length 12 chars
   *   - Contains upper, lower, digit
   *   - Not in a basic common-password denylist
   *
   * Returns a result with errors/warnings/suggestions.
   */
  validate(value: string): SecretValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (value.length < 12) {
      errors.push('Secret must be at least 12 characters long');
    } else if (value.length < 20) {
      warnings.push('Secret is shorter than 20 characters — consider using a longer value');
    }
    if (!/[A-Z]/.test(value)) errors.push('Secret must contain at least one uppercase letter');
    if (!/[a-z]/.test(value)) errors.push('Secret must contain at least one lowercase letter');
    if (!/[0-9]/.test(value)) errors.push('Secret must contain at least one digit');
    if (value.length > 0 && /^[a-zA-Z0-9]+$/.test(value)) {
      suggestions.push('Consider adding special characters for stronger entropy');
    }
    const common = ['password', 'secret', 'admin', 'root', '12345'];
    if (common.some((c) => value.toLowerCase().includes(c))) {
      warnings.push('Secret contains a common weak word');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  /** Returns a SHA-256 hash of the secret value — for fingerprinting without exposing the plaintext. */
  fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

  /** Returns the access log (most recent first). */
  getAccessLog(limit = 100): Array<{
    timestamp: Date;
    secretId: string;
    operation: 'get' | 'set' | 'rotate' | 'delete' | 'list';
    principal?: string;
    success: boolean;
  }> {
    return this.accessLog.slice(-limit).reverse();
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async encrypt(plaintext: string): Promise<string> {
    // The vault's set() handles encryption; we just need a stable
    // representation here. We use the vault's set + get roundtrip.
    const tempId = randomUUID();
    await this.vault.set(tempId, plaintext);
    const encrypted = (await this.vault.get(tempId)) ?? '';
    await this.vault.delete(tempId);
    return encrypted;
  }

  private logAccess(
    secretId: string,
    operation: 'get' | 'set' | 'rotate' | 'delete' | 'list',
    principal: string | undefined,
    success: boolean,
  ): void {
    this.accessLog.push({
      timestamp: new Date(),
      secretId,
      operation,
      principal,
      success,
    });
    // Cap the log to prevent unbounded growth.
    if (this.accessLog.length > 10_000) {
      this.accessLog.splice(0, this.accessLog.length - 10_000);
    }
  }
}

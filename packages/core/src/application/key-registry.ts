/**
 * ───────────────────────────────────────────────────────────────────────────
 * KeyRegistry — multi-API-key per provider with intelligent rotation.
 *
 * Each provider can have N API keys registered. Each key is independently
 * tracked for health, latency, quota, and cooldown state. When the routing
 * engine resolves an endpoint, the chat use case asks the KeyRegistry to
 * select the best key for that endpoint's provider.
 *
 * Rotation strategies:
 *   - round_robin: cursor-based rotation through active keys
 *   - least_used:  pick key with lowest request count
 *   - lru:         pick key with oldest last-success timestamp
 *   - latency:     pick key with lowest EWMA latency
 *   - health:      pick key with highest success rate
 *   - adaptive:    weighted scoring (latency + success + freshness), default
 *
 * Failure handling:
 *   - 429 → cooldown (default 60s, configurable)
 *   - 401/403 → mark invalid (removed from rotation until re-registered)
 *   - 5xx → record failure, may trip if threshold hit
 *
 * All key plaintexts are stored in the CredentialVault (encrypted at rest);
 * the KeyRegistry only holds key IDs + metadata.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { CredentialVaultPort } from './ports.js';

export type KeyRotationStrategy =
  | 'round_robin'
  | 'least_used'
  | 'lru'
  | 'latency'
  | 'health'
  | 'adaptive';

export type KeyStatus = 'active' | 'cooldown' | 'exhausted' | 'invalid';

export interface KeyDescriptor {
  /** Stable id for this key (e.g. "openai-key-01"). User-supplied or auto-generated. */
  readonly id: string;
  /** The provider this key belongs to (e.g. "openai", "anthropic"). */
  readonly providerId: string;
  /** Optional label for the dashboard (e.g. "Work account", "Free tier key"). */
  readonly label?: string;
  /** Last 4 chars of the plaintext key, for display (`sk-••••••abcd`). */
  readonly lastFour: string;

  status: KeyStatus;
  /** Total requests sent using this key. */
  requests: number;
  /** Total tokens consumed (input + output). */
  tokens: number;
  /** Total errors (4xx + 5xx + network). */
  errors: number;
  /** 429-specific count (rate limit hits). */
  rateLimitedCount: number;
  /** EWMA latency in ms (updated on each success). */
  latencyMs: number;
  /** Last successful request timestamp (epoch ms). */
  lastSuccessAt: number;
  /** Last failure timestamp. */
  lastFailureAt: number;
  /** Last failure reason (HTTP status or error code). */
  lastFailureReason?: string;
  /** Cooldown until (epoch ms). 0 = no cooldown. */
  cooldownUntil: number;
  /** When this key was registered. */
  readonly registeredAt: number;
}

export interface KeyRegistryOptions {
  /** Default cooldown duration in ms when a key hits 429. Default: 60_000. */
  cooldownMs?: number;
  /** Default rotation strategy. Default: 'adaptive'. */
  defaultStrategy?: KeyRotationStrategy;
  /** EWMA alpha for latency smoothing (0..1). Default: 0.3. */
  latencyAlpha?: number;
}

export interface SelectKeyOptions {
  strategy?: KeyRotationStrategy;
  /** If true, only return keys whose status is 'active' (skip cooldown). */
  skipCooldown?: boolean;
}

export class KeyRegistry {
  private readonly keys = new Map<string, KeyDescriptor>();
  /** providerId → list of key ids, in registration order. */
  private readonly byProvider = new Map<string, string[]>();
  /** round-robin cursor per provider. */
  private readonly cursors = new Map<string, number>();
  /** Reference to the encrypted credential vault (stores plaintexts). */
  private readonly vault: CredentialVaultPort;
  private readonly cooldownMs: number;
  private readonly defaultStrategy: KeyRotationStrategy;
  private readonly latencyAlpha: number;

  constructor(vault: CredentialVaultPort, opts: KeyRegistryOptions = {}) {
    this.vault = vault;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.defaultStrategy = opts.defaultStrategy ?? 'adaptive';
    this.latencyAlpha = opts.latencyAlpha ?? 0.3;
  }

  /**
   * Registers a new API key for a provider. The plaintext is stored in the
   * encrypted vault under the key id; the KeyRegistry only holds metadata.
   *
   * Returns the key descriptor. Throws if the key id is already registered.
   */
  async register(params: {
    id: string;
    providerId: string;
    plaintext: string;
    label?: string;
  }): Promise<KeyDescriptor> {
    if (this.keys.has(params.id)) {
      throw new Error(`Key '${params.id}' is already registered`);
    }
    // Store plaintext in the vault (encrypted at rest).
    await this.vault.set(params.id, params.plaintext);

    const descriptor: KeyDescriptor = {
      id: params.id,
      providerId: params.providerId,
      label: params.label,
      lastFour: params.plaintext.slice(-4),
      status: 'active',
      requests: 0,
      tokens: 0,
      errors: 0,
      rateLimitedCount: 0,
      latencyMs: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
      cooldownUntil: 0,
      registeredAt: Date.now(),
    };
    this.keys.set(params.id, descriptor);

    const list = this.byProvider.get(params.providerId) ?? [];
    list.push(params.id);
    this.byProvider.set(params.providerId, list);

    return descriptor;
  }

  /** Removes a key from the registry and the vault. */
  async unregister(keyId: string): Promise<boolean> {
    const desc = this.keys.get(keyId);
    if (!desc) return false;
    this.keys.delete(keyId);
    const list = this.byProvider.get(desc.providerId) ?? [];
    const idx = list.indexOf(keyId);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) this.byProvider.delete(desc.providerId);
    await this.vault.delete(keyId);
    return true;
  }

  /** Returns the descriptor for a key, or undefined. */
  get(keyId: string): KeyDescriptor | undefined {
    return this.keys.get(keyId);
  }

  /** Returns all keys for a provider (including cooldown/invalid ones). */
  listByProvider(providerId: string): readonly KeyDescriptor[] {
    const list = this.byProvider.get(providerId) ?? [];
    return list.map((id) => this.keys.get(id)!).filter(Boolean);
  }

  /** Returns all registered keys. */
  listAll(): readonly KeyDescriptor[] {
    return Array.from(this.keys.values());
  }

  /**
   * Selects the best key for a provider using the configured strategy.
   * Returns the key id, or undefined if no active key is available.
   *
   * The plaintext is NOT returned here — call `getPlaintext(keyId)` to
   * retrieve it just before the provider call. This keeps selection cheap
   * and avoids touching the vault on every routing decision.
   */
  select(providerId: string, opts: SelectKeyOptions = {}): string | undefined {
    const strategy = opts.strategy ?? this.defaultStrategy;
    const skipCooldown = opts.skipCooldown ?? true;
    let candidates = this.listByProvider(providerId);

    // Expire cooldowns.
    const now = Date.now();
    for (const k of candidates) {
      if (k.status === 'cooldown' && k.cooldownUntil !== 0 && k.cooldownUntil < now) {
        k.status = 'active';
        k.cooldownUntil = 0;
      }
    }

    if (skipCooldown) {
      candidates = candidates.filter((k) => k.status === 'active');
    }
    if (candidates.length === 0) return undefined;

    switch (strategy) {
      case 'round_robin':
        return this.selectRoundRobin(providerId, candidates);
      case 'least_used':
        return this.selectLeastUsed(candidates);
      case 'lru':
        return this.selectLRU(candidates);
      case 'latency':
        return this.selectLatency(candidates);
      case 'health':
        return this.selectHealth(candidates);
      case 'adaptive':
      default:
        return this.selectAdaptive(candidates);
    }
  }

  /** Retrieves the plaintext key from the vault. Call just before the provider call. */
  async getPlaintext(keyId: string): Promise<string | undefined> {
    return this.vault.get(keyId);
  }

  /**
   * Records a successful request. Updates latency EWMA, request count,
   * token count, last-success timestamp.
   */
  recordSuccess(keyId: string, latencyMs: number, tokens: number): void {
    const k = this.keys.get(keyId);
    if (!k) return;
    k.requests++;
    k.tokens += tokens;
    k.lastSuccessAt = Date.now();
    if (k.latencyMs === 0) {
      k.latencyMs = latencyMs;
    } else {
      k.latencyMs = k.latencyMs * (1 - this.latencyAlpha) + latencyMs * this.latencyAlpha;
    }
    // If the key was on cooldown, a successful request clears it.
    if (k.status === 'cooldown') {
      k.status = 'active';
      k.cooldownUntil = 0;
    }
  }

  /**
   * Records a failed request. Classifies the failure:
   *   - 429 → cooldown (default 60s)
   *   - 401/403 → invalid (removed from rotation until re-registered)
   *   - 5xx → increment errors; status stays active (transient)
   *   - network error → increment errors
   */
  recordFailure(keyId: string, status: number | string, retryable: boolean): void {
    const k = this.keys.get(keyId);
    if (!k) return;
    k.requests++;
    k.errors++;
    k.lastFailureAt = Date.now();
    k.lastFailureReason = String(status);

    if (status === 429) {
      k.rateLimitedCount++;
      k.status = 'cooldown';
      k.cooldownUntil = Date.now() + this.cooldownMs;
      return;
    }
    if (status === 401 || status === 403) {
      k.status = 'invalid';
      return;
    }
    // 5xx, timeouts, network errors: stay active if retryable, otherwise
    // a single failure doesn't take the key out of rotation. The circuit
    // breaker on the endpoint handles sustained failures.
    if (!retryable) {
      // Non-retryable but not auth/quota — likely a 4xx we shouldn't retry.
      // Leave the key active; the request just failed.
    }
  }

  /** Forces a key back to active status (clears cooldown / invalid). */
  reset(keyId: string): boolean {
    const k = this.keys.get(keyId);
    if (!k) return false;
    k.status = 'active';
    k.cooldownUntil = 0;
    return true;
  }

  // ─── Selection strategies ──────────────────────────────────────────────

  private selectRoundRobin(providerId: string, candidates: readonly KeyDescriptor[]): string | undefined {
    if (candidates.length === 0) return undefined;
    const idx = (this.cursors.get(providerId) ?? 0) % candidates.length;
    this.cursors.set(providerId, idx + 1);
    return candidates[idx]?.id;
  }

  private selectLeastUsed(candidates: readonly KeyDescriptor[]): string | undefined {
    if (candidates.length === 0) return undefined;
    let best = candidates[0]!;
    for (const k of candidates) {
      if (k.requests < best.requests) best = k;
    }
    return best.id;
  }

  private selectLRU(candidates: readonly KeyDescriptor[]): string | undefined {
    if (candidates.length === 0) return undefined;
    let best = candidates[0]!;
    for (const k of candidates) {
      if (k.lastSuccessAt < best.lastSuccessAt) best = k;
    }
    return best.id;
  }

  private selectLatency(candidates: readonly KeyDescriptor[]): string | undefined {
    if (candidates.length === 0) return undefined;
    let best = candidates[0]!;
    for (const k of candidates) {
      // Treat 0 latency (never used) as best — give new keys a chance.
      const bestScore = best.latencyMs === 0 ? Infinity : best.latencyMs;
      const kScore = k.latencyMs === 0 ? Infinity : k.latencyMs;
      if (kScore < bestScore) best = k;
    }
    return best.id;
  }

  private selectHealth(candidates: readonly KeyDescriptor[]): string | undefined {
    if (candidates.length === 0) return undefined;
    let best = candidates[0]!;
    let bestScore = this.successRate(best);
    for (const k of candidates) {
      const score = this.successRate(k);
      if (score > bestScore) {
        best = k;
        bestScore = score;
      }
    }
    return best.id;
  }

  /**
   * Adaptive: weighted score combining latency (lower=better), success rate
   * (higher=better), and freshness (more recent success=better). New keys
   * (requests=0) get a bonus so they're tried first.
   */
  private selectAdaptive(candidates: readonly KeyDescriptor[]): string | undefined {
    if (candidates.length === 0) return undefined;
    const now = Date.now();
    let best = candidates[0]!;
    let bestScore = -Infinity;
    for (const k of candidates) {
      // New keys get a strong bonus — explore first.
      if (k.requests === 0) {
        return k.id;
      }
      const successRate = this.successRate(k);
      // Latency score: 1.0 at 0ms, 0.0 at 5000ms.
      const latencyScore = Math.max(0, 1 - (k.latencyMs / 5000));
      // Freshness: 1.0 if just succeeded, decays over 5 minutes.
      const ageSec = (now - k.lastSuccessAt) / 1000;
      const freshnessScore = k.lastSuccessAt === 0 ? 0 : Math.max(0, 1 - (ageSec / 300));
      // Weighted: success rate matters most, then latency, then freshness.
      const score = (successRate * 0.5) + (latencyScore * 0.3) + (freshnessScore * 0.2);
      if (score > bestScore) {
        best = k;
        bestScore = score;
      }
    }
    return best.id;
  }

  private successRate(k: KeyDescriptor): number {
    if (k.requests === 0) return 1.0; // assume good until proven otherwise
    return Math.max(0, 1 - (k.errors / k.requests));
  }
}

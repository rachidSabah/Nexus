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
  | 'weighted'
  | 'adaptive';

export type KeyStatus = 'active' | 'cooldown' | 'exhausted' | 'invalid';

export interface KeyRotationPolicy {
  readonly providerId: string;
  readonly maxAgeDays?: number;
  readonly autoRotate?: boolean;
  readonly rotationSchedule?: string;
  readonly lastRotatedAt?: number;
  readonly notifyWebhook?: string;
}

export interface KeyDescriptor {
  /** Stable id for this key (e.g. "openai-key-01"). User-supplied or auto-generated. */
  readonly id: string;
  /** The provider this key belongs to (e.g. "openai", "anthropic"). */
  readonly providerId: string;
  /** Optional label for the dashboard (e.g. "Work account", "Free tier key"). */
  readonly label?: string;
  /** Last 4 chars of the plaintext key, for display (`sk-••••••abcd`). */
  readonly lastFour: string;
  /** Relative routing weight (1-100) for weighted multi-key selection. Default 1. */
  weight?: number;

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
  /** In-flight request count — used to honor per-key concurrency caps (P5). */
  activeRequests: number;
  /** Optional per-key concurrency cap. When set, select() skips this key once
   *  activeRequests reaches the cap, spreading load across keys instead of
   *  hammering a single one. Undefined → governed by the registry default. */
  concurrencyLimit?: number;
  /** Proactive Rate-Limit Quota Tracking: Remaining TPM/RPM estimated from upstream headers */
  remainingTokens?: number;
  remainingRequests?: number;
  quotaResetAt?: number;
}

export interface KeyRegistryOptions {
  /** Default cooldown duration in ms when a key hits 429. Default: 60_000. */
  cooldownMs?: number;
  /** Default rotation strategy. Default: 'adaptive'. */
  defaultStrategy?: KeyRotationStrategy;
  /** EWMA alpha for latency smoothing (0..1). Default: 0.3. */
  latencyAlpha?: number;
  /**
   * Default per-key concurrency cap (max simultaneous in-flight requests per
   * key). When exceeded, select() routes to a different key. Default:
   * undefined (uncapped) — set this to spread load across a multi-key pool
   * instead of hammering a single key (master prompt #15).
   */
  defaultConcurrencyLimit?: number;
}

export interface SelectKeyOptions {
  strategy?: KeyRotationStrategy;
  /** If true, only return keys whose status is 'active' (skip cooldown). */
  skipCooldown?: boolean;
  /** Per-call concurrency cap override (defaults to the registry/global cap). */
  concurrencyLimit?: number;
}

export class KeyRegistry {
  private readonly keys = new Map<string, KeyDescriptor>();
  /** providerId → list of key ids, in registration order. */
  private readonly byProvider = new Map<string, string[]>();
  /** round-robin cursor per provider. */
  private readonly cursors = new Map<string, number>();
  /** providerId → rotation policy. */
  private readonly rotationPolicies = new Map<string, KeyRotationPolicy>();
  /** Reference to the encrypted credential vault (stores plaintexts). */
  private readonly vault: CredentialVaultPort;
  private readonly cooldownMs: number;
  private readonly defaultStrategy: KeyRotationStrategy;
  private readonly latencyAlpha: number;
  /** Default per-key concurrency cap; undefined = uncapped. */
  private readonly defaultConcurrencyLimit?: number;

  constructor(vault: CredentialVaultPort, opts: KeyRegistryOptions = {}) {
    this.vault = vault;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.defaultStrategy = opts.defaultStrategy ?? 'adaptive';
    this.latencyAlpha = opts.latencyAlpha ?? 0.3;
    this.defaultConcurrencyLimit = opts.defaultConcurrencyLimit;
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
    /** Optional per-key concurrency cap (P5). */
    concurrencyLimit?: number;
  }): Promise<KeyDescriptor> {
    if (this.keys.has(params.id)) {
      throw new Error(`Key '${params.id}' is already registered`);
    }
    // Store plaintext in the vault (encrypted at rest).
    await this.vault.set(params.id, params.plaintext);
    // Also persist metadata so any key id format restores accurately
    await this.vault.set(`__meta__${params.id}`, JSON.stringify({
      providerId: params.providerId,
      label: params.label,
    }));

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
      activeRequests: 0,
      concurrencyLimit: params.concurrencyLimit,
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
    await this.vault.delete(`__meta__${keyId}`);
    return true;
  }

  /**
   * Rehydrates registry metadata from the encrypted vault after a restart.
   * The vault persists plaintexts (keyed by key id); descriptors are rebuilt
   * from those entries so multi-key rotation survives gateway restarts.
   */
  async restoreFromVault(): Promise<number> {
    const ids = await this.vault.list();
    let restored = 0;
    for (const id of ids) {
      if (id.startsWith('__meta__')) continue;
      if (this.keys.has(id)) continue;
      const plaintext = await this.vault.get(id);
      if (!plaintext) continue;

      let providerId: string | undefined;
      let label: string | undefined;

      const metaRaw = await this.vault.get(`__meta__${id}`);
      if (metaRaw) {
        try {
          const meta = JSON.parse(metaRaw) as { providerId?: string; label?: string };
          providerId = meta.providerId;
          label = meta.label;
        } catch {
          // ignore
        }
      }

      if (!providerId) {
        providerId = this.parseProviderId(id);
      }
      if (!providerId) continue;

      const descriptor: KeyDescriptor = {
        id,
        providerId,
        label,
        lastFour: plaintext.slice(-4),
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
        activeRequests: 0,
        concurrencyLimit: undefined,
      };
      this.keys.set(id, descriptor);

      const list = this.byProvider.get(providerId) ?? [];
      list.push(id);
      this.byProvider.set(providerId, list);

      restored += 1;
    }
    return restored;
  }

  private parseProviderId(keyId: string): string | undefined {
    if (keyId.startsWith('__meta__')) return undefined;
    // 1. `{providerId}-key-{suffix}`
    const idx = keyId.lastIndexOf('-key-');
    if (idx > 0) return keyId.slice(0, idx);

    // 2. `key-{providerId}-{suffix}`
    if (keyId.startsWith('key-')) {
      const rest = keyId.slice(4);
      const lastDash = rest.lastIndexOf('-');
      if (lastDash > 0) return rest.slice(0, lastDash);
      return rest;
    }

    // 3. `auto-{providerId}`
    if (keyId.startsWith('auto-')) return keyId.slice(5);

    // 4. Provider id directly (e.g. 'nvidia-nim', 'mistral', 'opencode-zen', etc.)
    return keyId;
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
    const cap = opts.concurrencyLimit ?? this.defaultConcurrencyLimit;
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

    // Honor per-key concurrency caps (P5): skip keys already at their limit so
    // load spreads across the pool instead of hammering one key. When a cap is
    // configured, a saturated-only pool still returns undefined (caller fails
    // over) rather than violating the cap.
    if (cap !== undefined) {
      const eligible = candidates.filter((k) => k.activeRequests < (k.concurrencyLimit ?? cap));
      if (eligible.length > 0) candidates = eligible;
    }

    // Filter out keys nearing rate-limit quota exhaustion (proactive 429 prevention)
    const quotaSafe = candidates.filter(
      (k) =>
        k.remainingRequests === undefined ||
        k.remainingRequests > 2 ||
        (k.quotaResetAt !== undefined && Date.now() > k.quotaResetAt)
    );
    if (quotaSafe.length > 0) candidates = quotaSafe;

    if (candidates.length === 0) return undefined;

    let chosen: string | undefined;
    switch (strategy) {
      case 'round_robin':
        chosen = this.selectRoundRobin(providerId, candidates);
        break;
      case 'least_used':
        chosen = this.selectLeastUsed(candidates);
        break;
      case 'lru':
        chosen = this.selectLRU(candidates);
        break;
      case 'latency':
        chosen = this.selectLatency(candidates);
        break;
      case 'health':
        chosen = this.selectHealth(candidates);
        break;
      case 'weighted':
        chosen = this.selectWeighted(candidates);
        break;
      case 'adaptive':
      default:
        chosen = this.selectAdaptive(candidates);
        break;
    }

    // Atomically reserve the chosen key so concurrent selections don't collide.
    if (chosen && !this.acquire(chosen)) return undefined;
    return chosen;
  }

  /**
   * Increments a key's in-flight counter. Returns false (and does NOT increment)
   * if the key is unknown or already at its concurrency cap — callers should
   * treat that as "not acquirable" and either retry selection or fail over.
   */
  acquire(keyId: string): boolean {
    const k = this.keys.get(keyId);
    if (!k) return false;
    const limit = k.concurrencyLimit ?? this.defaultConcurrencyLimit;
    if (limit !== undefined && k.activeRequests >= limit) return false;
    k.activeRequests++;
    return true;
  }

  /** Decrements a key's in-flight counter (call when the request completes). Clamped at 0. */
  release(keyId: string): void {
    const k = this.keys.get(keyId);
    if (!k) return;
    if (k.activeRequests > 0) k.activeRequests--;
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
    k.tokens += Number.isFinite(tokens) ? tokens : 0;
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
   *   - 429 → cooldown (honors provider `Retry-After` when supplied; escalates
   *           on repeated rate-limits; falls back to the configured default)
   *   - 401/403 → invalid (removed from rotation until re-registered)
   *   - 5xx → increment errors; status stays active (transient)
   *   - network error → increment errors
   *
   * @param retryAfterMs Optional provider-supplied `Retry-After` (ms). When
   *        present on a 429 it sets a precise cooldown rather than a fixed
   *        penalty; repeated 429s within a cooldown escalate the window.
   */
  recordFailure(keyId: string, status: number | string, retryable: boolean, retryAfterMs?: number): void {
    const k = this.keys.get(keyId);
    if (!k) return;
    k.requests++;
    k.errors++;
    k.lastFailureAt = Date.now();
    k.lastFailureReason = String(status);

    const sNum = typeof status === 'number' ? status : parseInt(status, 10);
    if (sNum === 429 || status === '429') {
      k.rateLimitedCount++;
      // Adaptive cooldown: prefer the provider's own Retry-After; otherwise
      // the configured default. Repeated 429s escalate (backoff) so a stuck
      // key doesn't thrash, but a genuine success always clears it.
      let cooldown = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : this.cooldownMs;
      if (k.status === 'cooldown' && k.cooldownUntil > Date.now()) {
        // Already cooling down → extend with escalating backoff, capped at 10m.
        const escalated = Math.min(cooldown * 2, 10 * 60_000);
        cooldown = Math.max(cooldown, escalated);
      }
      // Hard safety cap: a cooldown must ALWAYS expire so a key can never be
      // permanently disabled by an absurd/garbage retryAfter value. Clamp to
      // the escalation ceiling regardless of what upstream reported.
      cooldown = Math.min(cooldown, 10 * 60_000);
      k.status = 'cooldown';
      k.cooldownUntil = Date.now() + cooldown;
      return;
    }
    if (sNum === 401 || sNum === 403 || sNum === 402 || status === '401' || status === '403' || status === '402' || status === 'AUTH_ERROR') {
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

  /** Forces a key back to active status (clears cooldown / invalid / failure error state). */
  reset(keyId: string): boolean {
    const k = this.keys.get(keyId);
    if (!k) return false;
    k.status = 'active';
    k.cooldownUntil = 0;
    k.errors = 0;
    k.rateLimitedCount = 0;
    k.lastFailureReason = undefined;
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

  private selectWeighted(candidates: readonly KeyDescriptor[]): string | undefined {
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0]!.id;
    const totalWeight = candidates.reduce((sum, k) => sum + (k.weight ?? 1), 0);
    let rand = Math.random() * totalWeight;
    for (const k of candidates) {
      rand -= (k.weight ?? 1);
      if (rand <= 0) return k.id;
    }
    return candidates[0]!.id;
  }

  setKeyWeight(keyId: string, weight: number): boolean {
    const k = this.keys.get(keyId);
    if (!k) return false;
    k.weight = Math.max(1, Math.min(100, Math.floor(weight)));
    return true;
  }

  setRotationPolicy(providerId: string, policy: Partial<KeyRotationPolicy>): KeyRotationPolicy {
    const existing = this.rotationPolicies.get(providerId) ?? { providerId };
    const merged: KeyRotationPolicy = {
      ...existing,
      ...policy,
      providerId,
    };
    this.rotationPolicies.set(providerId, merged);
    return merged;
  }

  getRotationPolicy(providerId: string): KeyRotationPolicy | undefined {
    return this.rotationPolicies.get(providerId);
  }

  listRotationPolicies(): readonly KeyRotationPolicy[] {
    return Array.from(this.rotationPolicies.values());
  }

  getExpiringKeys(maxAgeDays = 90): Array<{ key: KeyDescriptor; ageDays: number; status: 'expired' | 'expiring_soon' | 'valid' }> {
    const now = Date.now();
    const results: Array<{ key: KeyDescriptor; ageDays: number; status: 'expired' | 'expiring_soon' | 'valid' }> = [];
    for (const key of this.keys.values()) {
      const policy = this.rotationPolicies.get(key.providerId);
      const limitDays = policy?.maxAgeDays ?? maxAgeDays;
      const ageMs = now - key.registeredAt;
      const ageDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
      const status: 'expired' | 'expiring_soon' | 'valid' =
        ageDays >= limitDays ? 'expired' : ageDays >= Math.max(1, limitDays - 14) ? 'expiring_soon' : 'valid';
      results.push({ key, ageDays, status });
    }
    return results;
  }

  private successRate(k: KeyDescriptor): number {
    if (k.requests === 0) return 1.0; // assume good until proven otherwise
    return Math.max(0, 1 - (k.errors / k.requests));
  }
}

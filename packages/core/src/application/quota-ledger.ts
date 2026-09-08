/**
 * ───────────────────────────────────────────────────────────────────────────
 * Daily Quota Ledger — tracks cumulative daily requests (RPD) and tokens (TPD)
 * per (keyId, providerId, modelId) with automatic resets at UTC midnight (00:00:00 UTC).
 *
 * Provides time helpers and an in-memory implementation of DailyQuotaLedgerPort.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type {
  DailyQuotaCheckResult,
  DailyQuotaLedgerPort,
  DailyQuotaUsageRecord,
} from './ports.js';

/** Returns the current date in UTC as 'YYYY-MM-DD'. */
export function currentDayUtc(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Computes the epoch timestamp (ms) of the next UTC midnight (00:00:00.000 UTC). */
export function nextUtcMidnight(from: Date = new Date()): number {
  return Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0);
}

/** Returns the milliseconds remaining until the next UTC midnight. */
export function msUntilUtcMidnight(from: Date = new Date()): number {
  return Math.max(0, nextUtcMidnight(from) - from.getTime());
}

/**
 * In-memory reference implementation of DailyQuotaLedgerPort.
 * Used for tests and ephemeral environments.
 */
export class InMemoryDailyQuotaLedger implements DailyQuotaLedgerPort {
  // key: `${keyId}:${providerId}:${modelId}:${dayUtc}`
  private readonly ledger = new Map<string, DailyQuotaUsageRecord>();

  async recordUsage(params: {
    keyId: string;
    providerId: string;
    modelId?: string;
    tokens?: number;
    isError?: boolean;
    timestamp?: number;
  }): Promise<void> {
    const ts = params.timestamp ?? Date.now();
    const dayUtc = currentDayUtc(new Date(ts));
    const modelId = params.modelId ?? '*';
    const compositeKey = `${params.keyId}:${params.providerId}:${modelId}:${dayUtc}`;

    const existing = this.ledger.get(compositeKey);
    const requests = (existing?.requests ?? 0) + 1;
    const tokens = (existing?.tokens ?? 0) + (params.tokens ?? 0);
    const errors = (existing?.errors ?? 0) + (params.isError ? 1 : 0);

    this.ledger.set(compositeKey, {
      keyId: params.keyId,
      providerId: params.providerId,
      modelId,
      dayUtc,
      requests,
      tokens,
      errors,
      updatedAt: ts,
    });
  }

  async getKeyDailyUsage(keyId: string, dayUtc?: string): Promise<{
    requests: number;
    tokens: number;
    errors: number;
    dayUtc: string;
    resetAtUtc: number;
    msUntilReset: number;
  }> {
    const day = dayUtc ?? currentDayUtc();
    let requests = 0;
    let tokens = 0;
    let errors = 0;

    for (const record of this.ledger.values()) {
      if (record.keyId === keyId && record.dayUtc === day) {
        requests += record.requests;
        tokens += record.tokens;
        errors += record.errors;
      }
    }

    const resetAt = nextUtcMidnight();
    return {
      requests,
      tokens,
      errors,
      dayUtc: day,
      resetAtUtc: resetAt,
      msUntilReset: msUntilUtcMidnight(),
    };
  }

  async getProviderDailyUsage(providerId: string, dayUtc?: string): Promise<{
    requests: number;
    tokens: number;
    errors: number;
    dayUtc: string;
    resetAtUtc: number;
    msUntilReset: number;
  }> {
    const day = dayUtc ?? currentDayUtc();
    let requests = 0;
    let tokens = 0;
    let errors = 0;

    for (const record of this.ledger.values()) {
      if (record.providerId === providerId && record.dayUtc === day) {
        requests += record.requests;
        tokens += record.tokens;
        errors += record.errors;
      }
    }

    const resetAt = nextUtcMidnight();
    return {
      requests,
      tokens,
      errors,
      dayUtc: day,
      resetAtUtc: resetAt,
      msUntilReset: msUntilUtcMidnight(),
    };
  }

  async checkQuota(
    keyId: string,
    limits: { maxDailyRequests?: number; maxDailyTokens?: number },
    dayUtc?: string,
  ): Promise<DailyQuotaCheckResult> {
    const usage = await this.getKeyDailyUsage(keyId, dayUtc);
    let allowed = true;
    let remainingRequests: number | undefined;
    let remainingTokens: number | undefined;

    if (limits.maxDailyRequests !== undefined) {
      remainingRequests = Math.max(0, limits.maxDailyRequests - usage.requests);
      if (usage.requests >= limits.maxDailyRequests) {
        allowed = false;
      }
    }

    if (limits.maxDailyTokens !== undefined) {
      remainingTokens = Math.max(0, limits.maxDailyTokens - usage.tokens);
      if (usage.tokens >= limits.maxDailyTokens) {
        allowed = false;
      }
    }

    return {
      allowed,
      remainingRequests,
      remainingTokens,
      requestsToday: usage.requests,
      tokensToday: usage.tokens,
      errorsToday: usage.errors,
      dayUtc: usage.dayUtc,
      resetAtUtc: usage.resetAtUtc,
      msUntilReset: usage.msUntilReset,
    };
  }

  async listEntries(filter?: { keyId?: string; providerId?: string; dayUtc?: string }): Promise<DailyQuotaUsageRecord[]> {
    let list = Array.from(this.ledger.values());
    if (filter?.keyId) list = list.filter((r) => r.keyId === filter.keyId);
    if (filter?.providerId) list = list.filter((r) => r.providerId === filter.providerId);
    if (filter?.dayUtc) list = list.filter((r) => r.dayUtc === filter.dayUtc);
    return list;
  }

  async clear(): Promise<void> {
    this.ledger.clear();
  }
}

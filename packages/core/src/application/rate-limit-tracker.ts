/**
 * ───────────────────────────────────────────────────────────────────────────
 * ProactiveRateLimitTracker — parses X-RateLimit-* headers from provider
 * responses and proactively switches keys BEFORE the limit is hit.
 *
 * Many providers (OpenAI, Anthropic, Google, Groq, etc.) include headers like:
 *   X-RateLimit-Remaining-Requests: 47
 *   X-RateLimit-Remaining-Tokens: 50000
 *   X-RateLimit-Reset-Requests: 23s
 *   X-RateLimit-Reset-Tokens: 1h
 *   retry-after: 60
 *
 * This tracker captures those headers after each provider call and feeds them
 * into the KeyRegistry so that `select()` can prefer keys with more remaining
 * quota — zero 429 errors.
 *
 * Integration: the HttpServer (or a plugin) extracts response headers and
 * calls `tracker.recordHeaders(keyId, headers)`. The KeyRegistry's adaptive
 * selector then weights by `remainingRequests` / `remainingTokens`.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface RateLimitInfo {
  /** Remaining requests in the current window. */
  remainingRequests?: number;
  /** Remaining tokens in the current window. */
  remainingTokens?: number;
  /** Seconds until the request limit resets. */
  resetRequestsSeconds?: number;
  /** Seconds until the token limit resets. */
  resetTokensSeconds?: number;
  /** Retry-After header value in seconds (from 429 responses). */
  retryAfterSeconds?: number;
  /** When this info was recorded (epoch ms). */
  recordedAt: number;
}

export class ProactiveRateLimitTracker {
  private readonly info = new Map<string, RateLimitInfo>();

  /**
   * Records rate-limit headers from a provider response.
   * Call this after every successful (or 429) provider response.
   */
  recordHeaders(keyId: string, headers: Record<string, string | string[] | undefined>): void {
    const get = (name: string): string | undefined => {
      const v = headers[name] ?? headers[name.toLowerCase()];
      if (Array.isArray(v)) return v[0];
      return v;
    };

    const remainingRequests = this.parseInt(get('x-ratelimit-remaining-requests') ?? get('x-ratelimit-limit-remaining'));
    const remainingTokens = this.parseInt(get('x-ratelimit-remaining-tokens'));
    const resetRequestsSeconds = this.parseDuration(get('x-ratelimit-reset-requests'));
    const resetTokensSeconds = this.parseDuration(get('x-ratelimit-reset-tokens'));
    const retryAfterSeconds = this.parseInt(get('retry-after'));

    // Only record if we got at least one useful field.
    if (remainingRequests === undefined && remainingTokens === undefined && retryAfterSeconds === undefined) {
      return;
    }

    this.info.set(keyId, {
      remainingRequests,
      remainingTokens,
      resetRequestsSeconds,
      resetTokensSeconds,
      retryAfterSeconds,
      recordedAt: Date.now(),
    });
  }

  /** Returns the rate-limit info for a key, or undefined if none recorded. */
  get(keyId: string): RateLimitInfo | undefined {
    const info = this.info.get(keyId);
    if (!info) return undefined;
    // Expire stale entries (older than 5 minutes).
    if (Date.now() - info.recordedAt > 5 * 60 * 1000) {
      this.info.delete(keyId);
      return undefined;
    }
    return info;
  }

  /**
   * Returns a "health score" (0..1) for a key based on rate-limit info.
   * Higher = more remaining quota. If no info, returns 1.0 (assume good).
   */
  getHealthScore(keyId: string): number {
    const info = this.get(keyId);
    if (!info) return 1.0;

    let score = 1.0;
    // If remainingRequests is low, penalize.
    if (info.remainingRequests !== undefined) {
      if (info.remainingRequests <= 0) score = 0;
      else if (info.remainingRequests < 5) score *= info.remainingRequests / 5;
    }
    // If remainingTokens is low, penalize.
    if (info.remainingTokens !== undefined) {
      if (info.remainingTokens <= 0) score = 0;
      else if (info.remainingTokens < 1000) score *= info.remainingTokens / 1000;
    }
    // If retryAfter is set (from a 429), zero the score.
    if (info.retryAfterSeconds !== undefined && info.retryAfterSeconds > 0) {
      score = 0;
    }
    return score;
  }

  /** Returns all tracked keys' rate-limit info (for the dashboard). */
  getAll(): Record<string, RateLimitInfo> {
    const result: Record<string, RateLimitInfo> = {};
    for (const [keyId, info] of this.info) {
      // Expire stale entries during read.
      if (Date.now() - info.recordedAt <= 5 * 60 * 1000) {
        result[keyId] = info;
      }
    }
    return result;
  }

  /** Clears all tracked info. */
  clear(): void {
    this.info.clear();
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private parseInt(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const n = parseInt(value, 10);
    return isNaN(n) ? undefined : n;
  }

  private parseDuration(value: string | undefined): number | undefined {
    if (!value) return undefined;
    // Handle "23s", "1h", "2m", or plain seconds as a number.
    const match = value.match(/^(\d+)([smh])?$/);
    if (!match) return this.parseInt(value);
    const n = parseInt(match[1]!, 10);
    const unit = match[2] ?? 's';
    switch (unit) {
      case 's': return n;
      case 'm': return n * 60;
      case 'h': return n * 3600;
      default: return n;
    }
  }
}

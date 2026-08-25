/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Error Diagnostic Registry
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Maintains live, structured diagnostic records for all provider, key, model,
 * and routing errors. Provides aggregation, querying, and verification-backed
 * resolution state tracking.
 */

import {
  classifyErrorDiagnostic,
  type ClassifyErrorInput,
  type ProviderErrorDiagnostic,
} from '../domain/error-diagnostic.js';

export interface ErrorDiagnosticFilter {
  providerId?: string;
  keyId?: string;
  modelId?: string;
  category?: string;
  resolved?: boolean;
}

export class ErrorDiagnosticRegistry {
  private readonly diagnostics = new Map<string, ProviderErrorDiagnostic>();
  private readonly maxRetained = 2000;

  /**
   * Records a failed request into the registry. If a matching active diagnostic
   * already exists for this provider/key/category, increments its occurrence
   * and consecutive failure counters.
   */
  recordError(input: ClassifyErrorInput): ProviderErrorDiagnostic {
    const fresh = classifyErrorDiagnostic(input);
    const existing = this.diagnostics.get(fresh.id);

    if (existing && !existing.resolved) {
      existing.occurrenceCount++;
      existing.consecutiveFailures++;
      (existing as { lastSeenAt: number }).lastSeenAt = fresh.timestamp;
      (existing as { timestamp: number }).timestamp = fresh.timestamp;
      if (fresh.latencyMs !== undefined) {
        existing.latencyMs = fresh.latencyMs;
      }
      if (fresh.cooldownUntil !== undefined) {
        existing.cooldownUntil = fresh.cooldownUntil;
      }
      if (fresh.circuitBreakerState !== undefined) {
        existing.circuitBreakerState = fresh.circuitBreakerState;
      }
      if (fresh.upstreamMessage) {
        (existing as { upstreamMessage: string }).upstreamMessage = fresh.upstreamMessage;
      }
      return existing;
    }

    // New diagnostic record
    this.diagnostics.set(fresh.id, fresh);

    // Prune if oversized
    if (this.diagnostics.size > this.maxRetained) {
      const oldestKey = this.diagnostics.keys().next().value;
      if (oldestKey) this.diagnostics.delete(oldestKey);
    }

    return fresh;
  }

  /**
   * Records a successful request for a provider/key/model. Resets consecutive
   * failure counts and marks relevant active error diagnostics as resolved.
   */
  recordSuccess(providerId: string, keyId?: string, modelId?: string): void {
    const now = Date.now();
    for (const diag of this.diagnostics.values()) {
      if (diag.providerId !== providerId || diag.resolved) continue;

      // If key-specific, match key
      if (diag.keyId && keyId && diag.keyId === keyId) {
        diag.consecutiveFailures = 0;
        diag.resolved = true;
        diag.resolvedAt = now;
        diag.resolutionAction = 'Verified by live successful request';
      }
      // If model-specific, match model
      else if (diag.modelId && modelId && diag.modelId === modelId) {
        diag.consecutiveFailures = 0;
        diag.resolved = true;
        diag.resolvedAt = now;
        diag.resolutionAction = 'Verified by live successful model completion';
      }
      // If provider-wide error without specific key/model (or general 5xx/network)
      else if (!diag.keyId && !diag.modelId) {
        diag.consecutiveFailures = 0;
        diag.resolved = true;
        diag.resolvedAt = now;
        diag.resolutionAction = 'Verified by live successful provider completion';
      }
    }
  }

  /** Retrieves a diagnostic by ID. */
  get(id: string): ProviderErrorDiagnostic | undefined {
    return this.diagnostics.get(id);
  }

  /** Lists all diagnostics matching optional filter criteria. */
  list(filter: ErrorDiagnosticFilter = {}): ProviderErrorDiagnostic[] {
    let list = Array.from(this.diagnostics.values());

    if (filter.providerId) {
      list = list.filter((d) => d.providerId === filter.providerId);
    }
    if (filter.keyId) {
      list = list.filter((d) => d.keyId === filter.keyId);
    }
    if (filter.modelId) {
      list = list.filter((d) => d.modelId === filter.modelId);
    }
    if (filter.category) {
      list = list.filter((d) => d.category === filter.category);
    }
    if (filter.resolved !== undefined) {
      list = list.filter((d) => d.resolved === filter.resolved);
    }

    return list.sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Lists unresolved active errors for a provider or all providers. */
  listActive(providerId?: string): ProviderErrorDiagnostic[] {
    return this.list({ providerId, resolved: false });
  }

  /** Marks a diagnostic as resolved with verification evidence. */
  markResolved(
    id: string,
    action: string,
    verification: { verified: boolean; message: string; latencyMs?: number },
  ): ProviderErrorDiagnostic | undefined {
    const diag = this.diagnostics.get(id);
    if (!diag) return undefined;

    diag.resolved = verification.verified;
    diag.consecutiveFailures = verification.verified ? 0 : diag.consecutiveFailures;
    if (verification.verified) {
      diag.resolvedAt = Date.now();
      diag.resolutionAction = action;
    }
    diag.lastVerificationResult = {
      verified: verification.verified,
      timestamp: Date.now(),
      latencyMs: verification.latencyMs,
      message: verification.message,
    };

    return diag;
  }

  /** Aggregated error statistics across all providers. */
  stats(): {
    totalRecorded: number;
    activeCount: number;
    resolvedCount: number;
    byProvider: Record<string, { total: number; active: number; categories: Record<string, number> }>;
    byCategory: Record<string, number>;
  } {
    let activeCount = 0;
    let resolvedCount = 0;
    const byProvider: Record<string, { total: number; active: number; categories: Record<string, number> }> = {};
    const byCategory: Record<string, number> = {};

    for (const d of this.diagnostics.values()) {
      if (d.resolved) resolvedCount++;
      else activeCount++;

      byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;

      if (!byProvider[d.providerId]) {
        byProvider[d.providerId] = { total: 0, active: 0, categories: {} };
      }
      const p = byProvider[d.providerId]!;
      p.total++;
      if (!d.resolved) p.active++;
      p.categories[d.category] = (p.categories[d.category] ?? 0) + 1;
    }

    return {
      totalRecorded: this.diagnostics.size,
      activeCount,
      resolvedCount,
      byProvider,
      byCategory,
    };
  }

  /** Clears all resolved or all diagnostics (for testing or hard reset). */
  clear(resolvedOnly = true): void {
    if (!resolvedOnly) {
      this.diagnostics.clear();
      return;
    }
    for (const [id, d] of this.diagnostics.entries()) {
      if (d.resolved) this.diagnostics.delete(id);
    }
  }
}

/**
 * Manual failover / fallback-model configuration.
 *
 * Lets an operator pin an EXPLICIT, ordered list of fallback models for any
 * primary model (e.g. 5 similarly-benchmarked models), instead of relying
 * solely on the automatic failover chain. When configured, the chat path tries
 * the manual fallbacks FIRST (in order) and then falls through to the automatic
 * alternatives — augmenting, never replacing, automatic failover.
 *
 * Config persists to disk via AtomicJsonStore so it survives restarts.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '@anx/persistence';

import type { ModelDescriptor } from '@anx/core';

const DEFAULT_CONFIG: Record<string, string[]> = {};

export interface CandidateModel {
  id: string;
  providerId: string;
  displayName?: string;
  contextWindow?: number;
  /** 0..1 similarity to the primary (higher = closer benchmark tier). */
  similarity: number;
  pricing?: { inputPer1M?: number; outputPer1M?: number; isFree?: boolean };
  capabilities?: Record<string, unknown>;
}

/**
 * Rank models by benchmark-tier similarity to a primary model using:
 *   - context-window proximity (log-scaled)
 *   - capability-flag overlap (reasoning / vision / toolCalling / etc.)
 *   - price proximity (log-scaled, when both priced)
 *
 * Returns the top `limit` candidates EXCLUDING the primary itself. Used to
 * populate the dashboard dropdown with "similar benchmark level" models.
 */
export function rankSimilarModels(
  primary: ModelDescriptor,
  all: readonly ModelDescriptor[],
  limit = 25,
): CandidateModel[] {
  const primCtx = primary.contextWindow ?? 0;
  const primCaps = (primary.capabilities ?? {}) as Record<string, unknown>;
  const primPrice =
    (primary.pricing?.inputPer1M ?? 0) + (primary.pricing?.outputPer1M ?? 0);

  const capKeys = Object.keys(primCaps).filter((k) => primCaps[k] === true);

  const scored = all
    .filter((m) => m.id !== primary.id)
    .map((m) => {
      let score = 0;

      // Context-window proximity (log scale so 8k vs 32k isn't punished as
      // harshly as 8k vs 200k).
      const ctx = m.contextWindow ?? 0;
      if (primCtx > 0 && ctx > 0) {
        const ratio = Math.min(primCtx, ctx) / Math.max(primCtx, ctx);
        score += ratio * 0.45;
      }

      // Capability overlap (Jaccard-ish over active flags).
      const caps = (m.capabilities ?? {}) as Record<string, unknown>;
      const mKeys = Object.keys(caps).filter((k) => caps[k] === true);
      if (capKeys.length > 0) {
        const overlap = capKeys.filter((k) => mKeys.includes(k)).length;
        score += (overlap / capKeys.length) * 0.35;
      } else {
        score += 0.15;
      }

      // Price proximity (log scale). Free models get a small neutral nudge.
      const price = (m.pricing?.inputPer1M ?? 0) + (m.pricing?.outputPer1M ?? 0);
      if (primPrice > 0 && price > 0) {
        const pRatio = Math.min(primPrice, price) / Math.max(primPrice, price);
        score += pRatio * 0.2;
      } else if (primPrice === 0 && price === 0) {
        score += 0.2;
      }

      return {
        id: m.id,
        providerId: m.providerId,
        displayName: m.displayName ?? m.id,
        contextWindow: m.contextWindow,
        similarity: Math.round(score * 1000) / 1000,
        pricing: m.pricing
          ? {
              inputPer1M: m.pricing.inputPer1M,
              outputPer1M: m.pricing.outputPer1M,
              isFree: m.pricing.isFree,
            }
          : undefined,
        capabilities: m.capabilities,
      } as CandidateModel;
    })
    // Only surface models with a meaningful similarity (avoid junk matches).
    .filter((c) => c.similarity >= 0.3)
    .sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, limit);
}

/**
 * Persistent store for manual fallback chains, keyed by resolved model id.
 */
export class FalloverConfigStore {
  private readonly store: AtomicJsonStore<Record<string, string[]>>;

  constructor(configDir?: string) {
    const dir = configDir ?? join(homedir(), '.agent-nexus');
    this.store = new AtomicJsonStore<Record<string, string[]>>(
      join(dir, 'fallover-config.json'),
      DEFAULT_CONFIG,
    );
  }

  get(modelId: string): string[] {
    const all = this.store.read();
    return all[modelId] ?? [];
  }

  set(modelId: string, fallbacks: string[]): void {
    const all = this.store.read();
    if (fallbacks.length === 0) {
      delete all[modelId];
    } else {
      // De-dupe while preserving order.
      const seen = new Set<string>();
      const clean: string[] = [];
      for (const f of fallbacks) {
        if (f && f !== modelId && !seen.has(f)) {
          seen.add(f);
          clean.push(f);
        }
      }
      all[modelId] = clean;
    }
    this.store.write(all);
  }

  all(): Record<string, string[]> {
    return this.store.read();
  }
}

import { ModelDescriptor } from '@anx/core';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * RoutingIndexManager — O(1) set-intersection index for high-scale routing
 * ───────────────────────────────────────────────────────────────────────────
 */
export class RoutingIndexManager {
  private readonly freeSet = new Set<string>();
  private readonly paidSet = new Set<string>();
  private readonly unknownSet = new Set<string>();

  private readonly toolCallingSet = new Set<string>();
  private readonly visionSet = new Set<string>();
  private readonly reasoningSet = new Set<string>();
  private readonly streamingSet = new Set<string>();

  private readonly modelMap = new Map<string, ModelDescriptor>();
  private readonly providerMap = new Map<string, Set<string>>();

  rebuild(models: readonly ModelDescriptor[]): void {
    this.freeSet.clear();
    this.paidSet.clear();
    this.unknownSet.clear();
    this.toolCallingSet.clear();
    this.visionSet.clear();
    this.reasoningSet.clear();
    this.streamingSet.clear();
    this.modelMap.clear();
    this.providerMap.clear();

    for (const m of models) {
      if (m.stale) continue;
      this.modelMap.set(m.id, m);

      // Pricing index
      const isFree = m.pricing?.isFree === true || m.pricing?.freeTier === 'FREE' || m.id.endsWith('-free');
      const isUnknown = m.pricing?.freeTier === 'UNKNOWN' || !m.pricing?.source || m.pricing.source === 'unknown';
      if (isFree) this.freeSet.add(m.id);
      else if (isUnknown) this.unknownSet.add(m.id);
      else this.paidSet.add(m.id);

      // Capabilities index
      if (m.capabilities?.toolCalling) this.toolCallingSet.add(m.id);
      if (m.capabilities?.vision) this.visionSet.add(m.id);
      if (m.capabilities?.reasoning) this.reasoningSet.add(m.id);
      if (m.capabilities?.streaming) this.streamingSet.add(m.id);

      // Provider index
      if (!this.providerMap.has(m.providerId)) {
        this.providerMap.set(m.providerId, new Set());
      }
      this.providerMap.get(m.providerId)!.add(m.id);
    }
  }

  queryCandidates(opts: {
    freeOnly?: boolean;
    toolCalling?: boolean;
    vision?: boolean;
    reasoning?: boolean;
    providerId?: string;
  }): ModelDescriptor[] {
    let candidateIds: Set<string> | undefined;

    const intersect = (set: Set<string>) => {
      if (!candidateIds) {
        candidateIds = new Set(set);
      } else {
        for (const id of candidateIds) {
          if (!set.has(id)) candidateIds.delete(id);
        }
      }
    };

    if (opts.freeOnly) intersect(this.freeSet);
    if (opts.toolCalling) intersect(this.toolCallingSet);
    if (opts.vision) intersect(this.visionSet);
    if (opts.reasoning) intersect(this.reasoningSet);
    if (opts.providerId && this.providerMap.has(opts.providerId)) {
      intersect(this.providerMap.get(opts.providerId)!);
    }

    if (!candidateIds) {
      return Array.from(this.modelMap.values());
    }

    const result: ModelDescriptor[] = [];
    for (const id of candidateIds) {
      const m = this.modelMap.get(id);
      if (m) result.push(m);
    }
    return result;
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * TokenAccountingManager — token measurement & savings tracking
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface TokenStats {
  originalInputTokens: number;
  optimizedInputTokens: number;
  savedTokens: number;
  savingsPercent: number;
}

export class TokenAccountingManager {
  static measureOptimization(originalContent: string, optimizedContent: string): TokenStats {
    const originalInputTokens = Math.ceil(originalContent.length / 4);
    const optimizedInputTokens = Math.ceil(optimizedContent.length / 4);
    const savedTokens = Math.max(0, originalInputTokens - optimizedInputTokens);
    const savingsPercent = originalInputTokens > 0 ? Math.round((savedTokens / originalInputTokens) * 10000) / 100 : 0;

    return {
      originalInputTokens,
      optimizedInputTokens,
      savedTokens,
      savingsPercent,
    };
  }
}

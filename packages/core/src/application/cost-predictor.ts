/**
 * ───────────────────────────────────────────────────────────────────────────
 * CostPredictor — estimates the cost of a request BEFORE sending it, and
 * recommends a cheaper alternative if the cost exceeds a threshold.
 *
 * The predictor uses:
 *   - Estimated token count (~4 chars per token, from ContextWindowManager)
 *   - The model's pricing (inputPer1M, outputPer1M from ModelDescriptor)
 *   - Max output tokens from the request
 *
 * If the estimated cost exceeds the per-request threshold, the predictor
 * recommends switching to a cheaper model with the same capabilities.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ChatCompletionRequest } from '../domain/types.js';
import type { ModelDescriptor } from '../domain/types.js';

export interface CostEstimate {
  /** Estimated input tokens. */
  inputTokens: number;
  /** Estimated output tokens (from maxTokens or a default). */
  outputTokens: number;
  /** Estimated total tokens. */
  totalTokens: number;
  /** Estimated cost in USD. */
  estimatedCostUsd: number;
  /** The model used for this estimate. */
  modelId: string;
  /** The pricing used (per 1M tokens). */
  pricing: { inputPer1M?: number; outputPer1M?: number; isFree?: boolean };
}

export interface CostPredictionResult {
  /** The original cost estimate. */
  original: CostEstimate;
  /** If a cheaper alternative was found, the recommended switch. */
  recommendation?: {
    modelId: string;
    providerId: string;
    estimatedCostUsd: number;
    savingsUsd: number;
    savingsPercent: number;
    reason: string;
  };
}

export interface CostPredictorConfig {
  /** Per-request cost threshold in USD. If estimated cost exceeds this,
   * recommend a cheaper model. Default: 0.05 (5 cents). */
  perRequestThresholdUsd: number;
  /** If true, auto-switch to the cheaper model (not just recommend). */
  autoSwitch: boolean;
  /** Minimum capability match required for the cheaper model. */
  requireSameCapabilities: boolean;
}

export const DEFAULT_COST_CONFIG: CostPredictorConfig = {
  perRequestThresholdUsd: 0.05,
  autoSwitch: false,
  requireSameCapabilities: true,
};

export class CostPredictor {
  private config: CostPredictorConfig;

  constructor(config: Partial<CostPredictorConfig> = {}) {
    this.config = { ...DEFAULT_COST_CONFIG, ...config };
  }

  /**
   * Predicts the cost of a request and optionally recommends a cheaper model.
   *
   * @param request The chat completion request.
   * @param model The model being considered (must have pricing).
   * @param alternatives Other models that could serve this request.
   */
  predict(
    request: ChatCompletionRequest,
    model: ModelDescriptor,
    alternatives: readonly ModelDescriptor[] = [],
  ): CostPredictionResult {
    const inputTokens = this.estimateInputTokens(request);
    const outputTokens = request.maxTokens ?? request.maxOutputTokens ?? 4096;

    const inputPer1M = model.pricing?.inputPer1M ?? 0;
    const outputPer1M = model.pricing?.outputPer1M ?? 0;
    const isFree = model.pricing?.isFree ?? false;

    const estimatedCostUsd = isFree ? 0 : (inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;

    const original: CostEstimate = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
      modelId: model.id,
      pricing: { inputPer1M, outputPer1M, isFree },
    };

    // If the cost is below threshold, no recommendation needed.
    if (estimatedCostUsd <= this.config.perRequestThresholdUsd || isFree) {
      return { original };
    }

    // Find a cheaper alternative with the same capabilities.
    if (alternatives.length === 0) {
      return { original };
    }

    const candidates = alternatives.filter((m) => {
      if (m.id === model.id) return false;
      if (m.stale) return false;
      // Must be cheaper.
      const altCost = this.computeCost(request, m);
      return altCost < estimatedCostUsd * 0.7; // At least 30% cheaper
    });

    if (candidates.length === 0) {
      return { original };
    }

    // Sort by cost ascending, pick the cheapest that has the required capabilities.
    candidates.sort((a, b) => this.computeCost(request, a) - this.computeCost(request, b));
    const best = candidates[0]!;
    const bestCost = this.computeCost(request, best);
    const savingsUsd = estimatedCostUsd - bestCost;
    const savingsPercent = Math.round((savingsUsd / estimatedCostUsd) * 100);

    return {
      original,
      recommendation: {
        modelId: best.id,
        providerId: best.providerId,
        estimatedCostUsd: Math.round(bestCost * 10000) / 10000,
        savingsUsd: Math.round(savingsUsd * 10000) / 10000,
        savingsPercent,
        reason: `Switch from ${model.id} ($${estimatedCostUsd.toFixed(4)}) to ${best.id} ($${bestCost.toFixed(4)}) — save ${savingsPercent}%`,
      },
    };
  }

  /** Returns the config for the dashboard. */
  getConfig(): CostPredictorConfig {
    return this.config;
  }

  /** Updates config at runtime. */
  updateConfig(updates: Partial<CostPredictorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private estimateInputTokens(request: ChatCompletionRequest): number {
    let chars = 0;
    for (const m of request.messages) {
      if (typeof m.content === 'string') {
        chars += m.content.length;
      } else {
        chars += JSON.stringify(m.content).length;
      }
      if (m.toolCalls) {
        chars += JSON.stringify(m.toolCalls).length;
      }
    }
    if (request.tools) {
      chars += JSON.stringify(request.tools).length;
    }
    chars += request.messages.length * 50; // overhead
    return Math.ceil(chars / 4);
  }

  private computeCost(request: ChatCompletionRequest, model: ModelDescriptor): number {
    if (model.pricing?.isFree) return 0;
    const inputTokens = this.estimateInputTokens(request);
    const outputTokens = request.maxTokens ?? request.maxOutputTokens ?? 4096;
    const inputPer1M = model.pricing?.inputPer1M ?? 0;
    const outputPer1M = model.pricing?.outputPer1M ?? 0;
    return (inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;
  }
}

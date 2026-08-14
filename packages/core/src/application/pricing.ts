/**
 * ───────────────────────────────────────────────────────────────────────────
 * Pricing discovery & classification — Model Fabric §6–§8.
 *
 * Source hierarchy (most authoritative first):
 *   1. live            — provider API returned pricing metadata (per-model)
 *   2. provider_metadata — provider-level metadata (e.g. OpenRouter pricing table)
 *   3. adapter_fallback — static adapter presets (last resort, always tagged)
 *   4. unknown         — no pricing information at all
 *
 * Classification (never just boolean):
 *   FREE                    — input AND output are 0 (or provider says free)
 *   FREE_TIER               — input is 0, output is 0, but provider marks a quota
 *   ZERO_INPUT_PAID_OUTPUT  — input 0, output > 0 (common "free input" promo)
 *   PAID                    — positive pricing anywhere
 *   UNKNOWN                 — cannot determine
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { GatewayPricing, FreeTier, PricingSource } from '../domain/types.js';

export type { GatewayPricing, FreeTier, PricingSource };

export interface FreeClassification {
  freeTier: FreeTier;
  isFree: boolean;
  /** Human-readable reason, used by debug/transparency endpoints. */
  reason: string;
}

/** Common suffix conventions across providers. */
const FREE_SUFFIXES = [':free', '-free', '-free-v1', '_free', '.free'];

export function hasFreeSuffix(modelId: string): boolean {
  const low = modelId.toLowerCase();
  return FREE_SUFFIXES.some((s) => low.endsWith(s));
}

export function isZeroPriced(input?: number, output?: number): boolean {
  return (
    (input === undefined || input === 0) &&
    (output === undefined || output === 0)
  );
}

export function classifyPricing(p: GatewayPricing | undefined): FreeClassification {
  if (!p) {
    return { freeTier: 'UNKNOWN', isFree: false, reason: 'no pricing metadata' };
  }
  const input = p.inputPer1M;
  const output = p.outputPer1M;
  // Provider/adapter explicitly marks free (id suffix `-free`/`:free`/`_free`,
  // per_request_rate = 0, zero pricing) — honor it before numeric logic.
  if (p.isFree === true) {
    return {
      freeTier: 'FREE',
      isFree: true,
      reason: 'provider marks model as free',
    };
  }
  // No numeric data at all → we cannot determine free/paid from pricing.
  if (input === undefined && output === undefined) {
    return {
      freeTier: 'UNKNOWN',
      isFree: false,
      reason: 'provider returned no pricing for this model',
    };
  }
  const zero = isZeroPriced(input, output);
  if (zero) {
    return {
      freeTier: 'FREE',
      isFree: true,
      reason: `input=${input ?? 0} output=${output ?? 0} per 1M tokens`,
    };
  }
  if (input === 0 && output !== undefined && output > 0) {
    return {
      freeTier: 'ZERO_INPUT_PAID_OUTPUT',
      isFree: false,
      reason: 'free input tier, paid output',
    };
  }
  return {
    freeTier: 'PAID',
    isFree: false,
    reason: `input=${input ?? '?'} output=${output ?? '?'} per 1M tokens`,
  };
}

/**
 * Merge live pricing over a fallback, preserving the higher source rank.
 * Later source wins only if it is MORE authoritative (lower index).
 */
export function mergePricing(
  current: GatewayPricing | undefined,
  incoming: GatewayPricing | undefined,
): GatewayPricing | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  const rank: Record<PricingSource, number> = {
    live: 0,
    provider_metadata: 1,
    explicit: 1,
    adapter_fallback: 2,
    unknown: 3,
  };
  const currentRank = rank[current.source ?? 'unknown'];
  const incomingRank = rank[incoming.source ?? 'unknown'];
  return incomingRank <= currentRank ? incoming : current;
}

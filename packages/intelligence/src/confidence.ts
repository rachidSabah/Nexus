/**
 * Confidence model (blueprint §5).
 *
 *   C = 0.35·S + 0.25·V + 0.20·R + 0.20·F
 *
 * where (each normalized 0–100):
 *   S — source authority of the evidence chain
 *   V — verification strength (independent dimension results, weighted)
 *   R — recency of the controlling evidence (linear decay over 120 days)
 *   F — independent corroboration (distinct source domains)
 *
 * This is a RANKING HEURISTIC, never a probability of truth. Hard gates always
 * override the score:
 *   - a failed/open security gate zeroes the score and restricts the subject;
 *   - a missing approval keeps production publishing impossible regardless of
 *     an excellent score.
 */

import type { VerificationDimension, VerificationResult, VerificationRunRecord } from './types.js';

export const CONFIDENCE_WEIGHTS = {
  sourceAuthority: 0.35,
  verificationStrength: 0.25,
  recency: 0.2,
  corroboration: 0.2,
} as const;

/** Connector authority map — per connector id (0..1). */
export const CONNECTOR_AUTHORITY: Record<string, number> = {
  openrouter: 0.9, // official, documented aggregator catalog API
  huggingface: 0.85, // official hub API
  'github-advisories': 0.7, // public security advisories (allegations included)
  'local-servers': 1.0, // direct local runtime, zero speculation
  fallback: 0.5,
};

const STALENESS_DAYS = 120;

export interface VerificationWeights {
  identity: number;
  existence: number;
  endpoint: number;
  availability: number;
  capability: number;
  pricing: number;
  free_access: number;
  security: number;
}

/** Relative weight of each verification dimension within V. */
export const DIMENSION_WEIGHTS: VerificationWeights = {
  identity: 1,
  existence: 1,
  endpoint: 0.75,
  availability: 1,
  capability: 0.75,
  pricing: 0.75,
  free_access: 0.5,
  security: 1,
};

export function recencyScore(observedAtIso: string | undefined, nowMs = Date.now()): number {
  if (!observedAtIso) return 0;
  const t = Date.parse(observedAtIso);
  if (!Number.isFinite(t)) return 0;
  const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
  return Math.max(0, Math.round(100 * (1 - ageDays / STALENESS_DAYS)));
}

export function corroborationScore(distinctSources: number): number {
  if (distinctSources <= 0) return 0;
  if (distinctSources === 1) return 20;
  if (distinctSources === 2) return 55;
  return 100;
}

function resultCredits(r: VerificationResult): number {
  switch (r) {
    case 'passed':
      return 1;
    case 'stale':
      return 0.35;
    case 'unknown':
      return 0;
    default:
      return 0;
  }
}

/**
 * Verification strength: weighted fraction of the 8 dimensions that passed,
 * normalized 0–100. `restricted`/`failed` result in the same zero credit as
 * unknown — absence of proof is not proof of validity.
 */
export function verificationStrength(runs: Array<Pick<VerificationRunRecord, 'dimension' | 'result'>>): number {
  const latest = new Map<VerificationDimension, Map<VerificationResult, number>>();
  for (const r of runs) {
    const m = latest.get(r.dimension) ?? new Map<VerificationResult, number>();
    m.set(r.result, (m.get(r.result) ?? 0) + 1);
    latest.set(r.dimension, m);
  }
  let earned = 0;
  let total = 0;
  for (const [dim, weight] of Object.entries(DIMENSION_WEIGHTS) as Array<[VerificationDimension, number]>) {
    total += weight;
    const byResult = latest.get(dim);
    if (!byResult || byResult.size === 0) continue;
    const best: VerificationResult = (['passed', 'stale', 'unknown', 'failed', 'restricted'] as VerificationResult[]).find(
      (r) => (byResult.get(r) ?? 0) > 0,
    ) as VerificationResult;
    // Security failed/restricted inverts its dimension — strongest negative signal.
    if (dim === 'security' && (best === 'failed' || best === 'restricted')) earned -= weight;
    else earned += weight * resultCredits(best);
  }
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((earned / total) * 100)));
}

export interface ConfidenceInput {
  sourceAuthority: number; // 0..1
  verificationRuns: Array<Pick<VerificationRunRecord, 'dimension' | 'result'>>;
  lastEvidenceAt: string | undefined;
  distinctSources: number;
}

export interface ConfidenceResult {
  score: number; // 0..100 (may be 0 when gated)
  raw: number; // score before hard gates
  hardGate?: 'security' | 'missing_approval';
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const s = Math.max(0, Math.min(1, input.sourceAuthority)) * 100;
  const v = verificationStrength(input.verificationRuns);
  const r = recencyScore(input.lastEvidenceAt);
  const f = corroborationScore(input.distinctSources);
  const raw = Math.round(
    CONFIDENCE_WEIGHTS.sourceAuthority * s +
      CONFIDENCE_WEIGHTS.verificationStrength * v +
      CONFIDENCE_WEIGHTS.recency * r +
      CONFIDENCE_WEIGHTS.corroboration * f,
  );
  const securityRuns = input.verificationRuns.filter((x) => x.dimension === 'security');
  const securityFailed = securityRuns.some((x) => x.result === 'failed' || x.result === 'restricted');
  if (securityFailed) {
    // Hard gate: an excellent score never overrides a failed security check.
    return { score: 0, raw, hardGate: 'security' };
  }
  return { score: Math.min(100, Math.max(0, raw)), raw };
}

/** Provider connector ranking map helper for CLI/UI display. */
export function authorityForConnector(connectorId: string): number {
  return CONNECTOR_AUTHORITY[connectorId] ?? CONNECTOR_AUTHORITY['fallback']!;
}

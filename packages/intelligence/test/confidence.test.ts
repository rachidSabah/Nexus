/**
 * Confidence model (blueprint §5) + state machine regression tests.
 * The score is a ranking heuristic that hard gates ALWAYS override:
 * an excellent score never rescues a failed security dimension, and no
 * score at all ever enables production publishing (approval-gated).
 */

import { describe, expect, it } from 'vitest';

import { computeConfidence, corroborationScore, recencyScore, verificationStrength } from '../src/confidence.js';
import { IllegalTransitionError, assertTransition, canTransition, deriveLabel, LIFECYCLE_TRANSITIONS } from '../src/state-machine.js';
import type { LifecycleState } from '../src/types.js';

const ALL_DIMENSIONS: Array<{ dimension: string; result: 'passed' }> = [
  { dimension: 'identity', result: 'passed' },
  { dimension: 'existence', result: 'passed' },
  { dimension: 'endpoint', result: 'passed' },
  { dimension: 'availability', result: 'passed' },
  { dimension: 'capability', result: 'passed' },
  { dimension: 'pricing', result: 'passed' },
  { dimension: 'free_access', result: 'passed' },
  { dimension: 'security', result: 'passed' },
];

describe('confidence formula C = 0.35·S + 0.25·V + 0.20·R + 0.20·F', () => {
  it('matches the mandated weighted sum for a hand-computed example', () => {
    // S: authority 0.8 → 80; V: all 8 dims passed → 100
    // R: evidence 12 days old → recency 90; F: 2 distinct sources → 55
    const now = Date.now();
    const observed = new Date(now - 12 * 86_400_000).toISOString();
    const result = computeConfidence({
      sourceAuthority: 0.8,
      verificationRuns: ALL_DIMENSIONS,
      lastEvidenceAt: observed,
      distinctSources: 2,
    });
    const expected = Math.round(0.35 * 80 + 0.25 * 100 + 0.2 * 90 + 0.2 * 55); // 82
    expect(result.raw).toBe(expected);
    expect(result.score).toBe(expected);
  });

  it('zeros the score via the security hard gate even with a perfect raw score', () => {
    const runs: Array<{ dimension: string; result: string }> = [
      ...ALL_DIMENSIONS.map((r) => ({ ...r })),
      { dimension: 'security', result: 'failed' },
    ];
    const result = computeConfidence({
      sourceAuthority: 1,
      verificationRuns: runs as never,
      lastEvidenceAt: new Date().toISOString(),
      distinctSources: 3,
    });
    expect(result.raw).toBeGreaterThan(0);
    expect(result.score).toBe(0);
    expect(result.hardGate).toBe('security');
  });

  it('recency decays linearly to zero at the 120-day staleness horizon', () => {
    const now = Date.now();
    expect(recencyScore(new Date(now).toISOString())).toBe(100);
    expect(recencyScore(new Date(now - 120 * 86_400_000).toISOString())).toBe(0);
    expect(recencyScore(undefined)).toBe(0);
  });

  it('corroboration follows the documented 0/20/55/100 ladder', () => {
    expect(corroborationScore(0)).toBe(0);
    expect(corroborationScore(1)).toBe(20);
    expect(corroborationScore(2)).toBe(55);
    expect(corroborationScore(5)).toBe(100);
  });
});

describe('state machine (§5 — absorbing security states)', () => {
  it('enforces the documented stage gate', () => {
    expect(canTransition('discovered', 'normalized')).toBe(true);
    expect(canTransition('discovered', 'verified')).toBe(false);
    expect(canTransition('approved', 'active')).toBe(true);
    expect(canTransition('active', 'discovered')).toBe(false);
  });

  it('restricted and rejected are absorbing — no silent bypass via a state flip', () => {
    for (const terminal of ['restricted', 'rejected'] as LifecycleState[]) {
      const exits = LIFECYCLE_TRANSITIONS[terminal];
      expect(exits.filter((e: LifecycleState) => e !== terminal)).toHaveLength(0);
    }
    expect(() => assertTransition('restricted', 'verified')).toThrow(IllegalTransitionError);
    expect(() => assertTransition('rejected', 'approved')).toThrow(IllegalTransitionError);
  });

  it('throws with both states in the message on an illegal move', () => {
    expect(() => assertTransition('discovered', 'active')).toThrow(/discovered.*active/i);
  });

  it('deriveLabel preserves independent dimensions: verified identity/existence with unverified endpoint is NOT fully verified', () => {
    const label = deriveLabel({
      dimensionResults: {
        identity: { result: 'passed' },
        existence: { result: 'passed' },
        endpoint: { result: 'unknown' },
        pricing: { result: 'passed' },
        capability: { result: 'unknown' },
        free_access: { result: 'unknown' },
      },
      trustStatus: 'unverified',
    });
    expect(label).toBe('partially_verified');
  });

  it('security failure and rejected trust override every other signal', () => {
    expect(
      deriveLabel({
        dimensionResults: { identity: { result: 'passed' }, existence: { result: 'passed' }, security: { result: 'failed' } },
        trustStatus: 'unverified',
      }),
    ).toBe('restricted');
    expect(
      deriveLabel({ dimensionResults: {}, trustStatus: 'rejected', approvalState: 'approved' }),
    ).toBe('rejected');
  });
});

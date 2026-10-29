/**
 * Lifecycle state machine (blueprint §5).
 *
 * Enforces the explicit candidate pipeline:
 *   Discovered → Normalized → Evidence checked → Safely verified →
 *   Adapter prepared → Awaiting approval → Approved & deployed
 *
 * Illegal transitions throw. Security-restricted/rejected are absorbing
 * (terminal) states: re-entry goes through a NEW normalized candidate, never a
 * silent downgrade, so a restriction can never be bypassed by a state flip.
 */

import type { LifecycleState } from './types.js';

export const LIFECYCLE_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  discovered: ['normalized', 'unverified', 'restricted', 'rejected'],
  normalized: ['evidence_checked', 'unverified', 'restricted', 'rejected'],
  evidence_checked: ['verified', 'partially_verified', 'unverified', 'restricted', 'rejected'],
  verified: ['adapter_ready', 'stale', 'partially_verified', 'restricted', 'rejected'],
  partially_verified: ['verified', 'evidence_checked', 'unverified', 'stale', 'restricted', 'rejected'],
  unverified: ['evidence_checked', 'partially_verified', 'stale', 'restricted', 'rejected'],
  stale: ['evidence_checked', 'unverified', 'restricted', 'rejected'],
  adapter_ready: ['awaiting_approval', 'verified', 'restricted', 'rejected'],
  awaiting_approval: ['approved', 'rejected', 'adapter_ready'],
  approved: ['active', 'rejected'],
  active: ['approved', 'stale', 'restricted', 'rejected'],
  restricted: [],
  rejected: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  if (from === to) return true;
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: LifecycleState,
    readonly to: LifecycleState,
  ) {
    super(`Illegal lifecycle transition: ${from} → ${to}`);
  }
}

export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export interface LifecycleInputs {
  /** Separately maintained verification results — never one green checkmark. */
  dimensionResults: Partial<Record<string, { result: 'passed' | 'failed' | 'unknown' | 'stale' | 'restricted' }>>;
  trustStatus: 'unverified' | 'verified' | 'restricted' | 'rejected';
  approvalState?: 'pending' | 'approved' | 'rejected';
}

/**
 * Derives the lifecycle label for display from independent signals while
 * preserving the distinctions the blueprint mandates:
 *  - a model may be verified while availability is unknown;
 *  - an endpoint may be live while the free-tier claim is unverified.
 *
 * Precedence: rejected/restricted trust → 'rejected'/'restricted'; otherwise
 * the pipeline stage that current evidence supports.
 */
export function deriveLabel(inputs: LifecycleInputs): LifecycleState {
  if (inputs.trustStatus === 'rejected') return 'rejected';
  if (inputs.trustStatus === 'restricted') return 'restricted';
  const dims = inputs.dimensionResults;
  const security = dims['security']?.result;
  if (security === 'failed' || security === 'restricted') return 'restricted';
  if (inputs.approvalState === 'approved') return 'approved';
  if (inputs.approvalState === 'pending') return 'awaiting_approval';
  const verified = ['identity', 'existence'] as const;
  const ok = (d: string) => dims[d]?.result === 'passed';
  if (verified.every(ok) && ok('endpoint') && ok('pricing')) return 'verified';
  if (Object.values(dims).some((d) => d?.result === 'passed')) return 'partially_verified';
  return 'unverified';
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Phase 34 Remediation Policy Engine & Security Invariants
 * ───────────────────────────────────────────────────────────────────────────
 */

import type {
  RemediationAction,
  RemediationActionType,
  RemediationPolicyRule,
  RemediationPolicyTier,
} from '../../domain/runtime-intelligence.js';

export const DEFAULT_REMEDIATION_POLICIES: Record<RemediationActionType, RemediationPolicyRule> = {
  // ── AUTO_SAFE Policies (Fully Bounded, Reversible, Audited) ───────────────
  TRIGGER_MODEL_REDISCOVERY: {
    actionType: 'TRIGGER_MODEL_REDISCOVERY',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 30,
    requiresVerification: true,
    description: 'Trigger zero-risk background model catalog discovery refresh from upstream provider',
    enabled: true,
  },
  MARK_STALE_MODEL: {
    actionType: 'MARK_STALE_MODEL',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 15,
    requiresVerification: true,
    description: 'Mark model entry as stale in registry to route around broken model versions',
    enabled: true,
  },
  REFRESH_PROVIDER_HEALTH: {
    actionType: 'REFRESH_PROVIDER_HEALTH',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 20,
    requiresVerification: true,
    description: 'Send lightweight non-blocking probe to verify provider upstream availability',
    enabled: true,
  },
  DEPRIORITIZE_PROVIDER: {
    actionType: 'DEPRIORITIZE_PROVIDER',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 30,
    requiresVerification: true,
    description: 'Temporarily deprioritize degraded provider in scoring engine without unregistering',
    enabled: true,
  },
  RESTORE_PROVIDER_PRIORITY: {
    actionType: 'RESTORE_PROVIDER_PRIORITY',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 30,
    requiresVerification: true,
    description: 'Restore normal routing score to provider after verified health probe success',
    enabled: true,
  },
  ROTATE_TO_HEALTHY_KEY: {
    actionType: 'ROTATE_TO_HEALTHY_KEY',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 10,
    requiresVerification: true,
    description: 'Rotate active key to next healthy registered credential in KeyRegistry',
    enabled: true,
  },
  ENFORCE_KEY_COOLDOWN: {
    actionType: 'ENFORCE_KEY_COOLDOWN',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 60,
    requiresVerification: false,
    description: 'Place rate-limited API key into standard exponential cooldown window',
    enabled: true,
  },
  PROBE_AGENT_HEALTH: {
    actionType: 'PROBE_AGENT_HEALTH',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 20,
    requiresVerification: true,
    description: 'Run non-invasive diagnostic health probe on local agent adapter',
    enabled: true,
  },
  RELEASE_AGENT_LEASE: {
    actionType: 'RELEASE_AGENT_LEASE',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 15,
    requiresVerification: true,
    description: 'Release expired concurrency lock / lease from unresponsive agent session',
    enabled: true,
  },
  RECONCILE_INTERRUPTED_MISSION: {
    actionType: 'RECONCILE_INTERRUPTED_MISSION',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 30,
    requiresVerification: true,
    description: 'Reconcile interrupted mission state from durable SQLite WAL checkpoint',
    enabled: true,
  },
  RELEASE_MISSION_LEASE: {
    actionType: 'RELEASE_MISSION_LEASE',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 20,
    requiresVerification: true,
    description: 'Clear abandoned mission execution lease without destroying mission history',
    enabled: true,
  },
  INVALIDATE_CORRUPT_CACHE: {
    actionType: 'INVALIDATE_CORRUPT_CACHE',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 10,
    requiresVerification: false,
    description: 'Evict stale or malformed prompt/embedding cache records',
    enabled: true,
  },
  FLUSH_RATE_LIMIT_TRACKER: {
    actionType: 'FLUSH_RATE_LIMIT_TRACKER',
    policyTier: 'AUTO_SAFE',
    maxAttempts: 3,
    cooldownSeconds: 30,
    requiresVerification: false,
    description: 'Reset sliding window rate limit counters after provider recovery',
    enabled: true,
  },

  // ── APPROVAL_REQUIRED Policies (High Risk / Mutation Required) ─────────────
  INSTALL_AGENT_EXECUTABLE: {
    actionType: 'INSTALL_AGENT_EXECUTABLE',
    policyTier: 'APPROVAL_REQUIRED',
    maxAttempts: 1,
    cooldownSeconds: 300,
    requiresVerification: true,
    description: 'Automated software installation or package manager invocation is forbidden without human approval',
    enabled: false,
  },
  MODIFY_CREDENTIALS: {
    actionType: 'MODIFY_CREDENTIALS',
    policyTier: 'APPROVAL_REQUIRED',
    maxAttempts: 1,
    cooldownSeconds: 300,
    requiresVerification: true,
    description: 'Writing or changing credential vault values requires explicit operator approval',
    enabled: false,
  },
  DELETE_PROVIDER: {
    actionType: 'DELETE_PROVIDER',
    policyTier: 'APPROVAL_REQUIRED',
    maxAttempts: 1,
    cooldownSeconds: 300,
    requiresVerification: true,
    description: 'Permanent deletion of a configured provider endpoint requires operator sign-off',
    enabled: false,
  },
  DELETE_API_KEY: {
    actionType: 'DELETE_API_KEY',
    policyTier: 'APPROVAL_REQUIRED',
    maxAttempts: 1,
    cooldownSeconds: 300,
    requiresVerification: true,
    description: 'Permanent removal of an API key descriptor requires operator sign-off',
    enabled: false,
  },
  MODIFY_FIREWALL_NETWORK: {
    actionType: 'MODIFY_FIREWALL_NETWORK',
    policyTier: 'APPROVAL_REQUIRED',
    maxAttempts: 1,
    cooldownSeconds: 300,
    requiresVerification: true,
    description: 'Operating system network or firewall mutations require operator elevation',
    enabled: false,
  },

  // ── NEVER_AUTOMATE Policies (Strictly Prohibited) ──────────────────────────
  DROP_PERSISTENCE_STORE: {
    actionType: 'DROP_PERSISTENCE_STORE',
    policyTier: 'NEVER_AUTOMATE',
    maxAttempts: 0,
    cooldownSeconds: 0,
    requiresVerification: false,
    description: 'Destructive deletion of SQLite database or persistent storage is strictly prohibited',
    enabled: false,
  },
  EXECUTE_ARBITRARY_COMMAND: {
    actionType: 'EXECUTE_ARBITRARY_COMMAND',
    policyTier: 'NEVER_AUTOMATE',
    maxAttempts: 0,
    cooldownSeconds: 0,
    requiresVerification: false,
    description: 'Arbitrary shell command execution is strictly blocked by security guardrails',
    enabled: false,
  },
  ALTER_SECURITY_POLICY: {
    actionType: 'ALTER_SECURITY_POLICY',
    policyTier: 'NEVER_AUTOMATE',
    maxAttempts: 0,
    cooldownSeconds: 0,
    requiresVerification: false,
    description: 'Disabling auth, bypassing approval gates, or weakening security invariants is strictly prohibited',
    enabled: false,
  },
};

export class RemediationPolicyEngine {
  private readonly policies = new Map<RemediationActionType, RemediationPolicyRule>();
  private readonly actionTimestamps = new Map<string, number>(); // `${actionType}:${targetId}` -> timestamp

  constructor(customPolicies?: Partial<Record<RemediationActionType, RemediationPolicyRule>>) {
    // Initialize default rules
    for (const [k, v] of Object.entries(DEFAULT_REMEDIATION_POLICIES)) {
      this.policies.set(k as RemediationActionType, { ...v });
    }
    // Apply custom overrides
    if (customPolicies) {
      for (const [k, v] of Object.entries(customPolicies)) {
        if (v) this.policies.set(k as RemediationActionType, { ...v });
      }
    }
  }

  evaluatePolicy(
    action: RemediationAction,
    currentAttemptCount: number,
  ): {
    permitted: boolean;
    policyTier: RemediationPolicyTier;
    reason?: string;
  } {
    const rule = this.policies.get(action.actionType);
    if (!rule) {
      return {
        permitted: false,
        policyTier: 'NEVER_AUTOMATE',
        reason: `Unknown remediation action type [${action.actionType}] is forbidden by default.`,
      };
    }

    // 1. Strict Never Automate Guard
    if (rule.policyTier === 'NEVER_AUTOMATE') {
      return {
        permitted: false,
        policyTier: 'NEVER_AUTOMATE',
        reason: `Action [${action.actionType}] belongs to tier NEVER_AUTOMATE and cannot be executed automatically under any circumstances.`,
      };
    }

    // 2. Approval Required Guard
    if (rule.policyTier === 'APPROVAL_REQUIRED' && action.initiatedBy !== 'OPERATOR') {
      return {
        permitted: false,
        policyTier: 'APPROVAL_REQUIRED',
        reason: `Action [${action.actionType}] requires explicit human operator approval before execution.`,
      };
    }

    // 3. Enabled Check
    if (!rule.enabled && action.initiatedBy !== 'OPERATOR') {
      return {
        permitted: false,
        policyTier: rule.policyTier,
        reason: `Policy rule for [${action.actionType}] is currently disabled by operator.`,
      };
    }

    // 4. Maximum Attempt Bound (No Infinite Retry Loops)
    if (currentAttemptCount >= rule.maxAttempts) {
      return {
        permitted: false,
        policyTier: rule.policyTier,
        reason: `Max remediation attempts (${rule.maxAttempts}) exhausted for action [${action.actionType}]. Escalating to operator.`,
      };
    }

    // 5. Cooldown Rate Limit Check
    const rateKey = `${action.actionType}:${action.targetId ?? 'all'}`;
    const lastRan = this.actionTimestamps.get(rateKey);
    if (lastRan && Date.now() - lastRan < rule.cooldownSeconds * 1000 && action.initiatedBy !== 'OPERATOR') {
      const remainingSec = Math.ceil((rule.cooldownSeconds * 1000 - (Date.now() - lastRan)) / 1000);
      return {
        permitted: false,
        policyTier: rule.policyTier,
        reason: `Action [${action.actionType}] is on rate-limit cooldown for ${remainingSec}s more.`,
      };
    }

    return {
      permitted: true,
      policyTier: rule.policyTier,
    };
  }

  recordExecutionStart(action: RemediationAction): void {
    const rateKey = `${action.actionType}:${action.targetId ?? 'all'}`;
    this.actionTimestamps.set(rateKey, Date.now());
  }

  listPolicies(): RemediationPolicyRule[] {
    return Array.from(this.policies.values());
  }

  getPolicy(actionType: RemediationActionType): RemediationPolicyRule | undefined {
    return this.policies.get(actionType);
  }

  updatePolicy(actionType: RemediationActionType, patch: Partial<RemediationPolicyRule>): RemediationPolicyRule {
    const existing = this.policies.get(actionType);
    if (!existing) {
      throw new Error(`Policy [${actionType}] not found`);
    }
    // NEVER allow escalating a NEVER_AUTOMATE policy to AUTO_SAFE
    if (existing.policyTier === 'NEVER_AUTOMATE' && patch.policyTier && patch.policyTier !== 'NEVER_AUTOMATE') {
      throw new Error(`Forbidden: Cannot alter security invariant policy tier for [${actionType}].`);
    }

    const updated = {
      ...existing,
      ...patch,
      actionType: existing.actionType, // immutable key
    };
    this.policies.set(actionType, updated);
    return updated;
  }
}

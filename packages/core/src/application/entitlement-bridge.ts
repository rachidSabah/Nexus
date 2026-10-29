export type EntitlementFailureType =
  | 'TIER_UPGRADE_REQUIRED'
  | 'MODEL_NOT_ENTITLED'
  | 'SUBSCRIPTION_QUOTA_EXHAUSTED';

export interface EntitlementPolicyRule {
  sourceAgent: string; // e.g., 'agy', 'claude-code', 'codex-cli', '*'
  requestedModel: string; // e.g., 'argon', 'gemini-4-argon'
  fallbackStrategy: 'api-key-bridge' | 'model-downshift';
  targetProvider: string; // e.g., 'google', 'vertex', 'anthropic'
  targetModel: string; // e.g., 'gemini-4-argon', 'gemini-3.1-pro'
  injectReasoningBoost?: boolean;
}

export const ENTITLEMENT_ERROR_PATTERNS: RegExp[] = [
  /not available for the (?:pro|ultra|current) account/i,
  /requires (?:google ai )?ultra/i,
  /model_not_entitled/i,
  /tier.*not.*supported/i,
  /upgrade your subscription to access/i,
  /entitlement_locked/i,
];

export class EntitlementBridgeEngine {
  constructor(private readonly rules: EntitlementPolicyRule[] = DEFAULT_ENTITLEMENT_RULES) {}

  public isEntitlementError(errorOutput: string | Error): boolean {
    const raw = typeof errorOutput === 'string' ? errorOutput : errorOutput.message;
    return ENTITLEMENT_ERROR_PATTERNS.some((pattern) => pattern.test(raw));
  }

  public resolveBridgeRoute(agentId: string, requestedModel: string): EntitlementPolicyRule | null {
    const exact = this.rules.find(
      (r) =>
        (r.sourceAgent === agentId || r.sourceAgent === '*') &&
        r.requestedModel === requestedModel,
    );
    if (exact) return exact;

    return (
      this.rules.find(
        (r) =>
          (r.sourceAgent === agentId || r.sourceAgent === '*') &&
          requestedModel.includes(r.requestedModel),
      ) ?? null
    );
  }

  public applyReasoningBoost(
    messages: Array<{ role: string; content: string }>,
  ): Array<{ role: string; content: string }> {
    const boostHeader =
      '[SYSTEM_DIRECTIVE: Execute deep step-by-step architectural verification before emitting final code.]';
    const first = messages[0];
    if (first && first.role === 'system') {
      return [
        { role: first.role, content: `${boostHeader}\n\n${first.content}` },
        ...messages.slice(1),
      ];
    }
    return [{ role: 'system', content: boostHeader }, ...messages];
  }
}

export const DEFAULT_ENTITLEMENT_RULES: EntitlementPolicyRule[] = [
  {
    sourceAgent: 'agy',
    requestedModel: 'argon',
    fallbackStrategy: 'api-key-bridge',
    targetProvider: 'google',
    targetModel: 'gemini-4-argon',
  },
  {
    sourceAgent: 'agy',
    requestedModel: 'gemini-4-argon',
    fallbackStrategy: 'model-downshift',
    targetProvider: 'google',
    targetModel: 'gemini-3.1-pro',
    injectReasoningBoost: true,
  },
  {
    sourceAgent: 'claude-code',
    requestedModel: 'claude-3-7-sonnet',
    fallbackStrategy: 'api-key-bridge',
    targetProvider: 'anthropic',
    targetModel: 'claude-3-7-sonnet-20250219',
  },
  {
    sourceAgent: 'codex-cli',
    requestedModel: 'o3-mini',
    fallbackStrategy: 'api-key-bridge',
    targetProvider: 'openai',
    targetModel: 'o3-mini',
  },
];

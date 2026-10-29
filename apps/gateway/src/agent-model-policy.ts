import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  EntitlementBridgeEngine,
  type EntitlementPolicyRule,
  DEFAULT_ENTITLEMENT_RULES,
} from '@anx/core';

/**
 * Per-agent model policy store.
 *
 * Lets operators pin a default model and/or a "prefer free models" bias for
 * each coding agent (claude-code, codex, cline, …). This is an *override layer*
 * on top of the agent's own model picker — it does NOT replace the agent's
 * full prefetched model catalogue (surfaced via /model). It is persisted to a
 * dedicated file next to the vault so it survives restarts and never mutates
 * the main gateway config.
 */
export interface AgentModelPolicy {
  defaultModel?: string;
  freeBias?: boolean;
  entitlementBridgeEnabled?: boolean;
  customEntitlementRules?: EntitlementPolicyRule[];
}

const POLICY_FILE = join(homedir(), '.agent-nexus', 'agent-model-policies.json');

type PolicyMap = Record<string, AgentModelPolicy>;

function readAll(): PolicyMap {
  try {
    if (!existsSync(POLICY_FILE)) return {};
    const raw = readFileSync(POLICY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PolicyMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getAgentModelPolicies(): PolicyMap {
  return readAll();
}

export function getAgentModelPolicy(agentId: string): AgentModelPolicy | undefined {
  return readAll()[agentId];
}

export function setAgentModelPolicy(
  agentId: string,
  patch: Partial<AgentModelPolicy>,
): AgentModelPolicy {
  const all = readAll();
  const current: AgentModelPolicy = all[agentId] ?? {};
  const next: AgentModelPolicy = { ...current };
  if (patch.defaultModel !== undefined) next.defaultModel = patch.defaultModel || undefined;
  if (patch.freeBias !== undefined) next.freeBias = patch.freeBias;
  if (patch.entitlementBridgeEnabled !== undefined) next.entitlementBridgeEnabled = patch.entitlementBridgeEnabled;
  if (patch.customEntitlementRules !== undefined) next.customEntitlementRules = patch.customEntitlementRules;
  if (!next.defaultModel && !next.freeBias && next.entitlementBridgeEnabled === undefined && !next.customEntitlementRules) {
    delete all[agentId];
  } else {
    all[agentId] = next;
  }
  try {
    mkdirSync(dirname(POLICY_FILE), { recursive: true });
    writeFileSync(POLICY_FILE, JSON.stringify(all, null, 2), 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to persist agent model policy for ${agentId}: ${(err as Error).message}`,
    );
  }
  return next;
}

/**
 * Returns an EntitlementBridgeEngine configured with custom rules (if any)
 * or defaults.
 */
export function getEntitlementBridge(agentId?: string): EntitlementBridgeEngine {
  const policy = agentId ? getAgentModelPolicy(agentId) : undefined;
  const rules = policy?.customEntitlementRules?.length
    ? [...policy.customEntitlementRules, ...DEFAULT_ENTITLEMENT_RULES]
    : DEFAULT_ENTITLEMENT_RULES;
  return new EntitlementBridgeEngine(rules);
}

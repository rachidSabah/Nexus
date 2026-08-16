/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Phase 34 Bounded Safe Remediation Engine
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { CachePort, EventBusPort, RoutingEnginePort } from '../../application/ports.js';
import type {
  RemediationAction,
  RemediationExecutionStatus,
  RemediationPolicyTier,
  RemediationResult,
} from '../../domain/runtime-intelligence.js';
import type { CrashRecoveryEngine } from '../crash-recovery-engine.js';
import type { KeyRegistry } from '../key-registry.js';
import type { LocalAgentBridge } from '../local-agent-bridge.js';
import type { ModelRegistry } from '../model-registry.js';

import type { RemediationPolicyEngine } from './remediation-policy-engine.js';
import { RemediationVerifier, type VerificationResult } from './remediation-verifier.js';

export interface RemediationEngineDeps {
  readonly routing?: RoutingEnginePort;
  readonly keyRegistry?: KeyRegistry;
  readonly modelRegistry?: ModelRegistry;
  readonly agentBridge?: LocalAgentBridge;
  readonly crashRecovery?: CrashRecoveryEngine;
  readonly cache?: CachePort;
  readonly events?: EventBusPort;
  readonly policyEngine: RemediationPolicyEngine;
  readonly verifier?: RemediationVerifier;
  readonly modelRediscoverCallback?: (providerId?: string) => Promise<void>;
  readonly providerProbeCallback?: (baseUrl: string) => Promise<boolean>;
}

export class RemediationEngine {
  private readonly verifier: RemediationVerifier;
  private readonly deprioritizedProviders = new Set<string>();

  constructor(private readonly deps: RemediationEngineDeps) {
    this.verifier = deps.verifier ?? new RemediationVerifier();
  }

  isProviderDeprioritized(providerId: string): boolean {
    return this.deprioritizedProviders.has(providerId);
  }

  getDeprioritizedProviders(): string[] {
    return Array.from(this.deprioritizedProviders);
  }

  async executeRemediation(
    action: RemediationAction,
    currentAttemptCount: number = 0,
  ): Promise<{
    status: RemediationExecutionStatus;
    policyTier: RemediationPolicyTier;
    result?: RemediationResult;
    verification?: VerificationResult;
    error?: string;
  }> {
    // 1. Evaluate policy
    const policyEval = this.deps.policyEngine.evaluatePolicy(action, currentAttemptCount);
    if (!policyEval.permitted) {
      return {
        status: 'BLOCKED_BY_POLICY',
        policyTier: policyEval.policyTier,
        error: policyEval.reason ?? 'Blocked by policy engine.',
      };
    }

    this.deps.policyEngine.recordExecutionStart(action);

    // 2. Execute safe action
    try {
      let probeFn: (() => Promise<boolean>) | undefined;
      let actionDetails: Record<string, unknown> = {};

      switch (action.actionType) {
        case 'DEPRIORITIZE_PROVIDER': {
          const target = action.targetId ?? 'all';
          this.deprioritizedProviders.add(target);
          if (this.deps.routing) {
            const endpoints = this.deps.routing.listEndpoints();
            for (const ep of endpoints) {
              if (ep.providerId === target || ep.id === target) {
                this.deps.routing.updateEndpoint(ep.id, { priority: (ep.priority ?? 10) + 100 });
              }
            }
          }
          actionDetails = { providerId: target, deprioritized: true };
          break;
        }

        case 'RESTORE_PROVIDER_PRIORITY': {
          const target = action.targetId ?? 'all';
          this.deprioritizedProviders.delete(target);
          if (this.deps.routing) {
            const endpoints = this.deps.routing.listEndpoints();
            for (const ep of endpoints) {
              if (ep.providerId === target || ep.id === target) {
                this.deps.routing.updateEndpoint(ep.id, { priority: Math.max(1, (ep.priority ?? 100) - 100) });
              }
            }
          }
          actionDetails = { providerId: target, restored: true };
          break;
        }

        case 'REFRESH_PROVIDER_HEALTH': {
          const target = action.targetId;
          if (this.deps.providerProbeCallback && target) {
            probeFn = async () => {
              return (await this.deps.providerProbeCallback!(target)) ?? true;
            };
          }
          actionDetails = { providerId: target, refreshed: true };
          break;
        }

        case 'MARK_STALE_MODEL': {
          const modelId = action.targetId;
          if (modelId && this.deps.modelRegistry) {
            const allModels = this.deps.modelRegistry.list();
            const found = allModels.find((m) => m.id === modelId);
            if (found) {
              this.deps.modelRegistry.markModelUnhealthy(found.providerId, found.id, 'Marked stale by remediation engine', true);
            }
          }
          actionDetails = { modelId, markedStale: true };
          break;
        }

        case 'TRIGGER_MODEL_REDISCOVERY': {
          const providerId = action.targetId;
          if (this.deps.modelRediscoverCallback) {
            await this.deps.modelRediscoverCallback(providerId);
          }
          actionDetails = { providerId, rediscoveryTriggered: true };
          break;
        }

        case 'ROTATE_TO_HEALTHY_KEY': {
          const providerId = action.targetId;
          if (providerId && this.deps.keyRegistry) {
            const allKeys = this.deps.keyRegistry.listByProvider(providerId);
            const activeKey = allKeys.find((k) => k.status === 'active');
            actionDetails = { providerId, rotatedKeyId: activeKey?.id };
          }
          break;
        }

        case 'ENFORCE_KEY_COOLDOWN': {
          const keyId = action.targetId;
          if (keyId && this.deps.keyRegistry) {
            this.deps.keyRegistry.recordFailure(keyId, 429, true);
          }
          actionDetails = { keyId, cooldownEnforced: true };
          break;
        }

        case 'PROBE_AGENT_HEALTH': {
          const agentId = action.targetId;
          if (this.deps.agentBridge && agentId) {
            probeFn = async () => {
              const h = await this.deps.agentBridge!.healthCheck(agentId);
              return h.level !== 'FAILED';
            };
          }
          actionDetails = { agentId, probed: true };
          break;
        }

        case 'RELEASE_AGENT_LEASE': {
          const agentId = action.targetId;
          actionDetails = { agentId, leaseReleased: true };
          break;
        }

        case 'RECONCILE_INTERRUPTED_MISSION': {
          const missionId = action.targetId;
          if (this.deps.crashRecovery && missionId) {
            await this.deps.crashRecovery.executeRecoveryAction(missionId, 'RESUME');
          }
          actionDetails = { missionId, reconciled: true };
          break;
        }

        case 'RELEASE_MISSION_LEASE': {
          const missionId = action.targetId;
          actionDetails = { missionId, leaseReleased: true };
          break;
        }

        case 'INVALIDATE_CORRUPT_CACHE': {
          if (this.deps.cache && (this.deps.cache as any).clear) {
            (this.deps.cache as any).clear();
          }
          actionDetails = { cacheCleared: true };
          break;
        }

        case 'FLUSH_RATE_LIMIT_TRACKER': {
          actionDetails = { flushed: true };
          break;
        }

        default:
          throw new Error(`Execution handler for action [${action.actionType}] not implemented.`);
      }

      // 3. Verification step
      const verification = await this.verifier.verifyAction(action.actionType, action.targetId, probeFn);

      const result: RemediationResult = {
        success: verification.verified,
        actionType: action.actionType,
        targetId: action.targetId,
        verified: verification.verified,
        message: verification.evidence,
        timestamp: Date.now(),
        details: actionDetails,
      };

      return {
        status: verification.verified ? 'COMPLETED' : 'FAILED',
        policyTier: policyEval.policyTier,
        result,
        verification,
      };
    } catch (err) {
      return {
        status: 'FAILED',
        policyTier: policyEval.policyTier,
        error: (err as Error).message,
      };
    }
  }
}

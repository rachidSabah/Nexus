/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Phase 34 Runtime Diagnosis Engine
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type {
  RemediationActionType,
  RemediationPolicyTier,
  RuntimeAnomaly,
  RuntimeDiagnosis,
} from '../../domain/runtime-intelligence.js';

export class DiagnosisEngine {
  diagnose(anomaly: RuntimeAnomaly, incidentId?: string): RuntimeDiagnosis {
    const incId = incidentId ?? `inc-${randomUUID().slice(0, 8)}`;
    const evidence = [anomaly.evidence];

    let probableCause = 'Unknown degradation';
    let confidence = 0.8;
    let recommendedRemediation: RemediationActionType = 'REFRESH_PROVIDER_HEALTH';
    let policyTier: RemediationPolicyTier = 'AUTO_SAFE';

    switch (anomaly.anomalyType) {
      case 'RATE_LIMIT_SPIKE':
        probableCause = `Provider [${anomaly.targetId ?? 'upstream'}] rate limit exceeded. Concurrency or token quota reached.`;
        confidence = 0.95;
        recommendedRemediation = 'DEPRIORITIZE_PROVIDER';
        policyTier = 'AUTO_SAFE';
        evidence.push('Upstream provider returned HTTP 429 Too Many Requests repeatedly');
        break;

      case 'AUTH_FAILURE_SPIKE':
        probableCause = `Authentication credential for [${anomaly.targetId ?? 'provider'}] rejected (401/403). Expired, revoked, or quota depleted.`;
        confidence = 0.92;
        recommendedRemediation = 'ROTATE_TO_HEALTHY_KEY';
        policyTier = 'AUTO_SAFE';
        evidence.push('Provider authentication rejected active key. Operator may need to supply fresh credential if rotation fails.');
        break;

      case 'MODEL_DEGRADED':
        probableCause = `Model registry entry [${anomaly.targetId ?? 'model'}] returned 404 or unsupported capability.`;
        confidence = 0.9;
        recommendedRemediation = 'TRIGGER_MODEL_REDISCOVERY';
        policyTier = 'AUTO_SAFE';
        evidence.push('Controlled rediscovery required to synchronize remote provider model catalog with local registry.');
        break;

      case 'PROVIDER_DEGRADED':
        probableCause = `Upstream provider [${anomaly.targetId ?? 'endpoint'}] experiencing 5xx server errors or persistent timeouts.`;
        confidence = 0.88;
        recommendedRemediation = 'DEPRIORITIZE_PROVIDER';
        policyTier = 'AUTO_SAFE';
        evidence.push('Failover routing and temporary deprioritization recommended.');
        break;

      case 'AGENT_DEGRADED':
      case 'AGENT_UNAVAILABLE':
        probableCause = `Local agent adapter [${anomaly.targetId ?? 'agent'}] process failure, execution timeout, or missing CLI binary.`;
        confidence = 0.85;
        recommendedRemediation = 'PROBE_AGENT_HEALTH';
        policyTier = 'AUTO_SAFE';
        evidence.push('Health probe recommended. Software installation or binary modification strictly requires operator action.');
        break;

      case 'MISSION_STALLED':
        probableCause = `Mission task or lease stalled with no active heartbeat. Process may have terminated abnormally.`;
        confidence = 0.85;
        recommendedRemediation = 'RECONCILE_INTERRUPTED_MISSION';
        policyTier = 'AUTO_SAFE';
        evidence.push('Lease release and state reconciliation via durable persistence recommended.');
        break;

      case 'MISSION_FAILURE_SPIKE':
      case 'REPAIR_LOOP_EXHAUSTION':
        probableCause = `Autonomous repair loop exhausted max retry budget or task dependency execution repeatedly failed.`;
        confidence = 0.9;
        recommendedRemediation = 'RECONCILE_INTERRUPTED_MISSION';
        policyTier = 'AUTO_SAFE';
        evidence.push('Mission failed bounded repair cycles and requires checkpoint review or operator intervention.');
        break;

      case 'PERSISTENCE_DEGRADED':
        probableCause = `Database SQLite WAL write failure, disk lock contention, or migration inconsistency.`;
        confidence = 0.8;
        recommendedRemediation = 'DROP_PERSISTENCE_STORE'; // UNSAFE action!
        policyTier = 'NEVER_AUTOMATE'; // strictly forbidden
        evidence.push('Durable state corruption must NEVER be automatically destroyed or overwritten.');
        break;

      case 'NETWORK_DEGRADED':
        probableCause = `DNS resolution failure, socket connection refusal, or upstream gateway network drop.`;
        confidence = 0.85;
        recommendedRemediation = 'MODIFY_FIREWALL_NETWORK'; // UNSAFE action!
        policyTier = 'NEVER_AUTOMATE';
        evidence.push('OS network reconfiguration cannot be automated safely.');
        break;

      case 'TOKEN_COST_SPIKE':
        probableCause = `Rapid token budget consumption detected. Prompt explosion or unbounded agent interaction loop.`;
        confidence = 0.82;
        recommendedRemediation = 'INVALIDATE_CORRUPT_CACHE';
        policyTier = 'AUTO_SAFE';
        evidence.push('Token budget and prompt compression inspection recommended.');
        break;

      case 'ROUTING_DEGRADED':
      case 'LATENCY_SPIKE':
      case 'ERROR_RATE_SPIKE':
      default:
        probableCause = `Subsystem [${anomaly.subsystem}] health degraded under current traffic conditions.`;
        confidence = 0.8;
        recommendedRemediation = 'REFRESH_PROVIDER_HEALTH';
        policyTier = 'AUTO_SAFE';
        break;
    }

    const autoRemediationPermitted = policyTier === 'AUTO_SAFE';

    return {
      incidentId: incId,
      subsystem: anomaly.subsystem,
      signal: anomaly.anomalyType,
      severity: anomaly.severity,
      probableCause,
      evidence,
      confidence,
      recommendedRemediation,
      autoRemediationPermitted,
      policyTier,
    };
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Phase 34 Deterministic Statistical Anomaly Detector
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type { AnomalySeverity, AnomalyType, RuntimeAnomaly } from '../../domain/runtime-intelligence.js';
import type { SubsystemName } from '../../domain/system-health.js';

import type { SignalCollector } from './signal-collector.js';

export interface AnomalyThresholds {
  readonly rateLimitSpikeCount?: number;       // default: 3 in 60s
  readonly authFailureSpikeCount?: number;     // default: 2 in 60s
  readonly latencySpikeP95Ms?: number;         // default: 4000ms
  readonly errorRateSpikePct?: number;         // default: 30%
  readonly providerFailureCount?: number;      // default: 3 consecutive / window
  readonly modelNotFoundCount?: number;        // default: 2 in 60s
  readonly agentFailureCount?: number;         // default: 3 in 60s
  readonly missionFailureCount?: number;       // default: 3 in 60s
  readonly tokenCostSpikeUsd?: number;         // default: 1.00 USD in 60s
  readonly windowMs?: number;                  // default: 60_000ms
}

export class AnomalyDetector {
  private readonly thresholds: Required<AnomalyThresholds>;

  constructor(
    private readonly collector: SignalCollector,
    customThresholds: AnomalyThresholds = {},
  ) {
    this.thresholds = {
      rateLimitSpikeCount: customThresholds.rateLimitSpikeCount ?? 3,
      authFailureSpikeCount: customThresholds.authFailureSpikeCount ?? 2,
      latencySpikeP95Ms: customThresholds.latencySpikeP95Ms ?? 4000,
      errorRateSpikePct: customThresholds.errorRateSpikePct ?? 30,
      providerFailureCount: customThresholds.providerFailureCount ?? 3,
      modelNotFoundCount: customThresholds.modelNotFoundCount ?? 2,
      agentFailureCount: customThresholds.agentFailureCount ?? 3,
      missionFailureCount: customThresholds.missionFailureCount ?? 3,
      tokenCostSpikeUsd: customThresholds.tokenCostSpikeUsd ?? 1.0,
      windowMs: customThresholds.windowMs ?? 60_000,
    };
  }

  detectAnomalies(): RuntimeAnomaly[] {
    const anomalies: RuntimeAnomaly[] = [];
    const windowMs = this.thresholds.windowMs;

    // 1. RATE_LIMIT_SPIKE (Providers/Keys)
    const rateLimits = this.collector.getSignalAggregates('providers', 'rate_limit_429', windowMs);
    if (rateLimits.count >= this.thresholds.rateLimitSpikeCount) {
      const providerId = (rateLimits.latest?.metadata?.['providerId'] as string) ?? 'upstream';
      anomalies.push(this.createAnomaly(
        'RATE_LIMIT_SPIKE',
        'providers',
        rateLimits.count >= 6 ? 'CRITICAL' : 'HIGH',
        `Provider [${providerId}] 429 rate limit spike: ${rateLimits.count} occurrences in ${windowMs / 1000}s (threshold: ${this.thresholds.rateLimitSpikeCount})`,
        this.thresholds.rateLimitSpikeCount,
        rateLimits.count,
        providerId,
        rateLimits.latest?.correlationId,
      ));
    }

    // 2. AUTH_FAILURE_SPIKE (API Keys)
    const authFailures = this.collector.getSignalAggregates('apiKeys', 'auth_failure', windowMs);
    if (authFailures.count >= this.thresholds.authFailureSpikeCount) {
      const providerId = (authFailures.latest?.metadata?.['providerId'] as string) ?? 'upstream';
      anomalies.push(this.createAnomaly(
        'AUTH_FAILURE_SPIKE',
        'apiKeys',
        'HIGH',
        `API Key authentication failure spike: ${authFailures.count} 401/403 errors in ${windowMs / 1000}s for provider [${providerId}]`,
        this.thresholds.authFailureSpikeCount,
        authFailures.count,
        providerId,
        authFailures.latest?.correlationId,
      ));
    }

    // 3. MODEL_DEGRADED / 404 Model Not Found
    const modelNotFound = this.collector.getSignalAggregates('models', 'model_not_found', windowMs);
    if (modelNotFound.count >= this.thresholds.modelNotFoundCount) {
      const providerId = (modelNotFound.latest?.metadata?.['providerId'] as string) ?? 'provider';
      const endpointId = (modelNotFound.latest?.metadata?.['endpointId'] as string) ?? undefined;
      anomalies.push(this.createAnomaly(
        'MODEL_DEGRADED',
        'models',
        'MEDIUM',
        `Model 404/Not-Found anomaly: ${modelNotFound.count} missing model occurrences in ${windowMs / 1000}s on [${providerId}]`,
        this.thresholds.modelNotFoundCount,
        modelNotFound.count,
        endpointId ?? providerId,
        modelNotFound.latest?.correlationId,
      ));
    }

    // 4. PROVIDER_DEGRADED / 5xx Server Errors
    const serverErrors = this.collector.getSignalAggregates('providers', 'server_error_5xx', windowMs);
    if (serverErrors.count >= this.thresholds.providerFailureCount) {
      const providerId = (serverErrors.latest?.metadata?.['providerId'] as string) ?? 'upstream';
      anomalies.push(this.createAnomaly(
        'PROVIDER_DEGRADED',
        'providers',
        'HIGH',
        `Provider 5xx error spike: ${serverErrors.count} server errors in ${windowMs / 1000}s on [${providerId}]`,
        this.thresholds.providerFailureCount,
        serverErrors.count,
        providerId,
        serverErrors.latest?.correlationId,
      ));
    }

    // 5. LATENCY_SPIKE
    const latencies = this.collector.getSignalAggregates('providers', 'latency_ms', windowMs);
    if (latencies.count > 0 && latencies.avg > this.thresholds.latencySpikeP95Ms) {
      anomalies.push(this.createAnomaly(
        'LATENCY_SPIKE',
        'providers',
        latencies.avg > this.thresholds.latencySpikeP95Ms * 2 ? 'CRITICAL' : 'MEDIUM',
        `Latency anomaly: rolling average latency is ${latencies.avg}ms (threshold: ${this.thresholds.latencySpikeP95Ms}ms)`,
        this.thresholds.latencySpikeP95Ms,
        latencies.avg,
        undefined,
        latencies.latest?.correlationId,
      ));
    }

    // 6. ERROR_RATE_SPIKE (Gateway & Providers aggregate)
    const successSignals = this.collector.getSignalAggregates('providers', 'request_success', windowMs);
    const failureSignals = this.collector.getSignalAggregates('providers', 'request_failure', windowMs);
    const totalReqs = successSignals.count + failureSignals.count;
    if (totalReqs >= 5) {
      const errorRate = (failureSignals.count / totalReqs) * 100;
      if (errorRate >= this.thresholds.errorRateSpikePct) {
        anomalies.push(this.createAnomaly(
          'ERROR_RATE_SPIKE',
          'gateway',
          errorRate >= 60 ? 'CRITICAL' : 'HIGH',
          `Gateway error rate spike: ${Math.round(errorRate)}% failures (${failureSignals.count}/${totalReqs} reqs in ${windowMs / 1000}s)`,
          this.thresholds.errorRateSpikePct,
          errorRate,
          undefined,
        ));
      }
    }

    // 7. AGENT_DEGRADED & AGENT_UNAVAILABLE
    const agentFailures = this.collector.getSignalAggregates('localAgents', 'agent_failure', windowMs);
    if (agentFailures.count >= this.thresholds.agentFailureCount) {
      const agentId = (agentFailures.latest?.metadata?.['agentId'] as string) ?? 'agent';
      anomalies.push(this.createAnomaly(
        'AGENT_DEGRADED',
        'localAgents',
        'HIGH',
        `Local Agent [${agentId}] failure spike: ${agentFailures.count} execution failures in ${windowMs / 1000}s`,
        this.thresholds.agentFailureCount,
        agentFailures.count,
        agentId,
        agentFailures.latest?.correlationId,
      ));
    }

    // 8. MISSION_FAILURE_SPIKE & MISSION_STALLED
    const missionFailures = this.collector.getSignalAggregates('missionEngine', 'task_failure', windowMs);
    if (missionFailures.count >= this.thresholds.missionFailureCount) {
      const taskId = (missionFailures.latest?.metadata?.['taskId'] as string) ?? 'task';
      anomalies.push(this.createAnomaly(
        'MISSION_FAILURE_SPIKE',
        'missionEngine',
        'HIGH',
        `Mission task failure spike: ${missionFailures.count} failed tasks in ${windowMs / 1000}s (recent task: ${taskId})`,
        this.thresholds.missionFailureCount,
        missionFailures.count,
        taskId,
        missionFailures.latest?.correlationId,
      ));
    }

    // 9. TOKEN_COST_SPIKE
    const costs = this.collector.getSignalAggregates('tokenEngine', 'cost_usd', windowMs);
    if (costs.sum >= this.thresholds.tokenCostSpikeUsd) {
      anomalies.push(this.createAnomaly(
        'TOKEN_COST_SPIKE',
        'tokenEngine',
        'MEDIUM',
        `Token cost acceleration: $${costs.sum.toFixed(4)} consumed in ${windowMs / 1000}s (threshold: $${this.thresholds.tokenCostSpikeUsd.toFixed(2)})`,
        this.thresholds.tokenCostSpikeUsd,
        costs.sum,
      ));
    }

    return anomalies;
  }

  createManualAnomaly(
    type: AnomalyType,
    subsystem: SubsystemName,
    severity: AnomalySeverity,
    evidence: string,
    targetId?: string,
    correlationId?: string,
  ): RuntimeAnomaly {
    return this.createAnomaly(type, subsystem, severity, evidence, 1, 1, targetId, correlationId);
  }

  private createAnomaly(
    anomalyType: AnomalyType,
    subsystem: SubsystemName,
    severity: AnomalySeverity,
    evidence: string,
    threshold: number,
    observedValue: number,
    targetId?: string,
    correlationId?: string,
  ): RuntimeAnomaly {
    return {
      id: `anom-${randomUUID().slice(0, 8)}`,
      anomalyType,
      subsystem,
      severity,
      detectedAt: Date.now(),
      evidence,
      threshold,
      observedValue: Math.round(observedValue * 100) / 100,
      targetId,
      correlationId,
    };
  }
}

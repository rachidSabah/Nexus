/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Phase 34 Self-Healing Orchestrator & Autonomous Loop
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type { EventBusPort } from '../../application/ports.js';
import { buildEvent } from '../../domain/events.js';
import type {
  RemediationAction,
  RemediationExecution,
  RuntimeAnomaly,
  RuntimeIncident,
  RuntimeIntelligenceOverview,
} from '../../domain/runtime-intelligence.js';
import type { SubsystemName, SystemHealthStatus } from '../../domain/system-health.js';

import type { AnomalyDetector } from './anomaly-detector.js';
import type { DiagnosisEngine } from './diagnosis-engine.js';
import type { IncidentManager } from './incident-manager.js';
import type { RemediationEngine } from './remediation-engine.js';
import type { RemediationPolicyEngine } from './remediation-policy-engine.js';
import type { SignalCollector } from './signal-collector.js';

export interface SelfHealingOrchestratorOptions {
  readonly intervalMs?: number;
  readonly autoStart?: boolean;
}

export class SelfHealingOrchestrator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private activeAnomalies: RuntimeAnomaly[] = [];

  constructor(
    private readonly collector: SignalCollector,
    private readonly detector: AnomalyDetector,
    private readonly diagnosisEngine: DiagnosisEngine,
    private readonly policyEngine: RemediationPolicyEngine,
    private readonly remediationEngine: RemediationEngine,
    private readonly incidentManager: IncidentManager,
    private readonly events?: EventBusPort,
    opts: SelfHealingOrchestratorOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 15_000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runCycle().catch(() => {
        /* swallow to avoid terminating process */
      });
    }, this.intervalMs);

    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runCycle(): Promise<{
    anomaliesDetected: number;
    incidentsCreated: number;
    remediationsAttempted: number;
    remediationsSucceeded: number;
  }> {
    // 1. DETECT
    const anomalies = this.detector.detectAnomalies();
    this.activeAnomalies = anomalies;

    let incidentsCreated = 0;
    let remediationsAttempted = 0;
    let remediationsSucceeded = 0;

    const openIncidents = await this.incidentManager.listIncidents({ limit: 200 });

    for (const anomaly of anomalies) {
      // Check if an open/remediating incident already exists for this subsystem and anomaly
      const existing = openIncidents.find(
        (i) => (i.status === 'OPEN' || i.status === 'REMEDIATING' || i.status === 'ACKNOWLEDGED') &&
               i.subsystem === anomaly.subsystem &&
               i.anomalyType === anomaly.anomalyType,
      );

      let incident: RuntimeIncident;
      if (existing) {
        incident = existing;
      } else {
        // 2. DIAGNOSE
        const diagnosis = this.diagnosisEngine.diagnose(anomaly);
        incident = await this.incidentManager.createIncident(anomaly, diagnosis, {
          correlationId: anomaly.correlationId,
        });
        incidentsCreated++;

        if (this.events) {
          this.events.publish(
            buildEvent('runtime.anomaly.detected', {
              id: anomaly.id,
              anomalyType: anomaly.anomalyType,
              subsystem: anomaly.subsystem,
              severity: anomaly.severity,
              detectedAt: anomaly.detectedAt,
              evidence: anomaly.evidence,
              threshold: anomaly.threshold,
              observedValue: anomaly.observedValue,
              targetId: anomaly.targetId,
            }, anomaly.correlationId),
          );

          this.events.publish(
            buildEvent('runtime.diagnosis.created', {
              incidentId: incident.id,
              subsystem: diagnosis.subsystem,
              signal: diagnosis.signal,
              severity: diagnosis.severity,
              probableCause: diagnosis.probableCause,
              confidence: diagnosis.confidence,
              recommendedRemediation: diagnosis.recommendedRemediation,
              autoRemediationPermitted: diagnosis.autoRemediationPermitted,
            }, anomaly.correlationId),
          );
        }
      }

      // 3. POLICY CHECK & REMEDIATE
      const diagnosis = incident.diagnosis;
      if (diagnosis.policyTier === 'NEVER_AUTOMATE') {
        if (incident.status !== 'ESCALATED') {
          await this.incidentManager.escalateIncident(
            incident.id,
            `Strict Security Policy: Degradation [${anomaly.anomalyType}] requires manual operator intervention. Automated action is strictly forbidden.`,
          );
        }
        continue;
      }

      if (diagnosis.policyTier === 'APPROVAL_REQUIRED') {
        // Keeps incident OPEN waiting for operator
        continue;
      }

      // AUTO_SAFE action execution
      const currentAttempts = incident.remediationHistory.length;
      const action: RemediationAction = {
        actionType: diagnosis.recommendedRemediation,
        targetSubsystem: incident.subsystem,
        targetId: anomaly.targetId,
        initiatedBy: 'AUTONOMOUS',
        timestamp: Date.now(),
      };

      const executionId = `rem-${randomUUID().slice(0, 8)}`;
      const execution: RemediationExecution = {
        id: executionId,
        incidentId: incident.id,
        action,
        policy: diagnosis.policyTier,
        attemptNumber: currentAttempts + 1,
        status: 'RUNNING',
        startedAt: Date.now(),
      };

      await this.incidentManager.recordRemediationExecution(incident.id, execution);
      remediationsAttempted++;

      if (this.events) {
        this.events.publish(
          buildEvent('runtime.remediation.started', {
            executionId,
            incidentId: incident.id,
            actionType: action.actionType,
            targetSubsystem: action.targetSubsystem,
            targetId: action.targetId,
            policyTier: diagnosis.policyTier,
            attemptNumber: execution.attemptNumber,
            initiatedBy: 'AUTONOMOUS',
          }, incident.correlationId),
        );
      }

      // 4. REMEDIATE & VERIFY
      const outcome = await this.remediationEngine.executeRemediation(action, currentAttempts);

      execution.completedAt = Date.now();
      execution.status = outcome.status;
      execution.verificationResult = outcome.verification;
      execution.error = outcome.error;
      await this.incidentManager.recordRemediationExecution(incident.id, execution);

      if (outcome.status === 'COMPLETED' && outcome.verification?.verified) {
        remediationsSucceeded++;
        await this.incidentManager.resolveIncident(
          incident.id,
          outcome.verification.evidence || 'Autonomous self-healing completed and verified.',
        );

        if (this.events) {
          this.events.publish(
            buildEvent('runtime.remediation.completed', {
              executionId,
              incidentId: incident.id,
              actionType: action.actionType,
              targetSubsystem: action.targetSubsystem,
              targetId: action.targetId,
              verified: true,
              message: outcome.verification.evidence,
            }, incident.correlationId),
          );
        }
      } else {
        if (this.events) {
          this.events.publish(
            buildEvent('runtime.remediation.failed', {
              executionId,
              incidentId: incident.id,
              actionType: action.actionType,
              targetSubsystem: action.targetSubsystem,
              targetId: action.targetId,
              attemptNumber: execution.attemptNumber,
              error: outcome.error ?? 'Verification failed',
            }, incident.correlationId),
          );
        }

        // 5. Check if exhausted max attempts (3)
        const policyRule = this.policyEngine.getPolicy(action.actionType);
        const maxAttempts = policyRule?.maxAttempts ?? 3;
        if (execution.attemptNumber >= maxAttempts) {
          await this.incidentManager.escalateIncident(
            incident.id,
            `Max autonomous remediation attempts (${maxAttempts}) exhausted for [${action.actionType}]. Escalated to human operator.`,
          );
        }
      }
    }

    return {
      anomaliesDetected: anomalies.length,
      incidentsCreated,
      remediationsAttempted,
      remediationsSucceeded,
    };
  }

  async operatorApproveAndRemediate(
    incidentId: string,
    operatorNotes?: string,
  ): Promise<{ success: boolean; message: string; incident: RuntimeIncident }> {
    const incident = await this.incidentManager.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident [${incidentId}] not found`);
    }

    const action: RemediationAction = {
      actionType: incident.diagnosis.recommendedRemediation,
      targetSubsystem: incident.subsystem,
      targetId: incident.diagnosis.subsystem,
      initiatedBy: 'OPERATOR',
      timestamp: Date.now(),
    };

    const executionId = `rem-op-${randomUUID().slice(0, 8)}`;
    const execution: RemediationExecution = {
      id: executionId,
      incidentId: incident.id,
      action,
      policy: incident.diagnosis.policyTier,
      attemptNumber: incident.remediationHistory.length + 1,
      status: 'RUNNING',
      startedAt: Date.now(),
      operatorNotes,
    };

    await this.incidentManager.recordRemediationExecution(incident.id, execution);

    const outcome = await this.remediationEngine.executeRemediation(action, 0);
    execution.completedAt = Date.now();
    execution.status = outcome.status;
    execution.verificationResult = outcome.verification;
    execution.error = outcome.error;
    await this.incidentManager.recordRemediationExecution(incident.id, execution);

    if (outcome.status === 'COMPLETED') {
      const updated = await this.incidentManager.resolveIncident(
        incident.id,
        outcome.verification?.evidence ?? 'Operator remediation completed.',
      );
      return { success: true, message: outcome.verification?.evidence ?? 'Remediation completed', incident: updated };
    } else {
      const updated = await this.incidentManager.getIncident(incident.id);
      return { success: false, message: outcome.error ?? 'Remediation failed', incident: updated! };
    }
  }

  async operatorTriggerRemediation(
    actionType: RemediationAction['actionType'],
    targetSubsystem: SubsystemName,
    targetId?: string,
    parameters?: Record<string, unknown>,
  ): Promise<{ success: boolean; message: string; details?: Record<string, unknown> }> {
    const action: RemediationAction = {
      actionType,
      targetSubsystem,
      targetId,
      parameters,
      initiatedBy: 'OPERATOR',
      timestamp: Date.now(),
    };

    const outcome = await this.remediationEngine.executeRemediation(action, 0);
    return {
      success: outcome.status === 'COMPLETED',
      message: outcome.verification?.evidence ?? outcome.error ?? 'Remediation executed',
      details: outcome.result?.details,
    };
  }

  async getOverview(): Promise<RuntimeIntelligenceOverview> {
    const allIncidents = await this.incidentManager.listIncidents({ limit: 100 });
    const activeIncidents = allIncidents.filter((i) => i.status === 'OPEN' || i.status === 'REMEDIATING' || i.status === 'ACKNOWLEDGED');
    const resolvedIncidents = allIncidents.filter((i) => i.status === 'RESOLVED');
    const escalatedIncidents = allIncidents.filter((i) => i.status === 'ESCALATED');

    let totalRemediations = 0;
    let successfulRemediations = 0;
    let failedRemediations = 0;

    for (const inc of allIncidents) {
      for (const rem of inc.remediationHistory) {
        totalRemediations++;
        if (rem.status === 'COMPLETED') successfulRemediations++;
        if (rem.status === 'FAILED') failedRemediations++;
      }
    }

    const rateLimits = this.collector.getSignalAggregates('providers', 'rate_limit_429', 60_000);
    const costs = this.collector.getSignalAggregates('tokenEngine', 'cost_usd', 3600_000);
    const latencies = this.collector.getSignalAggregates('providers', 'latency_ms', 60_000);
    const failures = this.collector.getSignalAggregates('providers', 'request_failure', 60_000);
    const successes = this.collector.getSignalAggregates('providers', 'request_success', 60_000);
    const totalReqs = failures.count + successes.count;
    const errorRate = totalReqs > 0 ? (failures.count / totalReqs) * 100 : 0;

    let systemState: SystemHealthStatus = 'HEALTHY';
    if (escalatedIncidents.length > 0 || activeIncidents.some((i) => i.severity === 'CRITICAL')) {
      systemState = 'DEGRADED';
    } else if (activeIncidents.length > 0) {
      systemState = 'DEGRADED';
    }

    return {
      systemState,
      activeIncidentsCount: activeIncidents.length,
      resolvedIncidentsCount: resolvedIncidents.length,
      activeAnomaliesCount: this.activeAnomalies.length,
      totalRemediationsCount: totalRemediations,
      successfulRemediationsCount: successfulRemediations,
      failedRemediationsCount: failedRemediations,
      escalatedIncidentsCount: escalatedIncidents.length,
      incidents: allIncidents,
      activeAnomalies: this.activeAnomalies,
      policies: this.policyEngine.listPolicies(),
      statisticalTrends: {
        errorRateP95: Math.round(errorRate * 10) / 10,
        latencyP95Ms: latencies.avg,
        rateLimitCount1m: rateLimits.count,
        tokenCost1hUsd: Math.round(costs.sum * 10000) / 10000,
      },
    };
  }
}

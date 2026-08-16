/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Phase 34 Incident Manager & Lifecycle Coordinator
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type { EventBusPort } from '../../application/ports.js';
import { buildEvent } from '../../domain/events.js';
import type {
  IncidentStatus,
  RemediationExecution,
  RuntimeAnomaly,
  RuntimeDiagnosis,
  RuntimeIncident,
} from '../../domain/runtime-intelligence.js';
import type { SubsystemName } from '../../domain/system-health.js';

export interface IncidentRepositoryPort {
  save(incident: RuntimeIncident): Promise<void> | void;
  get(id: string): Promise<RuntimeIncident | undefined> | RuntimeIncident | undefined;
  list(options?: { status?: IncidentStatus; subsystem?: SubsystemName; limit?: number }): Promise<RuntimeIncident[]> | RuntimeIncident[];
}

export class InMemoryIncidentRepository implements IncidentRepositoryPort {
  private readonly incidents = new Map<string, RuntimeIncident>();

  save(incident: RuntimeIncident): void {
    this.incidents.set(incident.id, JSON.parse(JSON.stringify(incident)));
  }

  get(id: string): RuntimeIncident | undefined {
    const raw = this.incidents.get(id);
    return raw ? JSON.parse(JSON.stringify(raw)) : undefined;
  }

  list(options?: { status?: IncidentStatus; subsystem?: SubsystemName; limit?: number }): RuntimeIncident[] {
    let list = Array.from(this.incidents.values());
    if (options?.status) {
      list = list.filter((i) => i.status === options.status);
    }
    if (options?.subsystem) {
      list = list.filter((i) => i.subsystem === options.subsystem);
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    const limit = options?.limit ?? 100;
    return list.slice(0, limit);
  }
}

export class IncidentManager {
  constructor(
    private readonly repo: IncidentRepositoryPort = new InMemoryIncidentRepository(),
    private readonly events?: EventBusPort,
  ) {}

  async createIncident(
    anomaly: RuntimeAnomaly,
    diagnosis: RuntimeDiagnosis,
    opts?: {
      correlationId?: string;
      missionId?: string;
      taskId?: string;
      executionId?: string;
    },
  ): Promise<RuntimeIncident> {
    const sanitizedEvidence = (anomaly.evidence ? [anomaly.evidence] : []).map((e) => this.sanitize(e));
    const incident: RuntimeIncident = {
      id: diagnosis.incidentId ?? `inc-${randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      subsystem: anomaly.subsystem,
      severity: anomaly.severity,
      anomalyType: anomaly.anomalyType,
      diagnosis: {
        ...diagnosis,
        probableCause: this.sanitize(diagnosis.probableCause),
        evidence: diagnosis.evidence.map((e) => this.sanitize(e)),
      },
      evidence: sanitizedEvidence,
      status: 'OPEN',
      remediationHistory: [],
      correlationId: opts?.correlationId ?? anomaly.correlationId,
      missionId: opts?.missionId,
      taskId: opts?.taskId,
      executionId: opts?.executionId,
      createdAt: Date.now(),
    };

    await this.repo.save(incident);

    if (this.events) {
      this.events.publish(
        buildEvent('runtime.incident.created', {
          incidentId: incident.id,
          subsystem: incident.subsystem,
          severity: incident.severity,
          anomalyType: incident.anomalyType,
          diagnosis: incident.diagnosis.probableCause,
        }, incident.correlationId),
      );
    }

    return incident;
  }

  async acknowledgeIncident(incidentId: string, operatorNotes?: string): Promise<RuntimeIncident> {
    const incident = await this.repo.get(incidentId);
    if (!incident) {
      throw new Error(`Incident [${incidentId}] not found.`);
    }

    incident.status = 'ACKNOWLEDGED';
    incident.acknowledgedAt = Date.now();
    if (operatorNotes) {
      incident.operatorNotes = this.sanitize(operatorNotes);
    }

    await this.repo.save(incident);

    if (this.events) {
      this.events.publish(
        buildEvent('runtime.incident.acknowledged', {
          incidentId: incident.id,
          acknowledgedAt: incident.acknowledgedAt,
          operatorNotes: incident.operatorNotes,
        }, incident.correlationId),
      );
    }

    return incident;
  }

  async recordRemediationExecution(
    incidentId: string,
    execution: RemediationExecution,
  ): Promise<RuntimeIncident> {
    const incident = await this.repo.get(incidentId);
    if (!incident) {
      throw new Error(`Incident [${incidentId}] not found.`);
    }

    incident.status = 'REMEDIATING';
    const idx = incident.remediationHistory.findIndex((r) => r.id === execution.id);
    if (idx >= 0) {
      incident.remediationHistory[idx] = execution;
    } else {
      incident.remediationHistory.push(execution);
    }

    await this.repo.save(incident);
    return incident;
  }

  async resolveIncident(incidentId: string, verificationEvidence: string): Promise<RuntimeIncident> {
    const incident = await this.repo.get(incidentId);
    if (!incident) {
      throw new Error(`Incident [${incidentId}] not found.`);
    }

    incident.status = 'RESOLVED';
    incident.resolvedAt = Date.now();
    incident.verificationResult = {
      verified: true,
      evidence: this.sanitize(verificationEvidence),
      resolvedAt: incident.resolvedAt,
    };

    await this.repo.save(incident);

    if (this.events) {
      this.events.publish(
        buildEvent('runtime.incident.resolved', {
          incidentId: incident.id,
          subsystem: incident.subsystem,
          resolvedAt: incident.resolvedAt,
          verificationEvidence: incident.verificationResult.evidence,
        }, incident.correlationId),
      );
    }

    return incident;
  }

  async escalateIncident(incidentId: string, reason: string): Promise<RuntimeIncident> {
    const incident = await this.repo.get(incidentId);
    if (!incident) {
      throw new Error(`Incident [${incidentId}] not found.`);
    }

    incident.status = 'ESCALATED';
    incident.escalatedAt = Date.now();
    incident.operatorNotes = `ESCALATED: ${this.sanitize(reason)}`;

    await this.repo.save(incident);

    if (this.events) {
      this.events.publish(
        buildEvent('runtime.incident.escalated', {
          incidentId: incident.id,
          subsystem: incident.subsystem,
          reason: incident.operatorNotes,
          escalatedAt: incident.escalatedAt,
        }, incident.correlationId),
      );
    }

    return incident;
  }

  async getIncident(incidentId: string): Promise<RuntimeIncident | undefined> {
    return this.repo.get(incidentId);
  }

  async listIncidents(options?: { status?: IncidentStatus; subsystem?: SubsystemName; limit?: number }): Promise<RuntimeIncident[]> {
    return this.repo.list(options);
  }

  private sanitize(str: string): string {
    if (!str) return '';
    return str
      .replace(/sk-[a-zA-Z0-9_-]{10,}/g, '[REDACTED_API_KEY]')
      .replace(/bearer\s+[a-zA-Z0-9._-]{10,}/gi, 'Bearer [REDACTED_TOKEN]')
      .replace(/(?:password|secret|key|token)["':=\s]+([^\s,;}{]+)/gi, '$1=[REDACTED]');
  }
}

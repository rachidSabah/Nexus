/**
 * Canonical intelligence repository port + in-memory implementation.
 *
 * All persistence for the AI Provider Intelligence OS crosses this port so the
 * engineering pipeline is testable without SQLite and swappable per
 * environment (SQLite via node:sqlite is the production backend, see
 * `sqlite-repository.ts`).
 */

import type {
  AccessPlanFilter,
  AccessPlanRecord,
  AdapterVersionFilter,
  AdapterVersionRecord,
  ApprovalFilter,
  ApprovalRequestRecord,
  AuditEventRecord,
  ConnectorCheckpoint,
  ConnectorRecord,
  DiscoveryJobFilter,
  DiscoveryJobRecord,
  EndpointRecord,
  EvidenceFilter,
  EvidenceRecord,
  IntelligenceOverview,
  ModelFilter,
  ModelRecord,
  ProviderFilter,
  ProviderModelFilter,
  ProviderModelRecord,
  ProviderRecord,
  SecurityFindingFilter,
  SecurityFindingRecord,
  SecurityFindingStatus,
  VerificationRunFilter,
  VerificationRunRecord,
} from './types.js';

export interface IntelligenceRepository {
  // Providers
  upsertProvider(p: ProviderRecord): Promise<void>;
  getProvider(id: string): Promise<ProviderRecord | undefined>;
  listProviders(filter?: ProviderFilter): Promise<ProviderRecord[]>;

  // Canonical models
  upsertModel(m: ModelRecord): Promise<void>;
  getModel(id: string): Promise<ModelRecord | undefined>;
  listModels(filter?: ModelFilter): Promise<ModelRecord[]>;

  // Provider↔model serving relations (unique per (provider, provider_model_id))
  upsertProviderModel(p: ProviderModelRecord, opts?: { createOnly?: boolean }): Promise<'created' | 'updated'>;
  getProviderModel(providerId: string, providerModelId: string): Promise<ProviderModelRecord | undefined>;
  getProviderModelById(id: string): Promise<ProviderModelRecord | undefined>;
  listProviderModels(filter?: ProviderModelFilter): Promise<ProviderModelRecord[]>;

  // Endpoints
  upsertEndpoint(e: EndpointRecord): Promise<void>;
  getEndpoint(id: string): Promise<EndpointRecord | undefined>;
  listEndpoints(providerId?: string): Promise<EndpointRecord[]>;

  // Access plans
  upsertAccessPlan(a: AccessPlanRecord): Promise<void>;
  listAccessPlans(filter?: AccessPlanFilter): Promise<AccessPlanRecord[]>;

  // Sources / connectors
  upsertConnector(c: ConnectorRecord): Promise<void>;
  listConnectors(): Promise<ConnectorRecord[]>;
  getConnector(id: string): Promise<ConnectorRecord | undefined>;

  // Evidence (idempotent by dedupeKey)
  appendEvidence(e: EvidenceRecord): Promise<'created' | 'duplicate'>;
  listEvidence(filter?: EvidenceFilter): Promise<EvidenceRecord[]>;
  countDistinctSources(subjectType: EvidenceFilter['subjectType'], subjectId: string): Promise<number>;

  // Verification runs
  recordVerificationRun(r: VerificationRunRecord): Promise<void>;
  listVerificationRuns(filter?: VerificationRunFilter): Promise<VerificationRunRecord[]>;

  // Discovery jobs (retryable, checkpointed)
  enqueueDiscoveryJob(j: DiscoveryJobRecord): Promise<void>;
  updateDiscoveryJob(j: DiscoveryJobRecord): Promise<void>;
  dueDiscoveryJobs(nowIso: string, limit?: number): Promise<DiscoveryJobRecord[]>;
  listDiscoveryJobs(filter?: DiscoveryJobFilter): Promise<DiscoveryJobRecord[]>;

  // Security findings (dedupe by key, redacted before insertion)
  addSecurityFinding(f: SecurityFindingRecord): Promise<'created' | 'updated'>;
  listSecurityFindings(filter?: SecurityFindingFilter): Promise<SecurityFindingRecord[]>;
  getSecurityFinding(id: string): Promise<SecurityFindingRecord | undefined>;
  updateSecurityFindingStatus(id: string, status: SecurityFindingStatus, at: string): Promise<boolean>;

  // Adapter versions + approvals
  upsertAdapterVersion(a: AdapterVersionRecord): Promise<void>;
  getAdapterVersion(id: string): Promise<AdapterVersionRecord | undefined>;
  listAdapterVersions(filter?: AdapterVersionFilter): Promise<AdapterVersionRecord[]>;
  upsertApprovalRequest(a: ApprovalRequestRecord): Promise<void>;
  getApprovalRequest(id: string): Promise<ApprovalRequestRecord | undefined>;
  listApprovalRequests(filter?: ApprovalFilter): Promise<ApprovalRequestRecord[]>;

  // Audit (append-only)
  appendAudit(e: AuditEventRecord): Promise<void>;
  listAudit(limit?: number): Promise<AuditEventRecord[]>;

  // Aggregate metrics (real data only)
  overview(): Promise<IntelligenceOverview>;

  close?(): Promise<void>;
}

export class InMemoryIntelligenceRepository implements IntelligenceRepository {
  private readonly providers = new Map<string, ProviderRecord>();
  private readonly models = new Map<string, ModelRecord>();
  private readonly providerModels = new Map<string, ProviderModelRecord>();
  private readonly endpoints = new Map<string, EndpointRecord>();
  private readonly accessPlans = new Map<string, AccessPlanRecord>();
  private readonly connectors = new Map<string, ConnectorRecord>();
  private readonly evidence = new Map<string, EvidenceRecord>();
  private readonly verificationRuns: VerificationRunRecord[] = [];
  private readonly jobs = new Map<string, DiscoveryJobRecord>();
  private readonly findings = new Map<string, SecurityFindingRecord>();
  private readonly adapters = new Map<string, AdapterVersionRecord>();
  private readonly approvals = new Map<string, ApprovalRequestRecord>();
  private readonly audit: AuditEventRecord[] = [];

  async upsertProvider(p: ProviderRecord): Promise<void> {
    this.providers.set(p.id, { ...p });
  }

  async getProvider(id: string): Promise<ProviderRecord | undefined> {
    return this.providers.get(id);
  }

  async listProviders(filter?: ProviderFilter): Promise<ProviderRecord[]> {
    let list = Array.from(this.providers.values());
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      list = list.filter(
        (p) => p.id.toLowerCase().includes(q) || p.canonicalName.toLowerCase().includes(q) || (p.canonicalDomain ?? '').includes(q),
      );
    }
    if (filter?.trust) list = list.filter((p) => p.trustStatus === filter.trust);
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  async upsertModel(m: ModelRecord): Promise<void> {
    this.models.set(m.id, { ...m });
  }

  async getModel(id: string): Promise<ModelRecord | undefined> {
    return this.models.get(id);
  }

  async listModels(filter?: ModelFilter): Promise<ModelRecord[]> {
    let list = Array.from(this.models.values());
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      list = list.filter((m) => m.id.toLowerCase().includes(q) || m.canonicalName.toLowerCase().includes(q));
    }
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  async upsertProviderModel(
    p: ProviderModelRecord,
    opts?: { createOnly?: boolean },
  ): Promise<'created' | 'updated'> {
    const existing = this.providerModels.get(p.id);
    if (existing && opts?.createOnly) return 'updated';
    this.providerModels.set(p.id, { ...p });
    return existing ? 'updated' : 'created';
  }

  async getProviderModel(providerId: string, providerModelId: string): Promise<ProviderModelRecord | undefined> {
    const key = `${providerId}:${providerModelId}`;
    return this.providerModels.get(key);
  }

  async getProviderModelById(id: string): Promise<ProviderModelRecord | undefined> {
    return this.providerModels.get(id);
  }

  async listProviderModels(filter?: ProviderModelFilter): Promise<ProviderModelRecord[]> {
    let list = Array.from(this.providerModels.values());
    if (filter?.providerId) list = list.filter((p) => p.providerId === filter.providerId);
    if (filter?.modelId) list = list.filter((p) => p.modelId === filter.modelId);
    if (filter?.lifecycle) list = list.filter((p) => p.lifecycle === filter.lifecycle);
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  async upsertEndpoint(e: EndpointRecord): Promise<void> {
    this.endpoints.set(e.id, { ...e });
  }

  async getEndpoint(id: string): Promise<EndpointRecord | undefined> {
    return this.endpoints.get(id);
  }

  async listEndpoints(providerId?: string): Promise<EndpointRecord[]> {
    let list = Array.from(this.endpoints.values());
    if (providerId) list = list.filter((e) => e.providerId === providerId);
    return list;
  }

  async upsertAccessPlan(a: AccessPlanRecord): Promise<void> {
    this.accessPlans.set(a.id, { ...a });
  }

  async listAccessPlans(filter?: AccessPlanFilter): Promise<AccessPlanRecord[]> {
    let list = Array.from(this.accessPlans.values());
    if (filter?.freeOnly) list = list.filter((p) => p.planType === 'free' || p.planType === 'free-trial');
    if (filter?.providerId) list = list.filter((p) => p.providerId === filter.providerId);
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async upsertConnector(c: ConnectorRecord): Promise<void> {
    this.connectors.set(c.id, { ...c });
  }

  async listConnectors(): Promise<ConnectorRecord[]> {
    return Array.from(this.connectors.values());
  }

  async getConnector(id: string): Promise<ConnectorRecord | undefined> {
    return this.connectors.get(id);
  }

  async appendEvidence(e: EvidenceRecord): Promise<'created' | 'duplicate'> {
    const existing = this.evidence.get(e.dedupeKey);
    if (existing) return 'duplicate';
    this.evidence.set(e.dedupeKey, { ...e });
    return 'created';
  }

  async listEvidence(filter?: EvidenceFilter): Promise<EvidenceRecord[]> {
    let list = Array.from(this.evidence.values());
    if (filter?.subjectType) list = list.filter((e) => e.subjectType === filter.subjectType);
    if (filter?.subjectId) list = list.filter((e) => e.subjectId === filter.subjectId);
    if (filter?.claimType) list = list.filter((e) => e.claimType === filter.claimType);
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }

  async countDistinctSources(subjectType: EvidenceFilter['subjectType'], subjectId: string): Promise<number> {
    const set = new Set<string>();
    for (const e of this.evidence.values()) {
      if (e.subjectType === subjectType && e.subjectId === subjectId) set.add(e.sourceUrl);
    }
    return set.size;
  }

  async recordVerificationRun(r: VerificationRunRecord): Promise<void> {
    this.verificationRuns.push({ ...r });
  }

  async listVerificationRuns(filter?: VerificationRunFilter): Promise<VerificationRunRecord[]> {
    let list = Array.from(this.verificationRuns);
    if (filter?.subjectType) list = list.filter((r) => r.subjectType === filter.subjectType);
    if (filter?.subjectId) list = list.filter((r) => r.subjectId === filter.subjectId);
    if (filter?.dimension) list = list.filter((r) => r.dimension === filter.dimension);
    if (filter?.result) list = list.filter((r) => r.result === filter.result);
    if (filter?.limit) list = list.slice(-filter.limit);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async enqueueDiscoveryJob(j: DiscoveryJobRecord): Promise<void> {
    this.jobs.set(j.id, { ...j });
  }

  async updateDiscoveryJob(j: DiscoveryJobRecord): Promise<void> {
    this.jobs.set(j.id, { ...j });
  }

  async dueDiscoveryJobs(nowIso: string, limit = 10): Promise<DiscoveryJobRecord[]> {
    const due = Array.from(this.jobs.values()).filter(
      (j) => j.status !== 'dead' && j.attempts < j.maxAttempts && j.scheduledAt <= nowIso && j.status !== 'succeeded',
    );
    return due.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, limit);
  }

  async listDiscoveryJobs(filter?: DiscoveryJobFilter): Promise<DiscoveryJobRecord[]> {
    let list = Array.from(this.jobs.values());
    if (filter?.connectorId) list = list.filter((j) => j.connectorId === filter.connectorId);
    if (filter?.status) list = list.filter((j) => j.status === filter.status);
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, filter?.limit ?? 50);
  }

  async addSecurityFinding(f: SecurityFindingRecord): Promise<'created' | 'updated'> {
    const existing = Array.from(this.findings.values()).find((x) => x.dedupeKey === f.dedupeKey);
    if (existing) {
      existing.lastSeenAt = f.lastSeenAt;
      existing.confidence = Math.max(existing.confidence, f.confidence);
      return 'updated';
    }
    this.findings.set(f.id, { ...f });
    return 'created';
  }

  async listSecurityFindings(filter?: SecurityFindingFilter): Promise<SecurityFindingRecord[]> {
    let list = Array.from(this.findings.values());
    if (filter?.status) list = list.filter((f) => f.status === filter.status);
    if (filter?.severity) list = list.filter((f) => f.severity === filter.severity);
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
  }

  async getSecurityFinding(id: string): Promise<SecurityFindingRecord | undefined> {
    return this.findings.get(id);
  }

  async updateSecurityFindingStatus(id: string, status: SecurityFindingStatus, at: string): Promise<boolean> {
    const f = this.findings.get(id);
    if (!f) return false;
    (f as { status: SecurityFindingStatus }).status = status;
    f.lastSeenAt = at;
    return true;
  }

  async upsertAdapterVersion(a: AdapterVersionRecord): Promise<void> {
    this.adapters.set(a.id, { ...a });
  }

  async getAdapterVersion(id: string): Promise<AdapterVersionRecord | undefined> {
    return this.adapters.get(id);
  }

  async listAdapterVersions(filter?: AdapterVersionFilter): Promise<AdapterVersionRecord[]> {
    let list = Array.from(this.adapters.values());
    if (filter?.providerId) list = list.filter((a) => a.providerId === filter.providerId);
    if (filter?.status) list = list.filter((a) => a.status === filter.status);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, filter?.limit ?? 100);
  }

  async upsertApprovalRequest(a: ApprovalRequestRecord): Promise<void> {
    this.approvals.set(a.id, { ...a });
  }

  async getApprovalRequest(id: string): Promise<ApprovalRequestRecord | undefined> {
    return this.approvals.get(id);
  }

  async listApprovalRequests(filter?: ApprovalFilter): Promise<ApprovalRequestRecord[]> {
    let list = Array.from(this.approvals.values());
    if (filter?.state) list = list.filter((a) => a.state === filter.state);
    return list.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, filter?.limit ?? 100);
  }

  async appendAudit(e: AuditEventRecord): Promise<void> {
    this.audit.push({ ...e });
    if (this.audit.length > 10_000) this.audit.splice(0, this.audit.length - 10_000);
  }

  async listAudit(limit = 100): Promise<AuditEventRecord[]> {
    return this.audit.slice(-limit).reverse();
  }

  async overview(): Promise<IntelligenceOverview> {
    const pm = Array.from(this.providerModels.values());
    const endpoints = Array.from(this.endpoints.values());
    const now = Date.now();
    const freshnessMs = 3 * 3_600_000;
    const verifiedEndpoints = endpoints.filter(
      (e) => e.healthStatus === 'live' && e.lastVerifiedAt && now - Date.parse(e.lastVerifiedAt) < freshnessMs,
    ).length;
    const staleRecords = pm.filter((p) => p.lifecycle === 'stale').length;
    const degraded = Array.from(this.connectors.values()).filter((c) => c.status !== 'healthy').length;
    let lastDiscoveryAt: string | undefined;
    for (const c of this.connectors.values()) {
      if (c.lastRunAt && (!lastDiscoveryAt || c.lastRunAt > lastDiscoveryAt)) lastDiscoveryAt = c.lastRunAt;
    }
    const freeModels = Array.from(this.accessPlans.values()).filter((a) => a.planType === 'free' || a.planType === 'free-trial').length;
    return {
      discoveredModels: pm.length,
      verifiedEndpoints,
      pendingApprovals: Array.from(this.approvals.values()).filter((a) => a.state === 'pending').length,
      openSecurityFindings: Array.from(this.findings.values()).filter((f) => f.status === 'open').length,
      providersCount: this.providers.size,
      freeAccessModels: freeModels,
      staleRecords,
      degradedConnectors: degraded,
      lastDiscoveryAt,
      generatedAt: new Date(now).toISOString(),
    };
  }
}

/** Re-export for engine code that stores checkpoints with connector rows. */
export type { ConnectorCheckpoint };

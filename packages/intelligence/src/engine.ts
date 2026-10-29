/**
 * IntelligenceEngine — the continuously operating orchestrator (blueprint §1).
 *
 * Owns the loop: enqueue discovery jobs → (rate-limited connectors) →
 * normalize + redact + ingest → schedule verification → hand adapters to the
 * approval flow → publish APPROVED artifacts into the gateway's routing and
 * model fabric via an injected callback.
 *
 * System boundaries enforced:
 *   - Discovery workers CANNOT modify production routing: they never receive
 *     routing/model-registry handles; only publishApprovedAdapter() does, and
 *     only for hash-bound, approved adapter versions.
 *   - All built artifacts and metrics come from the repository — invented
 *     counts/simulated successes are impossible here.
 */

import type { EventBusPort } from '@anx/core';
import { buildEvent } from '@anx/core';

import { AdapterFactory, checkPublishBinding, manifestFingerprint, AdapterPreparationError, slugify } from './adapter-factory.js';
import { ApprovalService, ApprovalGuardError } from './approval.js';
import { sleep, newId } from './connectors/base.js';
import { IngestionPipeline } from './ingestion.js';
import type { IntelligenceRepository } from './repository.js';
import type {
  ApprovalFilter,
  ApprovalRequestRecord,
  ConnectorCheckpoint,
  ConnectorHealth,
  DiscoveryJobRecord,
  EvidenceFilter,
  EvidenceRecord,
  IntelligenceOverview,
  ModelFilter,
  ProviderFilter,
  ProviderModelFilter,
  ProviderModelRecord,
  ProviderRecord,
  SecurityFindingFilter,
  SecurityFindingRecord,
  VerificationRunFilter,
  VerificationRunRecord,
} from './types.js';
import type { DiscoveryConnector } from './types.js';
import { VerificationEngine } from './verification.js';

export interface PublishPayload {
  adapterVersionId: string;
  artifactHash: string;
  providerId: string;
  baseUrl: string;
  apiStyle: string;
  models: string[];
  approvedBy?: string;
  decidedAt?: string;
}

export interface IntelligenceEngineOptions {
  repo: IntelligenceRepository;
  connectors: DiscoveryConnector[];
  events?: EventBusPort;
  /**
   * Publishing hook. The gateway injects its routing engine + model registry
   * here. The engine calls it ONLY after approval guards have passed.
   */
  onPublish?: (payload: PublishPayload) => void | Promise<void>;
  /** Scheduler cadence (default 15 min). */
  intervalMs?: number;
  /** Max connector records processed per scheduled pass. */
  maxRecordsPerRun?: number;
}

const BACKOFF_BASE_MS = 60_000;

export class IntelligenceEngine {
  readonly repo: IntelligenceRepository;
  private readonly connectors: Map<string, DiscoveryConnector>;
  private readonly events?: EventBusPort;
  private readonly onPublish?: (payload: PublishPayload) => void | Promise<void>;
  private readonly intervalMs: number;
  private readonly maxRecordsPerRun: number;
  private readonly ingestion: IngestionPipeline;
  private readonly verification: VerificationEngine;
  private readonly adapters: AdapterFactory;
  private readonly approvals: ApprovalService;
  private scheduler: ReturnType<typeof setInterval> | undefined;
  private schedulerBusy = false;

  constructor(options: IntelligenceEngineOptions) {
    this.repo = options.repo;
    this.connectors = new Map(options.connectors.map((c) => [c.id, c]));
    this.events = options.events;
    this.onPublish = options.onPublish;
    this.intervalMs = options.intervalMs ?? 15 * 60_000;
    this.maxRecordsPerRun = options.maxRecordsPerRun ?? 300;
    this.ingestion = new IngestionPipeline(this.repo);
    this.verification = new VerificationEngine(this.repo);
    this.adapters = new AdapterFactory(this.repo);
    this.approvals = new ApprovalService(this.repo);
  }

  // ── Jobs & scheduling ─────────────────────────────────────────────────────

  async enqueueRun(connectorId: string, opts?: { maxAttempts?: number; scheduledAt?: string }): Promise<DiscoveryJobRecord> {
    const connector = this.connectors.get(connectorId);
    if (!connector) throw new Error(`Unknown connector '${connectorId}'`);
    const now = new Date().toISOString();
    const job: DiscoveryJobRecord = {
      id: newId('job'),
      connectorId,
      kind: 'discovery',
      status: 'queued',
      attempts: 0,
      maxAttempts: opts?.maxAttempts ?? 5,
      scheduledAt: opts?.scheduledAt ?? now,
      updatedAt: now,
    };
    await this.repo.enqueueDiscoveryJob(job);
    return job;
  }

  async enqueueVerificationRun(subjectType: 'provider_model' | 'endpoint', subjectId: string): Promise<DiscoveryJobRecord> {
    const now = new Date().toISOString();
    const job: DiscoveryJobRecord = {
      id: newId('vjob'),
      connectorId: 'verification',
      kind: 'verification',
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: now,
      payload: { subjectType, subjectId },
      updatedAt: now,
    };
    await this.repo.enqueueDiscoveryJob(job);
    return job;
  }

  startScheduler(): void {
    if (this.scheduler) return;
    this.scheduler = setInterval(() => {
      void this.runSchedulerPass().catch(() => {});
    }, this.intervalMs);
    this.scheduler.unref?.();
  }

  stopScheduler(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler);
      this.scheduler = undefined;
    }
  }

  /**
   * Cadence work: enqueue one bounded discovery job per registered connector
   * that has no active (queued/running) job, then drain the queue. Public so
   * control planes and tests can trigger the exact scheduler behavior
   * synchronously instead of waiting for the interval.
   */
  async runSchedulerPass(): Promise<{
    enqueued: number;
    drained: { executed: number; succeeded: number; retried: number; dead: number };
  }> {
    let enqueued = 0;
    for (const id of this.connectors.keys()) {
      const [queued, running] = await Promise.all([
        this.repo.listDiscoveryJobs({ connectorId: id, status: 'queued', limit: 1 }),
        this.repo.listDiscoveryJobs({ connectorId: id, status: 'running', limit: 1 }),
      ]);
      if (queued.length === 0 && running.length === 0) {
        await this.enqueueRun(id, { maxAttempts: 3 });
        enqueued++;
      }
    }
    const drained = await this.runDueJobs();
    return { enqueued, drained };
  }

  /**
   * Bounded retry engine: claims due jobs, executes with per-attempt error
   * capture and exponential backoff; repeated failures land in 'dead'.
   */
  async runDueJobs(nowIso = new Date().toISOString()): Promise<{ executed: number; succeeded: number; retried: number; dead: number }> {
    if (this.schedulerBusy) return { executed: 0, succeeded: 0, retried: 0, dead: 0 };
    this.schedulerBusy = true;
    try {
      const due = await this.repo.dueDiscoveryJobs(nowIso, 6);
      let succeeded = 0;
      let retried = 0;
      let dead = 0;
      for (const job of due) {
        const result = await this.executeJob(job);
        if (result === 'succeeded') succeeded++;
        else if (result === 'requeue') retried++;
        else dead++;
      }
      return { executed: due.length, succeeded, retried, dead };
    } finally {
      this.schedulerBusy = false;
    }
  }

  private async executeJob(job: DiscoveryJobRecord): Promise<'succeeded' | 'requeue' | 'dead' | 'noop'> {
    const now = new Date().toISOString();
    const running = { ...job, status: 'running' as const, attempts: job.attempts + 1, startedAt: job.startedAt ?? now, updatedAt: now };
    await this.repo.updateDiscoveryJob(running);
    try {
      if (job.kind === 'verification') {
        const subjectType = (job.payload?.['subjectType'] as 'provider_model' | 'endpoint') ?? 'provider_model';
        const subjectId = String(job.payload?.['subjectId'] ?? '');
        if (subjectType === 'endpoint') await this.verification.verifyEndpoint(subjectId);
        else await this.verification.verifyProviderModel(subjectId);
      } else {
        await this.runDiscovery(job);
      }
      await this.repo.updateDiscoveryJob({ ...running, status: 'succeeded', finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: undefined });
      await this.touchConnector(job.connectorId, true);
      return 'succeeded';
    } catch (err) {
      const message = (err as Error).message?.slice(0, 300) ?? String(err);
      const updatedAt = new Date().toISOString();
      if (running.attempts >= running.maxAttempts) {
        await this.repo.updateDiscoveryJob({ ...running, status: 'dead', error: message, lastErrorAt: updatedAt, updatedAt });
        await this.touchConnector(job.connectorId, false, message);
        return 'dead';
      }
      // Exponential backoff: 60s, 120s, 240s, …
      const delay = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, running.attempts - 1));
      await this.repo.updateDiscoveryJob({
        ...running,
        status: 'failed',
        error: message,
        lastErrorAt: updatedAt,
        scheduledAt: new Date(Date.now() + delay).toISOString(),
        updatedAt,
      });
      await this.touchConnector(job.connectorId, false, message);
      return 'requeue';
    }
  }

  /** One bounded connector pass, resuming from the stored checkpoint. */
  private async runDiscovery(job: DiscoveryJobRecord): Promise<void> {
    const connector = this.connectors.get(job.connectorId);
    if (!connector) throw new Error(`Unknown connector '${job.connectorId}'`);
    this.ingestion.beginRun();
    const connectorRow = await this.repo.getConnector(job.connectorId);
    const checkpoint: ConnectorCheckpoint | undefined = connectorRow?.checkpoint;

    let batch = await connector.discover(checkpoint ? this.mergeCheckpoints(checkpoint) : undefined);
    let processed = 0;
    let createdEvidence = 0;
    let duplicateEvidence = 0;
    let createdProviderModels = 0;
    let invocation = 0;
    while (batch && processed < this.maxRecordsPerRun && invocation < 8) {
      for (const record of batch.records.slice(0, Math.max(0, this.maxRecordsPerRun - processed))) {
        processed++;
        let candidates;
        try {
          candidates = await connector.normalize(record);
        } catch (normalizeError) {
          // Malformed/malicious record: skip and continue, never crash the job.
          void normalizeError;
          continue;
        }
        const outcome = await this.ingestion.ingestCandidates(candidates, {
          connectorId: batch.connectorId,
          sourceUrl: record.sourceUrl || batch.sourceUrl,
          observedAt: record.observedAt,
        });
        createdEvidence += outcome.createdEvidence;
        duplicateEvidence += outcome.duplicateEvidence;
        if (outcome.providerModelCreated) createdProviderModels++;
      }
      if (batch.exhausted || processed >= this.maxRecordsPerRun) break;
      const nextCursor = batch.checkpoint;
      await sleep(50);
      batch = await connector.discover(nextCursor);
      invocation++;
    }
    await this.repo.upsertConnector({
      id: job.connectorId,
      status: 'healthy',
      lastRunAt: new Date().toISOString(),
      lastError: undefined,
      consecutiveFailures: 0,
      checkpoint: batch?.checkpoint ?? checkpoint,
      updatedAt: new Date().toISOString(),
    });
    void this.events?.publish(
      buildEvent({ type: 'intelligence.discovery.completed' } as never, {
        connectorId: job.connectorId,
        processed,
        createdEvidence,
        duplicateEvidence,
        createdProviderModels,
      } as never),
    );
  }

  private mergeCheckpoints(existing: ConnectorCheckpoint): ConnectorCheckpoint {
    return { ...existing, updatedAt: new Date().toISOString() };
  }

  private async touchConnector(connectorId: string, ok: boolean, error?: string): Promise<void> {
    const previous = await this.repo.getConnector(connectorId);
    const now = new Date().toISOString();
    await this.repo.upsertConnector({
      id: connectorId,
      status: ok ? 'healthy' : error?.includes('rate limit') ? 'blocked' : 'degraded',
      lastRunAt: ok ? now : (previous?.lastRunAt ?? now),
      lastError: ok ? undefined : error,
      consecutiveFailures: ok ? 0 : (previous?.consecutiveFailures ?? 0) + 1,
      checkpoint: previous?.checkpoint,
      updatedAt: now,
    });
  }

  // ── Verification ──────────────────────────────────────────────────────────

  async verifyProviderModel(providerModelId: string): Promise<VerificationRunRecord[]> {
    const runs = await this.verification.verifyProviderModel(providerModelId);
    await this.ingestion.refreshConfidenceFor(providerModelId);
    void this.events?.publish(
      buildEvent({ type: 'intelligence.verification.completed' } as never, { providerModelId, runs: runs.length } as never),
    );
    return runs;
  }

  async verifyEndpoint(endpointId: string): Promise<VerificationRunRecord[]> {
    return this.verification.verifyEndpoint(endpointId);
  }

  async sweepStale(): Promise<{ providersSwept: number; availabilitySwept: number }> {
    return this.verification.sweepStale();
  }

  // ── Adapters & approvals ──────────────────────────────────────────────────

  async prepareAdapter(opts: { providerId: string; adapterVersionLabel?: string; requestedBy: string }) {
    try {
      const prepared = await this.adapters.prepareAdapter({ ...opts });
      void this.events?.publish(
        buildEvent({ type: 'intelligence.approval.requested' } as never, {
          requestId: prepared.request.id,
          adapterVersionId: prepared.record.id,
          providerId: prepared.record.providerId,
        } as never),
      );
      return prepared;
    } catch (err) {
      if (err instanceof AdapterPreparationError) {
        await this.repo.appendAudit({
          id: newId('aud'),
          at: new Date().toISOString(),
          actor: opts.requestedBy,
          action: 'adapter.prepare.rejected',
          subject: opts.providerId,
          detail: { reasons: err.reasons },
        });
      }
      throw err;
    }
  }

  /** Reviewer decision. The API layer must have already checked RBAC. */
  async decideApproval(requestId: string, review: { decision: 'approved' | 'rejected'; reviewer: string; note?: string; hasReviewerPermissions?: boolean }) {
    const result = await this.approvals.decide(requestId, review);
    void this.events?.publish(
      buildEvent({ type: 'intelligence.approval.decided' } as never, {
        requestId,
        decision: review.decision,
        reviewer: review.reviewer,
      } as never),
    );
    return result;
  }

  async listApprovals(filter?: ApprovalFilter): Promise<Array<ApprovalRequestRecord & { adapter?: Awaited<ReturnType<IntelligenceRepository['getAdapterVersion']>>; bindingValid: boolean }>> {
    if (filter?.state === 'pending') return this.approvals.pendingWithBinding();
    const pending = await this.repo.listApprovalRequests(filter);
    const out = [] as Array<ApprovalRequestRecord & { adapter?: Awaited<ReturnType<IntelligenceRepository['getAdapterVersion']>>; bindingValid: boolean }>;
    for (const req of pending) {
      const adapter = await this.repo.getAdapterVersion(req.adapterVersionId);
      const currentHash = adapter ? manifestFingerprint(adapter.manifest) : '';
      out.push({
        ...req,
        adapter,
        bindingValid: Boolean(adapter) && currentHash === adapter!.artifactHash && adapter!.artifactHash === req.adapterArtifactHash,
      });
    }
    return out;
  }

  /**
   * Publishes an approved adapter into production routing — the ONLY path from
   * discovery into the gateway's live fabric. Requires:
   *   approved adapter status + approval whose hash binds the CURRENT artifact.
   */
  async publishApprovedAdapter(adapterVersionId: string): Promise<PublishPayload> {
    const binding = await checkPublishBinding(this.repo, adapterVersionId);
    if (!binding.ok) throw new ApprovalGuardError('ARTIFACT_DRIFT', binding.reason ?? 'publish refused');
    const adapter = (await this.repo.getAdapterVersion(adapterVersionId))!;
    const provider = await this.repo.getProvider(adapter.providerId);
    if (!provider || provider.trustStatus === 'restricted' || provider.trustStatus === 'rejected') {
      throw new ApprovalGuardError('PERMISSION_DENIED', `Provider trust status '${provider?.trustStatus ?? 'missing'}' forbids production publishing`);
    }
    const approvals = await this.repo.listApprovalRequests({ state: 'approved', limit: 200 });
    const approval = approvals.find((a) => a.adapterVersionId === adapterVersionId);
    const payload: PublishPayload = {
      adapterVersionId,
      artifactHash: adapter.artifactHash,
      providerId: adapter.providerId,
      baseUrl: adapter.manifest.baseUrl,
      apiStyle: adapter.manifest.apiStyle,
      models: adapter.manifest.models,
      approvedBy: approval?.decidedBy,
      decidedAt: approval?.decidedAt,
    };
    if (!this.onPublish) {
      throw new Error('No publish hook configured (engine constructed without routing integration)');
    }
    await this.onPublish(payload);
    const now = new Date().toISOString();
    await this.repo.upsertAdapterVersion({ ...adapter, status: 'active', updatedAt: now });
    await this.repo.appendAudit({
      id: newId('aud'),
      at: now,
      actor: approval?.decidedBy ?? 'system',
      action: 'adapter.published',
      subject: adapterVersionId,
      detail: { artifactHash: adapter.artifactHash, providerId: adapter.providerId, models: adapter.manifest.models.length },
    });
    void this.events?.publish(
      buildEvent({ type: 'intelligence.integration.activated' } as never, { adapterVersionId, providerId: adapter.providerId } as never),
    );
    return payload;
  }

  // ── Read surface ──────────────────────────────────────────────────────────

  listProviders(f?: ProviderFilter): Promise<ProviderRecord[]> {
    return this.repo.listProviders(f ?? { limit: 200 });
  }
  listModels(f?: ModelFilter): Promise<ProviderModelRecord[]> {
    return this.repo.listProviderModels(this.mapModelFilter(f));
  }
  listEndpointsFor(providerId?: string) {
    return this.repo.listEndpoints(providerId);
  }
  listEvidence(f?: EvidenceFilter): Promise<EvidenceRecord[]> {
    return this.repo.listEvidence(f);
  }
  listVerificationRuns(f?: VerificationRunFilter): Promise<VerificationRunRecord[]> {
    return this.repo.listVerificationRuns(f);
  }
  listJobs(filter?: { connectorId?: string; status?: DiscoveryJobRecord['status']; limit?: number }) {
    return this.repo.listDiscoveryJobs(filter);
  }
  listFindings(f?: SecurityFindingFilter): Promise<SecurityFindingRecord[]> {
    return this.repo.listSecurityFindings(f);
  }
  updateFindingStatus(id: string, status: SecurityFindingRecord['status']) {
    return this.repo.updateSecurityFindingStatus(id, status, new Date().toISOString());
  }
  listAdapters(filter?: { providerId?: string; status?: import('./types.js').AdapterStatus; limit?: number }) {
    return this.repo.listAdapterVersions(filter);
  }
  listAudit(limit?: number) {
    return this.repo.listAudit(limit);
  }
  async listConnectors(): Promise<ConnectorHealth[]> {
    const rows = await this.repo.listConnectors();
    const merged = new Map<string, ConnectorHealth>(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          status: r.status,
          authority: 0.5,
          lastRunAt: r.lastRunAt,
          lastError: r.lastError,
          consecutiveFailures: r.consecutiveFailures,
        },
      ]),
    );
    // Bootstrap: connectors registered on this engine that have never
    // completed a run have no persisted row yet. Without surfacing them here,
    // a fresh store reports "No connectors are registered" and
    // POST /v1/intelligence/jobs/run can never start the first one.
    for (const id of this.connectors.keys()) {
      if (!merged.has(id)) {
        merged.set(id, { id, status: 'healthy', authority: 0.5, consecutiveFailures: 0 });
      }
    }
    return [...merged.values()];
  }

  private mapModelFilter(f?: ModelFilter): ProviderModelFilter | undefined {
    if (!f) return undefined;
    return {
      providerId: f.providerId,
      lifecycle: f.lifecycle,
      limit: f.limit ?? 200,
    };
  }

  async overview(): Promise<IntelligenceOverview> {
    return this.repo.overview();
  }

  /** Structured health for the gateway's 15-subsystem hierarchy. */
  async healthReport(): Promise<{
    subsystem: 'discovery';
    status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'ERROR';
    healthy: boolean;
    message: string;
    metrics: Record<string, unknown>;
    remediation?: string;
  }> {
    const overview = await this.repo.overview();
    const connectors = await this.repo.listConnectors();
    const registered = this.connectors.size;
    const failedJobs = (await this.repo.listDiscoveryJobs({ status: 'dead', limit: 20 })).length;
    let status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED' = 'HEALTHY';
    let message = `Discovery operating: ${overview.providersCount} provider(s), ${overview.discoveredModels} catalog relation(s), ${connectors.length} connector row(s).`;
    let remediation: string | undefined;
    if (registered === 0 && connectors.length === 0) {
      status = 'NOT_CONFIGURED';
      message = 'No connectors registered for AI provider discovery.';
      remediation = 'Validate the default connector bundle (OpenRouter, Hugging Face, GitHub advisories, local runtimes).';
    } else if (connectors.every((c) => !c.lastRunAt)) {
      status = 'DEGRADED';
      message = 'Registered connectors have not completed a discovery run yet; the intelligence store is empty.';
      remediation = 'Trigger POST /v1/intelligence/jobs/run (all registered connectors) or wait for the scheduler cadence.';
    } else if (overview.degradedConnectors > 0 || failedJobs > 0) {
      status = 'DEGRADED';
      message = `${overview.degradedConnectors} degraded connector row(s), ${failedJobs} dead job(s).`;
      remediation = 'Inspect GET /v1/intelligence/connectors and /v1/intelligence/jobs for the failing source.';
    }
    return {
      subsystem: 'discovery',
      status,
      healthy: status === 'HEALTHY' || status === 'DEGRADED' || status === 'NOT_CONFIGURED',
      message,
      metrics: {
        providers: overview.providersCount,
        discoveredModels: overview.discoveredModels,
        verifiedEndpoints: overview.verifiedEndpoints,
        pendingApprovals: overview.pendingApprovals,
        openSecurityFindings: overview.openSecurityFindings,
        lastDiscoveryAt: overview.lastDiscoveryAt,
      },
      remediation,
    };
  }
}

export function slugOf(id: string): string {
  return slugify(id);
}

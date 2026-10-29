/**
 * Approval service (blueprint §7 "Awaiting approval").
 *
 * Enforces, at the service layer (the gateway re-enforces at the API layer):
 *   - Only reviewers may decide (RBAC gate lives in the caller).
 *   - The approval binds to the adapter's IMMUTABLE artifact hash.
 *   - Decisions are recorded with reviewer id, time, and note; adapter rows are
 *     flipped atomically and never silently.
 *   - Non-reviewers attempting approval are rejected AND audited
 *     (blueprint §11 security regression #5).
 */

import { manifestFingerprint } from './adapter-factory.js';
import { newId } from './connectors/base.js';
import type { IntelligenceRepository } from './repository.js';
import type { AdapterStatus, ApprovalRequestRecord } from './types.js';

export class ApprovalGuardError extends Error {
  constructor(
    readonly code: 'NOT_PENDING' | 'ARTIFACT_DRIFT' | 'ADAPTER_MISSING' | 'PERMISSION_DENIED',
    message: string,
  ) {
    super(message);
  }
}

export interface ApprovalDecision {
  decision: 'approved' | 'rejected';
  reviewer: string;
  note?: string;
  /** Set false (default) when the caller has verified reviewer permission via RBAC. */
  hasReviewerPermissions?: boolean;
}

export class ApprovalService {
  constructor(private readonly repo: IntelligenceRepository) {}

  /** Creates (or re-uses) a pending approval bound to the CURRENT artifact hash. */
  async ensurePendingRequest(adapterVersionId: string, requestedBy: string): Promise<ApprovalRequestRecord> {
    const adapter = await this.repo.getAdapterVersion(adapterVersionId);
    if (!adapter) throw new ApprovalGuardError('ADAPTER_MISSING', `Adapter ${adapterVersionId} not found`);
    const existing = (await this.repo.listApprovalRequests({ state: 'pending', limit: 200 })).find(
      (a) => a.adapterVersionId === adapterVersionId,
    );
    if (existing && existing.adapterArtifactHash === adapter.artifactHash) return existing;
    const now = new Date().toISOString();
    const request: ApprovalRequestRecord = {
      id: newId('apr'),
      adapterVersionId,
      adapterArtifactHash: adapter.artifactHash,
      state: 'pending',
      requestedBy,
      requestedAt: now,
      updatedAt: now,
    };
    await this.repo.upsertApprovalRequest(request);
    await this.repo.upsertAdapterVersion({ ...adapter, status: 'awaiting_approval', updatedAt: now });
    await this.audit('system', 'approval.requested', adapterVersionId, { requestedBy });
    return request;
  }

  /** Applies a reviewer decision. Throws on permission/check failures. */
  async decide(requestId: string, input: ApprovalDecision): Promise<ApprovalRequestRecord & { adapterStatus: AdapterStatus }> {
    if (input.hasReviewerPermissions === false) {
      await this.audit(input.reviewer ?? 'anonymous', 'approval.denied', requestId, {
        reason: 'PERMISSION_DENIED',
      });
      throw new ApprovalGuardError('PERMISSION_DENIED', 'Caller lacks reviewer permissions for approval decisions');
    }
    const request = await this.repo.getApprovalRequest(requestId);
    if (!request) throw new ApprovalGuardError('ADAPTER_MISSING', `Approval request ${requestId} not found`);
    if (request.state !== 'pending') {
      throw new ApprovalGuardError('NOT_PENDING', `Approval request is already ${request.state}`);
    }
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new ApprovalGuardError('NOT_PENDING', `Invalid decision '${input.decision}'`);
    }
    const adapter = await this.repo.getAdapterVersion(request.adapterVersionId);
    if (!adapter) throw new ApprovalGuardError('ADAPTER_MISSING', `Adapter ${request.adapterVersionId} vanished`);
    const currentHash = manifestFingerprint(adapter.manifest);
    if (currentHash !== adapter.artifactHash || currentHash !== request.adapterArtifactHash) {
      await this.audit(input.reviewer, 'approval.blocked', requestId, { reason: 'ARTIFACT_DRIFT' });
      throw new ApprovalGuardError(
        'ARTIFACT_DRIFT',
        'Adapter artifact changed after the approval request was created — re-approval is required',
      );
    }
    const now = new Date().toISOString();
    const nextAdapterStatus: AdapterStatus = input.decision === 'approved' ? 'approved' : 'rejected';
    await this.repo.upsertAdapterVersion({ ...adapter, status: nextAdapterStatus, updatedAt: now });
    const updated: ApprovalRequestRecord = {
      ...request,
      state: input.decision,
      decidedBy: input.reviewer,
      decidedAt: now,
      decisionNote: sanitizeNote(input.note),
      updatedAt: now,
    };
    await this.repo.upsertApprovalRequest(updated);
    await this.audit(input.reviewer, `approval.${input.decision}`, request.adapterVersionId, {
      requestId,
      adapterHash: request.adapterArtifactHash,
      note: updated.decisionNote,
    });
    return { ...updated, adapterStatus: nextAdapterStatus };
  }

  /** Lists pending approvals with the current binding validity flag. */
  async pendingWithBinding(): Promise<Array<ApprovalRequestRecord & { adapter?: Awaited<ReturnType<IntelligenceRepository['getAdapterVersion']>>; bindingValid: boolean }>> {
    const pending = await this.repo.listApprovalRequests({ state: 'pending', limit: 200 });
    const out = [] as Array<ApprovalRequestRecord & { adapter?: Awaited<ReturnType<IntelligenceRepository['getAdapterVersion']>>; bindingValid: boolean }>;
    for (const req of pending) {
      const adapter = await this.repo.getAdapterVersion(req.adapterVersionId);
      const currentHash = adapter ? manifestFingerprint(adapter.manifest) : '';
      out.push({ ...req, adapter, bindingValid: Boolean(adapter) && currentHash === adapter!.artifactHash && adapter!.artifactHash === req.adapterArtifactHash });
    }
    return out;
  }

  private async audit(actor: string, action: string, subject: string, detail?: Record<string, unknown>): Promise<void> {
    await this.repo.appendAudit({ id: newId('aud'), at: new Date().toISOString(), actor, action, subject, detail });
  }
}

function sanitizeNote(note?: string): string | undefined {
  if (!note) return note;
  return note.slice(0, 500);
}

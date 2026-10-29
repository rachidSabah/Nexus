/**
 * Ingestion pipeline (blueprint §1 "Normalization & Evidence Engine").
 *
 * Responsibilities:
 *   - REDACT untrusted payloads BEFORE anything is stored, logged or analyzed.
 *   - Resolve provider identity (canonical slug, domain, docs URL).
 *   - Deduplicate canonical model records (exact canonical-name match) and
 *     provider-specific model relations (unique (provider, provider_model_id)).
 *   - Record claim-level evidence with source provenance, timestamps, content
 *     hashes and confidence inputs; idempotent by content dedupe key.
 *   - Never mutate production routing — this pipeline only writes the
 *     intelligence store.
 */

import { createHash } from 'node:crypto';

import { computeConfidence, authorityForConnector } from './confidence.js';
import { evidenceDedupeKey, newId, sha256 } from './connectors/base.js';
import { scrubUntrustedPayload, looksLikeSecret } from './redaction.js';
import type { IntelligenceRepository } from './repository.js';
import type {
  AccessPlanCandidate,
  ClaimedCapabilities,
  EvidenceClaimType,
  EvidenceRecord,
  LifecycleState,
  ModelCandidate,
  NormalizedCandidate,
  ProviderCandidate,
  SecurityFindingCandidate,
  SubjectType,
} from './types.js';

export interface IngestionMeta {
  connectorId: string;
  sourceUrl: string;
  observedAt: string;
}

export interface IngestionOutcome {
  providerTouched: boolean;
  providerModelCreated: boolean;
  modelId?: string;
  providerModelId?: string;
  duplicateEvidence: number;
  createdEvidence: number;
  blocked?: 'security';
}

const MAX_MODELS_PER_RUN = 400;

export class IngestionPipeline {
  /** Safety bound: a single discovery run cannot create more than this many models. */
  private modelsCreatedThisRun = 0;
  runId = newId('run');

  beginRun(): void {
    this.runId = newId('run');
    this.modelsCreatedThisRun = 0;
  }

  constructor(private readonly repo: IntelligenceRepository) {}

  async ingestCandidates(candidates: NormalizedCandidate[], meta: IngestionMeta): Promise<IngestionOutcome> {
    const outcome: IngestionOutcome = {
      providerTouched: false,
      providerModelCreated: false,
      duplicateEvidence: 0,
      createdEvidence: 0,
    };
    for (const candidate of candidates) {
      // 1. Redact untrusted payload at the boundary — before storage, logging,
      //    indexing or any AI analysis. Untrusted content is data, never instructions.
      const scrubbed = JSON.parse(JSON.stringify(scrubUntrustedPayload(candidate))) as NormalizedCandidate;
      switch (scrubbed.kind) {
        case 'provider':
          await this.upsertProvider(scrubbed.candidate as ProviderCandidate, meta, outcome);
          break;
        case 'model':
          await this.upsertModel(scrubbed.candidate as ModelCandidate, meta, outcome);
          break;
        case 'access_plan':
          await this.recordAccessPlan(scrubbed.candidate as AccessPlanCandidate, meta, outcome);
          break;
        case 'security':
          await this.recordSecurityFinding(scrubbed.candidate as SecurityFindingCandidate, meta, outcome);
          break;
      }
    }
    return outcome;
  }

  private async upsertProvider(p: ProviderCandidate, meta: IngestionMeta, outcome: IngestionOutcome): Promise<void> {
    const id = slug(p.providerId);
    await this.repo.upsertProvider({
      id,
      canonicalName: p.displayName || p.providerId,
      canonicalDomain: p.canonicalDomain ?? undefined,
      officialDocsUrl: p.officialDocsUrl ?? undefined,
      trustStatus: 'unverified',
      providerKind: p.providerKind,
      firstSeenAt: meta.observedAt,
      lastSeenAt: meta.observedAt,
      updatedAt: new Date().toISOString(),
    });
    outcome.providerTouched = true;
    if (p.officialDocsUrl || p.canonicalDomain) {
      await this.recordEvidence(
        {
          subjectType: 'provider',
          subjectId: id,
          claimType: 'identity',
          sourceUrl: meta.sourceUrl,
          connectorId: meta.connectorId,
          sourceAuthority: authorityForConnector(meta.connectorId),
          observedAt: meta.observedAt,
          summary: `Provider identity observed on catalog source: ${p.displayName ?? id}${
            p.canonicalDomain ? ` (domain ${p.canonicalDomain})` : ''
          }`,
        },
        outcome,
      );
    }
  }

  private async upsertModel(m: ModelCandidate, meta: IngestionMeta, outcome: IngestionOutcome): Promise<void> {
    if (this.modelsCreatedThisRun >= MAX_MODELS_PER_RUN) return;
    const providerId = slug(m.providerId);
    const canonicalName = canonicalizeModelName(m.displayName || m.providerModelId);
    const modelId = sha256(`${providerId}|${canonicalName}`).slice(0, 24);

    await this.repo.upsertModel({
      id: modelId,
      canonicalName,
      family: m.family,
      inputModalities: m.inputModalities ?? [],
      outputModalities: m.outputModalities ?? [],
      contextWindow: m.contextWindow,
      metadata: (m.metadata ?? {}) as Record<string, unknown>,
      firstSeenAt: meta.observedAt,
      lastSeenAt: meta.observedAt,
    });

    const pmKey = `${providerId}:${slug(m.providerModelId)}`;
    const existing = await this.repo.getProviderModel(providerId, slug(m.providerModelId));
    const lifecycle: LifecycleState = existing ? existing.lifecycle : 'discovered';
    outcome.providerModelCreated = !existing;

    // Availability unknown until verification; pricing never assumed free.
    const pricingStatus = m.pricing?.explicitlyFree
      ? ('unverified' as const) // free claim found but needs evidence-backed verification stamp
      : m.pricing
        ? ('unverified' as const)
        : ('unknown' as const);
    await this.repo.upsertProviderModel({
      id: pmKey,
      providerId,
      modelId,
      providerModelId: m.providerModelId,
      displayName: m.displayName ?? m.providerModelId,
      lifecycle: existing ? lifecycle : 'discovered',
      availabilityStatus: existing ? existing.availabilityStatus : 'unknown',
      pricingStatus: existing ? existing.pricingStatus : pricingStatus,
      contextWindow: m.contextWindow ?? existing?.contextWindow,
      capabilities: m.capabilities ?? existing?.capabilities ?? {},
      confidence: existing?.confidence ?? 0,
      firstSeenAt: existing?.firstSeenAt ?? meta.observedAt,
      lastSeenAt: meta.observedAt,
      lastVerifiedAt: existing?.lastVerifiedAt,
    });
    this.modelsCreatedThisRun++;

    await this.recordEvidence(
      {
        subjectType: 'provider_model',
        subjectId: pmKey,
        claimType: 'model_catalog',
        sourceUrl: meta.sourceUrl,
        connectorId: meta.connectorId,
        sourceAuthority: authorityForConnector(meta.connectorId),
        observedAt: meta.observedAt,
        summary: `Model "${m.providerModelId}" listed by source catalog (provider ${providerId}).`,
      },
      outcome,
    );

    if (m.pricing) {
      await this.recordEvidence(
        {
          subjectType: 'provider_model',
          subjectId: pmKey,
          claimType: 'pricing',
          sourceUrl: meta.sourceUrl,
          connectorId: meta.connectorId,
          sourceAuthority: authorityForConnector(meta.connectorId),
          observedAt: meta.observedAt,
          summary: `Published pricing: in=${fmt(m.pricing.inputPer1M)} out=${fmt(m.pricing.outputPer1M)} ${
            m.pricing.currency ?? ''
          } per 1M tokens (source-of-truth catalog).`,
        },
        outcome,
      );
    }
    const caps = (m.capabilities ?? {}) as ClaimedCapabilities;
    const capKeys = Object.entries(caps).filter(([, v]) => v === true).map(([k]) => k);
    if (capKeys.length > 0) {
      await this.recordEvidence(
        {
          subjectType: 'provider_model',
          subjectId: pmKey,
          claimType: 'capability',
          sourceUrl: meta.sourceUrl,
          connectorId: meta.connectorId,
          sourceAuthority: authorityForConnector(meta.connectorId),
          observedAt: meta.observedAt,
          summary: `Documented capability claims: ${capKeys.join(', ')} (documented parameters, not live-tested).`,
        },
        outcome,
      );
    }
  }

  private async recordAccessPlan(a: AccessPlanCandidate, meta: IngestionMeta, outcome: IngestionOutcome): Promise<void> {
    const providerId = slug(a.providerId);
    const pmKey = a.providerModelId ? `${providerId}:${slug(a.providerModelId)}` : undefined;
    // An access plan is an evidence-recorded CLAIM; pricing stays 'unverified'
    // until a verification run stamps it with the source URL.
    const planId = sha256(`${providerId}|${pmKey ?? ''}|${planTypeOf(a)}|${a.sourceUrl}`).slice(0, 32);
    await this.repo.upsertAccessPlan({
      id: planId,
      providerId,
      providerModelId: pmKey,
      planType: a.planType,
      inputPer1M: a.pricing?.inputPer1M,
      outputPer1M: a.pricing?.outputPer1M,
      currency: a.pricing?.currency,
      quotaWindow: a.quota?.window,
      quotaLimit: a.quota?.limit,
      eligibility: a.eligibility,
      billingConditions: a.billingConditions,
      sourceUrl: a.sourceUrl || meta.sourceUrl,
      verifiedAt: undefined,
      createdAt: meta.observedAt,
      updatedAt: new Date().toISOString(),
    });
    if (pmKey) {
      await this.recordEvidence(
        {
          subjectType: 'access_plan',
          subjectId: `${planId}`,
          claimType: a.planType === 'free' || a.planType === 'free-trial' ? 'free_access' : 'pricing',
          sourceUrl: a.sourceUrl || meta.sourceUrl,
          connectorId: meta.connectorId,
          sourceAuthority: authorityForConnector(meta.connectorId),
          observedAt: meta.observedAt,
          summary: `Access plan claim (${a.planType}): ${
            a.billingConditions ?? 'conditions documented at source'
          } — eligibility/quota verification pending.`,
        },
        outcome,
      );
    }
  }

  private async recordSecurityFinding(f: SecurityFindingCandidate, meta: IngestionMeta, outcome: IngestionOutcome): Promise<void> {
    // The excerpt redacts AGAIN at this boundary even if a connector claims it
    // already sanitized — connectors are untrusted code paths too.
    if (looksLikeSecret(f.excerpt)) {
      const scrubbed = scrubUntrustedPayload(f) as SecurityFindingCandidate;
      f = scrubbed;
    }
    const dedupeKey = evidenceDedupeKey({
      connectorId: meta.connectorId,
      subjectType: 'security',
      subjectId: f.sourceRef,
      claimType: f.category,
      sourceUrl: f.sourceRef,
      observedAtDay: meta.observedAt.slice(0, 10),
    });
    const now = new Date().toISOString();
    const created = await this.repo.addSecurityFinding({
      id: newId('sec'),
      dedupeKey,
      title: f.title,
      category: f.category,
      severity: f.severity,
      confidence: Math.max(0, Math.min(1, f.confidence)),
      providerId: f.providerId,
      sourceRef: f.sourceRef,
      excerpt: f.excerpt,
      redacted: true,
      status: 'open',
      firstSeenAt: meta.observedAt,
      lastSeenAt: now,
    });
    if (created === 'created') outcome.createdEvidence++;
  }

  private async recordEvidence(
    e: Omit<EvidenceRecord, 'id' | 'dedupeKey' | 'contentHash' | 'confidence' | 'redacted'>,
    outcome: IngestionOutcome,
  ): Promise<void> {
    const observedAtDay = e.observedAt.slice(0, 10);
    const dedupeKey = evidenceDedupeKey({
      connectorId: e.connectorId ?? 'manual',
      subjectType: e.subjectType,
      subjectId: e.subjectId,
      claimType: e.claimType,
      sourceUrl: e.sourceUrl,
      observedAtDay,
    });
    const contentHash = createHash('sha256').update(`${e.summary}`).digest('hex');
    const confidence = Math.round(authorityForConnector(e.connectorId ?? 'fallback') * 100);
    // Idempotent by dedupe key: re-processing the same event creates NO duplicates.
    const res = await this.repo.appendEvidence({
      ...e,
      id: newId('ev'),
      dedupeKey,
      contentHash,
      confidence,
      redacted: true,
    });
    if (res === 'created') outcome.createdEvidence++;
    else outcome.duplicateEvidence++;
  }

  async recordPlainEvidence(input: {
    subjectType: SubjectType;
    subjectId: string;
    claimType: EvidenceClaimType;
    sourceUrl: string;
    connectorId?: string;
    observedAt: string;
    summary: string;
  }): Promise<'created' | 'duplicate'> {
    const observedAtDay = input.observedAt.slice(0, 10);
    const dedupeKey = evidenceDedupeKey({
      connectorId: input.connectorId ?? 'manual',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      claimType: input.claimType,
      sourceUrl: input.sourceUrl,
      observedAtDay,
    });
    const res = await this.repo.appendEvidence({
      ...input,
      connectorId: input.connectorId,
      id: newId('ev'),
      dedupeKey,
      contentHash: createHash('sha256').update(input.summary).digest('hex'),
      sourceAuthority: authorityForConnector(input.connectorId ?? 'fallback'),
      confidence: Math.round(authorityForConnector(input.connectorId ?? 'fallback') * 100),
      redacted: true,
    });
    return res;
  }

  async refreshConfidence(providerId: string, providerModelIdSlug: string): Promise<number> {
    const pmKey = `${providerId}:${providerModelIdSlug}`;
    const pm = await this.repo.getProviderModelById(pmKey);
    if (!pm) return 0;
    const evidence = await this.repo.listEvidence({ subjectType: 'provider_model', subjectId: pmKey, limit: 100 });
    const runs = await this.repo.listVerificationRuns({ subjectType: 'provider_model', subjectId: pmKey, limit: 200 });
    const distinct = await this.repo.countDistinctSources('provider_model', pmKey);
    const lastEvidenceAt = evidence[0]?.observedAt;
    const result = computeConfidence({
      sourceAuthority: evidence[0]?.sourceAuthority ?? authorityForConnector('fallback'),
      verificationRuns: runs.map((r) => ({ dimension: r.dimension, result: r.result })),
      lastEvidenceAt,
      distinctSources: distinct,
    });
    await this.repo.upsertProviderModel({ ...pm, confidence: result.score, id: pmKey }, { createOnly: false });
    return result.score;
  }

  /** Recomputes confidence given a full provider-model key ("provider:model-slug"). */
  async refreshConfidenceFor(providerModelKey: string): Promise<number> {
    const sep = providerModelKey.indexOf(':');
    if (sep < 0) return 0;
    return this.refreshConfidence(providerModelKey.slice(0, sep), providerModelKey.slice(sep + 1));
  }
}

/** Provider cache of raw candidates for later lookup by verification (in-process). */

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

/** Canonical name normalization for dedupe: lowercase, strip date-stamps and sizes. */
export function canonicalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/:free$/i, '')
    .replace(/-\d{6,8}$/i, '')
    .replace(/\s+/g, '-')
    .trim();
}

function planTypeOf(a: AccessPlanCandidate): string {
  return a.planType;
}

function fmt(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return 'n/a';
}

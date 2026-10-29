/**
 * Approval gate + publish-binding tests (§11):
 *   #5 only permitted reviewers may decide — denials are audited;
 *   #6 any post-approval artifact change invalidates the binding; publishing
 *      is possible ONLY through the hash-bound approved path.
 * Adapter sandbox checks are deterministic manifest lint — no network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovalService } from '../src/approval.js';
import { AdapterFactory, AdapterPreparationError, checkPublishBinding, manifestFingerprint, runSandboxChecks } from '../src/adapter-factory.js';
import { IntelligenceEngine, type PublishPayload } from '../src/engine.js';
import { InMemoryIntelligenceRepository } from '../src/repository.js';
import type { AdapterManifest, ProviderRecord, ProviderModelRecord, EndpointRecord } from '../src/types.js';

let repo: InMemoryIntelligenceRepository;
let factory: AdapterFactory;
let approvals: ApprovalService;
let engine: IntelligenceEngine;

const now = () => new Date().toISOString();

beforeEach(async () => {
  repo = new InMemoryIntelligenceRepository();
  factory = new AdapterFactory(repo);
  approvals = new ApprovalService(repo);
  engine = new IntelligenceEngine({ repo, connectors: [] });

  const provider: ProviderRecord = {
    id: 'test-provider',
    canonicalName: 'Test Provider',
    canonicalDomain: 'test-provider.example',
    officialDocsUrl: 'https://docs.test-provider.example',
    trustStatus: 'unverified',
    providerKind: 'aggregator',
    firstSeenAt: now(),
    lastSeenAt: now(),
    updatedAt: now(),
  };
  await repo.upsertProvider(provider);

  const endpoint: EndpointRecord = {
    id: 'ep_test',
    providerId: 'test-provider',
    baseUrl: 'https://api.test-provider.example/v1',
    apiStyle: 'openai-compatible',
    healthStatus: 'live',
    lastVerifiedAt: now(),
    sourceUrl: 'https://docs.test-provider.example',
  };
  await repo.upsertEndpoint(endpoint);

  const pm: ProviderModelRecord = {
    id: 'test-provider:test-model',
    providerId: 'test-provider',
    modelId: 'm_test',
    providerModelId: 'test-model',
    displayName: 'Test Model',
    lifecycle: 'partially_verified',
    availabilityStatus: 'unknown',
    pricingStatus: 'unknown',
    contextWindow: 32_000,
    capabilities: { toolCalling: true },
    confidence: 1,
    firstSeenAt: now(),
    lastSeenAt: now(),
  };
  await repo.upsertProviderModel(pm);
});

describe('adapter preparation (constrained generation, no routing access)', () => {
  it('prepares a bound artifact + pending approval with no credential embedded and production disabled', async () => {
    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    expect(prepared.record.status).toBe('awaiting_approval');
    expect(prepared.request.state).toBe('pending');
    expect(prepared.request.adapterArtifactHash).toBe(prepared.record.artifactHash);
    const manifest = prepared.record.manifest;
    expect(manifest.credentialRef).toBeNull();
    expect(manifest.productionEnabled).toBe(false);
    expect(manifest.approvalState).toBe('pending');
    expect(manifest.models).toEqual(['test-model']);
    expect(prepared.record.tests.passed).toBe(true);
  });

  it('refuses preparation when no verified endpoint / models exist', async () => {
    const empty = new InMemoryIntelligenceRepository();
    const emptyFactory = new AdapterFactory(empty);
    await expect(emptyFactory.prepareAdapter({ providerId: 'ghost', requestedBy: 'op' })).rejects.toMatchObject({
      reasons: expect.arrayContaining([expect.stringContaining('not present in the intelligence catalog')]),
    });
    await expect(emptyFactory.prepareAdapter({ providerId: 'ghost', requestedBy: 'op' })).rejects.toBeInstanceOf(AdapterPreparationError);
  });

  it('sandbox lint flags embedded secrets and out-of-vocabulary operations', () => {
    const manifest = {
      providerId: 'test-provider',
      adapterVersion: '1.0.0',
      apiStyle: 'openai-compatible',
      baseUrlSource: 'official-documentation',
      supportedOperations: ['list-models', 'arbitrary-exec'],
      baseUrl: 'https://api.test-provider.example/v1',
      models: ['test-model'],
      credentialRef: 'operator-registration-ref', // string refs are allowed, not values
      verificationState: 'evidence_checked',
      approvalState: 'pending',
      productionEnabled: false,
      pricingStatus: 'unknown',
      evidenceHashes: [],
      generator: 'nexus-intelligence/1.0 constrained-template',
      generatedAt: now(),
    } as AdapterManifest;
    const checks = runSandboxChecks(manifest);
    const operationCheck = checks.checks.find((c) => c.id === 'operations');
    expect(operationCheck?.passed).toBe(false);

    const secretManifest: AdapterManifest = { ...manifest, supportedOperations: ['list-models'], credentialRef: 'sk-AbCdEf1234567890AbCdEf1234567890' };
    const secretChecks = runSandboxChecks(secretManifest);
    expect(secretChecks.checks.find((c) => c.id === 'no-embedded-secrets')?.passed).toBe(false);
    expect(secretChecks.passed).toBe(false);

    const loopbackManifest: AdapterManifest = { ...manifest, baseUrl: 'http://127.0.0.1:11434', baseUrlSource: 'connector-catalog' };
    expect(runSandboxChecks(loopbackManifest).checks.find((c) => c.id === 'no-internal-target')?.passed).toBe(false);
  });
});

describe('approval decisions (§11 #5 — reviewer gate enforced and audited)', () => {
  it('a caller without reviewer permissions is rejected AND audited', async () => {
    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    await expect(
      approvals.decide(prepared.request.id, { decision: 'approved', reviewer: 'intern', hasReviewerPermissions: false }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const audit = await repo.listAudit(50);
    expect(audit.some((a) => a.action === 'approval.denied')).toBe(true);
  });

  it('deciding a missing request is ADAPTER_MISSING; a second decision is NOT_PENDING', async () => {
    await expect(approvals.decide('apr_nope', { decision: 'approved', reviewer: 'reviewer' })).rejects.toMatchObject({
      code: 'ADAPTER_MISSING',
    });

    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    await approvals.decide(prepared.request.id, { decision: 'approved', reviewer: 'reviewer' });
    await expect(approvals.decide(prepared.request.id, { decision: 'rejected', reviewer: 'reviewer' })).rejects.toMatchObject({
      code: 'NOT_PENDING',
    });
  });

  it('approval flips ONLY the adapter status (never productionEnabled in the manifest)', async () => {
    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    const decided = await approvals.decide(prepared.request.id, { decision: 'approved', reviewer: 'senior-reviewer', note: 'verified docs' });
    expect(decided.adapterStatus).toBe('approved');
    const stored = await repo.getAdapterVersion(prepared.record.id);
    expect(stored?.status).toBe('approved');
    expect(stored?.manifest.productionEnabled).toBe(false);
  });
});

describe('hash-bound publish path (§11 #6 — drift detection)', () => {
  it('publishing without an approval (status draft) is refused', async () => {
    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    const decision = await checkPublishBinding(repo, prepared.record.id);
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('requires an explicit approval');
  });

  it('a post-approval manifest edit breaks the binding and blocks BOTH re-decision and publish', async () => {
    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    const stored = (await repo.getAdapterVersion(prepared.record.id))!;
    // Tamper: swap the endpoint after the artifact hash was stamped.
    const tampered: AdapterManifest = { ...stored.manifest, baseUrl: 'https://evil.example/v1' };
    await repo.upsertAdapterVersion({ ...stored, manifest: tampered });

    // Fingerprint no longer matches the stored immutable artifactHash.
    expect(manifestFingerprint(tampered)).not.toBe(stored.artifactHash);

    // The recorded approval request still binds the ORIGINAL hash — the
    // pendingWithBinding() view must surface bindingValid=false.
    const pending = await approvals.pendingWithBinding();
    expect(pending.find((p) => p.id === prepared.request.id)?.bindingValid).toBe(false);

    // And publish refuses the drifted artifact.
    const publishable = await checkPublishBinding(repo, prepared.record.id);
    expect(publishable.ok).toBe(false);
    expect(publishable.reason).toContain('drifted');
  });

  it('full happy path: prepare → approve → publish through the ONLY routing hook', async () => {
    const onPublish = vi.fn(async (payload: PublishPayload) => {
      expect(payload.baseUrl).toBe('https://api.test-provider.example/v1');
      expect(payload.models).toContain('test-model');
    });
    const hookEngine = new IntelligenceEngine({ repo, connectors: [], onPublish });

    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    await approvals.decide(prepared.request.id, { decision: 'approved', reviewer: 'senior-reviewer' });

    const payload = await hookEngine.publishApprovedAdapter(prepared.record.id);
    expect(payload.adapterVersionId).toBe(prepared.record.id);
    expect(payload.approvedBy).toBe('senior-reviewer');
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect((await repo.getAdapterVersion(prepared.record.id))?.status).toBe('active');
    const audit = await repo.listAudit(50);
    expect(audit.some((a) => a.action === 'adapter.published')).toBe(true);
  });

  it('engine refuses publishing with no injectable routing hook (no silent action)', async () => {
    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    await approvals.decide(prepared.request.id, { decision: 'approved', reviewer: 'senior-reviewer' });
    await expect(engine.publishApprovedAdapter(prepared.record.id)).rejects.toThrow(/No publish hook configured/);
  });

  it('publishing a rejected/restricted provider is prohibited — even after technical approval', async () => {
    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    await approvals.decide(prepared.request.id, { decision: 'approved', reviewer: 'reviewer' });
    // Trust status degrades AFTER the approval: a production publication must
    // still be refused — trust is an independent gate from adapter status.
    const stored = (await repo.getProvider('test-provider'))!;
    await repo.upsertProvider({ ...stored, trustStatus: 'restricted' });
    await expect(engine.publishApprovedAdapter(prepared.record.id)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('ApprovalGuardError from publish after approval-success but drift is ARTIFACT_DRIFT', async () => {
    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    await approvals.decide(prepared.request.id, { decision: 'approved', reviewer: 'reviewer' });
    const stored = (await repo.getAdapterVersion(prepared.record.id))!;
    await repo.upsertAdapterVersion({ ...stored, manifest: { ...stored.manifest, baseUrl: 'https://drift.example/v1' } });
    await expect(engine.publishApprovedAdapter(prepared.record.id)).rejects.toMatchObject({ code: 'ARTIFACT_DRIFT' });
  });
});

// (scribe: approval guard error typing is stable across the engine surface)
describe('engine API surface', () => {
  it('decideApproval propagates the reviewer gate error verbatim', async () => {
    const prepared = await factory.prepareAdapter({ providerId: 'test-provider', requestedBy: 'operator' });
    await expect(
      engine.decideApproval('apr_missing', { decision: 'approved', reviewer: 'reviewer', hasReviewerPermissions: true }),
    ).rejects.toMatchObject({ code: 'ADAPTER_MISSING' });
  });
});

/**
 * Verification engine tests (§11):
 *   #7 capabilities/pricing/free-access stay INDEPENDENT dimensions — a model
 *      is never labeled 'verified' from a subset of passed dimensions;
 *   #8 stale claims expire: expired verification outcomes are re-labeled
 *      'stale' (never silently kept as current truth).
 */

import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryIntelligenceRepository } from '../src/repository.js';
import { VerificationEngine } from '../src/verification.js';
import { SafeEgress } from '../src/egress.js';
import type { EndpointRecord, EvidenceRecord, ProviderRecord, ProviderModelRecord, VerificationRunRecord } from '../src/types.js';
import { newId, sha256 } from '../src/connectors/base.js';

const now = () => new Date().toISOString();
const DOCUMENTED_DAY = new Date().toISOString();

let repo: InMemoryIntelligenceRepository;

beforeEach(() => {
  repo = new InMemoryIntelligenceRepository();
});

function seedProviderModel(pm: Partial<ProviderModelRecord> = {}): Promise<void> {
  const record: ProviderModelRecord = {
    id: 'test-provider:listing-model',
    providerId: 'test-provider',
    modelId: 'm_listing',
    providerModelId: 'listing-model',
    displayName: 'Listing Model',
    lifecycle: 'normalized',
    availabilityStatus: 'unknown',
    pricingStatus: 'unknown',
    capabilities: {},
    confidence: 1,
    firstSeenAt: now(),
    lastSeenAt: now(),
    ...pm,
  };
  return repo.upsertProviderModel(record).then(() => undefined);
}

describe('capability independence (§11 #7)', () => {
  it('identity+existence+pricing verified but capability unverified → NOT fully verified', async () => {
    const provider: ProviderRecord = {
      id: 'test-provider',
      canonicalName: 'Test Provider',
      officialDocsUrl: 'https://docs.test-provider.example',
      trustStatus: 'unverified',
      firstSeenAt: now(),
      lastSeenAt: now(),
      updatedAt: now(),
    };
    await repo.upsertProvider(provider);
    await seedProviderModel({ id: 'test-provider:cap-model', providerModelId: 'cap-model', lifecycle: 'normalized' });
    const pmId = 'test-provider:cap-model';

    // Documented catalog + pricing claims at the same source.
    const evidence = (claimType: EvidenceRecord['claimType'], subjectType: EvidenceRecord['subjectType'], subjectId: string): EvidenceRecord => ({
      id: newId('ev'),
      dedupeKey: sha256(`${subjectType}:${subjectId}:${claimType}:${newId('x')}`),
      subjectType,
      subjectId,
      claimType,
      sourceUrl: 'https://docs.test-provider.example/pricing',
      sourceAuthority: 0.9,
      observedAt: DOCUMENTED_DAY,
      summary: 'documented claim',
      confidence: 90,
      redacted: true,
    });
    await repo.appendEvidence(evidence('model_catalog', 'provider_model', pmId));
    await repo.appendEvidence(evidence('identity', 'provider', 'test-provider'));
    await repo.appendEvidence(evidence('pricing', 'provider_model', pmId));

    const verification = new VerificationEngine(repo);
    const runs = await verification.verifyProviderModel(pmId);
    const byDim = new Map(runs.map((r) => [r.dimension, r.result]));
    expect(byDim.get('existence')).toBe('passed');
    expect(byDim.get('identity')).toBe('passed');
    expect(byDim.get('pricing')).toBe('passed');
    expect(byDim.get('capability')).toBe('unknown'); // never inferred by testing
    expect(byDim.get('security')).toBe('passed');

    const stored = await repo.getProviderModelById(pmId);
    expect(stored?.lifecycle).toBe('evidence_checked'); // core verified, capability pending
    expect(stored?.lifecycle).not.toBe('verified');
  });
});

describe('stale expiry (§11 #8): expired claims are re-labeled, never silently current', () => {
  it('a sweep marks expired availability runs and flips an active-featured model to stale', async () => {
    const then = new Date(Date.now() - 4 * 3_600_000).toISOString(); // older than 3h freshness window
    await seedProviderModel({
      lifecycle: 'partially_verified',
      availabilityStatus: 'available',
      lastVerifiedAt: then,
    });
    // Seed a passed-then-expired availability verification.
    const expiredRun: VerificationRunRecord = {
      id: newId('vr'),
      subjectType: 'provider_model',
      subjectId: 'test-provider:listing-model',
      providerId: 'test-provider',
      dimension: 'availability',
      result: 'passed',
      detail: 'was live',
      createdAt: then,
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
    };
    await repo.recordVerificationRun(expiredRun);

    const verification = new VerificationEngine(repo);
    const result = await verification.sweepStale();
    expect(result.providersSwept).toBe(1);
    const stored = await repo.getProviderModelById('test-provider:listing-model');
    expect(stored?.lifecycle).toBe('stale');
    expect(stored?.availabilityStatus).toBe('stale');
    const runs = await repo.listVerificationRuns({ subjectType: 'provider_model', subjectId: 'test-provider:listing-model' });
    expect(runs.some((r) => r.result === 'stale' && r.dimension === 'availability')).toBe(true);
    // Absorption respected: original run remains immutable in history.
    expect(runs.some((r) => r.id === expiredRun.id && r.result === 'passed')).toBe(true);
  });

  it('restricted models are never silently downgraded to stale by a sweep', async () => {
    await seedProviderModel({
      lifecycle: 'restricted',
      availabilityStatus: 'available',
      lastVerifiedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    });
    await repo.recordVerificationRun({
      id: newId('vr'),
      subjectType: 'provider_model',
      subjectId: 'test-provider:listing-model',
      dimension: 'availability',
      result: 'passed',
      detail: 'was live',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const verification = new VerificationEngine(repo);
    const result = await verification.sweepStale();
    expect(result.providersSwept).toBe(0);
    expect((await repo.getProviderModelById('test-provider:listing-model'))?.lifecycle).toBe('restricted');
  });

  it('an expired free-access plan is no longer presented as currently confirmed free', async () => {
    await seedProviderModel({ lifecycle: 'partially_verified' });
    await repo.upsertAccessPlan({
      id: 'plan_old',
      providerId: 'test-provider',
      providerModelId: 'test-provider:listing-model',
      planType: 'free',
      inputPer1M: 0,
      outputPer1M: 0,
      currency: 'USD',
      billingConditions: 'documented free alias',
      sourceUrl: 'https://docs.test-provider.example/free',
      verifiedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      updatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    const verification = new VerificationEngine(repo);
    const runs = await verification.verifyProviderModel('test-provider:listing-model');
    const freeRun = runs.find((r) => r.dimension === 'free_access');
    expect(freeRun?.result).toBe('stale');
    expect(freeRun?.detail).toMatch(/expired/i);
  });
});

describe('endpoint + availability verification against a local runtime', () => {
  let server: http.Server;
  let port = 0;
  const loopbackEgress = () =>
    new SafeEgress({ allowLoopback: true, allowRemoteHttps: false, timeoutMs: 2_000, maxRedirects: 0, maxResponseBytes: 64 * 1024 });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/models')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'listing-model' }, { id: 'other-model' }] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('a live listing marks exact ids available; absent ids stay unknown (never inferred unavailable)', async () => {
    await repo.upsertProvider({
      id: 'test-provider',
      canonicalName: 'Test Provider',
      trustStatus: 'unverified',
      firstSeenAt: now(),
      lastSeenAt: now(),
      updatedAt: now(),
    });
    await seedProviderModel({ lifecycle: 'normalized' }); // listing-model
    await seedProviderModel({
      id: 'test-provider:hidden-model',
      providerModelId: 'hidden-model',
      lifecycle: 'normalized',
    });

    const endpoint: EndpointRecord = {
      id: 'ep_local',
      providerId: 'test-provider',
      baseUrl: `http://127.0.0.1:${port}`,
      apiStyle: 'openai-compatible',
      healthStatus: 'unknown',
      sourceUrl: 'local-runtime',
    };
    await repo.upsertEndpoint(endpoint);

    const verification = new VerificationEngine(repo, loopbackEgress());
    const runs = await verification.verifyEndpoint('ep_local');
    expect(runs[0]?.dimension).toBe('endpoint');
    expect(runs[0]?.result).toBe('passed');
    expect(runs[0]?.expiresAt).toBeTruthy();

    const listed = await repo.getProviderModelById('test-provider:listing-model');
    expect(listed?.availabilityStatus).toBe('available');
    expect(listed?.lifecycle).toBe('evidence_checked');

    const hidden = await repo.getProviderModelById('test-provider:hidden-model');
    expect(hidden?.availabilityStatus).toBe('unknown'); // never inferred unavailable
    const hiddenRuns = await repo.listVerificationRuns({ subjectId: 'test-provider:hidden-model', subjectType: 'provider_model' });
    expect(hiddenRuns.at(-1)?.result).toBe('unknown');

    const storedEndpoint = await repo.getEndpoint('ep_local');
    expect(storedEndpoint?.healthStatus).toBe('live');
  });
});

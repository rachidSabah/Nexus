/**
 * Ingestion regression tests: idempotency (§11 #9) + evidence-derivation
 * rules. Re-processing the same discovery event must create ZERO duplicate
 * rows; missing pricing must never become a free claim.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { IngestionPipeline, type IngestionMeta } from '../src/ingestion.js';
import { InMemoryIntelligenceRepository } from '../src/repository.js';
import type { NormalizedCandidate } from '../src/types.js';

const observed = '2026-01-15T10:00:00.000Z';
const meta: IngestionMeta = { connectorId: 'openrouter', sourceUrl: 'https://openrouter.ai/api/v1/models', observedAt: observed };

function openrouterModel(): NormalizedCandidate[] {
  return [
    { kind: 'provider', candidate: { providerId: 'openrouter', displayName: 'OpenRouter', canonicalDomain: 'openrouter.ai', officialDocsUrl: 'https://openrouter.ai/docs', providerKind: 'aggregator' } },
    { kind: 'model', candidate: { providerId: 'openrouter', providerModelId: 'test/free-model', displayName: 'Test Free Model', contextWindow: 32_768, capabilities: { toolCalling: true }, pricing: { inputPer1M: 0, outputPer1M: 0, currency: 'USD' } } },
    { kind: 'model', candidate: { providerId: 'openrouter', providerModelId: 'test/paid-model', displayName: 'Test Paid Model' } }, // no pricing at all
  ];
}

let repo: InMemoryIntelligenceRepository;
let pipeline: IngestionPipeline;

beforeEach(() => {
  repo = new InMemoryIntelligenceRepository();
  pipeline = new IngestionPipeline(repo);
  pipeline.beginRun();
});

describe('idempotent ingestion (§11 #9)', () => {
  it('ingesting the identical event twice creates zero duplicate evidence', async () => {
    const first = await pipeline.ingestCandidates(openrouterModel(), meta);
    expect(first.createdEvidence).toBeGreaterThan(0);
    expect(first.providerModelCreated).toBe(true);

    const second = await pipeline.ingestCandidates(openrouterModel(), meta); // same observedAt day
    expect(second.createdEvidence).toBe(0);
    expect(second.duplicateEvidence).toBe(first.createdEvidence);
    expect(second.providerModelCreated).toBe(false);
  });

  it('reprocessing keeps exactly one provider-model relation per (provider, provider_model_id)', async () => {
    await pipeline.ingestCandidates(openrouterModel(), meta);
    await pipeline.ingestCandidates(openrouterModel(), meta);
    const pms = await repo.listProviderModels({ providerId: 'openrouter' });
    const relations = pms.filter((pm) => pm.providerModelId.startsWith('test/'));
    expect(relations).toHaveLength(2);
  });

  it('an evidence re-observation on a DIFFERENT day creates a new row (fresh recency)', async () => {
    await pipeline.ingestCandidates(openrouterModel(), meta);
    const nextDay = await pipeline.ingestCandidates(openrouterModel(), {
      ...meta,
      observedAt: '2026-01-16T10:00:00.000Z',
    });
    expect(nextDay.createdEvidence).toBeGreaterThan(0);
  });
});

describe('never infer free by omission', () => {
  it('missing pricing stays pricingStatus unknown — never zero/free', async () => {
    await pipeline.ingestCandidates(openrouterModel(), meta);
    const paid = (await repo.listProviderModels({ providerId: 'openrouter' })).find((pm) => pm.providerModelId === 'test/paid-model');
    expect(paid?.pricingStatus).toBe('unknown');
  });

  it('a documented zero-price candidate is recorded as unverified (needs evidence stamp)', async () => {
    await pipeline.ingestCandidates(openrouterModel(), meta);
    const free = (await repo.listProviderModels({ providerId: 'openrouter' })).find((pm) => pm.providerModelId === 'test/free-model');
    expect(free?.pricingStatus).toBe('unverified');
  });
});

describe('leak-monitoring re-redaction at the ingestion boundary', () => {
  it('connector-supplied excerpt containing a live token is re-redacted before storage', async () => {
    const secret = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
    const outcome = await pipeline.ingestCandidates(
      [
        {
          kind: 'security',
          candidate: {
            title: 'Exposed repository token',
            category: 'credential-exposure',
            severity: 'critical',
            confidence: 0.9,
            sourceRef: 'https://github.com/example/repo/issues/1',
            excerpt: `curl -H "Authorization: Bearer ${secret}" https://api.example.com`,
            providerId: 'openrouter',
          },
        },
      ],
      meta,
    );
    expect(outcome.createdEvidence).toBeGreaterThan(0);
    const findings = await repo.listSecurityFindings({ status: 'open' });
    expect(findings).toHaveLength(1);
    const serialized = JSON.stringify(findings[0]);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('Bearer ' + secret);
  });

  it('the stored finding never contains the markdown-secret or its hash', async () => {
    const secret = 'sk-AbCdEf1234567890AbCdEf1234567890';
    await pipeline.ingestCandidates(
      [
        {
          kind: 'security',
          candidate: {
            title: 'Key posted publicly',
            category: 'credential-exposure',
            severity: 'high',
            confidence: 0.8,
            sourceRef: 'https://example.org/paste',
            excerpt: `key=${secret}`,
          },
        },
      ],
      meta,
    );
    const findings = await repo.listSecurityFindings();
    for (const finding of findings) {
      expect(finding.excerpt).not.toContain(secret);
      expect(finding.redacted).toBe(true);
    }
  });
});

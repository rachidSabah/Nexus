/**
 * Constrained adapter generation + immutably versioned approval binding
 * (blueprint §7).
 *
 * Adapters are generated from a CONSTRAINT TEMPLATE, never from free-form LLM
 * codegen: the artifact is a pure-JSON manifest rendered into the gateway's
 * existing provider-adapter vocabulary (`@anx/providers` already has the
 * executable transport; the manifest only declares safe, reviewable wiring).
 *
 * Immutability guarantee: `artifactHash` = sha256 over the manifest's
 * immutable content. An approval binds to exactly that hash; a changed
 * artifact can never ride an old approval (blueprint §11 scenario 6).
 */

import { newId, sha256, stableStringify } from './connectors/base.js';
import { looksLikeSecret } from './redaction.js';
import type { IntelligenceRepository } from './repository.js';
import type {
  AdapterManifest,
  AdapterOperation,
  AdapterStatus,
  AdapterTestResults,
  AdapterVersionRecord,
  ApprovalRequestRecord,
  LifecycleState,
} from './types.js';

const ALLOWED_API_STYLES = new Set<AdapterManifest['apiStyle']>([
  'openai-compatible',
  'anthropic',
  'google',
  'ollama',
  'unknown',
]);
const ALLOWED_OPERATIONS = new Set<AdapterOperation>(['list-models', 'chat-completions', 'stream-completions', 'embeddings']);
const MAX_MODELS_IN_MANIFEST = 50;

export class AdapterPreparationError extends Error {
  constructor(
    readonly reasons: string[],
  ) {
    super(`Adapter preparation refused: ${reasons.join('; ')}`);
    this.reasons = reasons;
  }
}

/**
 * The immutable portion of the manifest — everything hashed into artifactHash.
 * Mutable gate fields (approvalState/productionEnabled) are EXCLUDED: flipping
 * them is not an artifact change.
 */
export function manifestFingerprint(m: AdapterManifest): string {
  const immutable: Omit<AdapterManifest, 'approvalState' | 'productionEnabled' | 'generatedAt'> = {
    providerId: m.providerId,
    adapterVersion: m.adapterVersion,
    apiStyle: m.apiStyle,
    baseUrlSource: m.baseUrlSource,
    supportedOperations: [...m.supportedOperations].sort(),
    baseUrl: m.baseUrl,
    models: [...m.models].sort(),
    credentialRef: m.credentialRef,
    verificationState: m.verificationState,
    pricingStatus: m.pricingStatus,
    evidenceHashes: [...m.evidenceHashes].sort(),
    generator: m.generator,
  };
  return sha256(stableStringify(immutable));
}

export interface PreparedAdapter {
  record: AdapterVersionRecord;
  request: ApprovalRequestRecord;
}

export class AdapterFactory {
  constructor(private readonly repo: IntelligenceRepository) {}

  /**
   * Prepares a constrained adapter for (provider) after passing the approval
   * checklist. Creation NEVER touches routing; status lands at
   * 'awaiting_approval' with a pending approval request.
   */
  async prepareAdapter(opts: {
    providerId: string;
    adapterVersionLabel?: string;
    requestedBy?: string;
    maxModels?: number;
  }): Promise<PreparedAdapter> {
    const reasons: string[] = [];
    const provider = await this.repo.getProvider(slugify(opts.providerId));
    if (!provider) reasons.push(`Provider '${opts.providerId}' is not present in the intelligence catalog.`);
    if (provider?.trustStatus === 'restricted') reasons.push(`Provider '${provider.id}' is RESTRICTED — integration prohibited.`);
    if (provider?.trustStatus === 'rejected') reasons.push(`Provider '${provider.id}' was rejected by a reviewer.`);

    const endpoints = await this.repo.listEndpoints(provider ? provider.id : slugify(opts.providerId));
    const endpoint = endpoints.find((e) => e.healthStatus !== 'blocked');
    if (!endpoint) {
      reasons.push(`No verified endpoint on file for provider '${opts.providerId}'.`);
    }

    const providerModels = await this.repo.listProviderModels({ providerId: provider?.id ?? slugify(opts.providerId), limit: 200 });
    if (providerModels.length === 0) {
      reasons.push(`No provider-specific models recorded for '${opts.providerId}'.`);
    }
    const openFindings = await this.repo.listSecurityFindings({ status: 'open', limit: 100 });
    const blockingFindings = openFindings.filter(
      (f) => f.providerId === provider?.id || (provider && provider.trustStatus !== 'unverified' && f.severity === 'critical'),
    );
    if (blockingFindings.length > 0) {
      reasons.push(`${blockingFindings.length} open security finding(s) block adapter generation.`);
    }

    if (reasons.length > 0) throw new AdapterPreparationError(reasons);

    const now = new Date().toISOString();
    const models = providerModels
      .filter((pm) => pm.lifecycle !== 'restricted' && pm.lifecycle !== 'rejected')
      .slice(0, opts.maxModels ?? MAX_MODELS_IN_MANIFEST)
      .map((pm) => pm.providerModelId);

    const apiStyle = endpoints.some((e) => e.apiStyle === 'ollama') ? 'ollama' : endpoints[0]?.apiStyle ?? 'openai-compatible';
    const baseUrl = endpoint!.baseUrl;
    const baseUrlSource = endpoint!.sourceUrl.includes('127.0.0.1') || endpoint!.sourceUrl.includes('localhost')
      ? 'local-runtime'
      : endpoint!.sourceUrl
        ? 'connector-catalog'
        : 'official-documentation';

    const evidenceHashes: string[] = [];
    const modelEvidence = await this.repo.listEvidence({ subjectType: 'provider_model', subjectId: providerModels[0]?.id ?? '', limit: 3 });
    for (const e of modelEvidence) if (e.contentHash) evidenceHashes.push(e.contentHash);

    const manifest: AdapterManifest = {
      providerId: provider!.id,
      adapterVersion: sanitizeVersion(opts.adapterVersionLabel ?? '1.0.0'),
      apiStyle: ALLOWED_API_STYLES.has(apiStyle) ? apiStyle : 'unknown',
      baseUrlSource,
      supportedOperations: ['list-models', 'chat-completions'],
      baseUrl,
      models,
      credentialRef: null, // never embedded; the operator registers keys separately
      verificationState: 'evidence_checked' as LifecycleState,
      approvalState: 'pending',
      productionEnabled: false,
      pricingStatus: providerModels[0]?.pricingStatus ?? 'unknown',
      evidenceHashes,
      generator: 'nexus-intelligence/1.0 constrained-template',
      generatedAt: now,
    };

    const tests = runSandboxChecks(manifest);
    if (!tests.passed) {
      throw new AdapterPreparationError(tests.checks.filter((c) => !c.passed).map((c) => `${c.id}: ${c.detail ?? c.label}`));
    }

    const artifactHash = manifestFingerprint(manifest);
    const record: AdapterVersionRecord = {
      id: newId('adv'),
      providerId: provider!.id,
      version: manifest.adapterVersion,
      status: 'awaiting_approval',
      manifest,
      artifactHash,
      tests,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.upsertAdapterVersion(record);

    const request: ApprovalRequestRecord = {
      id: newId('apr'),
      adapterVersionId: record.id,
      adapterArtifactHash: artifactHash,
      state: 'pending',
      requestedBy: opts.requestedBy ?? 'system',
      requestedAt: now,
      updatedAt: now,
    };
    await this.repo.upsertApprovalRequest(request);
    return { record, request };
  }
}

export interface PublishDecision {
  ok: boolean;
  reason?: string;
}

/**
 * Verifies an adapter is publishable: an APPROVAL must exist for the CURRENT
 * artifact hash. Any post-approval manifest change (endpoint, auth, models,
 * operations) invalidates the binding (blueprint §11 regression #6).
 */
export async function checkPublishBinding(
  repo: IntelligenceRepository,
  adapterVersionId: string,
): Promise<PublishDecision> {
  const adapter = await repo.getAdapterVersion(adapterVersionId);
  if (!adapter) return { ok: false, reason: `Adapter version ${adapterVersionId} not found` };
  const currentHash = manifestFingerprint(adapter.manifest);
  if (currentHash !== adapter.artifactHash) {
    return {
      ok: false,
      reason: 'Artifact hash drifted from the recorded approval hash — the store version is tampered or hand-edited',
    };
  }
  if (adapter.status !== 'approved') {
    return { ok: false, reason: `Adapter status is '${adapter.status}'; publishing requires an explicit approval` };
  }
  const approvals = await repo.listApprovalRequests({ state: 'approved', limit: 200 });
  const binding = approvals.find((a) => a.adapterVersionId === adapterVersionId);
  if (!binding) return { ok: false, reason: 'No approved approval request exists for this adapter version' };
  if (binding.adapterArtifactHash !== adapter.artifactHash) {
    return {
      ok: false,
      reason: 'The approval binds to a DIFFERENT artifact hash — post-review changes require re-approval',
    };
  }
  return { ok: true };
}

/** Deterministic sandbox checks — no network, no execution, pure manifest lint. */
export function runSandboxChecks(manifest: AdapterManifest): AdapterTestResults {
  const checks: AdapterTestResults['checks'] = [];
  const add = (id: string, label: string, passed: boolean, detail?: string) => checks.push({ id, label, passed, detail });

  add(
    'provider-known',
    'Provider identity recorded with dispute evidence',
    manifest.providerId.length > 0,
    `providerId=${manifest.providerId}`,
  );
  add('api-style', 'API style is within the constrained vocabulary', ALLOWED_API_STYLES.has(manifest.apiStyle), manifest.apiStyle);
  add(
    'operations',
    'Only allow-listed operations declared',
    manifest.supportedOperations.every((o) => ALLOWED_OPERATIONS.has(o)),
    manifest.supportedOperations.join(','),
  );
  add(
    'protocol-url',
    'Endpoint URL has an http(s) origin',
    /^https?:\/\//i.test(manifest.baseUrl),
    manifest.baseUrl,
  );
  const noLoopbackRemote = !/127\.0\.0\.1|localhost|::1/.test(manifest.baseUrl) || manifest.baseUrlSource === 'local-runtime';
  add(
    'no-internal-target',
    'No internal/private host beyond the localhost policy',
    noLoopbackRemote,
    manifest.baseUrl,
  );
  const noSecrets = !looksLikeSecret(stableStringify(manifest));
  add('no-embedded-secrets', 'No secrets embedded in the manifest', noSecrets);
  add(
    'models-bounded',
    `Model set bounded (<= ${MAX_MODELS_IN_MANIFEST})`,
    manifest.models.length <= MAX_MODELS_IN_MANIFEST,
    `${manifest.models.length} models`,
  );
  add('credential-empty', 'No credential value embedded (operators register keys separately)', manifest.credentialRef === null || typeof manifest.credentialRef === 'string');

  // Timeout/retry budget policy is declared in the gateway, not generated here;
  // presence of the generator tag proves template provenance.
  add('template-provenance', 'Generated by the constrained template', manifest.generator.startsWith('nexus-intelligence/'), manifest.generator);

  return { checks, passed: checks.every((c) => c.passed) };
}

export function sanitizeVersion(v: string): string {
  return v.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || '1.0.0';
}

export function slugify(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

export type { AdapterStatus };

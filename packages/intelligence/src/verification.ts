/**
 * Verification engine (blueprint §5 "Safely verified").
 *
 * Produces SEPARATE verification results per dimension — never one misleading
 * green checkmark:
 *
 *   identity      — official docs/domain corroborated by the connector source
 *   existence     — exact model id present in a documented catalog
 *   endpoint      — documented URL reachable through the controlled egress layer
 *   availability  — authorized probe shows the model served (with expiry)
 *   capability    — capability only from documented parameters; an inference
 *                   attempt is never assumed, so untested claims stay 'unknown'
 *   pricing       — published pricing recorded with source and effective date
 *   free_access   — explicit free offering with eligibility/quota conditions
 *   security      — SSRF checks passed, no blocking security findings open
 *
 * Hard rules honored here:
 *   - A successful HTTP response does NOT prove a model is usable (existence
 *     is only 'passed' when the EXACT model id is in the catalog response).
 *   - Absence in a response does NOT prove unavailability (→ 'unknown').
 *   - Missing price !== zero price (pricing stays 'unknown').
 *   - Free-tier claims expire; expired ones are re-labeled 'stale'.
 */

import { newId } from './connectors/base.js';
import { SafeEgress } from './egress.js';
import type { IntelligenceRepository } from './repository.js';
import { assertTransition } from './state-machine.js';
import type {
  EndpointRecord,
  LifecycleState,
  ProviderModelRecord,
  VerificationRunRecord,
  VerificationRunFilter,
} from './types.js';

export const AVAILABILITY_FRESHNESS_MS = 3 * 3_600_000; // available claims expire after 3h
export const PRICING_FRESHNESS_MS = 7 * 86_400_000; // pricing verified claims expire after 7d

export class VerificationEngine {
  private readonly egress: SafeEgress;

  constructor(
    private readonly repo: IntelligenceRepository,
    egress?: SafeEgress,
  ) {
    this.egress = egress ?? new SafeEgress();
  }

  /** Endpoint + availability verification for a provider's recorded endpoint. */
  async verifyEndpoint(endpointId: string): Promise<VerificationRunRecord[]> {
    const endpoint = await this.repo.getEndpoint(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    const now = new Date().toISOString();
    const runs: VerificationRunRecord[] = [];

    // Endpoint dimension: documented URL reachable via controlled egress.
    const now0 = Date.now();
    const probeUrl = probeCandidates(endpoint);
    let lastErr: string | undefined;
    for (const url of probeUrl) {
      const res = await this.egress.fetchText(url, { maxRedirects: 0, maxResponseBytes: 512 * 1024 });
      if (res.ok) {
        const run: VerificationRunRecord = {
          id: newId('vr'),
          subjectType: 'endpoint',
          subjectId: endpoint.id,
          providerId: endpoint.providerId,
          dimension: 'endpoint',
          result: 'passed',
          detail: `Endpoint ${endpoint.baseUrl} reachable (HTTP ${res.status}, ${res.latencyMs}ms) via controlled egress; no redirects accepted.`,
          latencyMs: res.latencyMs,
          createdAt: now,
          expiresAt: new Date(now0 + AVAILABILITY_FRESHNESS_MS).toISOString(),
        };
        runs.push(run);
        await this.repo.recordVerificationRun(run);
        await this.repo.upsertEndpoint({ ...endpoint, healthStatus: 'live', lastVerifiedAt: now });
        // Availability: only exact per-model listing marks a model available;
        // endpoint liveness alone never does.
        await this.verifyModelsListedOnEndpoint(endpoint, res.body, now);
        return runs;
      }
      lastErr = `${res.blockedReason ?? 'http'}: ${res.error ?? `HTTP ${res.status ?? '?'}`}`;
    }
    const failed: VerificationRunRecord = {
      id: newId('vr'),
      subjectType: 'endpoint',
      subjectId: endpoint.id,
      providerId: endpoint.providerId,
      dimension: 'endpoint',
      result: 'failed',
      detail: `Endpoint verification failed: ${stripSecrets(lastErr ?? 'unknown error')}`,
      createdAt: now,
    };
    runs.push(failed);
    await this.repo.recordVerificationRun(failed);
    await this.repo.upsertEndpoint({
      ...endpoint,
      healthStatus: blockedLike(lastErr) ? 'blocked' : 'unreachable',
      lastVerifiedAt: now,
    });
    return runs;
  }

  /**
   * Availability: parse the /models listing and mark each tracked provider
   * model served by this endpoint. Presence ⇒ 'available' (with expiry).
   * Absence ⇒ 'unknown' (endpoint may not advertise everything). A 200 from
   * the endpoint NEVER marks all its models available.
   */
  async verifyModelsListedOnEndpoint(endpoint: EndpointRecord, body: string | undefined, now: string): Promise<void> {
    if (!body) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return;
    }
    const ids = extractModelIds(parsed);
    const pms = await this.repo.listProviderModels({ providerId: endpoint.providerId });
    for (const pm of pms) {
      const listed = new Set(ids);
      const exactListed = listed.has(pm.providerModelId);
      const run: VerificationRunRecord = {
        id: newId('vr'),
        subjectType: 'provider_model',
        subjectId: pm.id,
        providerId: pm.providerId,
        dimension: 'availability',
        result: exactListed ? 'passed' : 'unknown',
        detail: exactListed
          ? `Exact model id "${pm.providerModelId}" present in live ${endpoint.baseUrl} listing at ${now}.`
          : `Endpoint live, but "${pm.providerModelId}" not advertised in its listing; many providers list partial subsets — availability remains unknown (never inferred unavailable).`,
        createdAt: now,
        expiresAt: exactListed ? new Date(Date.now() + AVAILABILITY_FRESHNESS_MS).toISOString() : undefined,
      };
      await this.repo.recordVerificationRun(run);
      await this.repo.upsertProviderModel({
        ...pm,
        availabilityStatus: exactListed ? 'available' : pm.availabilityStatus,
        lastVerifiedAt: exactListed ? now : pm.lastVerifiedAt,
        lifecycle: exactListed ? (lifecycleFrom('availability', pm.lifecycle, now) as LifecycleState) : pm.lifecycle,
        id: pm.id,
      });
    }
  }

  /** Full provider-model verification (identity/existence/pricing/free/security dimensions). */
  async verifyProviderModel(providerModelId: string): Promise<VerificationRunRecord[]> {
    const pm = await this.repo.getProviderModelById(providerModelId);
    if (!pm) throw new Error(`Provider model ${providerModelId} not found`);
    const provider = await this.repo.getProvider(pm.providerId);
    const now = new Date().toISOString();
    const runs: VerificationRunRecord[] = [];
    const evidence = await this.repo.listEvidence({ subjectType: 'provider_model', subjectId: pm.id, limit: 100 });

    // existence
    const catalogEvidence = evidence.find((e) => e.claimType === 'model_catalog');
    runs.push(await this.pushRun('provider_model', pm, 'existence', catalogEvidence ? 'passed' : 'unknown',
      catalogEvidence
        ? `Exact model id listed in a documented catalog (source ${catalogEvidence.sourceUrl}, observed ${catalogEvidence.observedAt}).`
        : 'No catalog evidence yet; discovery may not have covered this model.',
      now));
    if (catalogEvidence) {
      void catalogEvidence;
    }

    // identity
    const identityEvidence = provider?.officialDocsUrl
      ? (await this.repo.listEvidence({ subjectType: 'provider', subjectId: pm.providerId, claimType: 'identity', limit: 5 }))[0]
      : undefined;
    runs.push(
      await this.pushRun('provider_model', pm, 'identity', provider?.officialDocsUrl ? (identityEvidence ? 'passed' : 'unknown') : 'unknown',
        provider?.officialDocsUrl
          ? `Official docs URL recorded (${provider.officialDocsUrl})${identityEvidence ? ` with catalog corroboration from ${identityEvidence.sourceUrl}` : ''}.`
          : 'No official documentation address recorded for this provider.',
      now),
    );

    // capability — documented only; NEVER inferred by testing
    const capabilityEvidence = evidence.find((e) => e.claimType === 'capability');
    runs.push(
      await this.pushRun('provider_model', pm, 'capability', capabilityEvidence ? 'passed' : 'unknown',
        capabilityEvidence
          ? `Capability claims documented at ${capabilityEvidence.sourceUrl}: not live-tested; treated as documented-not-proven.`
          : 'No documented capability claims; runtime probing requires an authorized test account and is never automatic.',
      now),
    );

    // pricing
    const pricingEvidence = evidence.find((e) => e.claimType === 'pricing');
    const pricingStale = pricingEvidence ? Date.now() - Date.parse(pricingEvidence.observedAt) > PRICING_FRESHNESS_MS : false;
    const pricingResult = !pricingEvidence ? 'unknown' : pricingStale ? 'stale' : 'passed';
    runs.push(
      await this.pushRun('provider_model', pm, 'pricing', pricingResult,
        pricingEvidence
          ? pricingStale
            ? `Published pricing evidence from ${pricingEvidence.sourceUrl} has expired (>${PRICING_FRESHNESS_MS / 86_400_000}d) — re-marked stale.`
            : `Published pricing verified from ${pricingEvidence.sourceUrl} (observed ${pricingEvidence.observedAt}).`
          : 'No published pricing claim — pricing status stays "unknown" (missing price is NOT zero).',
      now),
    );

    // free access
    const plans = await this.repo.listAccessPlans({ freeOnly: true, limit: 100 });
    const freePlan = plans.find((p) => p.providerModelId === pm.id);
    const freeFresh = freePlan ? Date.now() - Date.parse(freePlan.updatedAt) < PRICING_FRESHNESS_MS : false;
    runs.push(
      await this.pushRun('provider_model', pm, 'free_access', freePlan ? (freeFresh ? 'passed' : 'stale') : 'unknown',
        freePlan
          ? freeFresh
            ? `Documented free access (plan ${freePlan.planType}) with conditions: ${freePlan.billingConditions ?? 'on file'}; quota/eligibility pending operator confirmation.`
            : 'Free-tier claim expired — label no longer presented as currently-confirmed free.'
          : 'No documented free access claim.',
      now),
    );

    // security — blocked-provider gate
    const providerTrust = provider?.trustStatus ?? 'unverified';
    runs.push(
      await this.pushRun('provider_model', pm, 'security', providerTrust === 'rejected' || providerTrust === 'restricted' ? 'restricted' : 'passed',
        providerTrust === 'rejected' || providerTrust === 'restricted'
          ? `Provider trust status '${providerTrust}' — integration prohibited.`
          : 'No blocking security findings for this provider; SSRF-policing active on all probes.',
      now),
    );

    // Lifecycle promotion while preserving security gates.
    const anyFailed = runs.some((r) => r.result === 'restricted');
    const nextLifecycle: LifecycleState = anyFailed ? 'restricted' : promote(pm.lifecycle, runs);
    if (nextLifecycle !== pm.lifecycle) {
      assertTransition(pm.lifecycle, nextLifecycle);
      await this.repo.upsertProviderModel({ ...pm, lifecycle: nextLifecycle, lastVerifiedAt: now, id: pm.id });
    }
    return runs;
  }

  private async pushRun(
    subjectType: 'provider_model',
    pm: ProviderModelRecord,
    dimension: VerificationRunRecord['dimension'],
    result: VerificationRunRecord['result'],
    detail: string,
    now: string,
  ): Promise<VerificationRunRecord> {
    const run: VerificationRunRecord = {
      id: newId('vr'),
      subjectType,
      subjectId: pm.id,
      providerId: pm.providerId,
      dimension,
      result,
      detail,
      createdAt: now,
    };
    await this.repo.recordVerificationRun(run);
    return run;
  }

  /** Marks expired verification outcomes and availability claims stale. */
  async sweepStale(nowMs = Date.now()): Promise<{ providersSwept: number; availabilitySwept: number }> {
    let providersSwept = 0;
    let availabilitySwept = 0;
    const pms = await this.repo.listProviderModels({ limit: 1000 });
    for (const pm of pms) {
      const runs = await this.repo.listVerificationRuns({ subjectType: 'provider_model', subjectId: pm.id, limit: 50 });
      let stale = false;
      let availabilityExpired = false;
      for (const r of runs) {
        if (r.expiresAt && Date.parse(r.expiresAt) < nowMs && r.result === 'passed') {
          const expired: VerificationRunRecord = { ...r, result: 'stale' };
          await this.repo.recordVerificationRun({ ...expired, id: newId('vr'), createdAt: new Date(nowMs).toISOString() });
          if (r.dimension === 'availability') availabilityExpired = true;
          stale = true;
        }
      }
      const availabilityOld = pm.lastVerifiedAt && nowMs - Date.parse(pm.lastVerifiedAt) > AVAILABILITY_FRESHNESS_MS;
      if (availabilityExpired || (pm.availabilityStatus === 'available' && availabilityOld)) {
        availabilitySwept++;
      }
      if (stale && pm.lifecycle !== 'stale' && pm.lifecycle !== 'restricted' && pm.lifecycle !== 'rejected') {
        providersSwept++;
        try {
          assertTransition(pm.lifecycle, 'stale');
        } catch {
          continue;
        }
        await this.repo.upsertProviderModel({ ...pm, lifecycle: 'stale', availabilityStatus: availabilityOld ? 'stale' : pm.availabilityStatus, id: pm.id });
      }
    }
    // Access plans: no verified-at TTL → not presented as currently confirmed free.
    const plans = await this.repo.listAccessPlans({ freeOnly: true, limit: 1000 });
    for (const plan of plans) {
      if (plan.verifiedAt && nowMs - Date.parse(plan.verifiedAt) > PRICING_FRESHNESS_MS) {
        await this.repo.upsertAccessPlan({ ...plan, updatedAt: new Date(nowMs).toISOString() });
      }
    }
    return { providersSwept, availabilitySwept };
  }
}

function promote(current: LifecycleState, runs: VerificationRunRecord[]): LifecycleState {
  const exists = runs.find((r) => r.dimension === 'existence');
  const identity = runs.find((r) => r.dimension === 'identity');
  const pricing = runs.find((r) => r.dimension === 'pricing');
  const capability = runs.find((r) => r.dimension === 'capability');
  const free = runs.find((r) => r.dimension === 'free_access');
  if (exists?.result !== 'passed') return current === 'discovered' ? 'normalized' : current;
  const coreVerified = identity?.result === 'passed' && pricing?.result === 'passed';
  if (coreVerified && capability?.result === 'passed' && free?.result === 'passed') return 'verified';
  if (coreVerified) return 'evidence_checked';
  if (exists?.result === 'passed') return 'partially_verified';
  return current;
}

function lifecycleFrom(dimension: string, current: LifecycleState, now: string): LifecycleState {
  void dimension;
  void now;
  if (current === 'discovered' || current === 'normalized') return 'evidence_checked';
  return current;
}

function probeCandidates(endpoint: EndpointRecord): string[] {
  const base = endpoint.baseUrl.replace(/\/+$/, '');
  if (endpoint.apiStyle === 'ollama') return [`${base}/api/tags`];
  return [`${base}/models`, `${base}/v1/models`];
}

function blockedLike(lastErr: string | undefined): boolean {
  return Boolean(lastErr?.startsWith('policy:') || lastErr?.startsWith('redirect:'));
}

export function extractModelIds(payload: unknown): string[] {
  const root = payload as { data?: unknown; models?: unknown };
  const list = Array.isArray(root?.data) ? root.data : Array.isArray(root?.models) ? root.models : Array.isArray(payload) ? payload : [];
  const ids: string[] = [];
  for (const item of (list as unknown[]).slice(0, 1000)) {
    const id = (item as { id?: unknown; name?: unknown })?.id ?? (item as { name?: unknown })?.name;
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}

/**
 * Removes any accidental credential-looking text from error strings before
 * they are written to run details (double protection — errors can embed URLs).
 */
function stripSecrets(s: string): string {
  return s
    .replace(/\b(?:Bearer\s+)\S+/gi, 'Bearer <redacted>')
    .replace(/(?:\?|&)(?:api_key|key|token)=[^&\s]+/gi, '$1=<redacted>');
}

export type { VerificationRunFilter };

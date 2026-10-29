/**
 * OpenRouter model catalog connector (Priority 1, blueprint §3).
 *
 * Source: https://openrouter.ai/api/v1/models — documented, unauthenticated.
 * Claims extracted: model ids, context length, published pricing (per token →
 * normalized per-1M), input/output modalities, documented parameter support
 * (tools / structured outputs). Pricing is NEVER inferred when absent.
 */

import type {
  ClaimedCapabilities,
  ClaimedPricing,
  ConnectorCheckpoint,
  DiscoveryBatch,
  DiscoveryConnector,
  ModelCandidate,
  NormalizedCandidate,
  ProviderCandidate,
  RawDiscoveryRecord,
} from '../types.js';

import { BaseConnector, makeEgress, safeParseJson, type ConnectorContext } from './base.js';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const LANDING_PAGE = 'https://openrouter.ai/docs/api-reference/list-available-models';
const MAX_RECORDS = 400;

interface OpenRouterModelPayload {
  id?: string;
  canonical_slug?: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
    web_search?: string;
    internal_reasoning?: string;
  };
  top_provider?: { context_length?: number; max_completion_tokens?: number };
  supported_parameters?: string[];
}

export class OpenRouterConnector extends BaseConnector implements DiscoveryConnector {
  readonly id = 'openrouter';
  readonly version = '1.0.0';
  readonly authority = 0.9;
  readonly description = 'OpenRouter documented model catalog: ids, context, published pricing, parameter support.';

  // The full catalog is a single unpaginated multi-MB JSON document — the
  // response-size limit (§5) must be sized above the real payload or every
  // run dies on a truncated body. 16 MB stays bounded while tolerating real
  // catalog sizes.
  constructor(ctx: ConnectorContext = makeEgress({ maxRedirects: 0, maxResponseBytes: 16 * 1024 * 1024, timeoutMs: 30_000 }, 6, 1_200)) {
    super({ ...ctx, sourceUrl: ctx.sourceUrl || MODELS_URL });
  }

  async fetchPage(_cursor?: ConnectorCheckpoint): Promise<DiscoveryBatch> {
    await this.ctx.rateLimiter.acquire();
    const res = await this.ctx.egress.fetchText(MODELS_URL);
    const parsed = safeParseJson(res.body);
    if (!res.ok || parsed.ok !== 1) {
      throw new Error(`openrouter catalog fetch failed: HTTP ${res.status ?? 'n/a'} ${res.error ?? ''}`);
    }
    const root = parsed.value as { data?: unknown };
    const rows = Array.isArray(root?.data) ? (root!.data as OpenRouterModelPayload[]).slice(0, MAX_RECORDS) : [];
    return {
      connectorId: this.id,
      sourceUrl: MODELS_URL,
      records: rows.map((payload) => ({
        connectorId: this.id,
        sourceUrl: MODELS_URL,
        observedAt: new Date().toISOString(),
        payload,
      })),
      checkpoint: {
        updatedAt: new Date().toISOString(),
        meta: { catalog: 'openrouter', landingPage: LANDING_PAGE },
      },
      exhausted: true,
    };
  }

  async normalize(record: RawDiscoveryRecord): Promise<NormalizedCandidate[]> {
    const payload = record.payload as OpenRouterModelPayload;
    const fullId = String(payload.id ?? '').trim();
    if (!fullId || !fullId.includes('/')) return [];

    const [vendorSlug, rest] = splitModelId(fullId);
    const baseModelId = rest;
    const observedAt = record.observedAt;

    // Provider identity claim for the upstream vendor (unverified until
    // corroborated: OpenRouter documents the vendor, not the vendor itself).
    const providerCandidate: ProviderCandidate = {
      providerId: vendorSlug,
      displayName: vendorSlug,
      providerKind: 'upstream-vendor',
    };

    const pricing: ClaimedPricing | undefined = normalizePricing(payload.pricing, fullId);
    const capabilities = normalizeCapabilities(payload);

    const modelCandidate: ModelCandidate = {
      providerId: vendorSlug,
      providerModelId: baseModelId,
      displayName: typeof payload.name === 'string' ? payload.name : undefined,
      family: familyOf(baseModelId),
      contextWindow: typeof payload.context_length === 'number' && payload.context_length > 0 ? payload.context_length : undefined,
      capabilities,
      pricing,
      servingKind: 'hosted-api',
      metadata: {
        aggregator: 'openrouter',
        openrouterFullId: fullId,
        supportedParameters: Array.isArray(payload.supported_parameters) ? payload.supported_parameters.slice(0, 30) : [],
      },
    };

    const candidates: NormalizedCandidate[] = [
      { kind: 'provider', candidate: providerCandidate },
      { kind: 'model', candidate: modelCandidate },
      { kind: 'provider', candidate: aggregatorProvider() },
    ];

    if (pricing?.explicitlyFree) {
      candidates.push({
        kind: 'access_plan',
        candidate: {
          providerId: vendorSlug,
          providerModelId: baseModelId,
          planType: 'free',
          pricing,
          billingConditions: 'Published zero pricing in the OpenRouter catalog (provider-published claim).',
          sourceUrl: MODELS_URL,
          observedAt,
        },
      });
    }
    return candidates;
  }
}

/** The aggregator itself — endpoint + identity evidence comes from its API. */
export function aggregatorProvider(): ProviderCandidate {
  return {
    providerId: 'openrouter',
    displayName: 'OpenRouter',
    canonicalDomain: 'openrouter.ai',
    officialDocsUrl: 'https://openrouter.ai/docs',
    providerKind: 'aggregator',
  };
}

export function splitModelId(fullId: string): [string, string] {
  const slash = fullId.indexOf('/');
  if (slash <= 0) return [fullId, fullId];
  return [fullId.slice(0, slash), fullId.slice(slash + 1)];
}

/** OpenRouter documents per-token pricing strings; normalize to per-1M. */
export function normalizePricing(p: OpenRouterModelPayload['pricing'], fullId: string | undefined): ClaimedPricing | undefined {
  if (!p) return undefined;
  const prompt = toNumber(p.prompt);
  const completion = toNumber(p.completion);
  const bothZero = prompt === 0 && completion === 0;
  // Free alias detection REMAINS provider-asserted only: OpenRouter marks free
  // models with explicit `:free` suffix AND zero published pricing.
  const quotaAlias = Boolean(fullId && fullId.endsWith(':free'));
  if (prompt === undefined && completion === undefined) return undefined;
  return {
    inputPer1M: prompt !== undefined ? prompt * 1_000_000 : undefined,
    outputPer1M: completion !== undefined ? completion * 1_000_000 : undefined,
    currency: 'USD',
    explicitlyFree: bothZero || quotaAlias,
    quotaLimited: quotaAlias,
  };
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function normalizeCapabilities(payload: OpenRouterModelPayload): ClaimedCapabilities {
  const caps: ClaimedCapabilities = {};
  const params = Array.isArray(payload.supported_parameters) ? payload.supported_parameters.map(String) : [];
  if (params.includes('tools') || params.includes('tool_choice')) caps.toolCalling = true;
  if (params.includes('structured_outputs') || params.includes('response_format')) caps.jsonMode = true;
  if (params.includes('reasoning') || params.includes('include_reasoning')) caps.reasoning = true;
  if (typeof payload.description === 'string' && payload.description.toLowerCase().includes('image input')) {
    caps.vision = true;
  }
  const inputMods = payload.architecture?.input_modalities ?? [];
  if (inputMods.includes('image')) caps.vision = true;
  const modality = payload.architecture?.modality ?? '';
  if (modality.includes('->text')) caps.streaming = params.includes('stream');
  return caps;
}

/** Very light family normalization: trailing size/date suffixes are preserved
 *  as metadata; canonical family = id minus trailing '-instruct'/'-chat' variants. */
export function familyOf(modelId: string): string {
  return modelId
    .replace(/:(?:free|extended)[0-9]*$/i, '')
    .replace(/-instruct(?:-\d+)?$/i, '')
    .replace(/-chat$/i, '');
}

export default OpenRouterConnector as unknown as new (ctx?: ConnectorContext) => DiscoveryConnector;

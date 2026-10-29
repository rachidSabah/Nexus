/**
 * Hugging Face Hub connector (Priority 1, blueprint §3).
 *
 * Source: https://huggingface.co/api/models — documented public Hub API.
 * Extracts open model families, task tags and (via the documented
 * `expand[]=inferenceProviderMapping` parameter) discovered serving mappings.
 *
 * Blueprint distinction preserved: Hub entries are model WEIGHTS; a serving
 * provider mapping is recorded with `servingKind: 'hosted-api'` ONLY when the
 * payload actually contains the mapping. Weight-only records are recorded as
 * `servingKind: 'weights'` — never claimed as an accessible API.
 * No pricing information is published by the Hub, so none is claimed.
 */

import type {
  ConnectorCheckpoint,
  DiscoveryBatch,
  DiscoveryConnector,
  ModelCandidate,
  NormalizedCandidate,
  ProviderCandidate,
  RawDiscoveryRecord,
} from '../types.js';

import { BaseConnector, makeEgress, safeParseJson, type ConnectorContext } from './base.js';

const PAGE_SIZE = 100;
const HUB_URL = 'https://huggingface.co/api/models';

interface HubModelPayload {
  id?: string;
  pipeline_tag?: string;
  library_name?: string;
  tags?: string[];
  downloads?: number;
  likes?: number;
  created_at?: string;
  inferenceProviderMapping?: string;
}

export class HuggingFaceConnector extends BaseConnector implements DiscoveryConnector {
  readonly id = 'huggingface';
  readonly version = '1.0.0';
  readonly authority = 0.85;
  readonly description = 'Hugging Face Hub: open weights, sub model id, family, and serving-provider mapping when documented.';

  constructor(ctx: ConnectorContext = makeEgress(undefined, 4, 1_500)) {
    super({ ...ctx, sourceUrl: ctx.sourceUrl || HUB_URL });
  }

  async fetchPage(cursor?: ConnectorCheckpoint): Promise<DiscoveryBatch> {
    const skipBase = Number(cursor?.cursor ?? 0);
    const skip = Number.isFinite(skipBase) ? Math.max(0, Math.floor(skipBase)) : 0;
    await this.ctx.rateLimiter.acquire();
    const url = `${HUB_URL}?limit=${PAGE_SIZE}&skip=${skip}&sort=downloads&direction=-1&expand[]=inferenceProviderMapping`;
    const res = await this.ctx.egress.fetchText(url);
    const parsed = safeParseJson(res.body);
    if (!res.ok || parsed.ok !== 1) {
      throw new Error(`huggingface hub fetch failed: HTTP ${res.status ?? 'n/a'} ${res.error ?? ''}`);
    }
    const rows = Array.isArray(parsed.value) ? (parsed.value as HubModelPayload[]) : [];
    const exhausted = rows.length < PAGE_SIZE;
    return {
      connectorId: this.id,
      sourceUrl: HUB_URL,
      records: rows.map((payload) => ({
        connectorId: this.id,
        sourceUrl: url,
        observedAt: new Date().toISOString(),
        payload,
      })),
      checkpoint: {
        cursor: String(exhausted ? 0 : skip + rows.length),
        updatedAt: new Date().toISOString(),
        meta: { sort: 'downloads', pageSize: String(PAGE_SIZE) },
      },
      exhausted,
    };
  }

  async normalize(record: RawDiscoveryRecord): Promise<NormalizedCandidate[]> {
    const payload = record.payload as HubModelPayload;
    const hubId = String(payload.id ?? '').trim();
    if (!hubId || !hubId.includes('/')) return [];
    const [orgSlug, modelName] = splitHubId(hubId);
    const candidates: NormalizedCandidate[] = [];

    // Org page is the closest documented identity address for an org.
    const providerCandidate: ProviderCandidate = {
      providerId: `hf:${orgSlug}`,
      displayName: orgSlug,
      canonicalDomain: 'huggingface.co',
      officialDocsUrl: `https://huggingface.co/${orgSlug}`,
      providerKind: 'model-org',
    };
    candidates.push({ kind: 'provider', candidate: providerCandidate });

    const hasServingMapping = typeof payload.inferenceProviderMapping === 'string' && payload.inferenceProviderMapping.length > 2;
    const modalities = inferModalities(payload.tags ?? [], payload.pipeline_tag);
    const modelCandidate: ModelCandidate = {
      providerId: `hf:${orgSlug}`,
      providerModelId: modelName,
      displayName: modelName,
      family: familyFromTags(payload.tags ?? [], payload.pipeline_tag),
      inputModalities: modalities.input,
      outputModalities: modalities.output,
      capabilities: modalities.capabilities,
      servingKind: hasServingMapping ? 'hosted-api' : 'weights',
      metadata: {
        hub: 'huggingface',
        hubUrl: `https://huggingface.co/${hubId}`,
        pipelineTag: payload.pipeline_tag,
        library: payload.library_name,
        downloads: typeof payload.downloads === 'number' ? payload.downloads : undefined,
        weightsOnly: !hasServingMapping,
      },
    };
    candidates.push({ kind: 'model', candidate: modelCandidate });
    return candidates;
  }
}

export function splitHubId(hubId: string): [string, string] {
  const slash = hubId.indexOf('/');
  if (slash <= 0) return [hubId, hubId];
  return [hubId.slice(0, slash), hubId.slice(slash + 1)];
}

export function inferModalities(
  tags: string[],
  pipelineTag?: string,
): { input: string[]; output: string[]; capabilities: ModelCandidate['capabilities'] } {
  const input: string[] = ['text'];
  const output: string[] = ['text'];
  const capabilities: ModelCandidate['capabilities'] = {};
  const all = [pipelineTag ?? '', ...tags.map((t) => String(t).toLowerCase())];
  if (all.some((t) => t.includes('image') || t.includes('vision') || t.includes('multimodal') || t.includes('img'))) {
    input.push('image');
    capabilities.vision = true;
  }
  if (all.some((t) => t.includes('audio') || t.includes('speech'))) {
    if (pipelineTag?.includes('speech-to-text') || pipelineTag?.includes('asr')) input.push('audio');
    else output.push('audio');
    capabilities.embeddings = pipelineTag?.includes('audio') ?? false;
  }
  if (all.some((t) => t.includes('video'))) input.push('video');
  if (pipelineTag && (pipelineTag.includes('embed') || (pipelineTag as string).includes('feature-extraction'))) {
    capabilities.embeddings = true;
  }
  return { input, output, capabilities };
}

export function familyFromTags(tags: string[], pipelineTag?: string): string {
  const libraryTag = tags.find((t) => String(t).startsWith('library:'));
  const family = libraryTag ? String(libraryTag).slice('library:'.length) : 'unknown';
  return pipelineTag ? `${family}/${pipelineTag}` : family;
}

export default HuggingFaceConnector;

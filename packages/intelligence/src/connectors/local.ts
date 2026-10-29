/**
 * Local self-hosted model ecosystem connector (blueprint §3).
 *
 * Detects locally running serving runtimes — Ollama / LM Studio / vLLM — over
 * loopback only, via the SafeEgress loopback policy (no remote probes, no
 * arbitrary hosts, no SSRF surface). Serving data here is direct evidence
 * from the operator's own machine: models ARE hosted locally.
 *
 * Distinguishes downloadable weights (Hub) from locally accessible APIs.
 */

import type {
  ConnectorCheckpoint,
  DiscoveryBatch,
  DiscoveryConnector,
  ClaimedPricing,
  ModelCandidate,
  NormalizedCandidate,
  ProviderCandidate,
  RawDiscoveryRecord,
} from '../types.js';

import { BaseConnector, makeEgress, safeParseJson, type ConnectorContext } from './base.js';

interface LocalRuntimes {
  id: string;
  displayName: string;
  baseUrl: string;
  modelsPath: string;
  extract: (body: unknown) => Array<{ id: string; metadata: Record<string, unknown> }>;
}

export const LOCAL_RUNTIMES: LocalRuntimes[] = [
  {
    id: 'ollama',
    displayName: 'Ollama (local)',
    baseUrl: 'http://127.0.0.1:11434',
    modelsPath: '/api/tags',
    extract: (body) => {
      const models = (body as { models?: unknown })?.models;
      if (!Array.isArray(models)) return [];
      return models
        .slice(0, 300)
        .map((m) => {
          const row = m as { name?: string; model?: string; size?: number; details?: Record<string, unknown> };
          const id = String(row.name ?? row.model ?? '');
          return { id, metadata: { size: row.size, ...row.details } };
        })
        .filter((m) => m.id);
    },
  },
  {
    id: 'lmstudio',
    displayName: 'LM Studio (local)',
    baseUrl: 'http://127.0.0.1:1234',
    modelsPath: '/v1/models',
    extract: (body) => {
      const data = (body as { data?: unknown })?.data;
      if (!Array.isArray(data)) return [];
      return data
        .slice(0, 300)
        .map((m) => {
          const id = String((m as { id?: string }).id ?? '');
          return { id, metadata: {} as Record<string, unknown> };
        })
        .filter((m) => m.id);
    },
  },
  {
    id: 'vllm',
    displayName: 'vLLM (local)',
    baseUrl: 'http://127.0.0.1:8000',
    modelsPath: '/v1/models',
    extract: (body) => {
      const data = (body as { data?: unknown })?.data;
      if (!Array.isArray(data)) return [];
      return data
        .slice(0, 300)
        .map((m) => {
          const id = String((m as { id?: string }).id ?? '');
          return { id, metadata: {} as Record<string, unknown> };
        })
        .filter((m) => m.id);
    },
  },
];

export class LocalServersConnector extends BaseConnector implements DiscoveryConnector {
  readonly id = 'local-servers';
  readonly version = '1.0.0';
  readonly authority = 1.0;
  readonly description = 'Loopback-local model runtimes (Ollama/LM Studio/vLLM): direct local evidence.';

  constructor(ctx?: ConnectorContext) {
    const loopback = ctx ?? makeEgressPartial();
    super({ ...loopback, sourceUrl: loopback.sourceUrl || LOCAL_RUNTIMES[0]!.baseUrl });
  }

  async fetchPage(_cursor?: ConnectorCheckpoint): Promise<DiscoveryBatch> {
    const records: RawDiscoveryRecord[] = [];
    const observedAt = new Date().toISOString();
    for (const runtime of LOCAL_RUNTIMES) {
      await this.ctx.rateLimiter.acquire();
      const res = await this.ctx.egress.fetchText(`${runtime.baseUrl}${runtime.modelsPath}`, { maxRedirects: 0 });
      const parsed = safeParseJson(res.body);
      if (!res.ok || parsed.ok !== 1) continue;
      for (const entry of runtime.extract(parsed.value)) {
        records.push({
          connectorId: this.id,
          sourceUrl: `${runtime.baseUrl}${runtime.modelsPath}`,
          observedAt,
          payload: { runtime: runtime.id, ...entry },
        });
      }
    }
    return {
      connectorId: this.id,
      sourceUrl: LOCAL_RUNTIMES.map((r) => `${r.baseUrl}${r.modelsPath}`).join(' '),
      records,
      checkpoint: { updatedAt: observedAt },
      exhausted: true,
    };
  }

  async normalize(record: RawDiscoveryRecord): Promise<NormalizedCandidate[]> {
    const payload = record.payload as { runtime?: string; id?: string; size?: unknown };
    const runtimeId = String(payload.runtime ?? '');
    const modelLocalId = String(payload.id ?? '').trim();
    if (!runtimeId || !modelLocalId) return [];
    const runtime = LOCAL_RUNTIMES.find((r) => r.id === runtimeId);
    if (!runtime) return [];

    const providerCandidate: ProviderCandidate = {
      providerId: runtimeId,
      displayName: runtime.displayName,
      canonicalDomain: '127.0.0.1',
      officialDocsUrl: `${runtime.baseUrl}`,
      providerKind: 'local-runtime',
    };
    const pricing: ClaimedPricing = { inputPer1M: 0, outputPer1M: 0, currency: 'USD', explicitlyFree: true };
    const modelCandidate: ModelCandidate = {
      providerId: runtimeId,
      providerModelId: modelLocalId,
      displayName: modelLocalId,
      servingKind: 'local-runtime',
      pricing,
      metadata: { runtime: runtimeId, endpoint: runtime.baseUrl },
    };
    const planCandidate = {
      providerId: runtimeId,
      providerModelId: modelLocalId,
      planType: 'free' as const,
      pricing,
      billingConditions: 'Self-hosted local runtime; no per-token billing observed on the local API.',
      sourceUrl: `${runtime.baseUrl}${runtime.modelsPath}`,
      observedAt: record.observedAt,
    };
    return [
      { kind: 'provider', candidate: providerCandidate },
      { kind: 'model', candidate: modelCandidate },
      { kind: 'access_plan', candidate: planCandidate },
    ];
  }
}

function makeEgressPartial(): ConnectorContext {
  // Loopback-only policy: no remote DNS, no redirects, short timeout.
  return makeEgress(
    { allowLoopback: true, allowRemoteHttps: false, timeoutMs: 1_500, maxRedirects: 0 },
    6,
    250,
  );
}

export default LocalServersConnector;

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  NEXUS_CORE_MODELS,
  DeepSeekHarnessIntegration,
  generateHarnessSettingsYaml,
  resolveHarnessModels,
} from '../src/adapters/deepseek-harness.js';
import type { IntegrationContext } from '../src/contract.js';

function makeCtx(gatewayUrl: string): IntegrationContext {
  return {
    gatewayUrl,
    apiKey: 'nexus',
    defaultModel: 'nexus/auto',
  };
}

describe('DeepSeek Harness live model discovery (Nexus /v1/models)', () => {
  let server: Server;
  let baseUrl: string;
  let servedPayload: unknown;
  let requestCount: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      requestCount++;
      if (req.url?.startsWith('/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(servedPayload));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    servedPayload = { data: [] };
    requestCount = 0;
  });

  it('always includes the built-in nexus/* virtual routing aliases', async () => {
    const models = await resolveHarnessModels(makeCtx(baseUrl));
    for (const core of NEXUS_CORE_MODELS) {
      expect(models.some((m) => m.id === core.id)).toBe(true);
    }
  });

  it('merges live models fetched from the Nexus gateway /v1/models endpoint', async () => {
    servedPayload = {
      data: [
        { id: 'deepseek-v4-pro', owned_by: 'deepseek', context_window: 128000 },
        { id: 'deepseek-v4-flash', owned_by: 'deepseek' },
        { id: 'qwen3-coder-plus', owned_by: 'dashscope', capabilities: { vision: true } },
      ],
    };
    const models = await resolveHarnessModels(makeCtx(baseUrl));
    const ids = models.map((m) => m.id);

    expect(ids).toContain('deepseek-v4-pro');
    expect(ids).toContain('deepseek-v4-flash');
    expect(ids).toContain('qwen3-coder-plus');
    // live fetch actually happened against the gateway
    expect(requestCount).toBeGreaterThan(0);

    const pro = models.find((m) => m.id === 'deepseek-v4-pro');
    expect(pro?.contextWindow).toBe(128000);
    const qwen = models.find((m) => m.id === 'qwen3-coder-plus');
    expect(qwen?.inputModalities).toEqual(['text', 'image']);
    // no duplicates between core aliases and live catalog
    expect(ids.filter((id) => id === 'nexus/auto').length).toBe(1);
  });

  it('falls back to the core alias set when the gateway is unreachable (non-fatal)', async () => {
    // port 1 is reserved and refuses connections
    const models = await resolveHarnessModels(makeCtx('http://127.0.0.1:1'));
    expect(models.length).toBeGreaterThanOrEqual(NEXUS_CORE_MODELS.length);
    expect(models.some((m) => m.id === 'nexus/auto')).toBe(true);
  });

  it('generates settings.yaml from the live catalog, not a hardcoded model list', async () => {
    servedPayload = {
      data: [{ id: 'deepseek-v4-pro', owned_by: 'deepseek', context_window: 128000 }],
    };
    const yaml = await generateHarnessSettingsYaml(makeCtx(baseUrl));
    expect(yaml).toContain('baseURL: "http://127.0.0.1');
    expect(yaml).toContain('/v1"');
    expect(yaml).toContain('id: "deepseek-v4-pro"');
    expect(yaml).toContain('contextWindow: 128000');
    expect(yaml).toContain('model: "nexus/auto"');
  });

  it('launch spec targets the gateway and pins the dsh web UI port', async () => {
    const adapter = new DeepSeekHarnessIntegration();
    const spec = await adapter.getLaunchSpec(makeCtx(baseUrl));
    // binary resolution depends on the environment; on machines without dsh
    // the adapter must still be constructible and return null spec safely.
    if (spec) {
      expect(spec.args).toContain('--port');
      expect(spec.env.OPENAI_BASE_URL).toBe(`${baseUrl}/v1`);
      expect(spec.webUrl).toBe('http://127.0.0.1:3080');
    }
  });
});

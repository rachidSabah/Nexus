import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GatewayRuntime } from '../src/runtime';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Phase 35 Gateway Phase Verification', () => {
  let runtime: GatewayRuntime;
  const port = 19787;

  beforeAll(async () => {
    process.env['PORT'] = String(port);
    process.env['ANX_VAULT_PATH'] = join(tmpdir(), `test-p35-vault-${Date.now()}.json`);
    process.env['AGENT_NEXUS_VAULT_KEY'] = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();
  });

  afterAll(async () => {
    await runtime.stop();
  });

  it('serves MCP endpoints correctly', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/mcp/servers`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('servers');
    expect(Array.isArray(body.servers)).toBe(true);

    const toolsRes = await fetch(`http://127.0.0.1:${port}/v1/mcp/tools`);
    expect(toolsRes.status).toBe(200);
    const tools = await toolsRes.json();
    expect(tools).toHaveProperty('tools');

    const resRes = await fetch(`http://127.0.0.1:${port}/v1/mcp/resources`);
    expect(resRes.status).toBe(200);
    const resources = await resRes.json();
    expect(resources).toHaveProperty('resources');

    const promptRes = await fetch(`http://127.0.0.1:${port}/v1/mcp/prompts`);
    expect(promptRes.status).toBe(200);
    const prompts = await promptRes.json();
    expect(prompts).toHaveProperty('prompts');
  });

  it('serves Context Compression stats and preview endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/context/compression`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('enabled');
    expect(body).toHaveProperty('stats');
    expect(body).toHaveProperty('supportedStrategies');

    const previewRes = await fetch(`http://127.0.0.1:${port}/v1/context/compression/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are an AI assistant.' },
          { role: 'user', content: 'Hello, what is 2+2?' },
        ],
      }),
    });
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview).toHaveProperty('originalTokens');
    expect(preview).toHaveProperty('optimizedTokens');
    expect(preview).toHaveProperty('tokensSaved');
    expect(preview).toHaveProperty('compressionRatio');
    expect(preview).toHaveProperty('protectedSectionsPreserved', true);
  });

  it('serves Universal Provider Ecosystem and Dynamic Count endpoints', async () => {
    const ecoRes = await fetch(`http://127.0.0.1:${port}/v1/providers/ecosystem`);
    expect(ecoRes.status).toBe(200);
    const eco = await ecoRes.json();
    expect(eco).toHaveProperty('providers');
    expect(eco).toHaveProperty('totalProviders');

    const countsRes = await fetch(`http://127.0.0.1:${port}/v1/providers/counts`);
    expect(countsRes.status).toBe(200);
    const counts = await countsRes.json();
    expect(counts).toHaveProperty('totalProviders');
    expect(counts).toHaveProperty('healthyProviders');

    const freeRes = await fetch(`http://127.0.0.1:${port}/v1/providers/free`);
    expect(freeRes.status).toBe(200);
    const free = await freeRes.json();
    expect(free).toHaveProperty('count');
    expect(free).toHaveProperty('providers');
  });

  it('serves Universal Model Ecosystem and Dynamic Counts', async () => {
    const countsRes = await fetch(`http://127.0.0.1:${port}/v1/models/counts`);
    expect(countsRes.status).toBe(200);
    const counts = await countsRes.json();
    expect(counts).toHaveProperty('totalModels');
    expect(counts).toHaveProperty('healthyModels');
    expect(counts).toHaveProperty('freeModels');

    const freeRes = await fetch(`http://127.0.0.1:${port}/v1/models/free`);
    expect(freeRes.status).toBe(200);
    const free = await freeRes.json();
    expect(free).toHaveProperty('count');
    expect(free).toHaveProperty('models');

    const healthRes = await fetch(`http://127.0.0.1:${port}/v1/models/free/health`);
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json();
    expect(health).toHaveProperty('totalFreeModels');
    expect(health).toHaveProperty('healthyCount');
    expect(health).toHaveProperty('models');
  });

  it('supports GET and POST /v1/routing/explain with explainability', async () => {
    const getRes = await fetch(`http://127.0.0.1:${port}/v1/routing/explain?prompt=Write%20a%20python%20script`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody).toHaveProperty('intent');
    expect(getBody).toHaveProperty('selectedModel');
    expect(getBody).toHaveProperty('topCandidates');

    const postRes = await fetch(`http://127.0.0.1:${port}/v1/routing/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Debug this complex memory leak in C++',
      }),
    });
    expect(postRes.status).toBe(200);
    const postBody = await postRes.json();
    expect(postBody).toHaveProperty('intent');
    expect(postBody).toHaveProperty('selectedModel');
  });

  it('resolves dynamic free aliases successfully or reports proper status', async () => {
    const aliases = [
      'nexus/free',
      'nexus/free-coding',
      'nexus/free-reasoning',
      'nexus/free-vision',
      'nexus/free-fast',
      'nexus/free-long-context',
    ];
    for (const alias of aliases) {
      const res = await fetch(`http://127.0.0.1:${port}/v1/aliases/${encodeURIComponent(alias)}/resolve`);
      // It can either resolve (200) or report no candidates (404) if no free models discovered yet in test environment
      expect([200, 404]).toContain(res.status);
    }
  });
});

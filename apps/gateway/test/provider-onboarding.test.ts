import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { createServer } from 'http';

import { GatewayRuntime } from '../src/runtime.js';

describe('Universal Provider Fabric & Zero-Config Model Onboarding', () => {
  let runtime: GatewayRuntime;
  let mockProviderServer: ReturnType<typeof createServer>;
  const mockPort = 19988;

  beforeAll(async () => {
    // 1. Setup mock OpenAI-compatible provider
    mockProviderServer = createServer((req, res) => {
      if (req.url === '/v1/models' || req.url === '/models') {
        const auth = req.headers['authorization'];
        if (!auth || auth !== 'Bearer mock-test-key') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid API key', code: 401 } }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'mock-deepseek-v3', object: 'model', created: 1700000000, owned_by: 'mock' },
              { id: 'mock-deepseek-r1-reasoner', object: 'model', created: 1700000000, owned_by: 'mock' },
              { id: 'mock-vision-pro', object: 'model', created: 1700000000, owned_by: 'mock' },
            ],
          }),
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
    });

    await new Promise<void>((resolve) => mockProviderServer.listen(mockPort, resolve));

    // 2. Setup isolated GatewayRuntime
    process.env['ANX_VAULT_PATH'] = join(tmpdir(), 'anx-onboard-vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = 'anx-test-key-0123456789abcdef';
    process.env['PORT'] = '18789';
    rmSync(join(tmpdir(), 'anx-onboard-vault.json'), { force: true });
    rmSync(join(tmpdir(), 'anx-onboard-vault.key'), { force: true });

    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();
  });

  afterAll(async () => {
    await runtime.stop();
    await new Promise<void>((resolve) => mockProviderServer.close(() => resolve()));
  });

  it('probes a valid provider successfully and returns step-by-step verification', async () => {
    const res = await fetch('http://localhost:18789/v1/providers/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: `http://localhost:${mockPort}/v1`,
        apiKey: 'mock-test-key',
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.steps.gatewayReachable).toBe(true);
    expect(body.steps.authenticationSuccessful).toBe(true);
    expect(body.steps.modelsEndpointReachable).toBe(true);
    expect(body.steps.modelsDiscoveredCount).toBe(3);
    expect(body.modelsPreview.length).toBe(3);
  });

  it('fails probe on invalid credentials with step identification', async () => {
    const res = await fetch('http://localhost:18789/v1/providers/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: `http://localhost:${mockPort}/v1`,
        apiKey: 'wrong-key',
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.step).toBe('AUTHENTICATE');
    expect(body.error).toContain('401');
  });

  it('onboards provider, discovers models, and persists key in encrypted vault', async () => {
    const res = await fetch('http://localhost:18789/v1/providers/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'mock-ai',
        displayName: 'Mock AI Inference',
        baseUrl: `http://localhost:${mockPort}/v1`,
        apiKey: 'mock-test-key',
        priority: 90,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('READY');
    expect(body.providerId).toBe('mock-ai');
    expect(body.modelsDiscovered).toBe(3);

    // Verify provider appears in GET /v1/providers
    const provRes = await fetch('http://localhost:18789/v1/providers');
    expect(provRes.ok).toBe(true);
    const provs = (await provRes.json()) as Array<{ providerId: string; modelsCount: number; keysCount: number }>;
    const mockProv = provs.find((p) => p.providerId === 'mock-ai');
    expect(mockProv).toBeDefined();
    expect(mockProv?.modelsCount).toBe(3);
    expect(mockProv?.keysCount).toBe(1);
  });

  it('queries Model Explorer with capability and search filters', async () => {
    const res = await fetch('http://localhost:18789/v1/models/explore?provider=mock-ai');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.models.some((m: { id: string }) => m.id === 'mock-deepseek-v3')).toBe(true);

    // Search filter
    const searchRes = await fetch('http://localhost:18789/v1/models/explore?search=reasoner');
    const searchBody = await searchRes.json();
    expect(searchBody.models.length).toBe(1);
    expect(searchBody.models[0].id).toBe('mock-deepseek-r1-reasoner');
  });

  it('retrieves detailed model metadata with copy-paste agent snippets', async () => {
    const res = await fetch('http://localhost:18789/v1/models/mock-ai/mock-deepseek-v3');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.id).toBe('mock-deepseek-v3');
    expect(body.providerId).toBe('mock-ai');
    expect(body.agentSnippets).toBeDefined();
    expect(body.agentSnippets.claudeCode).toContain('nexus/mock-ai/mock-deepseek-v3');
    expect(body.agentSnippets.codexCli).toContain('nexus/mock-ai/mock-deepseek-v3');
    expect(body.agentSnippets.hermesCli).toContain('nexus/mock-ai/mock-deepseek-v3');
    expect(body.agentSnippets.agy).toContain('nexus/mock-ai/mock-deepseek-v3');
  });

  it('syncs on-demand and deletes provider cleanly with model sweeping', async () => {
    // 1. Sync
    const syncRes = await fetch('http://localhost:18789/v1/providers/mock-ai/sync', { method: 'POST' });
    expect(syncRes.ok).toBe(true);
    const syncBody = await syncRes.json();
    expect(syncBody.ok).toBe(true);
    expect(syncBody.discovered).toBe(3);

    // 2. Delete provider
    const delRes = await fetch('http://localhost:18789/v1/providers/mock-ai', { method: 'DELETE' });
    expect(delRes.ok).toBe(true);
    const delBody = await delRes.json();
    expect(delBody.ok).toBe(true);
    expect(delBody.modelsRemoved).toBe(3);

    // 3. Verify provider and models are swept
    const provRes = await fetch('http://localhost:18789/v1/providers');
    const provs = (await provRes.json()) as Array<{ providerId: string }>;
    expect(provs.some((p) => p.providerId === 'mock-ai')).toBe(false);

    const exploreRes = await fetch('http://localhost:18789/v1/models/explore?provider=mock-ai');
    const exploreBody = await exploreRes.json();
    expect(exploreBody.total).toBe(0);
  });
});

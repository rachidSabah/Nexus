import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';

import { GatewayRuntime } from '../src/runtime.js';

describe('GatewayRuntime integration', () => {
  let runtime: GatewayRuntime;

  beforeAll(async () => {
    // Isolate this suite from the real vault: never read/write the user's
    // live credentials (a stray persist() there wipes their API keys).
    delete process.env['OPENAI_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    process.env['ANX_VAULT_PATH'] = join(tmpdir(), 'anx-test-vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = 'anx-test-key-0123456789abcdef';
    process.env['ANX_CONFIG'] = '';
        // Isolated port: never collide with a live gateway (8787) and never
        // answer real agent traffic from a test instance.
        process.env['PORT'] = '18787';
        // Fresh temp vault every run: a stale file from a previous run carries
        // entries encrypted with a different per-run salt, which breaks decrypt.
        rmSync(join(tmpdir(), 'anx-test-vault.json'), { force: true });
        rmSync(join(tmpdir(), 'anx-test-vault.key'), { force: true });
    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();
  });

  afterAll(async () => {
    await runtime.stop();
  });

  it('exposes /health endpoint', async () => {
    const r = await fetch('http://localhost:18787/health');
    expect(r.ok).toBe(true);
    const body = await r.json();
    expect(body['version']).toBe('0.5.0');
    expect(body['status']).toBeDefined();
  });

  it('exposes /v1/models endpoint', async () => {
    const r = await fetch('http://localhost:18787/v1/models');
    expect(r.ok).toBe(true);
    const body = await r.json();
    expect(body['object']).toBe('list');
    expect(Array.isArray(body['data'])).toBe(true);
  });

  it('exposes /v1/providers endpoint', async () => {
    const r = await fetch('http://localhost:18787/v1/providers');
    expect(r.ok).toBe(true);
    const body = (await r.json()) as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
  });

  it('exposes /metrics endpoint in Prometheus format', async () => {
    const r = await fetch('http://localhost:18787/metrics');
    expect(r.ok).toBe(true);
    expect(r.headers.get('content-type')).toContain('text/plain');
  });

  it('redirects / (root) to the dashboard UI', async () => {
    const r = await fetch('http://localhost:18787/', { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/dashboard');
  });

  it('returns 400 for malformed /v1/chat/completions request', async () => {
    const r = await fetch('http://localhost:18787/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it('returns 503 for chat with no eligible provider', async () => {
    const r = await fetch('http://localhost:18787/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nonexistent-model-zzz',
        messages: [{ role: 'user', content: 'hi' }],
        routing: { preferredProviders: ['does-not-exist'] },
      }),
    });
    expect(r.status).toBe(503);
  });

  it('handles MCP initialize request', async () => {
    const r = await fetch('http://localhost:18787/v1/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      }),
    });
    expect(r.ok).toBe(true);
    const body = await r.json();
    expect(body['result']['serverInfo']['name']).toBe('agent-nexus-gateway');
  });

  it('handles MCP tools/list request', async () => {
    const r = await fetch('http://localhost:18787/v1/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }),
    });
    expect(r.ok).toBe(true);
    const body = await r.json();
    expect(Array.isArray(body['result']['tools'])).toBe(true);
    expect(body['result']['tools'].length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { GatewayRuntime } from '../src/runtime.js';

describe('GatewayRuntime integration', () => {
  let runtime: GatewayRuntime;

  beforeAll(async () => {
    process.env['ANX_CONFIG'] = '';
    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();
  });

  afterAll(async () => {
    await runtime.stop();
  });

  it('exposes /health endpoint', async () => {
    const r = await fetch('http://localhost:8787/health');
    expect(r.ok).toBe(true);
    const body = await r.json();
    expect(body['version']).toBe('0.1.0');
    expect(body['status']).toBeDefined();
  });

  it('exposes /v1/models endpoint', async () => {
    const r = await fetch('http://localhost:8787/v1/models');
    expect(r.ok).toBe(true);
    const body = await r.json();
    expect(body['object']).toBe('list');
    expect(Array.isArray(body['data'])).toBe(true);
  });

  it('exposes /v1/providers endpoint', async () => {
    const r = await fetch('http://localhost:8787/v1/providers');
    expect(r.ok).toBe(true);
    const body = (await r.json()) as Array<{ id: string }>;
    expect(Array.isArray(body)).toBe(true);
  });

  it('exposes /metrics endpoint in Prometheus format', async () => {
    const r = await fetch('http://localhost:8787/metrics');
    expect(r.ok).toBe(true);
    expect(r.headers.get('content-type')).toContain('text/plain');
  });

  it('exposes / (root info) endpoint', async () => {
    const r = await fetch('http://localhost:8787/');
    expect(r.ok).toBe(true);
    const body = await r.json();
    expect(body['name']).toBe('Agent Nexus Gateway');
  });

  it('returns 400 for malformed /v1/chat/completions request', async () => {
    const r = await fetch('http://localhost:8787/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
  });

  it('returns 503 for chat with no eligible provider', async () => {
    const r = await fetch('http://localhost:8787/v1/chat/completions', {
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
    const r = await fetch('http://localhost:8787/v1/mcp', {
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
    const r = await fetch('http://localhost:8787/v1/mcp', {
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

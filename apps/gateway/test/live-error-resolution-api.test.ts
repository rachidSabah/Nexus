import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { createServer } from 'http';

import { GatewayRuntime } from '../src/runtime.js';

describe('Live Error Resolution Engine — Gateway API & End-to-End Recovery Flow', () => {
  let runtime: GatewayRuntime;
  let mockProviderServer: ReturnType<typeof createServer>;
  const mockPort = 19991;
  const gatewayPort = 18791;
  let validKey = 'sk-live-valid-1234';

  beforeAll(async () => {
    mockProviderServer = createServer((req, res) => {
      const auth = req.headers['authorization'];
      const isAuthorized = auth === `Bearer ${validKey}`;

      if (req.url === '/v1/models' || req.url === '/models') {
        if (!isAuthorized) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid API Key provided', code: 'invalid_api_key' } }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [
              { id: 'mock-model-a', object: 'model' },
              { id: 'mock-model-b', object: 'model' },
            ],
          }),
        );
        return;
      }

      if (req.url === '/v1/chat/completions') {
        if (!isAuthorized) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Unauthorized upstream request', code: 401 } }));
          return;
        }

        let bodyStr = '';
        req.on('data', (c) => { bodyStr += c; });
        req.on('end', () => {
          try {
            const body = JSON.parse(bodyStr || '{}');
            if (body.model === 'retired-model') {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'Model retired-model not found', code: 'model_not_found' } }));
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 'chatcmpl-test',
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: body.model || 'mock-model-a',
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: 'verification response' },
                    finish_reason: 'stop',
                  },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              }),
            );
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Bad request JSON' } }));
          }
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
    });

    await new Promise<void>((resolve) => mockProviderServer.listen(mockPort, resolve));

    process.env['ANX_VAULT_PATH'] = join(tmpdir(), 'anx-live-error-vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = 'anx-test-key-0123456789abcdef';
    process.env['PORT'] = String(gatewayPort);
    rmSync(join(tmpdir(), 'anx-live-error-vault.json'), { force: true });
    rmSync(join(tmpdir(), 'anx-live-error-vault.key'), { force: true });

    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();

    await fetch(`http://localhost:${gatewayPort}/v1/providers/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'mock-provider',
        displayName: 'Mock Provider E2E',
        baseUrl: `http://localhost:${mockPort}/v1`,
        apiKey: 'sk-invalid-bad-key',
      }),
    });
  });

  afterAll(async () => {
    await runtime.stop();
    await new Promise<void>((resolve) => mockProviderServer.close(() => resolve()));
  });

  it('1. Reports provider as degraded/circuit_open and creates diagnostic record when request fails', async () => {
    runtime.server.errorRegistry.recordError({
      providerId: 'mock-provider',
      keyId: 'mock-provider-primary',
      error: new Error('Invalid API Key provided: sk-invalid-bad-key'),
      status: 401,
    });
    const ep = runtime.server.deps.routing.listEndpoints().find((e) => e.providerId === 'mock-provider');
    if (ep) {
      runtime.server.deps.routing.updateEndpoint(ep.id, { health: 'circuit_open' });
    }

    const diagRes = await fetch(`http://localhost:${gatewayPort}/v1/providers/mock-provider/diagnostics`);
    expect(diagRes.ok).toBe(true);
    const diagData = await diagRes.json();

    expect(diagData.providerId).toBe('mock-provider');
    expect(diagData.activeErrorsCount).toBeGreaterThanOrEqual(1);
    expect(diagData.circuitBreakerState).toBe('open');
    expect(diagData.activeErrors[0].category).toBe('AUTHENTICATION_FAILURE');
    expect(diagData.activeErrors[0].authFailure).toBe(true);
    expect(JSON.stringify(diagData)).not.toContain('sk-invalid-bad-key');
  });

  it('2. Fails resolve attempt truthfully when no valid key is available', async () => {
    const resolveRes = await fetch(`http://localhost:${gatewayPort}/v1/providers/mock-provider/resolve`, {
      method: 'POST',
    });
    expect(resolveRes.ok).toBe(true);
    const report = await resolveRes.json();

    expect(report.resolved).toBe(false);
    expect(report.healthy).toBe(false);
    expect(report.verification).toBe('failed');
    expect(report.recommendation).toContain('Update invalid or expired API credentials');
  });

  it('3. Successfully resolves and recovers provider after registering valid reserve key', async () => {
    await fetch(`http://localhost:${gatewayPort}/v1/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'mock-key-valid',
        providerId: 'mock-provider',
        plaintext: validKey,
        label: 'Valid Reserve Key',
      }),
    });

    const resolveRes = await fetch(`http://localhost:${gatewayPort}/v1/providers/mock-provider/resolve`, {
      method: 'POST',
    });
    expect(resolveRes.ok).toBe(true);
    const report = await resolveRes.json();

    expect(report.resolved).toBe(true);
    expect(report.healthy).toBe(true);
    expect(report.verification).toBe('passed');
    expect(report.actionTaken).toBe('live_verification_recovery');

    const ep = runtime.server.deps.routing.listEndpoints().find((e) => e.providerId === 'mock-provider');
    expect(ep?.health).toBe('healthy');

    const errRes = await fetch(`http://localhost:${gatewayPort}/v1/errors?provider=mock-provider&resolved=false`);
    const errData = await errRes.json();
    expect(errData.errors.length).toBe(0);
  });

  it('4. Returns safe report when provider is resolved again', async () => {
    const resolveRes = await fetch(`http://localhost:${gatewayPort}/v1/providers/mock-provider/resolve`, {
      method: 'POST',
    });
    expect(resolveRes.ok).toBe(true);
    const report = await resolveRes.json();

    expect(report.resolved).toBe(true);
    expect(report.healthy).toBe(true);
    expect(report.verification).toBe('passed');
  });

  it('5. Resolves specific API key via POST /v1/keys/:id/resolve', async () => {
    const resolveRes = await fetch(`http://localhost:${gatewayPort}/v1/keys/mock-key-valid/resolve`, {
      method: 'POST',
    });
    expect(resolveRes.ok).toBe(true);
    const report = await resolveRes.json();

    expect(report.resolved).toBe(true);
    expect(report.healthy).toBe(true);
    expect(report.verification).toBe('passed');
    expect(report.actionTaken).toBe('key_verified_and_activated');
  });

  it('6. Resolves model via POST /v1/models/:providerId/:modelId/resolve', async () => {
    const resolveRes = await fetch(`http://localhost:${gatewayPort}/v1/models/mock-provider/mock-model-a/resolve`, {
      method: 'POST',
    });
    expect(resolveRes.ok).toBe(true);
    const report = await resolveRes.json();

    expect(report.resolved).toBe(true);
    expect(report.verification).toBe('passed');
    expect(report.actionTaken).toBe('model_verified_and_recovered');
  });
});

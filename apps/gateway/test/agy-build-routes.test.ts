import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { GatewayRuntime } from '../src/runtime.js';

describe('Phase 22: AGY Build Session & Health Routes', { timeout: 30000 }, () => {
  let runtime: GatewayRuntime;
  const PORT = 19797;

  beforeAll(async () => {
    process.env['ANX_VAULT_PATH'] = join(tmpdir(), 'anx-test-agy-vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = 'anx-test-key-0123456789abcdef';
    process.env['ANX_CONFIG'] = '';
    process.env['PORT'] = String(PORT);
    rmSync(join(tmpdir(), 'anx-test-agy-vault.json'), { force: true });
    rmSync(join(tmpdir(), 'anx-test-agy-vault.key'), { force: true });

    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();
  });

  afterAll(async () => {
    await runtime.stop();
  });

  it('GET /v1/agents/agy/health returns truthful AGY runtime diagnostic', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/v1/agents/agy/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('installed');
    expect(body).toHaveProperty('runtimeReady');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('activeBuilds');
  });

  it('manages application build lifecycle and build session endpoints', async () => {
    // 1. Create application
    const createRes = await fetch(`http://127.0.0.1:${PORT}/v1/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective: 'Build a high-performance caching proxy' }),
    });
    expect(createRes.ok).toBe(true);
    const createdApp = await createRes.json();
    const appId = createdApp.appId;

    // 2. Plan application
    const planRes = await fetch(`http://127.0.0.1:${PORT}/v1/applications/${appId}/plan`, {
      method: 'POST',
    });
    expect(planRes.ok).toBe(true);

    // 3. Build application (dryRun)
    const buildRes = await fetch(`http://127.0.0.1:${PORT}/v1/applications/${appId}/builds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(buildRes.ok).toBe(true);

    // 4. Pause application
    const pauseRes = await fetch(`http://127.0.0.1:${PORT}/v1/applications/${appId}/build/pause`, {
      method: 'POST',
    });
    expect(pauseRes.ok).toBe(true);

    // 5. Resume application (dryRun)
    const resumeRes = await fetch(`http://127.0.0.1:${PORT}/v1/applications/${appId}/build/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(resumeRes.ok).toBe(true);

    // 6. List builds
    const listRes = await fetch(`http://127.0.0.1:${PORT}/v1/applications/${appId}/builds`);
    expect(listRes.ok).toBe(true);
    const listBody = await listRes.json();
    expect(listBody.applicationId).toBe(appId);
    expect(Array.isArray(listBody.builds)).toBe(true);

    // 7. Cancel application
    const cancelRes = await fetch(`http://127.0.0.1:${PORT}/v1/applications/${appId}/build/cancel`, {
      method: 'POST',
    });
    expect(cancelRes.ok).toBe(true);
    const cancelledBody = await cancelRes.json();
    expect(cancelledBody.stage).toBe('FAILED');
  });
});

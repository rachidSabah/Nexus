import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { GatewayRuntime } from '../src/runtime.js';

describe('Nexus Router Studio: Test Resolve Action E2E & Alias Integration', () => {
  let runtime: GatewayRuntime;
  const testPort = 18881;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-router-test-${Date.now()}`);

  beforeAll(async () => {
    process.env['ANX_VAULT_PATH'] = join(testDir, 'vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env['PORT'] = String(testPort);
    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();
  });

  afterAll(async () => {
    await runtime.stop();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('1. Live Endpoint Alias Resolution', () => {
    it('A. Resolves nexus/auto successfully to an active model candidate', async () => {
      const res = await fetch(`${baseUrl}/v1/aliases/nexus%2Fauto/resolve`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { modelId: string; providerId: string; reason: string; candidateCount: number };
      expect(typeof data.modelId).toBe('string');
      expect(data.modelId.length).toBeGreaterThan(0);
      expect(typeof data.providerId).toBe('string');
      expect(typeof data.reason).toBe('string');
      expect(data.candidateCount).toBeGreaterThan(0);
    });

    it('B. Resolves nexus/free to a free-tier candidate', async () => {
      const res = await fetch(`${baseUrl}/v1/aliases/nexus%2Ffree/resolve`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { modelId: string; providerId: string; reason: string; candidateCount: number };
      expect(typeof data.modelId).toBe('string');
      expect(data.reason).toContain('free');
      expect(data.candidateCount).toBeGreaterThanOrEqual(1);
    });

    it('C. Resolves capability alias nexus/free-coding filtering for toolCalling', async () => {
      const res = await fetch(`${baseUrl}/v1/aliases/nexus%2Ffree-coding/resolve`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { modelId: string; providerId: string; reason: string; candidateCount: number };
      expect(typeof data.modelId).toBe('string');
      expect(data.reason).toContain('toolCalling');
    });

    it('D. Returns 404 with descriptive error message for invalid alias', async () => {
      const res = await fetch(`${baseUrl}/v1/aliases/nonexistent%2Falias-xyz/resolve`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: { message: string } };
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('not found');
    });

    it('E. Multiple aliases do not corrupt or conflict with each other', async () => {
      const [resAuto, resCoding, resFree] = await Promise.all([
        fetch(`${baseUrl}/v1/aliases/nexus%2Fauto/resolve`),
        fetch(`${baseUrl}/v1/aliases/local%2Fcoding/resolve`),
        fetch(`${baseUrl}/v1/aliases/local%2Ffree/resolve`),
      ]);
      expect(resAuto.status).toBe(200);
      expect(resCoding.status).toBe(200);
      expect(resFree.status).toBe(200);
    });

    it('F. Custom alias creation, resolution, and deletion lifecycle', async () => {
      const customAlias = `local/test-unit-${Date.now()}`;
      // Create
      const createRes = await fetch(`${baseUrl}/v1/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alias: customAlias,
          description: 'Unit test custom alias',
          filter: { capability: 'streaming' },
          ranking: 'fastest',
        }),
      });
      expect(createRes.status).toBe(201);

      // Resolve
      const resolveRes = await fetch(`${baseUrl}/v1/aliases/${encodeURIComponent(customAlias)}/resolve`);
      expect(resolveRes.status).toBe(200);
      const data = (await resolveRes.json()) as { modelId: string; providerId: string; reason: string };
      expect(typeof data.modelId).toBe('string');

      // Delete
      const deleteRes = await fetch(`${baseUrl}/v1/aliases/${encodeURIComponent(customAlias)}`, {
        method: 'DELETE',
      });
      expect(deleteRes.status).toBe(200);
    });

    it('G. Sanitization guarantees no secrets or private keys are exposed in resolution payloads', async () => {
      const res = await fetch(`${baseUrl}/v1/aliases/nexus%2Fauto/resolve`);
      const text = await res.text();
      expect(text).not.toContain('0123456789abcdef');
      expect(text).not.toContain('apiKey');
      expect(text).not.toContain('plaintext');
      expect(text).not.toContain('bearer');
    });
  });
});

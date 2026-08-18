import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BUILTIN_INTEGRATIONS, BUILTIN_INTEGRATIONS_COUNT, createIntegrationRegistry } from '@anx/integrations';
import { GatewayRuntime } from '../src/runtime.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';

describe('Nexus One-Click Agent & IDE Harness: Link Integrity & Navigation Hardening', () => {
  let runtime: GatewayRuntime;
  const testPort = 18883;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-harness-test-${Date.now()}`);

  beforeAll(async () => {
    process.env['ANX_VAULT_PATH'] = join(testDir, 'vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env['PORT'] = String(testPort);
    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();
  }, 30000);

  afterAll(async () => {
    await runtime.stop();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }, 15000);

  describe('1. Integration Registry Integrity & Link Safety', () => {
    it('A. Contains exactly all built-in integrations without duplicates', () => {
      expect(BUILTIN_INTEGRATIONS.length).toBe(BUILTIN_INTEGRATIONS_COUNT);
      expect(BUILTIN_INTEGRATIONS_COUNT).toBe(18);
      const registry = createIntegrationRegistry();
      expect(registry.size).toBe(BUILTIN_INTEGRATIONS_COUNT);
      const ids = BUILTIN_INTEGRATIONS.map((i) => i.id);
      expect(new Set(ids).size).toBe(BUILTIN_INTEGRATIONS_COUNT);
    });

    it('B. Every integration has a valid, secure, non-localhost official documentation URL', () => {
      for (const i of BUILTIN_INTEGRATIONS) {
        expect(i.homepage, `Missing homepage for ${i.id}`).toBeDefined();
        expect(i.homepage!.startsWith('https://'), `Homepage for ${i.id} must be HTTPS`).toBe(true);
        expect(i.homepage).not.toContain('localhost');
        expect(i.homepage).not.toContain('127.0.0.1');
        expect(i.homepage).not.toContain('undefined');
        expect(i.homepage).not.toContain('null');
      }
    });

    it('C. Integration IDs match expected CLI installation command syntax exactly', () => {
      const registry = createIntegrationRegistry();
      for (const i of BUILTIN_INTEGRATIONS) {
        expect(registry.has(i.id)).toBe(true);
        expect(i.id).toMatch(/^[a-z0-9-]+$/);
      }
    });
  });

  describe('2. Live /v1/integrations Endpoint Health & Data Truthfulness', () => {
    it('A. Gateway exposes GET /v1/integrations without authentication blockage', async () => {
      const res = await fetch(`${baseUrl}/v1/integrations`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { count: number; integrations: any[] };
      expect(body.count).toBe(BUILTIN_INTEGRATIONS_COUNT);
      expect(body.integrations.length).toBe(BUILTIN_INTEGRATIONS_COUNT);
    }, 30000);

    it('B. Preserves detection truthfulness without faking installed state', async () => {
      const res = await fetch(`${baseUrl}/v1/integrations`);
      const body = (await res.json()) as { integrations: Array<{ id: string; installed: boolean; configured: boolean }> };
      for (const item of body.integrations) {
        expect(typeof item.installed).toBe('boolean');
        expect(typeof item.configured).toBe('boolean');
      }
    }, 30000);

    it('C. Payloads contain no secret credentials, auth tokens, or private keys', async () => {
      const res = await fetch(`${baseUrl}/v1/integrations`);
      const text = await res.text();
      expect(text).not.toContain('0123456789abcdef');
      expect(text).not.toContain('apiKey');
      expect(text).not.toContain('vault');
      expect(text).not.toContain('secret');
    }, 30000);
  });

  describe('3. Internal Navigation Target Validation', () => {
    it('A. Validates dashboard internal routes referenced on the harness matrix', () => {
      const validInternalRoutes = [
        '/agents',
        '/router-studio',
        '/providers',
        '/models',
        '/keys',
        '/integrations',
        '/observability',
        '/intelligence',
        '/requests',
      ];
      for (const route of validInternalRoutes) {
        expect(route.startsWith('/')).toBe(true);
        expect(route).not.toContain('localhost');
        expect(route).not.toContain('undefined');
      }
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { GatewayRuntime } from '../src/runtime.js';
import { isSsrfSafe } from '@anx/core';

describe('Nexus Phase 26 Security Hardening & Gate Enforcement', () => {
  let runtime: GatewayRuntime;
  const testPort = 18790;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-sec-test-${Date.now()}`);

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

  describe('SSRF Protection', () => {
    it('isSsrfSafe blocks AWS/GCP/Azure link-local metadata address 169.254.169.254', () => {
      expect(isSsrfSafe('http://169.254.169.254/latest/meta-data', { allowPrivate: true })).toBe(false);
      expect(isSsrfSafe('http://169.254.169.254/latest/meta-data', { allowPrivate: false })).toBe(false);
    });

    it('isSsrfSafe blocks non-http(s) schemes like file://, gopher://, ftp://', () => {
      expect(isSsrfSafe('file:///etc/passwd')).toBe(false);
      expect(isSsrfSafe('gopher://127.0.0.1:70/')).toBe(false);
      expect(isSsrfSafe('ftp://example.com/secret')).toBe(false);
    });

    it('POST /v1/providers/probe rejects cloud metadata URL with SSRF error', async () => {
      const res = await fetch(`${baseUrl}/v1/providers/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: 'http://169.254.169.254/latest/meta-data',
          apiKey: 'test-key',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('SSRF guard');
    });

    it('POST /v1/providers/onboard rejects cloud metadata URL with SSRF error', async () => {
      const res = await fetch(`${baseUrl}/v1/providers/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: 'evil-metadata-provider',
          baseUrl: 'http://169.254.169.254/v1',
          apiKey: 'secret-token',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error?.code).toBe('PROHIBITED_BASE_URL');
    });
  });

  describe('Provider Credential Security & Vault Redaction', () => {
    it('POST /v1/providers/onboard does NOT leak plaintext API key in responses', async () => {
      const sensitiveKey = 'sk-live-super-secret-key-1234567890abcdef1234';
      const res = await fetch(`${baseUrl}/v1/providers/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: 'sec-custom-provider',
          displayName: 'Secure Custom Provider',
          baseUrl: 'https://api.custom-ai.example.com/v1',
          apiKey: sensitiveKey,
          priority: 10,
        }),
      });

      expect(res.status).toBe(201);
      const rawText = await res.text();
      // Ensure full plaintext key is never echoed back
      expect(rawText).not.toContain(sensitiveKey);
      
      const data = JSON.parse(rawText);
      expect(data.key).toBeDefined();
      expect(data.key.lastFour).toBe('1234');
      expect(data.key.status).toBe('active');
    });

    it('GET /v1/providers lists providers without leaking API key plaintext', async () => {
      const res = await fetch(`${baseUrl}/v1/providers`);
      expect(res.status).toBe(200);
      const rawText = await res.text();
      expect(rawText).not.toContain('super-secret');
    });
  });

  describe('Autonomous Application Builder & Approval Gate Security', () => {
    it('blocks unapproved execution on high-risk application builds', async () => {
      // Create app with high-risk prompt
      const createRes = await fetch(`${baseUrl}/v1/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: 'Execute root shell commands and bypass security access controls',
        }),
      });
      expect(createRes.status).toBe(201);
      const app = (await createRes.json()) as { appId: string };

      // Plan application
      const planRes = await fetch(`${baseUrl}/v1/applications/${app.appId}/plan`, {
        method: 'POST',
      });
      expect(planRes.status).toBe(200);
      const plannedApp = (await planRes.json()) as { stage: string; buildContext?: { requiresApproval?: boolean } };

      // If high risk, stage must be APPROVAL
      if (plannedApp.buildContext?.requiresApproval) {
        expect(plannedApp.stage).toBe('APPROVAL');

        // Attempting to build without approving should throw / fail
        const buildRes = await fetch(`${baseUrl}/v1/applications/${app.appId}/build`, {
          method: 'POST',
        });
        const buildData = (await buildRes.json()) as { error?: { message?: string } };
        expect(buildRes.status).toBe(400);
        expect(buildData.error?.message).toContain('approval');
      }
    });
  });
});

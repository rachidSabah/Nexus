import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  SandboxedPluginRunner,
  VerifiablePluginSigner,
  PluginRuntime,
} from '../src/index.js';

describe('Plugins Sandboxing & Verification (v0.8.0)', () => {
  describe('SandboxedPluginRunner', () => {
    it('executes safe JavaScript code within isolated context', async () => {
      const runner = new SandboxedPluginRunner(1000);
      const code = `
        const transformed = data.prompt.toUpperCase();
        transformed + ' [PROCESSED]';
      `;

      const res = await runner.runInSandbox(code, {
        data: { prompt: 'hello agent' },
      });

      expect(res.success).toBe(true);
      expect(res.result).toBe('HELLO AGENT [PROCESSED]');
      expect(res.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('blocks access to dangerous host APIs (process, require, fs)', async () => {
      const runner = new SandboxedPluginRunner(1000);

      const resProcess = await runner.runInSandbox(`process.exit(1)`);
      expect(resProcess.success).toBe(false);
      expect(resProcess.error).toMatch(/process is not defined/);

      const resRequire = await runner.runInSandbox(`require('fs')`);
      expect(resRequire.success).toBe(false);
      expect(resRequire.error).toMatch(/require is not defined/);
    });

    it('enforces execution timeout', async () => {
      const runner = new SandboxedPluginRunner(50);
      const infiniteLoop = `while (true) {}`;

      const res = await runner.runInSandbox(infiniteLoop);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/timed out/i);
    });
  });

  describe('VerifiablePluginSigner', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    it('signs and verifies plugin manifest integrity', () => {
      const manifest = {
        id: 'anx-plugin-rate-limiter',
        name: 'Rate Limiter',
        version: '1.0.0',
        author: 'sec-ops@anx.dev',
        hooks: ['onRequest'],
        permissions: ['read_catalog'],
      };

      const signed = VerifiablePluginSigner.signManifest(manifest, privateKey);
      expect(signed.signature).toBeTruthy();
      expect(signed.algorithm).toBe('RSA-SHA256');

      const isValid = VerifiablePluginSigner.verifyManifest(signed, publicKey);
      expect(isValid).toBe(true);

      // Tampered manifest check
      const tampered = {
        ...signed,
        manifest: { ...signed.manifest, author: 'attacker@evil.com' },
      };
      const isTamperedValid = VerifiablePluginSigner.verifyManifest(tampered, publicKey);
      expect(isTamperedValid).toBe(false);
    });
  });
});

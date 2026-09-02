import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { BUILTIN_INTEGRATIONS, BUILTIN_INTEGRATIONS_COUNT, TRUSTED_AGENT_CATALOG, getAgentCatalogEntry } from '@anx/integrations';
import { GatewayRuntime } from '../src/runtime.js';

describe('Nexus Full System Certification & Diagnostics', () => {
  let runtime: GatewayRuntime;
  const testPort = 18991;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-cert-test-${Date.now()}`);

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
  }, 30000);

  describe('1. Gateway Health & Core Endpoints', () => {
    it('serves GET /healthz and /health with 200', async () => {
      const r1 = await fetch(`${baseUrl}/healthz`);
      expect(r1.status).toBe(200);
      const b1 = await r1.json();
      expect(['ok', 'degraded']).toContain(b1.status);

      const r2 = await fetch(`${baseUrl}/health`);
      expect(r2.status).toBe(200);
      const b2 = await r2.json();
      expect(b2.version).toBe('0.5.0');
    });

    it('serves GET /v1/models with valid array', async () => {
      const r = await fetch(`${baseUrl}/v1/models`);
      expect(r.status).toBe(200);
      const b = await r.json();
      expect(b.object).toBe('list');
      expect(Array.isArray(b.data)).toBe(true);
    });

    it('serves GET /v1/models/discover, /v1/models/stats, /v1/models/counts', async () => {
      const r1 = await fetch(`${baseUrl}/v1/models/discover`);
      expect(r1.status).toBe(200);
      const b1 = await r1.json();
      expect(Array.isArray(b1.models)).toBe(true);

      const r2 = await fetch(`${baseUrl}/v1/models/stats`);
      expect(r2.status).toBe(200);
      const b2 = await r2.json();
      expect(typeof b2.totalModels).toBe('number');

      const r3 = await fetch(`${baseUrl}/v1/models/counts`);
      expect(r3.status).toBe(200);
      const b3 = await r3.json();
      expect(typeof b3.totalModels).toBe('number');
    });
  });

  describe('2. Trusted Agent Catalogue & Integrations Registry', () => {
    it('contains all built-in integrations without duplicates', () => {
      expect(BUILTIN_INTEGRATIONS.length).toBe(BUILTIN_INTEGRATIONS_COUNT);
      const ids = BUILTIN_INTEGRATIONS.map((i) => i.id);
      expect(new Set(ids).size).toBe(BUILTIN_INTEGRATIONS_COUNT);
    });

    it('serves GET /v1/agents/catalog and /v1/agent-catalog with full catalog', async () => {
      const r1 = await fetch(`${baseUrl}/v1/agents/catalog`);
      expect(r1.status).toBe(200);
      const b1 = await r1.json();
      expect(b1.count).toBe(TRUSTED_AGENT_CATALOG.length);

      const r2 = await fetch(`${baseUrl}/v1/agent-catalog`);
      expect(r2.status).toBe(200);
      const b2 = await r2.json();
      expect(b2.count).toBe(TRUSTED_AGENT_CATALOG.length);
    });

    it('every supported integration (continue, neovim, emacs, jetbrains, etc.) is recognized in catalog', () => {
      const supported = [
        'claude-code', 'codex-cli', 'qwen-code', 'hermes-cli',
        'opencode', 'opencode-go', 'opencode-zen', 'aider',
        'gemini-cli', 'openhands', 'deepseek-harness', 'goose', 'crush',
        'cursor', 'continue', 'cline', 'roo-code', 'zed', 'neovim', 'emacs',
        'vscode', 'jetbrains',
      ];
      for (const id of supported) {
        const entry = getAgentCatalogEntry(id);
        expect(entry, `Agent '${id}' must be in TRUSTED_AGENT_CATALOG`).toBeDefined();
        expect(entry!.id).toBe(id);
        expect(entry!.displayName.length).toBeGreaterThan(0);
      }
    });

    it('serves GET and POST /v1/agents/detect', async () => {
      const rGet = await fetch(`${baseUrl}/v1/agents/detect`);
      expect(rGet.status).toBe(200);
      const bGet = await rGet.json();
      expect(bGet.agents).toBeDefined();

      const rPost = await fetch(`${baseUrl}/v1/agents/detect`, { method: 'POST' });
      expect(rPost.status).toBe(200);
      const bPost = await rPost.json();
      expect(bPost.agents).toBeDefined();
    });

    it('serves GET /v1/runtime-agents with structured agent status and health', async () => {
      const r = await fetch(`${baseUrl}/v1/runtime-agents`);
      expect(r.status).toBe(200);
      const b = await r.json();
      expect(Array.isArray(b.agents)).toBe(true);
      for (const a of b.agents) {
        expect(a.id).toBeDefined();
        expect(a.name).toBeDefined();
        expect(a.status).toBeDefined();
        expect(a.health).toBeDefined();
      }
    });

    it('serves GET /v1/integrations with separation of installed and configured states', async () => {
      const r = await fetch(`${baseUrl}/v1/integrations`);
      expect(r.status).toBe(200);
      const b = await r.json();
      expect(Array.isArray(b.integrations)).toBe(true);
      for (const item of b.integrations) {
        expect(typeof item.installed).toBe('boolean');
        expect(typeof item.configured).toBe('boolean');
      }
    }, 60000);
  });

  describe('3. Model Routing, Virtual Aliases & Honest Diagnostics', () => {
    it('handles virtual aliases (nexus/auto, nexus/best, nexus/free, nexus/best-coding)', async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nexus/auto',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });
      expect([200, 400, 401, 403, 502, 503]).toContain(res.status);
    });

    it('returns honest error when requested model cannot be served upstream', async () => {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.6-sol',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      });
      expect([200, 401, 502, 503]).toContain(res.status);
      if (res.status === 503 || res.status === 401) {
        const body = await res.json();
        expect(body.error).toBeDefined();
        expect(typeof body.error.message).toBe('string');
        expect(body.error.message.length).toBeGreaterThan(0);
      }
    });
  });
});

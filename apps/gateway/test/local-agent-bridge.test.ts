import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { GatewayRuntime } from '../src/runtime.js';
import {
  LocalAgentBridge,
  ClaudeCodeAdapter,
  CodexAdapter,
  HermesAdapter,
  OpenCodeAdapter,
  AgyAdapter,
} from '@anx/core';

describe('Phase 27: Local Agent Bridge & Universal Runtime Connector', () => {
  let runtime: GatewayRuntime;
  const testPort = 18795;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-bridge-test-${Date.now()}`);

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

  describe('1. Adapter Capabilities & Extensibility', () => {
    it('defines capability contracts for all 5 supported agents', () => {
      const claude = new ClaudeCodeAdapter();
      const codex = new CodexAdapter();
      const hermes = new HermesAdapter();
      const opencode = new OpenCodeAdapter();
      const agy = new AgyAdapter();

      expect(claude.id).toBe('claude-code');
      expect(claude.getCapabilities().workspace).toBe(true);
      expect(claude.getCapabilities().modelSelection).toBe(true);

      expect(codex.id).toBe('codex-cli');
      expect(codex.getCapabilities().nonInteractive).toBe(true);

      expect(hermes.id).toBe('hermes-cli');
      expect(hermes.getCapabilities().streaming).toBe(true);

      expect(opencode.id).toBe('opencode');
      expect(opencode.getCapabilities().prompt).toBe(true);

      expect(agy.id).toBe('agy');
      expect(agy.getCapabilities().buildRuntime).toBe(true);
    });
  });

  describe('2. Environment Isolation & Secret Redaction', () => {
    it('prepareEnvironment strips private credentials and injects gateway endpoints', () => {
      const claude = new ClaudeCodeAdapter();
      const env = claude.prepareEnvironment(
        {
          id: 'claude-code',
          name: 'Claude Code',
          type: 'claude-code',
          status: 'READY',
          health: {
            level: 'READY',
            executableFound: true,
            configValid: true,
            gatewayReachable: true,
            executionVerified: true,
            lastChecked: Date.now(),
          },
          capabilities: claude.getCapabilities(),
          workspaceSupport: true,
          streamingSupport: true,
          supportsNonInteractive: true,
          supportsEnvironmentConfiguration: true,
          supportsModelConfiguration: true,
          platform: 'win32',
          detectedVia: 'path',
        },
        {
          gatewayUrl: 'http://127.0.0.1:8787',
          modelPolicy: 'nexus/best-coding',
          targetModel: 'mistral-small-latest',
          customEnv: {
            MY_CUSTOM_VAR: 'safe-value',
            SUPER_SECRET_KEY: 'sensitive-password-do-not-leak',
            AWS_SECRET_ACCESS_KEY: 'aws-secret',
          },
        },
      );

      // Injected gateway variables
      expect(env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:8787');
      expect(env['ANTHROPIC_MODEL']).toBe('mistral-small-latest');
      expect(env['MY_CUSTOM_VAR']).toBe('safe-value');

      // Sensitive tokens stripped
      expect(env['SUPER_SECRET_KEY']).toBeUndefined();
      expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
    });
  });

  describe('3. REST API & Bridge Endpoints', () => {
    it('GET /v1/runtime-agents returns list of discovered local agents', async () => {
      const res = await fetch(`${baseUrl}/v1/runtime-agents`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { agents: Array<{ id: string; name: string; status: string; health: { level: string } }> };
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.length).toBeGreaterThanOrEqual(5);

      const claude = data.agents.find((a) => a.id === 'claude-code');
      expect(claude).toBeDefined();
      expect(claude?.name).toBe('Claude Code');
    });

    it('GET /v1/runtime-agents/:id returns truthful single agent status', async () => {
      const res = await fetch(`${baseUrl}/v1/runtime-agents/claude-code`);
      expect(res.status).toBe(200);
      const agent = (await res.json()) as { id: string; capabilities: Record<string, boolean>; health: { level: string } };
      expect(agent.id).toBe('claude-code');
      expect(agent.capabilities).toBeDefined();
      expect(agent.health).toBeDefined();
    });

    it('POST /v1/runtime-agents/:id/health performs real multi-stage health check', async () => {
      const res = await fetch(`${baseUrl}/v1/runtime-agents/claude-code/health`, { method: 'POST' });
      expect(res.status).toBe(200);
      const health = (await res.json()) as { level: string; gatewayReachable: boolean; executableFound: boolean };
      expect(health.level).toBeDefined();
      expect(typeof health.gatewayReachable).toBe('boolean');
    });

    it('GET /v1/runtime-agents/:id/chain returns 7-step diagnostic chain', async () => {
      const res = await fetch(`${baseUrl}/v1/runtime-agents/claude-code/chain?modelPolicy=nexus/fast`);
      expect(res.status).toBe(200);
      const chain = (await res.json()) as {
        agentId: string;
        steps: {
          executable: { ok: boolean };
          configuration: { ok: boolean };
          nexusGateway: { ok: boolean };
          modelRouting: { ok: boolean };
          providerAuth: { ok: boolean };
          modelDiscovery: { ok: boolean };
          liveExecution: { ok: boolean };
        };
        overallStatus: string;
      };
      expect(chain.agentId).toBe('claude-code');
      expect(chain.steps.executable).toBeDefined();
      expect(chain.steps.nexusGateway).toBeDefined();
      expect(chain.steps.modelRouting).toBeDefined();
      expect(chain.overallStatus).toBeDefined();
    });

    it('GET /v1/debug/runtime-agents returns bridge telemetry and history', async () => {
      const res = await fetch(`${baseUrl}/v1/debug/runtime-agents`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { metrics: { totalExecutions: number }; agents: Array<{ id: string }> };
      expect(data.metrics).toBeDefined();
      expect(typeof data.metrics.totalExecutions).toBe('number');
      expect(Array.isArray(data.agents)).toBe(true);
    });
  });

  describe('4. Workspace Path Traversal Protection', () => {
    it('rejects relative or traversal paths during execution', async () => {
      const res = await fetch(`${baseUrl}/v1/runtime-agents/claude-code/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Inspect workspace',
          workspace: '../../etc/passwd',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error?.message).toContain('absolute');
    });
  });
});

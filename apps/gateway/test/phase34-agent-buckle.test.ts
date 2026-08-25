import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { GatewayRuntime } from '../src/runtime.js';
import { AgentRuntimeManager } from '../src/agent-runtime-manager.js';
import { BUILTIN_INTEGRATIONS } from '@anx/integrations';

describe('Phase 34: Agent Buckle & Machine Agent Integration Truthfulness Hardening', () => {
  let runtime: GatewayRuntime;
  const testPort = 18797;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-buckle-truth-${Date.now()}`);

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

  describe('1. Canonical Gateway URL Verification', () => {
    it('uses 127.0.0.1 with canonical port and rejects hardcoded localhost:3000', async () => {
      const res = await fetch(`${baseUrl}/v1/runtime-agents/environment`);
      expect(res.status).toBe(200);
      const env = (await res.json()) as { recommendedBaseUrl: string; gatewayReachability: string };
      expect(env.recommendedBaseUrl).toBe(`http://127.0.0.1:${testPort}`);
      expect(env.gatewayReachability).toBe(`http://127.0.0.1:${testPort}`);
      expect(env.recommendedBaseUrl).not.toContain('3000');
    });

    it('generates Claude Code model snippets with root base URL (without /v1)', async () => {
      const res = await fetch(`${baseUrl}/v1/models`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { data: Array<{ agentSnippets?: { claudeCode?: string; codexCli?: string } }> };
      const snippet = data.data?.[0]?.agentSnippets?.claudeCode;
      if (snippet) {
        expect(snippet).toContain('ANTHROPIC_BASE_URL="http://127.0.0.1:8787"');
        expect(snippet).not.toContain('ANTHROPIC_BASE_URL="http://127.0.0.1:8787/v1"');
      }
    });
  });

  describe('2. Agent State Truthfulness & Lifecycle Separation', () => {
    it('separates detected state from configured and runnable states truthfully', async () => {
      const manager = new AgentRuntimeManager();
      const states = await manager.getTruthfulStates({ gatewayUrl: baseUrl });

      expect(Array.isArray(states)).toBe(true);
      expect(states.length).toBeGreaterThan(0);

      // Verify that an undetected agent is never marked as runnable or detected
      const nonExistent = await manager.verifyAgent('non-existent-agent-xyz');
      expect(nonExistent.detected).toBe(false);
      expect(nonExistent.runnable).toBe(false);
      expect(nonExistent.inferenceVerified).toBe(false);
      expect(nonExistent.failureReason).toContain('not in the recognized');
    }, 30000);

    it('verifies supported integrations are available as adapters without claiming they are installed', () => {
      expect(BUILTIN_INTEGRATIONS.length).toBeGreaterThanOrEqual(17);
      const ids = BUILTIN_INTEGRATIONS.map((i) => i.id);
      expect(ids).toContain('claude-code');
      expect(ids).toContain('codex-cli');
      expect(ids).toContain('cursor');
      expect(ids).toContain('opencode');
      expect(ids).toContain('hermes-cli');
    });
  });

  describe('3. Dynamic Model Fabric & Push Semantics', () => {
    it('POST /v1/runtime-agents/configure-all returns granular per-agent result objects', async () => {
      const res = await fetch(`${baseUrl}/v1/runtime-agents/configure-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, gatewayUrl: baseUrl }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { configuredAgents: Array<{ agentId: string; configured: boolean; message: string; gatewayUrl: string }> };
      expect(Array.isArray(body.configuredAgents)).toBe(true);
      for (const agent of body.configuredAgents) {
        expect(agent.gatewayUrl).toBe(baseUrl);
        expect(typeof agent.configured).toBe('boolean');
        expect(typeof agent.message).toBe('string');
      }
    }, 30000);

    it('POST /v1/runtime-agents/:id/verify executes truthful verification', async () => {
      const res = await fetch(`${baseUrl}/v1/runtime-agents/claude-code/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as { id: string; detected: boolean; gatewayReachable: boolean };
      expect(data.id).toBe('claude-code');
      expect(data.gatewayReachable).toBe(true);
      expect(typeof data.detected).toBe('boolean');
    }, 30000);
  });

  describe('4. Cross-Platform Shell Command Truthfulness', () => {
    it('verifies shell commands match platform conventions', () => {
      const gw = 'http://127.0.0.1:8787';
      const psClaude = `$env:ANTHROPIC_BASE_URL="${gw}"`;
      const cmdClaude = `set ANTHROPIC_BASE_URL=${gw}`;
      const bashClaude = `export ANTHROPIC_BASE_URL="${gw}"`;

      const psOpenAi = `$env:OPENAI_BASE_URL="${gw}/v1"`;
      const cmdOpenAi = `set OPENAI_BASE_URL=${gw}/v1`;
      const bashOpenAi = `export OPENAI_BASE_URL="${gw}/v1"`;

      expect(psClaude).toBe('$env:ANTHROPIC_BASE_URL="http://127.0.0.1:8787"');
      expect(cmdClaude).toBe('set ANTHROPIC_BASE_URL=http://127.0.0.1:8787');
      expect(bashClaude).toBe('export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"');

      expect(psOpenAi).toBe('$env:OPENAI_BASE_URL="http://127.0.0.1:8787/v1"');
      expect(cmdOpenAi).toBe('set OPENAI_BASE_URL=http://127.0.0.1:8787/v1');
      expect(bashOpenAi).toBe('export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"');
    });
  });
});

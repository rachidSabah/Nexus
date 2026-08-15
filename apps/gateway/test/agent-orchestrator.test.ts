import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { GatewayRuntime } from '../src/runtime.js';
import {
  IntentClassifier,
  AgentScoringEngine,
  AgentPool,
  AgentOrchestrator,
  LocalAgentBridge,
} from '@anx/core';

describe('Phase 28: Intelligent Multi-Agent Orchestration Fabric', () => {
  let runtime: GatewayRuntime;
  const testPort = 18796;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-orch-test-${Date.now()}`);

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

  describe('1. Task Intent Classification', () => {
    const classifier = new IntentClassifier();

    it('classifies debugging prompts with required capabilities', () => {
      const res = classifier.classify('Fix the authentication null pointer exception');
      expect(res.category).toBe('debugging');
      expect(res.requiredCapabilities).toContain('debugging');
      expect(res.requiredCapabilities).toContain('coding');
      expect(res.suggestedPolicy).toBe('nexus/best-coding-agent');
    });

    it('classifies application building prompts with scaffolding capabilities', () => {
      const res = classifier.classify('Build a new SaaS full-stack application for video processing');
      expect(res.category).toBe('application-building');
      expect(res.requiredCapabilities).toContain('application-building');
      expect(res.requiredCapabilities).toContain('scaffolding');
      expect(res.suggestedPolicy).toBe('nexus/application-builder');
    });

    it('classifies code review requests', () => {
      const res = classifier.classify('Please review this pull request and audit security');
      expect(res.category).toBe('code-review');
      expect(res.requiredCapabilities).toContain('repository-read');
      expect(res.requiredCapabilities).toContain('analysis');
    });

    it('classifies test fixing requests', () => {
      const res = classifier.classify('Run vitest and fix failing unit tests');
      expect(res.category).toBe('testing-debugging');
      expect(res.requiredCapabilities).toContain('testing');
      expect(res.requiredCapabilities).toContain('debugging');
    });
  });

  describe('2. Agent Scoring Engine & Explainability', () => {
    const scoringEngine = new AgentScoringEngine();
    const classifier = new IntentClassifier();

    it('computes transparent scores with explainable breakdown', () => {
      const intent = classifier.classify('Fix database deadlock bug');
      const mockAgent = {
        id: 'claude-code',
        name: 'Claude Code',
        type: 'claude-code',
        status: 'READY' as const,
        health: {
          level: 'READY' as const,
          executableFound: true,
          configValid: true,
          gatewayReachable: true,
          executionVerified: true,
          lastChecked: Date.now(),
        },
        capabilities: { prompt: true, streaming: true, workspace: true },
        workspaceSupport: true,
        streamingSupport: true,
        supportsNonInteractive: true,
        supportsEnvironmentConfiguration: true,
        supportsModelConfiguration: true,
        platform: 'win32',
        detectedVia: 'path' as const,
      };

      const score = scoringEngine.scoreAgent(mockAgent, intent, 'nexus/auto');
      expect(score.score).toBeGreaterThan(50);
      expect(score.breakdown.capabilityScore).toBeGreaterThan(0);
      expect(score.breakdown.healthScore).toBe(30);
      expect(score.breakdown.rationale).toBeDefined();
    });

    it('heavily penalizes uninstalled agents', () => {
      const intent = classifier.classify('Implement user profile page');
      const uninstalledAgent = {
        id: 'opencode',
        name: 'OpenCode',
        type: 'opencode',
        status: 'UNAVAILABLE' as const,
        health: {
          level: 'FAILED' as const,
          executableFound: false,
          configValid: false,
          gatewayReachable: true,
          executionVerified: false,
          lastChecked: Date.now(),
        },
        capabilities: { prompt: true, streaming: true },
        workspaceSupport: true,
        streamingSupport: true,
        supportsNonInteractive: true,
        supportsEnvironmentConfiguration: true,
        supportsModelConfiguration: true,
        platform: 'win32',
        detectedVia: 'not-found' as const,
      };

      const score = scoringEngine.scoreAgent(uninstalledAgent, intent);
      expect(score.breakdown.healthScore).toBe(-50);
    });
  });

  describe('3. Agent Pool & Execution Leases', () => {
    it('manages concurrency leases and tracks active counts', () => {
      const pool = new AgentPool();
      const lease = pool.acquireLease('claude-code', 'exec-123', 60_000);
      expect(lease.status).toBe('ACTIVE');
      expect(pool.getActiveLeasesCount('claude-code')).toBe(1);

      pool.recordSuccess('claude-code', 1500);
      const metrics = pool.getMetricsSnapshot('claude-code');
      expect(metrics.successRate).toBe(1.0);
      expect(metrics.consecutiveFailures).toBe(0);

      pool.releaseLease(lease.leaseId);
      expect(pool.getActiveLeasesCount('claude-code')).toBe(0);
    });
  });

  describe('4. REST API — Dry-run Explain Mode (POST /v1/agents/select)', () => {
    it('returns ranked candidate agents and explainable selection without executing', async () => {
      const res = await fetch(`${baseUrl}/v1/agents/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Fix the authentication null pointer exception in auth service',
        }),
      });

      expect(res.status).toBe(200);
      const selection = await res.json();
      expect(selection.selectedAgentId).toBeDefined();
      expect(selection.intent.category).toBe('debugging');
      expect(Array.isArray(selection.candidateScores)).toBe(true);
      expect(selection.candidateScores.length).toBeGreaterThanOrEqual(6);
      expect(selection.reason).toBeDefined();
    });

    it('selects AGY when requested policy is nexus/application-builder', async () => {
      const res = await fetch(`${baseUrl}/v1/agents/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Scaffold new microservice architecture',
          policy: 'nexus/application-builder',
        }),
      });

      expect(res.status).toBe(200);
      const selection = await res.json();
      expect(selection.selectedAgentId).toBe('agy');
    });
  });

  describe('5. High-Risk Safety Gate & Execution Telemetry', () => {
    it('blocks dangerous operations requiring operator approval', async () => {
      const res = await fetch(`${baseUrl}/v1/agents/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Please run rm -rf / on the server and delete all databases',
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error?.requiresApproval).toBe(true);
    });

    it('GET /v1/debug/agent-orchestration returns orchestration telemetry', async () => {
      const res = await fetch(`${baseUrl}/v1/debug/agent-orchestration`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.metrics).toBeDefined();
      expect(typeof data.metrics.totalOrchestrations).toBe('number');
      expect(Array.isArray(data.recentExecutions)).toBe(true);
    });
  });
});

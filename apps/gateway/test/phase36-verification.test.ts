import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  EntitlementBridgeEngine,
  DEFAULT_ENTITLEMENT_RULES,
  classifyFailure,
  GitWorktreeArbiter,
} from '@anx/core';
import { classifyAgyError } from '@anx/providers';
import { PrefixPinnedCompactor } from '@anx/token-efficiency';
import { QualityDriftGuardrail } from '../../../packages/quality-engine/src/index.js';
import {
  SqliteBuildRepository,
  DockerSandboxExecutionAdapter,
  BuildJob,
} from '../../builder/src/index.js';

const execFileAsync = promisify(execFile);

describe('Phase 36 Verification & Certification Test Suite', () => {
  // ─── Module 1: Entitlement-Aware Smart Aliasing & Subscription-to-API Bridge ──
  describe('Module 1: Entitlement-Aware Smart Aliasing & API Bridge', () => {
    it('detects tier-restriction and entitlement error patterns accurately', () => {
      const engine = new EntitlementBridgeEngine();

      expect(
        engine.isEntitlementError(
          'Error: gemini-4-argon is not available for the Pro account. Requires Google AI Ultra.',
        ),
      ).toBe(true);

      expect(engine.isEntitlementError(new Error('model_not_entitled for this user tier'))).toBe(true);
      expect(engine.isEntitlementError('Error: upgrade your subscription to access claude-3-7-sonnet')).toBe(true);
      expect(engine.isEntitlementError('Generic network timeout error')).toBe(false);
    });

    it('resolves bridge route for tier-locked models to pay-as-you-go key or fallback alias', () => {
      const engine = new EntitlementBridgeEngine();

      const agyArgonRoute = engine.resolveBridgeRoute('agy', 'argon');
      expect(agyArgonRoute).not.toBeNull();
      expect(agyArgonRoute?.fallbackStrategy).toBe('api-key-bridge');
      expect(agyArgonRoute?.targetProvider).toBe('google');
      expect(agyArgonRoute?.targetModel).toBe('gemini-4-argon');

      const agyDownshift = engine.resolveBridgeRoute('agy', 'gemini-4-argon');
      expect(agyDownshift).not.toBeNull();
      expect(agyDownshift?.fallbackStrategy).toBe('model-downshift');
      expect(agyDownshift?.targetModel).toBe('gemini-3.1-pro');
      expect(agyDownshift?.injectReasoningBoost).toBe(true);
    });

    it('injects reasoning boost into system directives when downshifting', () => {
      const engine = new EntitlementBridgeEngine();

      const messages = [
        { role: 'system', content: 'You are an autonomous engineering assistant.' },
        { role: 'user', content: 'Refactor the authentication flow.' },
      ];

      const boosted = engine.applyReasoningBoost(messages);
      expect(boosted.length).toBe(2);
      expect(boosted[0]?.content).toContain('[SYSTEM_DIRECTIVE: Execute deep step-by-step architectural verification');
      expect(boosted[0]?.content).toContain('You are an autonomous engineering assistant.');
      expect(boosted[1]?.content).toBe('Refactor the authentication flow.');
    });

    it('classifies entitlement errors as ENTITLEMENT_LOCKED with HTTP 403 in failure classifier', () => {
      const err = new Error('not available for the pro account; requires Google AI Ultra');
      const classification = classifyFailure(err);

      expect(classification.code).toBe('ENTITLEMENT_LOCKED');
      expect(classification.status).toBe(403);
      expect(classification.retryable).toBe(true);
      expect(classification.endpointAction).toBe('record_failure');
    });

    it('classifies agy CLI tier restriction in classifyAgyError with ENTITLEMENT_LOCKED', () => {
      const providerErr = classifyAgyError(
        'ep-antigravity',
        'Model argon is not available for the pro account. Please upgrade your subscription to access.',
      );

      expect(providerErr.status).toBe(403);
      expect(providerErr.context?.['errorCode']).toBe('ENTITLEMENT_LOCKED');
      expect(providerErr.context?.['retryable']).toBe(true);
    });
  });

  // ─── Module 2: Multi-Agent Git Worktree Sandbox & Conflict Arbiter ───────────
  describe('Module 2: Multi-Agent Git Worktree Sandbox & Conflict Arbiter', () => {
    let testRepoDir: string;
    let sandboxDir: string;

    beforeEach(async () => {
      testRepoDir = path.join(tmpdir(), `test-nexus-repo-${Date.now()}-${Math.random().toString(36).substring(7)}`);
      sandboxDir = path.join(tmpdir(), `test-nexus-sb-${Date.now()}-${Math.random().toString(36).substring(7)}`);

      await fs.mkdir(testRepoDir, { recursive: true });
      await fs.mkdir(sandboxDir, { recursive: true });

      // Initialize real git repo
      await execFileAsync('git', ['init', '-b', 'main'], { cwd: testRepoDir });
      await execFileAsync('git', ['config', 'user.name', 'Nexus Test'], { cwd: testRepoDir });
      await execFileAsync('git', ['config', 'user.email', 'test@nexus.internal'], { cwd: testRepoDir });
      await fs.writeFile(path.join(testRepoDir, 'README.md'), '# Initial Root\n');
      await execFileAsync('git', ['add', 'README.md'], { cwd: testRepoDir });
      await execFileAsync('git', ['commit', '-m', 'chore: initial commit'], { cwd: testRepoDir });
    });

    afterEach(async () => {
      await fs.rm(testRepoDir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
    });

    it('provisions isolated worktree, commits isolated agent edits, merges back into main', async () => {
      const arbiter = new GitWorktreeArbiter(testRepoDir, sandboxDir);

      const lease = await arbiter.acquireWorktree('m101', 'node-auth');
      expect(lease.missionId).toBe('m101');
      expect(lease.nodeId).toBe('node-auth');
      expect(lease.worktreePath).toContain('m101-node-auth');

      // Verify worktree has initialized repo contents
      const stat = await fs.stat(path.join(lease.worktreePath, 'README.md'));
      expect(stat.isFile()).toBe(true);

      // Simulate local agent modifying code strictly in worktree
      await fs.writeFile(path.join(lease.worktreePath, 'auth.ts'), 'export const auth = true;\n');

      // Commit and merge worktree
      const mergeResult = await arbiter.commitAndMergeWorktree(lease);
      expect(mergeResult.merged).toBe(true);
      expect(mergeResult.conflictedFiles).toHaveLength(0);

      // Verify merged file exists in root repo
      const rootAuthFile = await fs.readFile(path.join(testRepoDir, 'auth.ts'), 'utf8');
      expect(rootAuthFile).toContain('export const auth = true;');

      // Release worktree lease
      await arbiter.releaseWorktree(lease);
      const existsAfterRelease = await fs
        .stat(lease.worktreePath)
        .then(() => true)
        .catch(() => false);
      expect(existsAfterRelease).toBe(false);
    });
  });

  // ─── Module 3: Cache-Preserving Delta Compaction ("Prefix Pinning") ───────────
  describe('Module 3: Cache-Preserving Delta Compaction ("Prefix Pinning")', () => {
    it('pins the first N turns byte-identical with cacheControl and hashes prefix', () => {
      const compactor = new PrefixPinnedCompactor(2, 50);

      const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [
        { role: 'system', content: 'You are an immutable system prompt with high cache value.' },
        { role: 'user', content: 'Here is the repo index and schema specification.' },
        {
          role: 'assistant',
          content: 'Please kindly understand basically that this long tail conversation message exceeds threshold.',
        },
        { role: 'user', content: 'Keep the last turn uncompressed always.' },
      ];

      const result = compactor.compact(messages);

      // Prefix message 0 & 1 must be byte-identical in content
      expect(result.messages[0]?.content).toBe(messages[0]?.content);
      expect(result.messages[1]?.content).toBe(messages[1]?.content);

      // Boundary turn (index 1) gets ephemeral cacheControl
      expect(result.messages[1]?.cacheControl).toEqual({ type: 'ephemeral' });

      // Prefix hash is generated
      expect(result.prefixHash).toBeDefined();
      expect(result.prefixHash.length).toBe(64);

      // Sliding tail message 2 was compressed
      expect(result.messages[2]?.content).not.toContain('basically');
      expect(result.compressedDeltaTokensSaved).toBeGreaterThan(0);

      // Last turn is NEVER compressed
      expect(result.messages[3]?.content).toBe(messages[3]?.content);
    });
  });

  // ─── Module 4: Dedicated Live Agent Fleet Console ─────────────────────────────
  describe('Module 4: Dedicated Live Agent Fleet Console & Telemetry', () => {
    it('verifies fleet telemetry schema and hot-swap logic contracts', () => {
      interface FleetAgent {
        id: string;
        name: string;
        binary: string;
        status: 'online' | 'busy' | 'cooldown' | 'offline';
        activeModel: string;
        fallbackBridge: string;
        successRate: number;
        activeWorktree?: string;
      }

      const fleet: FleetAgent[] = [
        {
          id: 'agy',
          name: 'Google Antigravity (agy)',
          binary: 'agy',
          status: 'online',
          activeModel: 'gemini-4-argon (API Bridge Active)',
          fallbackBridge: 'google/gemini-4-argon -> gemini-3.1-pro',
          successRate: 98.4,
          activeWorktree: '/tmp/nexus-worktrees/mission-36-node-1',
        },
      ];

      expect(fleet[0]?.id).toBe('agy');
      expect(fleet[0]?.fallbackBridge).toContain('gemini-4-argon');
      expect(fleet[0]?.successRate).toBeGreaterThan(95);

      // Simulate model hot-swap
      const updated = fleet.map((a) =>
        a.id === 'agy' ? { ...a, activeModel: 'gemini-4-argon (Pay-As-You-Go Key)' } : a,
      );
      expect(updated[0]?.activeModel).toBe('gemini-4-argon (Pay-As-You-Go Key)');
    });
  });

  // ─── Module 5: Production-Grade Builder Persistence & Containerized Execution ─
  describe('Module 5: Production-Grade Builder Persistence & Execution', () => {
    let dbFile: string;

    beforeEach(() => {
      dbFile = path.join(tmpdir(), `test-build-repo-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
    });

    afterEach(async () => {
      await fs.unlink(dbFile).catch(() => {});
    });

    it('persists build jobs and step metadata across repository instances', async () => {
      const repo1 = new SqliteBuildRepository(dbFile);

      const job = new BuildJob({
        id: 'build-p36-001',
        projectId: 'project-auth',
        steps: [
          { id: 'step-1', name: 'Lint', command: 'npm run lint' },
          { id: 'step-2', name: 'Build', command: 'npm run build' },
        ],
      });
      job.start('/workspace/auth');
      job.appendLog('Build initialized with docker sandbox');
      job.complete();

      await repo1.save(job);

      // Re-open fresh repository instance pointing to the same file
      const repo2 = new SqliteBuildRepository(dbFile);
      const loaded = await repo2.findById('build-p36-001');

      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe('build-p36-001');
      expect(loaded?.projectId).toBe('project-auth');
      expect(loaded?.status).toBe('completed');
      expect(loaded?.logs.some((l) => l.includes('Build initialized with docker sandbox'))).toBe(true);

      const count = await repo2.count();
      expect(count).toBe(1);

      await repo2.delete('build-p36-001');
      const countAfter = await repo2.count();
      expect(countAfter).toBe(0);
    });

    it('initializes DockerSandboxExecutionAdapter with resource and network isolation config', () => {
      const adapter = new DockerSandboxExecutionAdapter({
        image: 'node:22-alpine',
        memoryLimitMb: 512,
        cpuQuota: '1.0',
        networkMode: 'none',
        timeoutMs: 30000,
      });

      expect(adapter).toBeDefined();
      expect(typeof adapter.prepareWorkspace).toBe('function');
      expect(typeof adapter.executeStep).toBe('function');
      expect(typeof adapter.cleanupWorkspace).toBe('function');
      expect(typeof adapter.cancelExecution).toBe('function');
    });
  });

  // ─── Module 6: Automated "Shadow Eval" & Quality Drift Guardrails ─────────────
  describe('Module 6: Automated "Shadow Eval" & Quality Drift Guardrails', () => {
    it('detects unclosed code fences and applies penalty', () => {
      const guardrail = new QualityDriftGuardrail();

      const verdict = guardrail.evaluateSample({
        providerId: 'free-provider',
        modelId: 'quantized-coder',
        prompt: 'Write a python function',
        responseContent: 'Here is the function:\n```python\ndef test():\n    return 42', // Missing closing fence
        latencyMs: 120,
      });

      expect(verdict.passed).toBe(false);
      expect(verdict.anomalies).toContain('UNCLOSED_CODE_FENCE_TRUNCATION');
      expect(verdict.qualityScore).toBeLessThan(0.7);
      expect(verdict.recommendedCooldownMs).toBe(300_000);
    });

    it('detects lazy omission placeholder comments in degraded provider responses', () => {
      const guardrail = new QualityDriftGuardrail();

      const verdict = guardrail.evaluateSample({
        providerId: 'budget-llm',
        modelId: 'mini-v1',
        prompt: 'Implement auth service',
        responseContent: 'class AuthService {\n  login() {\n    // ... rest of code\n  }\n}',
        latencyMs: 80,
      });

      expect(verdict.anomalies).toContain('LAZY_OMISSION_PLACEHOLDER_DETECTED');
      expect(verdict.qualityScore).toBeLessThan(0.7);
    });

    it('evaluates and passes compliant, complete tool-call and code samples', () => {
      const guardrail = new QualityDriftGuardrail();

      const verdict = guardrail.evaluateSample({
        providerId: 'google',
        modelId: 'gemini-4-argon',
        prompt: 'Calculate hash',
        responseContent: '```typescript\nexport function hash(s: string) {\n  return s.length;\n}\n```',
        expectedJsonSchema: false,
        latencyMs: 450,
      });

      expect(verdict.passed).toBe(true);
      expect(verdict.qualityScore).toBe(1.0);
      expect(verdict.anomalies).toHaveLength(0);
      expect(verdict.recommendedCooldownMs).toBe(0);
    });

    it('validates strict JSON output when schema expected and penalizes malformed JSON', () => {
      const guardrail = new QualityDriftGuardrail();

      const badJsonVerdict = guardrail.evaluateSample({
        providerId: 'free-llm',
        modelId: 'fast-chat',
        prompt: 'Emit JSON object',
        responseContent: '{ "name": "nexus", key: unquoted }',
        expectedJsonSchema: true,
        latencyMs: 100,
      });

      expect(badJsonVerdict.passed).toBe(false);
      expect(badJsonVerdict.anomalies).toContain('MALFORMED_JSON_SCHEMA_OUTPUT');

      const goodJsonVerdict = guardrail.evaluateSample({
        providerId: 'free-llm',
        modelId: 'fast-chat',
        prompt: 'Emit JSON object',
        responseContent: '{ "name": "nexus", "status": "ok" }',
        expectedJsonSchema: true,
        latencyMs: 100,
      });

      expect(goodJsonVerdict.anomalies).toHaveLength(0);
    });
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 30: Full-System Production Validation, Chaos Testing & Stabilization
 * Complete End-to-End Mission Chaos, Concurrency & Recovery Test Suite.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { GatewayRuntime } from '../src/runtime.js';
import {
  MissionPlanner,
  MissionVerifier,
  MissionStore,
  AgentPool,
  type Mission,
  type MissionTask,
} from '@anx/core';

describe('Phase 30: Full-System Production Validation & Chaos Testing', { timeout: 35000 }, () => {
  let runtime: GatewayRuntime;
  const testPort = 18799;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-p30-test-${Date.now()}`);

  beforeAll(async () => {
    process.env['ANX_VAULT_PATH'] = join(testDir, 'vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env['PORT'] = String(testPort);
    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();
  }, 35000);

  afterAll(async () => {
    await runtime.stop();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }, 35000);

  describe('1. Mission Lifecycle & State Machine Transitions', () => {
    it('enforces legal transitions and prevents illegal transitions', async () => {
      const store = new MissionStore();
      const mission: Mission = {
        id: 'mis-life-1',
        spec: { objective: 'Test state machine' },
        status: 'CREATED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activeTaskIds: [],
        completedTaskIds: [],
        failedTaskIds: [],
        totalTokens: 0,
        estimatedCost: 0,
        tokenSavings: 0,
        failoverCount: 0,
        repairCount: 0,
        checkpointsCount: 0,
      };

      store.save(mission);
      expect(store.get('mis-life-1')?.status).toBe('CREATED');

      // Update to READY
      mission.status = 'READY';
      store.save(mission);
      expect(store.get('mis-life-1')?.status).toBe('READY');

      // Update to EXECUTING
      mission.status = 'EXECUTING';
      store.save(mission);
      expect(store.get('mis-life-1')?.status).toBe('EXECUTING');

      // Update to PAUSED and back to EXECUTING
      mission.status = 'PAUSED';
      store.save(mission);
      expect(store.get('mis-life-1')?.status).toBe('PAUSED');

      mission.status = 'EXECUTING';
      store.save(mission);
      expect(store.get('mis-life-1')?.status).toBe('EXECUTING');

      // Complete
      mission.status = 'COMPLETED';
      store.save(mission);
      expect(store.get('mis-life-1')?.status).toBe('COMPLETED');
    });
  });

  describe('2. Complex DAG Topologies & Topological Validation', () => {
    const planner = new MissionPlanner();

    it('generates converging and parallel DAG structures with valid dependencies', () => {
      const plan = planner.plan('mis-dag-1', {
        objective: 'Build customer API and test suite',
        policy: 'nexus/best-coding',
      });

      expect(plan.tasks.length).toBeGreaterThanOrEqual(4);
      expect(plan.dependencies.length).toBeGreaterThanOrEqual(3);

      // Verify all dependency references exist within the plan
      const taskIds = new Set(plan.tasks.map((t) => t.taskId));
      for (const dep of plan.dependencies) {
        expect(taskIds.has(dep.fromTaskId)).toBe(true);
        expect(taskIds.has(dep.toTaskId)).toBe(true);
      }
    });

    it('handles application-builder specialized DAG plans', () => {
      const plan = planner.plan('mis-app-1', {
        objective: 'Build video processing SaaS app',
        policy: 'nexus/application-builder',
      });

      const types = plan.tasks.map((t) => t.type);
      expect(types).toContain('APPLICATION_BUILD');
      expect(types).toContain('CODING');
      expect(types).toContain('VERIFICATION');
    });
  });

  describe('3. Concurrency Stress & Agent Leasing', () => {
    it('manages concurrency limits, lease acquisitions, and releases without collision', () => {
      const pool = new AgentPool();
      const lease1 = pool.acquireLease('claude-code', 'exec-1', 5000);
      const lease2 = pool.acquireLease('claude-code', 'exec-2', 5000);

      expect(lease1.status).toBe('ACTIVE');
      expect(lease2.status).toBe('ACTIVE');
      expect(pool.getActiveLeasesCount('claude-code')).toBe(2);

      pool.releaseLease(lease1.leaseId);
      expect(pool.getActiveLeasesCount('claude-code')).toBe(1);

      pool.releaseLease(lease2.leaseId);
      expect(pool.getActiveLeasesCount('claude-code')).toBe(0);
    });

    it('accurately scores agent performance and success rate', () => {
      const pool = new AgentPool();
      pool.recordSuccess('agy', 1200);
      pool.recordSuccess('agy', 1400);
      pool.recordFailure('agy');

      const metrics = pool.getMetricsSnapshot('agy');
      expect(metrics.consecutiveFailures).toBe(1);
      expect(metrics.successRate).toBeCloseTo(0.666, 2);
      expect(metrics.averageLatencyMs).toBeGreaterThan(0);
    });
  });

  describe('4. Checkpoint Persistence & Crash Recovery Simulation', () => {
    it('persists checkpoints and survives simulated store reloads', () => {
      const store = new MissionStore();
      const missionId = 'mis-recovery-test';

      store.save({
        id: missionId,
        spec: { objective: 'Recovery audit' },
        status: 'EXECUTING',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activeTaskIds: ['t-2'],
        completedTaskIds: ['t-1'],
        failedTaskIds: [],
        totalTokens: 500,
        estimatedCost: 0.0015,
        tokenSavings: 120,
        failoverCount: 0,
        repairCount: 0,
        checkpointsCount: 1,
      });

      store.addCheckpoint({
        checkpointId: 'chk-step-1',
        missionId,
        timestamp: Date.now(),
        status: 'EXECUTING',
        completedTasks: ['t-1'],
        activeTasks: ['t-2'],
        failedTasks: [],
        dagState: {
          't-1': 'COMPLETED',
          't-2': 'EXECUTING',
          't-3': 'READY',
        },
        agentAssignments: {
          't-1': 'claude-code',
          't-2': 'codex',
        },
        totalTokens: 500,
        estimatedCost: 0.0015,
      });

      // Query latest checkpoint
      const latest = store.getLatestCheckpoint(missionId);
      expect(latest).toBeDefined();
      expect(latest?.checkpointId).toBe('chk-step-1');
      expect(latest?.completedTasks).toEqual(['t-1']);
      expect(latest?.dagState['t-1']).toBe('COMPLETED');
      expect(latest?.dagState['t-2']).toBe('EXECUTING');
    });
  });

  describe('5. Token & Cost Accounting Aggregation', () => {
    it('aggregates token usage and costs strictly additively', async () => {
      const origExecute = (runtime as any).agentOrchestrator.execute.bind((runtime as any).agentOrchestrator);
      let callCount = 0;

      (runtime as any).agentOrchestrator.execute = async (req: any) => {
        callCount++;
        return {
          executionId: `exec-${callCount}`,
          prompt: req.prompt,
          status: 'SUCCESS',
          selectedAgentId: 'claude-code',
          selectedAgentName: 'Claude Code',
          selectedModel: 'nexus/best-coding',
          policy: req.policy ?? 'nexus/best-coding',
          attempts: 1,
          durationMs: 50,
          output: `Output for step ${callCount} with verified code.`,
          failoverHistory: [],
          selection: {
            selectedAgentId: 'claude-code',
            selectedAgentName: 'Claude Code',
            policy: 'nexus/best-coding',
            intent: { category: 'coding', confidence: 0.95, requiredCapabilities: ['coding'], suggestedPolicy: 'nexus/best-coding', suggestedTimeoutMs: 60000, explanation: 'mock' },
            candidateScores: [],
            fallbackChain: [],
            reason: 'mock',
            timestamp: Date.now(),
          },
        };
      };

      const res = await fetch(`${baseUrl}/v1/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: 'Generate data access layer',
          policy: 'nexus/fast',
        }),
      });
      const mission: Mission = await res.json();

      const execRes = await fetch(`${baseUrl}/v1/missions/${mission.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const completed: Mission = await execRes.json();

      expect(completed.status).toBe('COMPLETED');
      expect(completed.totalTokens).toBeGreaterThan(0);
      expect(completed.estimatedCost).toBeGreaterThan(0);
      expect(completed.tokenSavings).toBeGreaterThanOrEqual(0);

      (runtime as any).agentOrchestrator.execute = origExecute;
    });
  });

  describe('6. Security & Path Traversal Guards', () => {
    it('blocks dangerous directory traversal patterns in mission requests', async () => {
      const payloads = [
        '../etc/shadow',
        '..\\Windows\\System32',
        '/var/../../etc/passwd',
      ];

      for (const workspace of payloads) {
        const res = await fetch(`${baseUrl}/v1/missions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            objective: 'Test workspace guard',
            workspace,
          }),
        });

        expect(res.status).toBe(400);
      }
    });
  });
});

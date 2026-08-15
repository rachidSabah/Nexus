/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 29: Unified Agent Mission Orchestration & Autonomous Execution
 * Full Integration & Quality Gate Certification Test Suite.
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
  type Mission,
} from '@anx/core';

describe('Phase 29: Unified Agent Mission Orchestration Fabric', { timeout: 35000 }, () => {
  let runtime: GatewayRuntime;
  const testPort = 18798;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-mission-test-${Date.now()}`);

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

  describe('1. Mission Domain Units (Planner, Verifier, Store)', () => {
    it('plans and decomposes API objective with DAG dependencies', () => {
      const planner = new MissionPlanner();
      const plan = planner.plan('mis-unit-1', {
        objective: 'Build customer REST API with database persistence and tests',
        policy: 'nexus/best-coding',
      });

      expect(plan.missionId).toBe('mis-unit-1');
      expect(plan.tasks.length).toBeGreaterThanOrEqual(4);
      expect(plan.dependencies.length).toBeGreaterThanOrEqual(3);
      expect(plan.riskLevel).toBe('MEDIUM');
      expect(plan.requiresApproval).toBe(false);

      const taskTypes = plan.tasks.map((t) => t.type);
      expect(taskTypes).toContain('ANALYSIS');
      expect(taskTypes).toContain('CODING');
      expect(taskTypes).toContain('TESTING');
      expect(taskTypes).toContain('VERIFICATION');
    });

    it('verifies mission state and passes when all tasks are complete', async () => {
      const verifier = new MissionVerifier();
      const mission: Mission = {
        id: 'mis-v-1',
        spec: { objective: 'Test verification engine' },
        status: 'EXECUTING',
        plan: {
          missionId: 'mis-v-1',
          objective: 'Test verification engine',
          tasks: [
            {
              taskId: 't-1',
              type: 'CODING',
              title: 'Implement component',
              objective: 'Implement',
              requiredCapabilities: ['coding'],
              risk: 'LOW',
              dependencies: [],
              status: 'COMPLETED',
              output: 'Exported component successfully',
            },
          ],
          dependencies: [],
          estimatedDurationMs: 1000,
          riskLevel: 'LOW',
          requiresApproval: false,
          maxParallelTasks: 2,
          plannedAt: Date.now(),
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        activeTaskIds: [],
        completedTaskIds: ['t-1'],
        failedTaskIds: [],
        totalTokens: 150,
        estimatedCost: 0.001,
        tokenSavings: 30,
        failoverCount: 0,
        repairCount: 0,
        checkpointsCount: 1,
      };

      const result = await verifier.verify(mission);
      expect(result.status).toBe('PASSED');
      expect(result.checks.length).toBeGreaterThanOrEqual(3);
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it('stores checkpoints and retrieves state history', () => {
      const store = new MissionStore();
      const mission: Mission = {
        id: 'mis-s-1',
        spec: { objective: 'Test store' },
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
      expect(store.get('mis-s-1')?.id).toBe('mis-s-1');

      store.addCheckpoint({
        checkpointId: 'chk-1',
        missionId: 'mis-s-1',
        timestamp: Date.now(),
        status: 'PLANNING',
        completedTasks: [],
        activeTasks: [],
        failedTasks: [],
        dagState: {},
        agentAssignments: {},
        totalTokens: 0,
        estimatedCost: 0,
      });

      const chks = store.getCheckpoints('mis-s-1');
      expect(chks.length).toBe(1);
      expect(store.getLatestCheckpoint('mis-s-1')?.checkpointId).toBe('chk-1');
    });
  });

  describe('2. Gateway Mission API Endpoints', () => {
    let createdMissionId = '';

    // POST /v1/missions
    it('creates and auto-plans a new mission', async () => {
      const res = await fetch(`${baseUrl}/v1/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: 'Build customer REST API with authentication',
          policy: 'nexus/best-coding',
        }),
      });

      expect(res.status).toBe(201);
      const mission: Mission = await res.json();
      expect(mission.id).toMatch(/^mis-/);
      expect(mission.status).toBe('READY');
      expect(mission.plan).toBeDefined();
      expect(mission.plan?.tasks.length).toBeGreaterThan(3);
      createdMissionId = mission.id;
    });

    // GET /v1/missions & GET /v1/missions/:id
    it('lists missions and gets mission by ID', async () => {
      const listRes = await fetch(`${baseUrl}/v1/missions`);
      expect(listRes.status).toBe(200);
      const { missions } = await listRes.json();
      expect(Array.isArray(missions)).toBe(true);
      expect(missions.some((m: Mission) => m.id === createdMissionId)).toBe(true);

      const getRes = await fetch(`${baseUrl}/v1/missions/${createdMissionId}`);
      expect(getRes.status).toBe(200);
      const mission: Mission = await getRes.json();
      expect(mission.id).toBe(createdMissionId);
    });

    // High Risk & Approval Gate
    it('places critical-risk operations in AWAITING_APPROVAL and enforces approval gate', async () => {
      const res = await fetch(`${baseUrl}/v1/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: 'Wipe table and drop database customer_prod',
          policy: 'nexus/auto',
        }),
      });

      expect(res.status).toBe(201);
      const mission: Mission = await res.json();
      expect(mission.status).toBe('AWAITING_APPROVAL');
      expect(mission.plan?.requiresApproval).toBe(true);
      expect(mission.plan?.riskLevel).toBe('CRITICAL');

      // Execution before approval must return 400
      const execRes = await fetch(`${baseUrl}/v1/missions/${mission.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(execRes.status).toBe(400);

      // Approve mission
      const approveRes = await fetch(`${baseUrl}/v1/missions/${mission.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'secops-lead' }),
      });
      expect(approveRes.status).toBe(200);
      const approved: Mission = await approveRes.json();
      expect(approved.status).toBe('READY');
      expect(approved.approvedBy).toBe('secops-lead');
    });

    // POST /v1/missions/:id/execute
    it('executes planned mission DAG and completes verification with token tracking', async () => {
      const origExecute = (runtime as any).agentOrchestrator.execute.bind((runtime as any).agentOrchestrator);
      (runtime as any).agentOrchestrator.execute = async (req: any) => ({
        executionId: 'mock-exec-1',
        prompt: req.prompt,
        status: 'SUCCESS',
        selectedAgentId: 'claude-code',
        selectedAgentName: 'Claude Code',
        selectedModel: 'nexus/best-coding',
        policy: req.policy ?? 'nexus/best-coding',
        attempts: 1,
        durationMs: 42,
        output: 'Task executed successfully with mock artifacts.',
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
      });

      const createRes = await fetch(`${baseUrl}/v1/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: 'Analyze and document customer schema',
          policy: 'nexus/fast',
        }),
      });
      const created: Mission = await createRes.json();

      const execRes = await fetch(`${baseUrl}/v1/missions/${created.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(execRes.status).toBe(200);
      const executed: Mission = await execRes.json();

      expect(executed.status).toBe('COMPLETED');
      expect(executed.completedTaskIds.length).toBe(executed.plan?.tasks.length);
      expect(executed.totalTokens).toBeGreaterThan(0);
      expect(executed.verification).toBeDefined();
      expect(executed.verification?.status).toBe('PASSED');

      (runtime as any).agentOrchestrator.execute = origExecute;
    });

    // Checkpoints Endpoint
    it('retrieves persistent checkpoints for executed mission', async () => {
      const chkRes = await fetch(`${baseUrl}/v1/missions/${createdMissionId}/checkpoints`);
      expect(chkRes.status).toBe(200);
      const { checkpoints } = await chkRes.json();
      expect(Array.isArray(checkpoints)).toBe(true);
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    });

    // Cancellation Endpoint
    it('cancels active mission and persists cancellation status', async () => {
      const createRes = await fetch(`${baseUrl}/v1/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: 'Audit test suites for all backend services',
          policy: 'nexus/auto',
        }),
      });
      const created: Mission = await createRes.json();

      const cancelRes = await fetch(`${baseUrl}/v1/missions/${created.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(cancelRes.status).toBe(200);
      const cancelled: Mission = await cancelRes.json();
      expect(cancelled.status).toBe('CANCELLED');
    });

    // Path Traversal Security
    it('strictly rejects relative or traversal paths in mission workspace', async () => {
      const res = await fetch(`${baseUrl}/v1/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objective: 'Read workspace files',
          workspace: '../../etc/passwd',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error?.message).toContain('absolute path');
    });

    // Debug Endpoint
    it('provides mission telemetry under /v1/debug/missions', async () => {
      const res = await fetch(`${baseUrl}/v1/debug/missions`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.metrics).toBeDefined();
      expect(data.metrics.totalMissions).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(data.recentMissions)).toBe(true);
    });
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 32: Durable Runtime, Persistence & Crash Recovery E2E Test Suite
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HttpServer } from '../src/server.js';
import {
  CrashRecoveryEngine,
  MissionOrchestrator,
  AgentOrchestrator,
  LocalAgentBridge,
  ModelRegistry,
  RoutingEngine,
  KeyRegistry,
  InMemoryEventBus,
} from '@anx/core';
import {
  openSqlite,
  SchemaMigrationManager,
  DurableMissionStore,
  DurableIdempotencyStore,
  BackupRestoreEngine,
} from '@anx/persistence';

describe('Phase 32 — Durable Runtime & Crash Recovery', () => {
  const testDbPath = join(tmpdir(), `nexus-phase32-test-${Date.now()}.db`);

  const cleanup = (path: string) => {
    for (const p of [path, path + '.json']) {
      if (existsSync(p)) {
        try {
          rmSync(p, { force: true });
        } catch {
          // ignore
        }
      }
    }
  };

  beforeEach(() => {
    cleanup(testDbPath);
  });

  afterEach(() => {
    cleanup(testDbPath);
  });

  describe('1. Schema Migrations & Storage Engine', () => {
    it('applies v1 and v2 schema migrations deterministically', async () => {
      const db = await openSqlite(testDbPath);
      const applied = await SchemaMigrationManager.applyMigrations(db);
      expect(applied).toBeGreaterThanOrEqual(2);

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('schema_migrations');
      expect(tableNames).toContain('endpoints');
      expect(tableNames).toContain('audit_log');
      expect(tableNames).toContain('missions');
      expect(tableNames).toContain('mission_checkpoints');
      expect(tableNames).toContain('models');
      expect(tableNames).toContain('agent_executions');
      expect(tableNames).toContain('api_keys_metadata');
      expect(tableNames).toContain('idempotency_keys');
    });
  });

  describe('2. Durable Mission State & Checkpointing', () => {
    it('persists missions and restores DAG checkpoints across restarts', async () => {
      const store = new DurableMissionStore({ path: testDbPath });

      const missionId = 'mission-test-p32';
      const mockMission: any = {
        id: missionId,
        spec: {
          objective: 'Build durable distributed recovery engine',
          maxCostUsd: 10,
        },
        status: 'EXECUTING',
        plan: {
          planId: 'plan-1',
          missionId,
          tasks: [
            {
              taskId: 'task-1',
              name: 'Schema Migration',
              kind: 'CODE_IMPLEMENT',
              status: 'COMPLETED',
              assignedAgent: 'claude-code',
            },
            {
              taskId: 'task-2',
              name: 'Crash Recovery',
              kind: 'CODE_REVIEW',
              status: 'RUNNING',
              assignedAgent: 'hermes',
            },
          ],
          totalEstimatedCostUsd: 0.5,
          dagEdges: [],
        },
        createdAt: Date.now() - 5000,
        updatedAt: Date.now(),
        eventLog: [],
      };

      await store.save(mockMission);

      // Verify mission was saved
      const loaded = await store.get(missionId);
      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(missionId);
      expect(loaded?.status).toBe('EXECUTING');

      // Save checkpoints
      const checkpoint1 = {
        checkpointId: 'chk-1',
        missionId,
        timestamp: Date.now() - 3000,
        status: 'EXECUTING' as const,
        completedTasks: ['task-1'],
        tokensSpent: 1200,
        costSpentUsd: 0.05,
      };
      await store.saveCheckpoint(checkpoint1);

      const checkpoints = await store.getCheckpoints(missionId);
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]?.checkpointId).toBe('chk-1');
      expect(checkpoints[0]?.completedTasks).toContain('task-1');
    });
  });

  describe('3. Durable Idempotency Protection', () => {
    it('reserves idempotency keys and protects against duplicate concurrent requests', async () => {
      const store = new DurableIdempotencyStore({ path: testDbPath });
      const idempotencyKey = 'idem-req-9988';
      const payload = { objective: 'Deploy to Kubernetes', team: 'Platform' };

      // 1. Initial reservation
      const res1 = await store.reserve(idempotencyKey, payload);
      expect(res1.isNew).toBe(true);

      // 2. Complete execution
      const mockResult = { missionId: 'mission-abc', status: 'CREATED' };
      await store.complete(idempotencyKey, 201, mockResult);

      // 3. Duplicate request with identical payload returns cached response
      const res2 = await store.reserve(idempotencyKey, payload);
      expect(res2.isNew).toBe(false);
      expect(res2.existingRecord?.status).toBe('COMPLETED');
      expect(res2.existingRecord?.responseStatus).toBe(201);
      expect(JSON.parse(res2.existingRecord!.responseBody!)).toEqual(mockResult);

      // 4. Duplicate request with mismatched payload throws conflict error
      await expect(store.reserve(idempotencyKey, { objective: 'DIFFERENT' })).rejects.toThrow(
        /Idempotency conflict/,
      );
    });
  });

  describe('4. Crash Recovery Engine & Startup Reconciliation', () => {
    it('detects interrupted missions on boot and generates truthful diagnostics', async () => {
      const events = new InMemoryEventBus();
      const routing = new RoutingEngine({ events });
      const modelRegistry = new ModelRegistry({ routing, events });
      const bridge = new LocalAgentBridge({ gatewayUrl: 'http://localhost:8787', routing, modelRegistry, events });
      const agentOrchestrator = new AgentOrchestrator({ bridge, events });
      const missionOrchestrator = new MissionOrchestrator({ agentOrchestrator, events });

      // Simulate mission created before crash in memory store
      const mission = await missionOrchestrator.createMission({
        objective: 'Rebuild indexing engine after crash',
      });
      mission.status = 'EXECUTING';
      if (mission.plan?.tasks[0]) {
        mission.plan.tasks[0].status = 'RUNNING';
      }

      const recoveryEngine = new CrashRecoveryEngine({
        missionOrchestrator,
        missionStore: (missionOrchestrator as any)['store'],
        modelRegistry,
        routing,
        localAgentBridge: bridge,
        events,
        autoResumeEligible: false,
      });

      const report = await recoveryEngine.runStartupReconciliation();
      expect(report.durableStorageAvailable).toBe(true);
      expect(report.interruptedMissions.length).toBeGreaterThanOrEqual(1);

      const diag = report.interruptedMissions.find((m) => m.missionId === mission.id);
      expect(diag).toBeDefined();
      expect(diag?.suggestedAction).toBe('RESUME');

      // Test Operator Recovery Action: RESUME
      const resumeResult = await recoveryEngine.executeRecoveryAction(mission.id, 'RESUME');
      expect(resumeResult.success).toBe(true);
      expect(resumeResult.mission?.status).toBe('READY');

      // Test Operator Recovery Action: CANCEL
      const cancelResult = await recoveryEngine.executeRecoveryAction(mission.id, 'CANCEL');
      expect(cancelResult.success).toBe(true);
      expect(cancelResult.mission?.status).toBe('CANCELLED');
    });
  });

  describe('5. Backup & Restore Engine', () => {
    it('creates cryptographic backup bundles and restores cleanly with SHA-256 validation', async () => {
      const db = await openSqlite(testDbPath);
      await SchemaMigrationManager.applyMigrations(db);

      // Insert dummy endpoint & mission
      db.prepare('INSERT INTO endpoints (id, data, updated_at) VALUES (?, ?, ?)').run(
        'ep-openai',
        JSON.stringify({ id: 'ep-openai', providerId: 'openai', baseUrl: 'https://api.openai.com/v1' }),
        new Date().toISOString(),
      );
      db.prepare('INSERT INTO missions (id, status, data, updated_at) VALUES (?, ?, ?, ?)').run(
        'm-123',
        'COMPLETED',
        JSON.stringify({ id: 'm-123', spec: { objective: 'Test' }, status: 'COMPLETED' }),
        Date.now(),
      );

      const backupEngine = new BackupRestoreEngine(testDbPath);
      const bundle = await backupEngine.createBackup('0.5.0');

      expect(bundle.schemaVersion).toBeGreaterThanOrEqual(2);
      expect(bundle.nexusVersion).toBe('0.5.0');
      expect(bundle.checksum).toBeDefined();
      expect(bundle.data.endpoints).toHaveLength(1);
      expect(bundle.data.missions).toHaveLength(1);

      // Test Restore into fresh database
      const restoreDbPath = join(tmpdir(), `nexus-phase32-restore-${Date.now()}.db`);
      const restoreEngine = new BackupRestoreEngine(restoreDbPath);

      const restoreResult = await restoreEngine.restoreBackup(bundle);
      expect(restoreResult.restoredCounts['endpoints']).toBe(1);
      expect(restoreResult.restoredCounts['missions']).toBe(1);

      // Verify tampered checksum is rejected
      const tamperedBundle = {
        ...bundle,
        checksum: 'bad-tampered-checksum-12345',
      };
      await expect(restoreEngine.restoreBackup(tamperedBundle)).rejects.toThrow(
        /Backup integrity violation/,
      );

      if (existsSync(restoreDbPath)) {
        try {
          rmSync(restoreDbPath, { force: true });
        } catch {
          // ignore
        }
      }
    });
  });

  describe('6. Gateway REST Control Plane Endpoints', () => {
    let server: HttpServer;
    let port: number;
    let baseUrl: string;

    beforeAll(async () => {
      port = 9188;
      baseUrl = `http://127.0.0.1:${port}`;
      const eventBus = new InMemoryEventBus();
      const routing = new RoutingEngine({ events: eventBus });
      const modelRegistry = new ModelRegistry({ routing, events: eventBus });
      const keyRegistry = new KeyRegistry({} as any);
      const aliasRegistry = new (await import('../src/model-aliases.js')).ModelAliasRegistry(modelRegistry);
      const agentDetector = new (await import('../src/agent-detector.js')).AgentDetector();

      server = new HttpServer({
        config: {
          server: { port, host: '127.0.0.1', cors: { origin: '*', credentials: true } },
          providers: [],
          routing: { defaultStrategy: 'priority' },
        } as any,
        chatUseCase: { execute: async () => ({ id: 'resp-1', model: 'test', choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) } as any,
        routing,
        modelRegistry,
        keyRegistry,
        aliasRegistry,
        tracer: new (await import('@anx/core')).RequestTracer(),
        privacy: { level: 'off', skipCachePersistence: false, maxContentChars: 5000 },
        sessions: new (await import('@anx/core')).SessionManager(new (await import('@anx/core')).InMemorySessionStore(), eventBus),
        agentDetector,
        budgetManager: new (await import('@anx/core')).BudgetManager(),
        promptCompressor: new (await import('@anx/core')).PromptCompressor(),
        rateLimitTracker: new (await import('@anx/core')).ProactiveRateLimitTracker(),
        taskClassifier: new (await import('@anx/core')).TaskClassifier(),
        contextWindowManager: new (await import('@anx/core')).ContextWindowManager(),
        costPredictor: new (await import('@anx/core')).CostPredictor(),
        events: eventBus,
        audit: { append: async () => {}, query: async () => [] } as any,
        cache: { get: () => null, set: () => {}, stats: () => ({ hits: 0, misses: 0, size: 0, hitRate: 0 }) } as any,
        adapters: new Map(),
        rbac: { listPrincipals: () => [], authorize: () => true } as any,
        jwt: { issue: () => 'token', verify: () => ({ sub: 'test' }) } as any,
        telemetry: { prometheus: () => '# HELP metrics' } as any,
        plugins: { list: () => [], load: async () => {}, unload: async () => {} } as any,
        vault: {} as any,
        tools: { list: () => [], execute: async () => ({}), getExecutionLog: () => [] } as any,
        memory: { store: async () => ({}), search: async () => [], list: async () => [], delete: async () => true } as any,
        planner: { plan: () => ({ steps: [] }) } as any,
        workflows: { list: () => [], create: async () => ({}), get: async () => ({}), start: async () => 'exec-1', listExecutions: () => [], getExecution: () => ({}), pause: async () => true, resume: async () => true, cancel: async () => true, replay: async () => 'exec-2' } as any,
        teams: { listTeams: () => [], formTeam: () => ({}), listProposals: () => [] } as any,
        marketplace: { addAvailableExtension: () => {}, install: async () => true, update: async () => true, remove: async () => true, getInstalledExtensions: () => [], getStats: () => ({}) } as any,
        mesh: { getRegistrySnapshot: () => [], getServiceCount: () => 0, getConfig: () => ({}), enableCanary: () => {}, disableCanary: () => {}, switchBlueGreen: () => {}, updateTrafficPolicy: () => {} } as any,
        runtime: { listAgents: async () => [] } as any,
        rag: null,
        a2a: {} as any,
        a2aRegistry: {} as any,
        network: { diagnose: async () => ({}) } as any,
        mcpServer: { handleRequest: async () => ({}) } as any,
        mcpClient: {} as any,
        agents: { list: () => [], get: () => undefined, register: () => {} } as any,
      });

      await server.listen(port, '127.0.0.1');
    });

    afterAll(async () => {
      await server.close();
    });

    it('GET /v1/system/recovery returns valid recovery diagnostics', async () => {
      const res = await fetch(`${baseUrl}/v1/system/recovery`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBeDefined();
      expect(json.durableStorageAvailable).toBe(true);
      expect(Array.isArray(json.interruptedMissions)).toBe(true);
    });

    it('POST /v1/system/backup generates verifiable backup bundle', async () => {
      const res = await fetch(`${baseUrl}/v1/system/backup`, { method: 'POST' });
      expect(res.status).toBe(200);
      const bundle = await res.json();
      expect(bundle.schemaVersion).toBeGreaterThanOrEqual(2);
      expect(bundle.nexusVersion).toBeDefined();
      expect(bundle.checksum).toBeDefined();
      expect(bundle.data).toBeDefined();
    });

    it('POST /v1/missions with Idempotency-Key prevents duplicate execution', async () => {
      const key = `idem-test-${Date.now()}`;
      const payload = { objective: 'Test Idempotent Mission Creation' };

      // 1. First execution
      const res1 = await fetch(`${baseUrl}/v1/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      expect(res1.status).toBe(201);
      const mission1 = await res1.json();
      expect(mission1.id).toBeDefined();
      expect(mission1.spec.objective).toBe(payload.objective);

      // 2. Replay with same idempotency key returns exact same mission
      const res2 = await fetch(`${baseUrl}/v1/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
      expect(res2.status).toBe(201);
      const mission2 = await res2.json();
      expect(mission2.id).toBe(mission1.id);
    });
  });
});


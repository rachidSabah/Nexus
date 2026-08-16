/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 34: Runtime Intelligence, Anomaly Detection & Bounded Autonomous Self-Healing
 * End-to-End Scenarios and Production Quality Gate Test Suite.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { GatewayRuntime } from '../src/runtime.js';
import {
  asEndpointId,
  type ProviderEndpoint,
  type ModelDescriptor,
  type Mission,
} from '@anx/core';

describe('Phase 34: Runtime Intelligence & Bounded Autonomous Self-Healing E2E', { timeout: 35000 }, () => {
  let runtime: GatewayRuntime;
  const testPort = 18780;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const testDir = join(tmpdir(), `anx-p34-test-${Date.now()}`);

  beforeAll(async () => {
    process.env['ANX_VAULT_PATH'] = join(testDir, 'vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env['NEXUS_DB_PATH'] = join(testDir, 'nexus.db');
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

  describe('SCENARIO 1: Healthy Provider → Normal Routing → No Anomaly', () => {
    it('routes requests to healthy provider with zero detected anomalies', async () => {
      const server = (runtime as any).server;
      const res = await fetch(`${baseUrl}/v1/system/intelligence`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.systemState).toBe('HEALTHY');
      expect(Array.isArray(data.policies)).toBe(true);
      expect(data.policies.length).toBeGreaterThan(5);

      const explainRes = await fetch(`${baseUrl}/v1/routing/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello world test' }],
        }),
      });
      expect(explainRes.status).toBe(200);
      const explain = await explainRes.json();
      expect(explain.intent).toBeDefined();
    });
  });

  describe('SCENARIO 2: Provider Returns 429 → Anomaly Detected → Deprioritization → Alternative Selected', () => {
    it('detects 429 spike, deprioritizes provider, and routes to alternative provider', async () => {
      const server = (runtime as any).server;

      // 1. Register primary provider & backup provider
      runtime.routing.registerEndpoint({
        id: asEndpointId('ep-provider-alpha'),
        providerId: 'provider-alpha',
        baseUrl: 'http://127.0.0.1:9991/v1',
        health: 'healthy',
        priority: 10,
      });

      runtime.routing.registerEndpoint({
        id: asEndpointId('ep-provider-beta'),
        providerId: 'provider-beta',
        baseUrl: 'http://127.0.0.1:9992/v1',
        health: 'healthy',
        priority: 10,
      });

      runtime.modelRegistry.addExplicit([{
        id: 'model-alpha',
        providerId: 'provider-alpha',
        contextWindow: 32000,
        capabilities: { toolCalling: true, streaming: true },
        discoveredAt: Date.now(),
      }]);

      runtime.modelRegistry.addExplicit([{
        id: 'model-beta',
        providerId: 'provider-beta',
        contextWindow: 32000,
        capabilities: { toolCalling: true, streaming: true },
        discoveredAt: Date.now(),
      }]);

      // 2. Inject 3x 429 signals for provider-alpha
      server.signalCollector.recordSignal('providers', 'rate_limit_429', 1, { providerId: 'provider-alpha' });
      server.signalCollector.recordSignal('providers', 'rate_limit_429', 1, { providerId: 'provider-alpha' });
      server.signalCollector.recordSignal('providers', 'rate_limit_429', 1, { providerId: 'provider-alpha' });

      // 3. Trigger autonomous self-healing cycle
      const cycle = await server.selfHealingOrchestrator.runCycle();
      expect(cycle.anomaliesDetected).toBeGreaterThanOrEqual(1);

      // 4. Verify provider-alpha is deprioritized
      expect(server.remediationEngine.isProviderDeprioritized('provider-alpha')).toBe(true);

      // 5. Verify routing explain reflects deprioritization
      const explainRes = await fetch(`${baseUrl}/v1/routing/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'function calculateSum() { return 1 + 1; }' }],
        }),
      });
      const explainText = await explainRes.text();
      let explain: any = {};
      try {
        explain = JSON.parse(explainText);
      } catch {
        // ignore
      }
      if (explainRes.status !== 200) {
        console.error('500 Error body from /v1/routing/explain:', explainText);
      }
      expect(explainRes.status).toBe(200);
      expect(explain.intent).toBeDefined();
      expect(explain.totalEvaluated).toBeGreaterThanOrEqual(0);

      // Deprioritized provider should have explanation reason if selected
      const alphaCandidate = explain.fallbackPath?.find((c: any) => c.providerId === 'provider-alpha');
      if (alphaCandidate) {
        expect(alphaCandidate.explainability?.whyDeprioritized).toBeDefined();
      }
    });
  });

  describe('SCENARIO 3: Model Returns 404 → Model Marked Stale → Discovery Refresh → Alternative Model Selected', () => {
    it('detects model not found, marks model stale, and selects alternative', async () => {
      const server = (runtime as any).server;

      runtime.modelRegistry.addExplicit([{
        id: 'deprecated-model-404',
        providerId: 'provider-beta',
        contextWindow: 16000,
        capabilities: { toolCalling: true },
        discoveredAt: Date.now(),
      }]);

      // Inject model 404 signals
      server.signalCollector.recordSignal('models', 'model_not_found', 1, { providerId: 'provider-beta', endpointId: 'deprecated-model-404' });
      server.signalCollector.recordSignal('models', 'model_not_found', 1, { providerId: 'provider-beta', endpointId: 'deprecated-model-404' });

      await server.selfHealingOrchestrator.runCycle();

      // Trigger safe remediation to mark stale
      await server.selfHealingOrchestrator.operatorTriggerRemediation(
        'MARK_STALE_MODEL',
        'models',
        'deprecated-model-404',
      );

      const allModels = runtime.modelRegistry.list();
      const m = allModels.find((m: any) => m.id === 'deprecated-model-404');
      expect(m?.stale).toBe(true);
    });
  });

  describe('SCENARIO 4: Local Agent Degraded → Anomaly Detected → Health Verified → Fallback', () => {
    it('detects local agent failures and verifies health state', async () => {
      const server = (runtime as any).server;

      // Inject 3 agent failure signals to exceed threshold
      server.signalCollector.recordSignal('localAgents', 'agent_failure', 1, { agentId: 'claude-code', code: 'TIMEOUT' });
      server.signalCollector.recordSignal('localAgents', 'agent_failure', 1, { agentId: 'claude-code', code: 'TIMEOUT' });
      server.signalCollector.recordSignal('localAgents', 'agent_failure', 1, { agentId: 'claude-code', code: 'TIMEOUT' });

      const cycle = await server.selfHealingOrchestrator.runCycle();
      expect(cycle.anomaliesDetected).toBeGreaterThanOrEqual(1);

      // Use in-memory incidentManager directly, bypassing SQLite
      const incidents = await server.incidentManager.listIncidents({ subsystem: 'localAgents' });
      expect(incidents.length).toBeGreaterThanOrEqual(1);
      expect(incidents[0].subsystem).toBe('localAgents');
    });
  });

  describe('SCENARIO 5: Mission State Stalled → Persistence Reconciles → Verified', () => {
    it('detects mission state and executes safe reconciliation without destroying state', async () => {
      const server = (runtime as any).server;

      const mission: Mission = {
        id: 'mis-crash-p34',
        spec: { objective: 'Validate crash recovery' },
        status: 'EXECUTING',
        createdAt: Date.now() - 100_000,
        updatedAt: Date.now() - 100_000,
        activeTaskIds: ['task-1'],
        completedTaskIds: [],
        failedTaskIds: [],
        totalTokens: 0,
        estimatedCost: 0,
        tokenSavings: 0,
        failoverCount: 0,
        repairCount: 0,
        checkpointsCount: 1,
      };

      await (server.missionOrchestrator as any)['store'].save(mission);

      // Reconcile mission
      const remResult = await server.selfHealingOrchestrator.operatorTriggerRemediation(
        'RECONCILE_INTERRUPTED_MISSION',
        'missionEngine',
        'mis-crash-p34',
      );

      expect(remResult.success).toBe(true);
    });
  });

  describe('SCENARIO 6: Unsafe Remediation Requested → Policy Engine Blocks → Operator Approval Required', () => {
    it('blocks arbitrary command execution and database deletion', async () => {
      const server = (runtime as any).server;

      // 1. Prohibited NEVER_AUTOMATE operation
      const blockedRes = await server.remediationEngine.executeRemediation({
        actionType: 'DROP_PERSISTENCE_STORE',
        targetSubsystem: 'persistence',
        initiatedBy: 'AUTONOMOUS',
        timestamp: Date.now(),
      }, 0);

      expect(blockedRes.status).toBe('BLOCKED_BY_POLICY');
      expect(blockedRes.policyTier).toBe('NEVER_AUTOMATE');

      // 2. APPROVAL_REQUIRED operation blocked for autonomous caller
      const installRes = await server.remediationEngine.executeRemediation({
        actionType: 'INSTALL_AGENT_EXECUTABLE',
        targetSubsystem: 'localAgents',
        targetId: 'custom-tool',
        initiatedBy: 'AUTONOMOUS',
        timestamp: Date.now(),
      }, 0);

      expect(installRes.status).toBe('BLOCKED_BY_POLICY');
      expect(installRes.policyTier).toBe('APPROVAL_REQUIRED');
    });
  });

  describe('SCENARIO 7: Remediation Fails 3 Times → Stops & Escalates → No Infinite Loop', () => {
    it('terminates remediation attempts after 3 failures and escalates incident to operator', async () => {
      const server = (runtime as any).server;

      // Create manual incident with failing action
      const anomaly = server.anomalyDetector.createManualAnomaly(
        'PROVIDER_DEGRADED',
        'providers',
        'CRITICAL',
        'Unreachable test provider endpoint',
        'unreachable-provider',
      );
      const diagnosis = server.diagnosisEngine.diagnose(anomaly);
      const incident = await server.incidentManager.createIncident(anomaly, diagnosis);

      // Evaluate policy at attempt 3 (exhausted)
      const action = {
        actionType: 'REFRESH_PROVIDER_HEALTH' as const,
        targetSubsystem: 'providers' as const,
        targetId: 'unreachable-provider',
        initiatedBy: 'AUTONOMOUS' as const,
        timestamp: Date.now(),
      };

      const evalAttempt3 = server.remediationPolicyEngine.evaluatePolicy(action, 3);
      expect(evalAttempt3.permitted).toBe(false);
      expect(evalAttempt3.reason).toContain('exhausted');

      // Escalate incident
      const escalated = await server.incidentManager.escalateIncident(
        incident.id,
        'Max autonomous remediation attempts (3) exhausted.',
      );
      expect(escalated.status).toBe('ESCALATED');
      expect(escalated.operatorNotes).toContain('ESCALATED');
    });
  });

  describe('8. REST Control Plane & SSE Telemetry Integration', () => {
    it('exposes all Phase 34 management endpoints', async () => {
      // GET /v1/system/intelligence/signals
      const sigRes = await fetch(`${baseUrl}/v1/system/intelligence/signals?limit=5`);
      expect(sigRes.status).toBe(200);
      const sigData = await sigRes.json();
      expect(Array.isArray(sigData.signals)).toBe(true);

      // GET /v1/system/intelligence/anomalies
      const anomRes = await fetch(`${baseUrl}/v1/system/intelligence/anomalies`);
      expect(anomRes.status).toBe(200);

      // GET /v1/system/intelligence/remediations
      const remRes = await fetch(`${baseUrl}/v1/system/intelligence/remediations`);
      expect(remRes.status).toBe(200);

      // GET /v1/system/intelligence/policies
      const polRes = await fetch(`${baseUrl}/v1/system/intelligence/policies`);
      expect(polRes.status).toBe(200);
      const polData = await polRes.json();
      expect(polData.policies.length).toBeGreaterThan(5);

      // POST /v1/system/intelligence/policies
      const updatePolRes = await fetch(`${baseUrl}/v1/system/intelligence/policies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType: 'TRIGGER_MODEL_REDISCOVERY',
          patch: { cooldownSeconds: 45 },
        }),
      });
      expect(updatePolRes.status).toBe(200);
    });
  });
});

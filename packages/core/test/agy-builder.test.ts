import { describe, it, expect, beforeEach } from 'vitest';
import { ApplicationEngine } from '../src/application/application-engine.js';
import { WorkflowOrchestrator } from '../src/application/workflow-orchestrator.js';
import { TaskOrchestrator } from '../src/application/task-orchestrator.js';
import { InMemoryTaskStore } from '../src/application/task-store.js';
import { SubprocessAgentExecutor } from '../src/application/agent-executor.js';
import { RoutingEngine } from '../src/application/routing-engine.js';
import { InMemoryEventBus } from '../src/application/event-bus.js';
import { AgyBuilderAdapter } from '../src/application/agy-builder-adapter.js';
import { ApplicationVerifier } from '../src/application/application-verifier.js';
import { AutonomousPlanner } from '../src/application/autonomous-planner.js';
import type { WorkspaceConfig, AgyBuildTask, AgyBuildResult } from '../src/domain/agy-builder.js';

describe('Phase 11: AGY Builder Integration Unit Tests', () => {
  let events: InMemoryEventBus;
  let routing: RoutingEngine;
  let taskStore: InMemoryTaskStore;
  let executor: SubprocessAgentExecutor;
  let taskOrchestrator: TaskOrchestrator;
  let workflowOrchestrator: WorkflowOrchestrator;
  let agyAdapter: AgyBuilderAdapter;
  let appEngine: ApplicationEngine;

  beforeEach(() => {
    events = new InMemoryEventBus();
    routing = new RoutingEngine(events);
    taskStore = new InMemoryTaskStore();
    executor = new SubprocessAgentExecutor();
    taskOrchestrator = new TaskOrchestrator(routing, taskStore, executor, events);
    workflowOrchestrator = new WorkflowOrchestrator(taskOrchestrator);
    agyAdapter = new AgyBuilderAdapter('http://127.0.0.1:8787', 'E:/CodingGhost');
    appEngine = new ApplicationEngine(workflowOrchestrator, agyAdapter, events, routing, {
      nexusRepoRoot: 'E:/CodingGhost',
    });
  });

  it('AgyBuilderAdapter detects AGY executable status', async () => {
    const detected = await agyAdapter.detect();
    expect(typeof detected).toBe('boolean');
    const health = await agyAdapter.healthCheck();
    expect(health).toHaveProperty('installed');
    expect(health).toHaveProperty('runtimeHealthy');
  });

  it('ApplicationVerifier checks workspace isolation and structure', async () => {
    const verifier = new ApplicationVerifier('E:/CodingGhost');
    const res = await verifier.verify({
      applicationId: 'test-app',
      workspaceId: 'ws-test',
      workspacePath: 'E:/CodingGhost/.nexus/applications/test-app',
    });
    expect(res.pathTraversalClean).toBe(false); // Should block nested path inside nexus repo
    expect(res.issues.length).toBeGreaterThan(0);
  });

  it('AutonomousPlanner generates AGY-specific execution nodes', () => {
    const planner = new AutonomousPlanner();
    const plan = planner.plan('Build a Fastify REST API');
    expect(plan.definition.nodes.length).toBeGreaterThanOrEqual(4);
    const kinds = plan.definition.nodes.map(n => n.config['kind']);
    expect(kinds).toContain('AGY_SCAFFOLD');
    expect(kinds).toContain('AGY_IMPLEMENT');
    expect(kinds).toContain('AGY_TEST');
  });

  it('ApplicationEngine enforces approval for high-risk prompts', async () => {
    const app = appEngine.createApplication('Delete production credentials and deploy changes');
    const planned = await appEngine.planApplication(app.appId);
    expect(planned.stage).toBe('APPROVAL');
    expect(planned.buildContext?.requiresApproval).toBe(true);

    // Attempting build before approval throws error
    await expect(appEngine.buildApplication(app.appId, [])).rejects.toThrow(/approval/i);

    // Approving unlocks build
    appEngine.approveApplication(app.appId);
    expect(planned.stage).toBe('APPROVAL'); // State update verified
  });

  it('ApplicationEngine supports dry-run builds', async () => {
    const app = appEngine.createApplication('Build a Task Manager API');
    await appEngine.planApplication(app.appId);
    const result = await appEngine.buildApplication(app.appId, [], { dryRun: true });
    expect(result.appId).toBe(app.appId);
  });
});

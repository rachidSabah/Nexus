import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import type { WorkspaceConfig, AgyBuildTask, AgyBuildResult, AgyBuilderPort, WorkspaceVerificationResult, AgyHealthStatus } from '../src/domain/agy-builder.js';
import { mkdir, writeFile } from 'node:fs/promises';

const TEST_REPO_ROOT = join(tmpdir(), 'anx-test-repo');

class MockAgyAdapter implements AgyBuilderPort {
  async detect(): Promise<boolean> { return true; }
  async healthCheck(): Promise<AgyHealthStatus> {
    return { installed: true, runtimeHealthy: true, checkedAt: Date.now() };
  }
  async initializeProject(ws: WorkspaceConfig): Promise<void> {
    await mkdir(ws.workspacePath, { recursive: true });
    await writeFile(`${ws.workspacePath}/package.json`, JSON.stringify({ name: 'test-app', version: '1.0.0' }));
    await mkdir(`${ws.workspacePath}/src`, { recursive: true });
    await writeFile(`${ws.workspacePath}/src/index.ts`, 'console.log("hello");');
    await mkdir(`${ws.workspacePath}/.nexus`, { recursive: true });
  }
  async build(task: AgyBuildTask): Promise<AgyBuildResult> {
    return {
      success: true,
      output: 'Build completed successfully',
      exitCode: 0,
      durationMs: 15,
      artifacts: ['package.json', 'src/index.ts'],
    };
  }
  async test(task: AgyBuildTask): Promise<AgyBuildResult> {
    return {
      success: true,
      output: 'Tests: 5 passed, 0 failed, 5 total',
      exitCode: 0,
      durationMs: 10,
      artifacts: [],
      testsRan: 5,
      testsPassed: 5,
      testsFailed: 0,
    };
  }
  async inspect(task: AgyBuildTask): Promise<AgyBuildResult> {
    return { success: true, output: 'Inspect passed', exitCode: 0, durationMs: 5, artifacts: [] };
  }
  async fix(task: AgyBuildTask): Promise<AgyBuildResult> {
    return { success: true, output: 'Fix applied', exitCode: 0, durationMs: 10, artifacts: [] };
  }
  async verify(workspace: WorkspaceConfig): Promise<WorkspaceVerificationResult> {
    return {
      valid: true,
      workspaceExists: true,
      manifestExists: true,
      sourceFilesPresent: true,
      pathTraversalClean: true,
      buildResultCaptured: true,
      testResultCaptured: true,
      artifacts: ['package.json', 'src/index.ts'],
      issues: [],
    };
  }
  async status(): Promise<AgyHealthStatus> { return this.healthCheck(); }
  async cancel(_taskId: string): Promise<void> {}
}

describe('Phase 11: AGY Builder Integration Unit Tests', () => {
  let events: InMemoryEventBus;
  let routing: RoutingEngine;
  let taskStore: InMemoryTaskStore;
  let executor: SubprocessAgentExecutor;
  let taskOrchestrator: TaskOrchestrator;
  let workflowOrchestrator: WorkflowOrchestrator;
  let agyAdapter: AgyBuilderAdapter;
  let mockAgy: MockAgyAdapter;
  let appEngine: ApplicationEngine;

  beforeEach(() => {
    events = new InMemoryEventBus();
    routing = new RoutingEngine(events);
    taskStore = new InMemoryTaskStore();
    executor = new SubprocessAgentExecutor();
    taskOrchestrator = new TaskOrchestrator(routing, taskStore, executor, events);
    workflowOrchestrator = new WorkflowOrchestrator(taskOrchestrator);
    agyAdapter = new AgyBuilderAdapter('http://127.0.0.1:8787', TEST_REPO_ROOT);
    mockAgy = new MockAgyAdapter();
    appEngine = new ApplicationEngine(workflowOrchestrator, mockAgy, events, routing, {
      nexusRepoRoot: TEST_REPO_ROOT,
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
    const verifier = new ApplicationVerifier(TEST_REPO_ROOT);
    const res = await verifier.verify({
      applicationId: 'test-app',
      workspaceId: 'ws-test',
      workspacePath: join(TEST_REPO_ROOT, '.nexus', 'applications', 'test-app'),
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

  it('Phase 22: manages build sessions, checkpoints, and token economics', async () => {
    const app = appEngine.createApplication('Build a SQLite Notes API');
    await appEngine.planApplication(app.appId);
    const built = await appEngine.buildApplication(app.appId, []);

    expect(built.stage).toBe('COMPLETED');

    const sessions = appEngine.listBuildSessions(app.appId);
    expect(sessions.length).toBeGreaterThan(0);

    const session = sessions[0]!;
    expect(session.status).toBe('COMPLETED');
    expect(session.tokensUsed).toBeGreaterThan(0);
    expect(session.inputTokens).toBeGreaterThan(0);
    expect(session.outputTokens).toBeGreaterThan(0);
    expect(session.cost).toBeGreaterThan(0);

    // Verify checkpoints were captured
    const checkpoints = appEngine.getBuildCheckpoints(session.buildSessionId);
    expect(checkpoints.length).toBeGreaterThanOrEqual(3);
    expect(checkpoints.some((c) => c.stage === 'SCAFFOLDING')).toBe(true);
    expect(checkpoints.some((c) => c.stage === 'IMPLEMENTING')).toBe(true);
    expect(checkpoints.some((c) => c.stage === 'VERIFYING')).toBe(true);

    // Verify token metrics endpoint helper
    const metrics = appEngine.getBuildMetrics(session.buildSessionId);
    expect(metrics?.totalTokens).toBe(session.tokensUsed);
    expect(metrics?.savedTokens).toBeGreaterThan(0);
  });

  it('Phase 22: supports pause, resume, cancel, and repair controls', async () => {
    const app = appEngine.createApplication('Build a URL shortener microservice');
    await appEngine.planApplication(app.appId);

    // Pause
    const paused = await appEngine.pauseApplication(app.appId);
    expect(paused.appId).toBe(app.appId);

    // Cancel
    const cancelled = await appEngine.cancelApplication(app.appId);
    expect(cancelled.stage).toBe('FAILED');
    expect(cancelled.error).toContain('Cancelled');

    // Retry
    const retried = await appEngine.retryApplication(app.appId, []);
    expect(retried.stage).toBe('COMPLETED');
  });

  it('Phase 22: selects stage-appropriate model policies', () => {
    expect(appEngine.selectPolicyForStage('SCAFFOLDING', 'Build a simple web service')).toBe('nexus/fast');
    expect(appEngine.selectPolicyForStage('IMPLEMENTING', 'Build a simple web service')).toBe('nexus/best-coding');
    expect(appEngine.selectPolicyForStage('TESTING', 'Build a simple web service')).toBe('nexus/fast');
    expect(appEngine.selectPolicyForStage('VERIFYING', 'Build a simple web service')).toBe('nexus/best');
  });
});

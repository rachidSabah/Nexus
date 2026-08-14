/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ApplicationEngine — Phase 11 Autonomous Application Builder
 *
 * Orchestrates the full Phase 11 build lifecycle:
 *
 *   DISCOVER → SPECIFY → ARCHITECT → PLAN → APPROVAL →
 *   SCAFFOLD → BUILD → TEST → VERIFY → REPAIR → FINALIZE → COMPLETED
 *
 * Nexus responsibilities (this file):
 *   - Application creation and state management
 *   - Specification and architecture generation
 *   - Planning (via AutonomousPlanner)
 *   - Risk analysis (via RiskEngine — inside AutonomousPlanner)
 *   - Approval gate enforcement
 *   - Workspace provisioning (via AgyBuilderPort.initializeProject)
 *   - Model/policy selection (via RoutingEnginePort)
 *   - AGY node execution scheduling (via AgyBuilderPort)
 *   - Bounded repair loop (TEST → INSPECT → FIX → TEST, max N cycles)
 *   - Artifact verification (via ApplicationVerifier)
 *   - Checkpoint persistence (via WorkflowOrchestrator)
 *   - Domain event emission (via EventBusPort)
 *   - State serialization
 *
 * AGY responsibilities (AgyBuilderAdapter):
 *   - Running the actual build/test/fix operations
 *   - Returning structured results
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ApplicationState } from '../domain/application.js';
import type { AgyBuilderPort, AgyBuildTask, WorkspaceConfig } from '../domain/agy-builder.js';
import type { EventBusPort, RoutingEnginePort } from './ports.js';
import type { WorkflowOrchestrator } from './workflow-orchestrator.js';
import { AutonomousPlanner } from './autonomous-planner.js';
import { ApplicationVerifier } from './application-verifier.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;
const DEFAULT_BUILD_TIMEOUT_MS = 300_000; // 5 minutes per AGY node
const NEXUS_WORKSPACE_ROOT = join(homedir(), '.nexus', 'applications');

export interface ApplicationEngineOptions {
  readonly maxRepairAttempts?: number;
  readonly buildTimeoutMs?: number;
  readonly workspaceRoot?: string;
  readonly gatewayBaseUrl?: string;
  readonly gatewayPort?: number;
  readonly nexusRepoRoot?: string;
}

export class ApplicationEngine {
  private readonly apps = new Map<string, ApplicationState>();
  private readonly planner = new AutonomousPlanner();
  private readonly maxRepairAttempts: number;
  private readonly buildTimeoutMs: number;
  private readonly workspaceRoot: string;
  private readonly gatewayBaseUrl: string;
  private readonly gatewayPort: number;
  private readonly nexusRepoRoot?: string;

  constructor(
    private readonly workflowOrchestrator: WorkflowOrchestrator,
    private readonly agy?: AgyBuilderPort,
    private readonly events?: EventBusPort,
    private readonly routing?: RoutingEnginePort,
    options: ApplicationEngineOptions = {},
  ) {
    this.maxRepairAttempts = options.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
    this.buildTimeoutMs = options.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
    this.workspaceRoot = options.workspaceRoot ?? NEXUS_WORKSPACE_ROOT;
    this.gatewayBaseUrl = options.gatewayBaseUrl ?? 'http://127.0.0.1:8787';
    this.gatewayPort = options.gatewayPort ?? 8787;
    this.nexusRepoRoot = options.nexusRepoRoot;
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  createApplication(objective: string): ApplicationState {
    const appId = `app-${Date.now()}-${randomUUID().substring(0, 6)}`;
    const app: ApplicationState = {
      appId,
      objective,
      stage: 'DISCOVER',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      repairAttempts: 0,
      eventLog: [],
    };
    this.apps.set(appId, app);
    this.emitAppEvent(app, 'application.created', { appId, objective });
    return app;
  }

  getApplication(appId: string): ApplicationState | undefined {
    return this.apps.get(appId);
  }

  listApplications(): readonly ApplicationState[] {
    return Array.from(this.apps.values());
  }

  // ── Plan ───────────────────────────────────────────────────────────────────

  async planApplication(appId: string): Promise<ApplicationState> {
    const app = this.requireApp(appId);

    // ─ SPECIFY
    this.transitionStage(app, 'SPECIFY');
    app.spec = {
      title: app.objective.substring(0, 60),
      summary: app.objective,
      techStack: this.inferTechStack(app.objective),
      features: this.inferFeatures(app.objective),
    };

    // ─ ARCHITECT
    this.transitionStage(app, 'ARCHITECT');
    app.architecture = {
      pattern: 'Hexagonal / Clean Architecture',
      components: this.inferComponents(app.objective),
      dataStore: this.inferDataStore(app.objective),
    };

    // ─ PLAN (risk analysis + workflow DAG)
    this.transitionStage(app, 'PLAN');
    const plan = this.planner.plan(app.objective);
    this.workflowOrchestrator.registerDefinition(plan.definition);
    app.workflowId = plan.definition.id;

    // ─ APPROVAL gate
    const risk = plan.risk;
    const requiresApproval = risk.requiresApproval;

    // ─ Workspace provisioning
    const workspaceId = `ws-${appId}-${Date.now()}`;
    const buildSessionId = `bld-${randomUUID().substring(0, 8)}`;
    const workspacePath = join(this.workspaceRoot, appId);

    app.workspace = {
      workspaceId,
      workspacePath,
      buildSessionId,
      createdAt: Date.now(),
    };

    // ─ Route model selection
    const selectedPolicy = this.selectPolicy(app.objective);
    let selectedModel = selectedPolicy;
    let selectedProvider = 'nexus';

    if (this.routing) {
      try {
        const decision = await this.routing.resolve({ model: selectedPolicy });
        selectedModel = decision.endpoint.id;
        selectedProvider = decision.endpoint.providerId;
      } catch {
        // fallback to policy alias
      }
    }

    app.buildContext = {
      requiresApproval,
      riskLevel: risk.level,
      riskFlags: risk.flags,
      selectedPolicy,
      selectedModel,
      selectedProvider,
      repairAttempts: 0,
      maxRepairAttempts: this.maxRepairAttempts,
    };

    app.updatedAt = Date.now();
    this.emitAppEvent(app, 'application.planned', {
      appId,
      riskLevel: risk.level,
      requiresApproval,
      selectedModel,
      selectedPolicy,
    });

    if (requiresApproval) {
      this.transitionStage(app, 'APPROVAL');
    }

    return app;
  }

  // ── Approval ───────────────────────────────────────────────────────────────

  approveApplication(appId: string, decidedBy?: string): ApplicationState {
    const app = this.requireApp(appId);
    if (app.stage !== 'APPROVAL') {
      throw new Error(`Application '${appId}' is not awaiting approval (current stage: ${app.stage})`);
    }
    this.emitAppEvent(app, 'application.approved', { appId, decidedBy });
    // Stage will advance to SCAFFOLD during buildApplication
    app.updatedAt = Date.now();
    return app;
  }

  rejectApplication(appId: string, reason?: string, decidedBy?: string): ApplicationState {
    const app = this.requireApp(appId);
    if (app.stage !== 'APPROVAL') {
      throw new Error(`Application '${appId}' is not awaiting approval (current stage: ${app.stage})`);
    }
    app.error = reason ?? 'Build rejected at approval gate';
    this.transitionStage(app, 'FAILED');
    this.emitAppEvent(app, 'application.rejected', { appId, reason, decidedBy });
    return app;
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  /**
   * Execute the full AGY build pipeline.
   *
   * Lifecycle (post-planning):
   *   SCAFFOLD → BUILD → TEST → [VERIFY if pass] → [REPAIR loop if fail] → FINALIZE → COMPLETED
   *
   * For dryRun=true: returns the plan without executing AGY.
   */
  async buildApplication(
    appId: string,
    availableAgents: readonly any[],
    opts: { dryRun?: boolean } = {},
  ): Promise<ApplicationState> {
    const app = this.requireApp(appId);

    if (!app.workflowId) throw new Error(`Application '${appId}' has not been planned yet`);
    if (!app.workspace) throw new Error(`Application '${appId}' has no workspace — plan first`);
    if (!app.buildContext) throw new Error(`Application '${appId}' has no build context — plan first`);

    // Enforce approval gate
    if (app.buildContext.requiresApproval && app.stage === 'APPROVAL') {
      throw new Error(
        `Application '${appId}' requires approval before building (risk: ${app.buildContext.riskLevel}). ` +
          'Call approveApplication() first.',
      );
    }

    // Dry run — return plan without executing AGY
    if (opts.dryRun) {
      return this.buildDryRun(app, availableAgents);
    }

    const workspace: WorkspaceConfig = {
      applicationId: appId,
      workspaceId: app.workspace.workspaceId,
      workspacePath: app.workspace.workspacePath,
      buildSessionId: app.workspace.buildSessionId,
    };

    const buildStart = Date.now();

    // Emit build started event
    this.events?.publish({
      type: 'application.build.started',
      occurredAt: new Date(),
      payload: {
        applicationId: appId,
        workspaceId: workspace.workspaceId,
        buildSessionId: workspace.buildSessionId ?? '',
        objective: app.objective,
        riskLevel: app.buildContext.riskLevel,
        requiresApproval: app.buildContext.requiresApproval,
      },
    });

    try {
      // ─── SCAFFOLD ────────────────────────────────────────────────────
      this.transitionStage(app, 'SCAFFOLD');
      if (this.agy) {
        await this.agy.initializeProject(workspace);
        const scaffoldTask = this.makeTask(app, workspace, 'AGY_SCAFFOLD');
        await this.executeAgyNode(app, scaffoldTask, 'AGY_SCAFFOLD');
      }

      // ─── BUILD (AGY_IMPLEMENT) ────────────────────────────────────────
      this.transitionStage(app, 'BUILD');
      if (this.agy) {
        const buildTask = this.makeTask(app, workspace, 'AGY_IMPLEMENT');
        const buildResult = await this.executeAgyNode(app, buildTask, 'AGY_IMPLEMENT');
        if (!buildResult.success && buildResult.exitCode !== 0) {
          throw new Error(`AGY BUILD failed (exit ${buildResult.exitCode}): ${buildResult.error ?? buildResult.output.substring(0, 200)}`);
        }
      }

      // ─── TEST + REPAIR LOOP ───────────────────────────────────────────
      this.transitionStage(app, 'TEST');
      let testPassed = false;
      let repairCount = 0;

      while (!testPassed && repairCount <= this.maxRepairAttempts) {
        if (this.agy) {
          const testTask = this.makeTask(app, workspace, 'AGY_TEST', { repairAttempt: repairCount });

          // Emit test started
          this.events?.publish({
            type: 'agy.test.started',
            occurredAt: new Date(),
            payload: {
              applicationId: appId,
              workspaceId: workspace.workspaceId,
              taskId: testTask.taskId,
              repairAttempt: repairCount,
            },
          });

          const testResult = await this.agy.test(testTask);

          // Update build context test results
          (app.buildContext as any).lastTestResult = {
            success: testResult.success,
            testsRan: testResult.testsRan ?? 0,
            testsPassed: testResult.testsPassed ?? 0,
            testsFailed: testResult.testsFailed ?? 0,
            output: testResult.output,
          };

          // Emit test completed
          this.events?.publish({
            type: 'agy.test.completed',
            occurredAt: new Date(),
            payload: {
              applicationId: appId,
              workspaceId: workspace.workspaceId,
              taskId: testTask.taskId,
              success: testResult.success,
              testsRan: testResult.testsRan ?? 0,
              testsPassed: testResult.testsPassed ?? 0,
              testsFailed: testResult.testsFailed ?? 0,
              durationMs: testResult.durationMs,
            },
          });

          testPassed = testResult.success;

          if (!testPassed) {
            if (repairCount >= this.maxRepairAttempts) {
              // Exceeded max repair attempts
              break;
            }

            // ─── REPAIR cycle ──────────────────────────────────────
            repairCount++;
            (app.buildContext as any).repairAttempts = repairCount;
            app.repairAttempts = repairCount;
            this.transitionStage(app, 'REPAIR');

            const repairTaskId = `repair-${randomUUID().substring(0, 8)}`;

            // Emit repair started
            this.events?.publish({
              type: 'agy.repair.started',
              occurredAt: new Date(),
              payload: {
                applicationId: appId,
                workspaceId: workspace.workspaceId,
                taskId: repairTaskId,
                attempt: repairCount,
                maxAttempts: this.maxRepairAttempts,
              },
            });

            const repairStart = Date.now();

            // INSPECT
            const inspectTask = this.makeTask(app, workspace, 'AGY_INSPECT', {
              repairAttempt: repairCount,
              currentRepairAttempt: repairCount,
            });
            await this.executeAgyNode(app, inspectTask, 'AGY_INSPECT');

            // Checkpoint after inspect
            if (app.runId) {
              this.workflowOrchestrator.getCheckpoint(app.runId);
            }

            // FIX
            const fixTask = this.makeTask(app, workspace, 'AGY_FIX', {
              repairAttempt: repairCount,
              currentRepairAttempt: repairCount,
              maxRepairAttempts: this.maxRepairAttempts,
            });
            const fixResult = await this.executeAgyNode(app, fixTask, 'AGY_FIX');

            // Emit repair completed
            this.events?.publish({
              type: 'agy.repair.completed',
              occurredAt: new Date(),
              payload: {
                applicationId: appId,
                workspaceId: workspace.workspaceId,
                taskId: repairTaskId,
                attempt: repairCount,
                success: fixResult.success,
                durationMs: Date.now() - repairStart,
              },
            });

            // Loop back to TEST
            this.transitionStage(app, 'TEST');
          }
        } else {
          // No AGY adapter — stub pass
          testPassed = true;
        }
      }

      // ─── VERIFY ──────────────────────────────────────────────────────
      this.transitionStage(app, 'VERIFY');
      const verifier = new ApplicationVerifier(this.nexusRepoRoot);
      const verifyResult = await verifier.verify(workspace);

      if (!verifyResult.valid) {
        this.emitAppEvent(app, 'application.verify.failed', { appId, issues: verifyResult.issues });
      }

      // ─── FINALIZE ────────────────────────────────────────────────────
      this.transitionStage(app, 'FINALIZE');

      // ─── COMPLETED ───────────────────────────────────────────────────
      this.transitionStage(app, 'COMPLETED');

      // Emit completed
      this.events?.publish({
        type: 'application.build.completed',
        occurredAt: new Date(),
        payload: {
          applicationId: appId,
          workspaceId: workspace.workspaceId,
          buildSessionId: workspace.buildSessionId ?? '',
          durationMs: Date.now() - buildStart,
          repairAttempts: repairCount,
          artifacts: verifyResult.artifacts,
        },
      });

    } catch (err: unknown) {
      const error = (err as Error).message;
      app.error = error;
      this.transitionStage(app, 'FAILED');

      this.events?.publish({
        type: 'application.build.failed',
        occurredAt: new Date(),
        payload: {
          applicationId: appId,
          workspaceId: workspace.workspaceId,
          buildSessionId: workspace.buildSessionId ?? '',
          error,
          stage: app.stage,
          repairAttempts: app.repairAttempts,
        },
      });
    }

    app.updatedAt = Date.now();
    return app;
  }

  // ── Dry Run ────────────────────────────────────────────────────────────────

  private async buildDryRun(app: ApplicationState, _availableAgents: readonly any[]): Promise<ApplicationState> {
    const agy = this.agy;
    const agyInstalled = agy ? await agy.detect() : false;
    let agyHealth;
    if (agy) {
      try { agyHealth = await agy.healthCheck(); } catch { /* ignore */ }
    }

    this.emitAppEvent(app, 'application.build.dry-run', {
      appId: app.appId,
      selectedRuntime: 'agy-builder',
      agyInstalled,
      agyVersion: agyHealth?.version,
      workspace: app.workspace?.workspacePath ?? `${this.workspaceRoot}/${app.appId}`,
      targetPolicy: app.buildContext?.selectedPolicy ?? 'nexus/best-coding',
      riskLevel: app.buildContext?.riskLevel ?? 'LOW',
      requiresApproval: app.buildContext?.requiresApproval ?? false,
      buildNodes: ['AGY_SCAFFOLD', 'AGY_IMPLEMENT', 'AGY_TEST', 'AGY_VERIFY'],
      maxRepairAttempts: this.maxRepairAttempts,
    });
    return app;
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  async cancelApplication(appId: string): Promise<ApplicationState> {
    const app = this.requireApp(appId);
    if (app.runId) {
      try {
        await this.workflowOrchestrator.cancelRun(app.runId);
      } catch { /* ignore */ }
    }
    app.error = 'Cancelled by user';
    this.transitionStage(app, 'FAILED');
    this.emitAppEvent(app, 'application.cancelled', { appId });
    return app;
  }

  // ── Retry ──────────────────────────────────────────────────────────────────

  async retryApplication(appId: string, availableAgents: readonly any[]): Promise<ApplicationState> {
    const app = this.requireApp(appId);
    if (app.stage !== 'FAILED') {
      throw new Error(`Application '${appId}' is not in FAILED state (current: ${app.stage})`);
    }
    app.repairAttempts += 1;
    app.error = undefined;
    this.transitionStage(app, 'BUILD');
    return this.buildApplication(appId, availableAgents);
  }

  // ── Events query ───────────────────────────────────────────────────────────

  getApplicationEvents(appId: string) {
    const app = this.apps.get(appId);
    return app?.eventLog ?? [];
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private requireApp(appId: string): ApplicationState {
    const app = this.apps.get(appId);
    if (!app) throw new Error(`Application '${appId}' not found`);
    return app;
  }

  private transitionStage(app: ApplicationState, stage: ApplicationState['stage']): void {
    app.stage = stage;
    app.updatedAt = Date.now();
  }

  private emitAppEvent(app: ApplicationState, type: string, payload: Record<string, unknown>): void {
    app.eventLog.push({ type, occurredAt: Date.now(), payload });
    this.events?.publish({ type, occurredAt: new Date(), payload });
  }

  private makeTask(
    app: ApplicationState,
    workspace: WorkspaceConfig,
    kind: AgyBuildTask['kind'],
    overrides: Partial<AgyBuildTask> = {},
  ): AgyBuildTask {
    const ctx = app.buildContext;
    return {
      taskId: `agy-${randomUUID().substring(0, 8)}`,
      applicationId: app.appId,
      workspaceId: workspace.workspaceId,
      workspace,
      objective: app.objective,
      kind,
      specSummary: app.spec ? `${app.spec.title}\n${app.spec.summary}\nTech: ${app.spec.techStack.join(', ')}` : undefined,
      architectureConstraints: app.architecture ? `Pattern: ${app.architecture.pattern}. Components: ${app.architecture.components.join(', ')}.` : undefined,
      forbiddenPaths: [this.nexusRepoRoot ?? 'E:/CodingGhost'],
      targetModel: ctx?.selectedModel,
      policy: (ctx?.selectedPolicy ?? 'nexus/best-coding') as AgyBuildTask['policy'],
      timeoutMs: this.buildTimeoutMs,
      maxRepairAttempts: this.maxRepairAttempts,
      gatewayBaseUrl: this.gatewayBaseUrl,
      gatewayPort: this.gatewayPort,
      ...overrides,
    };
  }

  private async executeAgyNode(
    app: ApplicationState,
    task: AgyBuildTask,
    kind: AgyBuildTask['kind'],
  ): Promise<import('../domain/agy-builder.js').AgyBuildResult> {
    if (!this.agy) {
      return {
        success: true,
        output: `[STUB] ${kind} completed`,
        exitCode: 0,
        durationMs: 0,
        artifacts: [],
      };
    }

    const ctx = app.buildContext;
    const bsId = app.workspace?.buildSessionId ?? '';

    // Emit started event
    this.events?.publish({
      type: 'agy.execution.started',
      occurredAt: new Date(),
      payload: {
        applicationId: app.appId,
        workspaceId: task.workspaceId,
        buildSessionId: bsId,
        taskId: task.taskId,
        kind: kind ?? 'UNKNOWN',
        model: ctx?.selectedModel ?? 'nexus/best-coding',
        policy: ctx?.selectedPolicy ?? 'nexus/best-coding',
      },
    });

    const execStart = Date.now();
    let result: import('../domain/agy-builder.js').AgyBuildResult;

    switch (kind) {
      case 'AGY_SCAFFOLD':
        result = await this.agy.build({ ...task, kind: 'AGY_SCAFFOLD' });
        break;
      case 'AGY_IMPLEMENT':
        result = await this.agy.build(task);
        break;
      case 'AGY_TEST':
        result = await this.agy.test(task);
        break;
      case 'AGY_INSPECT':
        result = await this.agy.inspect(task);
        break;
      case 'AGY_FIX':
        result = await this.agy.fix(task);
        break;
      case 'AGY_VERIFY':
        result = await this.agy.build({ ...task, kind: 'AGY_VERIFY' });
        break;
      default:
        result = await this.agy.build(task);
    }

    // Emit completed/failed
    if (result.success) {
      this.events?.publish({
        type: 'agy.execution.completed',
        occurredAt: new Date(),
        payload: {
          applicationId: app.appId,
          workspaceId: task.workspaceId,
          buildSessionId: bsId,
          taskId: task.taskId,
          kind: kind ?? 'UNKNOWN',
          durationMs: Date.now() - execStart,
          exitCode: result.exitCode,
          artifacts: result.artifacts,
        },
      });
    } else {
      this.events?.publish({
        type: 'agy.execution.failed',
        occurredAt: new Date(),
        payload: {
          applicationId: app.appId,
          workspaceId: task.workspaceId,
          buildSessionId: bsId,
          taskId: task.taskId,
          kind: kind ?? 'UNKNOWN',
          error: result.error ?? result.output.substring(0, 300),
          exitCode: result.exitCode,
        },
      });
    }

    this.emitAppEvent(app, `agy.${kind?.toLowerCase()}.result`, {
      taskId: task.taskId,
      success: result.success,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });

    return result;
  }

  // ── Domain inference helpers ───────────────────────────────────────────────

  private inferTechStack(objective: string): string[] {
    const lower = objective.toLowerCase();
    const stack: string[] = [];
    if (lower.includes('typescript') || lower.includes('ts')) stack.push('TypeScript');
    else if (lower.includes('javascript') || lower.includes('node')) stack.push('Node.js', 'JavaScript');
    if (lower.includes('fastify')) stack.push('Fastify');
    else if (lower.includes('express')) stack.push('Express');
    if (lower.includes('sqlite')) stack.push('SQLite');
    else if (lower.includes('postgres')) stack.push('PostgreSQL');
    if (lower.includes('docker')) stack.push('Docker');
    if (lower.includes('openapi') || lower.includes('swagger')) stack.push('OpenAPI');
    if (stack.length === 0) stack.push('Node.js', 'TypeScript');
    return stack;
  }

  private inferFeatures(objective: string): string[] {
    const lower = objective.toLowerCase();
    const features: string[] = [];
    if (lower.includes('rest') || lower.includes('api')) features.push('REST API');
    if (lower.includes('test')) features.push('Automated testing');
    if (lower.includes('docker')) features.push('Docker support');
    if (lower.includes('openapi') || lower.includes('swagger')) features.push('OpenAPI documentation');
    if (lower.includes('auth')) features.push('Authentication');
    if (lower.includes('validation')) features.push('Input validation');
    if (features.length === 0) features.push('Core functionality', 'Automated testing', 'Documentation');
    return features;
  }

  private inferComponents(objective: string): string[] {
    const lower = objective.toLowerCase();
    const components = ['API Layer'];
    if (lower.includes('database') || lower.includes('sqlite') || lower.includes('postgres')) {
      components.push('Database Layer');
    }
    components.push('Domain Core', 'Configuration');
    return components;
  }

  private inferDataStore(objective: string): string {
    const lower = objective.toLowerCase();
    if (lower.includes('sqlite')) return 'SQLite';
    if (lower.includes('postgres')) return 'PostgreSQL';
    if (lower.includes('mongo')) return 'MongoDB';
    if (lower.includes('redis')) return 'Redis';
    return 'In-Memory / JSON';
  }

  private selectPolicy(objective: string): string {
    const lower = objective.toLowerCase();
    if (lower.includes('architecture') || lower.includes('design')) return 'nexus/best';
    if (lower.includes('large') || lower.includes('monorepo')) return 'nexus/long-context';
    if (lower.includes('quick') || lower.includes('fix') || lower.includes('repair')) return 'nexus/fast';
    return 'nexus/best-coding';
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MissionPlanner — Phase 29 Autonomous Mission Decomposition & DAG Planning.
 *
 * Translates high-level user objectives into topologically sound, risk-scored,
 * capability-annotated DAGs of executable subtasks.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type {
  MissionPlan,
  MissionRiskLevel,
  MissionSpecification,
  MissionTask,
  MissionTaskDependency,
  MissionTaskType,
} from '../../domain/mission.js';

export class MissionPlanner {
  /**
   * Plans a mission by analyzing the objective, detecting keywords and scope,
   * synthesizing tasks with dependencies, and evaluating risk gates.
   */
  plan(missionId: string, spec: MissionSpecification): MissionPlan {
    const objective = spec.objective.trim();
    const objectiveLower = objective.toLowerCase();

    // 1. Analyze Risk Level & Approval Requirements
    const { riskLevel, requiresApproval, approvalReason } = this.assessRisk(objectiveLower);

    // 2. Generate Tasks based on Mission Type & Domain Intent
    const tasks: MissionTask[] = [];
    const dependencies: MissionTaskDependency[] = [];

    if (spec.type === 'APPLICATION_BUILD' || spec.policy === 'nexus/application-builder') {
      this.generateApplicationBuildPlan(missionId, spec, tasks, dependencies);
    } else if (this.isApiMission(objectiveLower)) {
      this.generateApiPlan(missionId, spec, tasks, dependencies);
    } else if (this.isRefactorOrDebugMission(objectiveLower)) {
      this.generateRefactorDebugPlan(missionId, spec, tasks, dependencies);
    } else if (this.isTestingMission(objectiveLower)) {
      this.generateTestingPlan(missionId, spec, tasks, dependencies);
    } else {
      this.generateGeneralPlan(missionId, spec, tasks, dependencies);
    }

    // 3. Compute Estimated Duration & Max Parallelism
    const estimatedDurationMs = tasks.reduce((sum, t) => sum + (t.durationMs ?? 30_000), 0);
    const maxParallelTasks = spec.userPreferences?.maxParallelTasks ?? 4;

    return {
      missionId,
      objective,
      tasks,
      dependencies,
      estimatedDurationMs,
      riskLevel,
      requiresApproval,
      approvalReason,
      maxParallelTasks,
      plannedAt: Date.now(),
    };
  }

  private assessRisk(objectiveLower: string): {
    riskLevel: MissionRiskLevel;
    requiresApproval: boolean;
    approvalReason?: string;
  } {
    // Critical risk checks
    if (
      /\b(drop database|rm -rf|format disk|destroy cluster|delete production|kill process tree|wipe table)\b/i.test(
        objectiveLower,
      )
    ) {
      return {
        riskLevel: 'CRITICAL',
        requiresApproval: true,
        approvalReason: 'Mission contains destructive operations that can cause permanent data loss.',
      };
    }

    // High risk checks
    if (
      /\b(deploy to prod|push to main|publish to npm|modify secrets|rotate keys|execute shell|run privileged)\b/i.test(
        objectiveLower,
      )
    ) {
      return {
        riskLevel: 'HIGH',
        requiresApproval: true,
        approvalReason: 'Mission involves production modification, credentials, or elevated shell execution.',
      };
    }

    // Medium risk checks
    if (
      /\b(install|build|refactor|modify|implement|create api|add feature|update codebase|schema migration)\b/i.test(
        objectiveLower,
      )
    ) {
      return {
        riskLevel: 'MEDIUM',
        requiresApproval: false,
      };
    }

    // Low risk checks (inspection, docs, read-only analysis)
    return {
      riskLevel: 'LOW',
      requiresApproval: false,
    };
  }

  private isApiMission(text: string): boolean {
    return /\b(api|rest|endpoint|server|crud|backend|fastify|express|controller|route|service)\b/i.test(text);
  }

  private isRefactorOrDebugMission(text: string): boolean {
    return /\b(refactor|debug|fix|repair|patch|diagnose|bug|issue|memory leak|bottleneck)\b/i.test(text);
  }

  private isTestingMission(text: string): boolean {
    return /\b(test|vitest|jest|playwright|e2e|unit test|integration test|coverage|qa)\b/i.test(text);
  }

  private createTask(
    idPrefix: string,
    type: MissionTaskType,
    title: string,
    objective: string,
    requiredCapabilities: string[],
    risk: MissionRiskLevel,
    dependencies: string[],
    workspace?: string,
    preferredAgent?: string,
    modelPolicy?: string,
  ): MissionTask {
    const taskId = `${idPrefix}-${randomUUID().substring(0, 6)}`;
    return {
      taskId,
      type,
      title,
      objective,
      requiredCapabilities,
      risk,
      dependencies,
      workspace,
      preferredAgent,
      modelPolicy: modelPolicy ?? 'nexus/best-coding',
      status: dependencies.length === 0 ? 'READY' : 'BLOCKED',
      repairAttempts: 0,
    };
  }

  private generateApiPlan(
    _missionId: string,
    spec: MissionSpecification,
    tasks: MissionTask[],
    dependencies: MissionTaskDependency[],
  ): void {
    const ws = spec.workspace;
    const policy = spec.policy ?? 'nexus/best-coding';

    // 1. Requirements & Analysis
    const taskAnalysis = this.createTask(
      'task-req',
      'ANALYSIS',
      'Analyze API requirements and domain entities',
      `Analyze requirements for "${spec.objective}" and formulate API schema & contracts.`,
      ['planning', 'architecture', 'context-retrieval'],
      'LOW',
      [],
      ws,
      spec.userPreferences?.preferredAgent ?? 'claude-code',
      policy,
    );
    tasks.push(taskAnalysis);

    // 2. Architecture & Data Model
    const taskArch = this.createTask(
      'task-arch',
      'PLANNING',
      'Design REST API architecture and endpoints',
      'Specify API routes, request/response DTOs, data persistence strategy, and error handling.',
      ['architecture', 'system-design'],
      'LOW',
      [taskAnalysis.taskId],
      ws,
      'claude-code',
      policy,
    );
    tasks.push(taskArch);
    dependencies.push({ fromTaskId: taskAnalysis.taskId, toTaskId: taskArch.taskId });

    // 3. Project Scaffolding
    const taskScaffold = this.createTask(
      'task-scaffold',
      'BUILD',
      'Scaffold project structure and dependencies',
      'Create folder structure, package.json, TypeScript configuration, and server boilerplate.',
      ['fast-codegen', 'scaffolding', 'tool-execution'],
      'MEDIUM',
      [taskArch.taskId],
      ws,
      'codex',
      'nexus/fast',
    );
    tasks.push(taskScaffold);
    dependencies.push({ fromTaskId: taskArch.taskId, toTaskId: taskScaffold.taskId });

    // 4. Implement Controllers and Services (parallel branch A)
    const taskImpl = this.createTask(
      'task-impl',
      'CODING',
      'Implement API controllers, routes, and business logic',
      'Write the complete implementation for routes, request validation, domain logic, and error handlers.',
      ['complex-refactoring', 'full-stack-codebase', 'type-safety'],
      'MEDIUM',
      [taskScaffold.taskId],
      ws,
      'claude-code',
      'nexus/best-coding',
    );
    tasks.push(taskImpl);
    dependencies.push({ fromTaskId: taskScaffold.taskId, toTaskId: taskImpl.taskId });

    // 5. Test Suite Construction (parallel branch B)
    const taskTests = this.createTask(
      'task-test-gen',
      'TESTING',
      'Author automated unit and integration tests',
      'Create comprehensive test suites verifying all status codes, happy paths, edge cases, and validation rules.',
      ['fast-codegen', 'test-generation'],
      'LOW',
      [taskScaffold.taskId],
      ws,
      'codex',
      'nexus/fast',
    );
    tasks.push(taskTests);
    dependencies.push({ fromTaskId: taskScaffold.taskId, toTaskId: taskTests.taskId });

    // 6. Test Execution & Assertion
    const taskTestExec = this.createTask(
      'task-test-exec',
      'TESTING',
      'Execute test suite and evaluate coverage',
      'Run the test suite against the API implementation and report test results.',
      ['test-execution', 'diagnostics'],
      'LOW',
      [taskImpl.taskId, taskTests.taskId],
      ws,
      'opencode',
      policy,
    );
    tasks.push(taskTestExec);
    dependencies.push({ fromTaskId: taskImpl.taskId, toTaskId: taskTestExec.taskId });
    dependencies.push({ fromTaskId: taskTests.taskId, toTaskId: taskTestExec.taskId });

    // 7. Final Verification
    const taskVerify = this.createTask(
      'task-verify',
      'VERIFICATION',
      'Verify API integrity, typecheck, and documentation',
      'Perform final linting, typecheck, OpenAPI documentation generation, and artifact verification.',
      ['verification', 'typecheck', 'documentation'],
      'LOW',
      [taskTestExec.taskId],
      ws,
      'gemini',
      policy,
    );
    tasks.push(taskVerify);
    dependencies.push({ fromTaskId: taskTestExec.taskId, toTaskId: taskVerify.taskId });
  }

  private generateApplicationBuildPlan(
    _missionId: string,
    spec: MissionSpecification,
    tasks: MissionTask[],
    dependencies: MissionTaskDependency[],
  ): void {
    const ws = spec.workspace;

    const tSpec = this.createTask(
      'task-app-spec',
      'APPLICATION_BUILD',
      'Analyze application requirements & architecture spec',
      `Generate full application spec and schema for "${spec.objective}".`,
      ['planning', 'architecture', 'application-spec'],
      'LOW',
      [],
      ws,
      'agy',
      'nexus/application-builder',
    );
    tasks.push(tSpec);

    const tScaffold = this.createTask(
      'task-app-scaffold',
      'APPLICATION_BUILD',
      'Scaffold full-stack application workspace',
      'Initialize Vite/Next.js workspace, Tailwind configuration, component architecture.',
      ['scaffolding', 'fast-codegen'],
      'MEDIUM',
      [tSpec.taskId],
      ws,
      'agy',
      'nexus/application-builder',
    );
    tasks.push(tScaffold);
    dependencies.push({ fromTaskId: tSpec.taskId, toTaskId: tScaffold.taskId });

    const tComponents = this.createTask(
      'task-app-components',
      'CODING',
      'Implement UI components and state management',
      'Build responsive, accessible, interactive UI components and client state.',
      ['full-stack-codebase', 'ui-engineering'],
      'MEDIUM',
      [tScaffold.taskId],
      ws,
      'claude-code',
      'nexus/best-coding',
    );
    tasks.push(tComponents);
    dependencies.push({ fromTaskId: tScaffold.taskId, toTaskId: tComponents.taskId });

    const tRoutes = this.createTask(
      'task-app-routes',
      'CODING',
      'Implement API endpoints and data layer',
      'Build backend routes, data layer persistence, and business logic.',
      ['full-stack-codebase', 'type-safety'],
      'MEDIUM',
      [tScaffold.taskId],
      ws,
      'codex',
      'nexus/fast',
    );
    tasks.push(tRoutes);
    dependencies.push({ fromTaskId: tScaffold.taskId, toTaskId: tRoutes.taskId });

    const tVerify = this.createTask(
      'task-app-verify',
      'VERIFICATION',
      'Build and verify application production bundle',
      'Verify zero build errors, clean types, working bundle output.',
      ['build-verification', 'typecheck'],
      'LOW',
      [tComponents.taskId, tRoutes.taskId],
      ws,
      'agy',
      'nexus/application-builder',
    );
    tasks.push(tVerify);
    dependencies.push({ fromTaskId: tComponents.taskId, toTaskId: tVerify.taskId });
    dependencies.push({ fromTaskId: tRoutes.taskId, toTaskId: tVerify.taskId });
  }

  private generateRefactorDebugPlan(
    _missionId: string,
    spec: MissionSpecification,
    tasks: MissionTask[],
    dependencies: MissionTaskDependency[],
  ): void {
    const ws = spec.workspace;
    const policy = spec.policy ?? 'nexus/best-coding';

    const tInspect = this.createTask(
      'task-inspect',
      'ANALYSIS',
      'Inspect codebase and isolate root causes',
      `Diagnose issues and plan surgical changes for: "${spec.objective}".`,
      ['debugging', 'root-cause-analysis'],
      'LOW',
      [],
      ws,
      'opencode',
      policy,
    );
    tasks.push(tInspect);

    const tPatch = this.createTask(
      'task-patch',
      'REFACTORING',
      'Apply surgical refactor and patch',
      'Execute clean code modifications, maintaining backwards compatibility and invariants.',
      ['complex-refactoring', 'type-safety'],
      'MEDIUM',
      [tInspect.taskId],
      ws,
      'claude-code',
      'nexus/best-coding',
    );
    tasks.push(tPatch);
    dependencies.push({ fromTaskId: tInspect.taskId, toTaskId: tPatch.taskId });

    const tVerify = this.createTask(
      'task-verify',
      'VERIFICATION',
      'Run verification and regression checks',
      'Validate that tests pass and no regression was introduced.',
      ['test-execution', 'verification'],
      'LOW',
      [tPatch.taskId],
      ws,
      'codex',
      'nexus/fast',
    );
    tasks.push(tVerify);
    dependencies.push({ fromTaskId: tPatch.taskId, toTaskId: tVerify.taskId });
  }

  private generateTestingPlan(
    _missionId: string,
    spec: MissionSpecification,
    tasks: MissionTask[],
    dependencies: MissionTaskDependency[],
  ): void {
    const ws = spec.workspace;
    const policy = spec.policy ?? 'nexus/best-coding';

    const tAudit = this.createTask(
      'task-test-audit',
      'ANALYSIS',
      'Audit existing tests and coverage gaps',
      `Identify untested paths, edge cases, and flakiness for: "${spec.objective}".`,
      ['planning', 'code-inspection'],
      'LOW',
      [],
      ws,
      'hermes',
      policy,
    );
    tasks.push(tAudit);

    const tWrite = this.createTask(
      'task-test-write',
      'TESTING',
      'Generate robust unit and integration tests',
      'Author test suites covering critical branches, assertions, and mock boundaries.',
      ['fast-codegen', 'test-generation'],
      'LOW',
      [tAudit.taskId],
      ws,
      'codex',
      'nexus/fast',
    );
    tasks.push(tWrite);
    dependencies.push({ fromTaskId: tAudit.taskId, toTaskId: tWrite.taskId });

    const tRun = this.createTask(
      'task-test-run',
      'VERIFICATION',
      'Execute all tests and verify coverage threshold',
      'Run test suite runner, verify exit code 0, and output test summary report.',
      ['test-execution', 'verification'],
      'LOW',
      [tWrite.taskId],
      ws,
      'opencode',
      policy,
    );
    tasks.push(tRun);
    dependencies.push({ fromTaskId: tWrite.taskId, toTaskId: tRun.taskId });
  }

  private generateGeneralPlan(
    _missionId: string,
    spec: MissionSpecification,
    tasks: MissionTask[],
    dependencies: MissionTaskDependency[],
  ): void {
    const ws = spec.workspace;
    const policy = spec.policy ?? 'nexus/best-coding';

    const tPlan = this.createTask(
      'task-plan',
      'PLANNING',
      'Formulate execution strategy and task breakdown',
      `Analyze objective: "${spec.objective}" and plan execution steps.`,
      ['planning', 'architecture'],
      'LOW',
      [],
      ws,
      'claude-code',
      policy,
    );
    tasks.push(tPlan);

    const tExec = this.createTask(
      'task-exec',
      'CODING',
      'Execute implementation according to plan',
      `Implement requirements for "${spec.objective}".`,
      ['full-stack-codebase', 'complex-refactoring'],
      'MEDIUM',
      [tPlan.taskId],
      ws,
      'claude-code',
      'nexus/best-coding',
    );
    tasks.push(tExec);
    dependencies.push({ fromTaskId: tPlan.taskId, toTaskId: tExec.taskId });

    const tVerify = this.createTask(
      'task-verify',
      'VERIFICATION',
      'Verify results and ensure task correctness',
      'Validate output, verify artifacts exist, and ensure correctness.',
      ['verification', 'quality-check'],
      'LOW',
      [tExec.taskId],
      ws,
      'gemini',
      policy,
    );
    tasks.push(tVerify);
    dependencies.push({ fromTaskId: tExec.taskId, toTaskId: tVerify.taskId });
  }
}

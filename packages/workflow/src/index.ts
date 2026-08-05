import { randomUUID } from 'node:crypto';

import {
  buildEvent,
  type EventBusPort,
  type WorkflowCompletedEvent,
  type WorkflowPausedEvent,
  type WorkflowResumedEvent,
  type WorkflowStartedEvent,
  type WorkflowStepCompletedEvent,
  type WorkflowStepStartedEvent,
} from '@anx/core';
import type { AgentRuntime, TaskRequest, TaskResult } from '@anx/runtime';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Workflow Engine
 *
 * A workflow is a versioned, named sequence of steps. Each step is executed
 * by a specific agent (or by a capability match — the engine picks an
 * eligible agent at runtime).
 *
 * Features:
 *   - Define workflows as JSON
 *   - Versioning (immutable; bumping creates a new version)
 *   - Persistence (pluggable repository — in-memory default)
 *   - Execution with pause / resume / retry / replay
 *   - Step results are passed as context to the next step
 *   - History of every execution
 *   - Templates (predefined workflows for common tasks)
 *
 * The engine does NOT call providers directly. It builds TaskRequest
 * objects and delegates execution to the AgentRuntime.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface WorkflowStep {
  readonly name: string;
  readonly agent?: string;             // agent id; if omitted, capability required
  readonly capability?: string;        // pick any agent with this capability
  readonly model?: string;             // override the model
  readonly task: string;               // the task description / prompt
  readonly systemPrompt?: string;
  readonly inputs?: readonly string[]; // step names whose results feed into this step
  readonly condition?: string;         // JS expression evaluated against context; step runs if truthy
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: number;
  readonly steps: readonly WorkflowStep[];
  readonly inputs?: ReadonlyArray<{ name: string; description: string; required?: boolean }>;
  readonly outputs?: ReadonlyArray<{ name: string; fromStep: string }>;
  readonly tags?: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface StepExecution {
  readonly index: number;
  readonly stepName: string;
  readonly agentId: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  readonly startedAt?: Date;
  readonly endedAt?: Date;
  readonly result?: TaskResult;
  readonly error?: string;
}

export interface WorkflowExecution {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly status: ExecutionStatus;
  readonly startedAt: Date;
  readonly endedAt?: Date;
  readonly pausedAtStep?: number;
  readonly steps: StepExecution[];
  readonly context: Record<string, unknown>;
  readonly inputs: Record<string, unknown>;
  readonly outputs?: Record<string, unknown>;
  readonly totalCostUsd: number;
  readonly totalTokensUsed: number;
  readonly error?: string;
}

/**
 * Persistence port. Implementations: in-memory (default), Postgres, SQLite.
 */
export interface WorkflowRepository {
  save(def: WorkflowDefinition): Promise<void>;
  get(id: string, version?: number): Promise<WorkflowDefinition | undefined>;
  list(): Promise<readonly WorkflowDefinition[]>;
  listVersions(id: string): Promise<readonly WorkflowDefinition[]>;
  delete(id: string): Promise<void>;

  saveExecution(execution: WorkflowExecution): Promise<void>;
  getExecution(executionId: string): Promise<WorkflowExecution | undefined>;
  listExecutions(workflowId: string, limit?: number): Promise<readonly WorkflowExecution[]>;
}

/**
 * In-memory repository. Used by default and in tests.
 */
export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly defs = new Map<string, WorkflowDefinition[]>();
  private readonly executions = new Map<string, WorkflowExecution>();

  async save(def: WorkflowDefinition): Promise<void> {
    const versions = this.defs.get(def.id) ?? [];
    const existingIdx = versions.findIndex((v) => v.version === def.version);
    if (existingIdx >= 0) versions[existingIdx] = def;
    else versions.push(def);
    this.defs.set(def.id, versions);
  }

  async get(id: string, version?: number): Promise<WorkflowDefinition | undefined> {
    const versions = this.defs.get(id);
    if (!versions || versions.length === 0) return undefined;
    if (version === undefined) return versions[versions.length - 1];
    return versions.find((v) => v.version === version);
  }

  async list(): Promise<readonly WorkflowDefinition[]> {
    return Array.from(this.defs.values()).map((vs) => vs[vs.length - 1]!);
  }

  async listVersions(id: string): Promise<readonly WorkflowDefinition[]> {
    return this.defs.get(id) ?? [];
  }

  async delete(id: string): Promise<void> {
    this.defs.delete(id);
  }

  async saveExecution(execution: WorkflowExecution): Promise<void> {
    this.executions.set(execution.id, execution);
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | undefined> {
    return this.executions.get(executionId);
  }

  async listExecutions(workflowId: string, limit = 50): Promise<readonly WorkflowExecution[]> {
    return Array.from(this.executions.values())
      .filter((e) => e.workflowId === workflowId)
      .slice(-limit);
  }
}

/**
 * The engine.
 */
export class WorkflowEngine {
  constructor(
    private readonly repo: WorkflowRepository,
    private readonly runtime: AgentRuntime,
    private readonly events: EventBusPort,
  ) {}

  // ─── Definition management ──────────────────────────────────────────────

  /**
   * Create a new workflow. If a workflow with the same id exists, a new
   * version is created (auto-incremented).
   */
  async create(input: Omit<WorkflowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<WorkflowDefinition> {
    const id = input.id ?? randomUUID();
    const existing = await this.repo.listVersions(id);
    const version = existing.length === 0 ? 1 : Math.max(...existing.map((v) => v.version)) + 1;
    const now = new Date();
    const def: WorkflowDefinition = {
      ...input,
      id,
      version,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.save(def);
    return def;
  }

  async get(id: string, version?: number): Promise<WorkflowDefinition | undefined> {
    return this.repo.get(id, version);
  }

  async list(): Promise<readonly WorkflowDefinition[]> {
    return this.repo.list();
  }

  async listVersions(id: string): Promise<readonly WorkflowDefinition[]> {
    return this.repo.listVersions(id);
  }

  async delete(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  // ─── Execution ──────────────────────────────────────────────────────────

  /**
   * Start a new execution of a workflow. Returns the execution id.
   */
  async start(
    workflowId: string,
    inputs: Record<string, unknown> = {},
    options: { version?: number; sessionId?: string } = {},
  ): Promise<string> {
    const def = await this.repo.get(workflowId, options.version);
    if (!def) throw new Error(`Workflow not found: ${workflowId}`);

    const executionId = randomUUID();
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      workflowVersion: def.version,
      status: 'running',
      startedAt: new Date(),
      steps: def.steps.map((step, index) => ({
        index,
        stepName: step.name,
        agentId: step.agent ?? '',
        status: 'pending' as const,
      })),
      context: {},
      inputs,
      totalCostUsd: 0,
      totalTokensUsed: 0,
    };

    await this.repo.saveExecution(execution);

    await this.events.publish(
      buildEvent<WorkflowStartedEvent>(
        'workflow.started',
        {
          workflowId,
          executionId,
          name: def.name,
          version: def.version,
          stepCount: def.steps.length,
        },
        executionId,
      ),
    );

    // Begin executing (async, fire-and-forget; caller polls status).
    void this.runToCompletion(executionId, def, options.sessionId).catch(async (err) => {
      const failed = await this.repo.getExecution(executionId);
      if (failed) {
        await this.repo.saveExecution({
          ...failed,
          status: 'failed',
          endedAt: new Date(),
          error: (err as Error).message,
        });
      }
    });

    return executionId;
  }

  /**
   * Pause a running execution at the next step boundary.
   */
  async pause(executionId: string): Promise<boolean> {
    const exec = await this.repo.getExecution(executionId);
    if (!exec || exec.status !== 'running') return false;
    const updated: WorkflowExecution = { ...exec, status: 'paused' };
    await this.repo.saveExecution(updated);
    return true;
  }

  /**
   * Resume a paused execution.
   */
  async resume(executionId: string): Promise<boolean> {
    const exec = await this.repo.getExecution(executionId);
    if (!exec || exec.status !== 'paused') return false;
    const def = await this.repo.get(exec.workflowId, exec.workflowVersion);
    if (!def) return false;

    const fromStep = exec.pausedAtStep ?? 0;
    const updated: WorkflowExecution = { ...exec, status: 'running', pausedAtStep: undefined };
    await this.repo.saveExecution(updated);

    await this.events.publish(
      buildEvent<WorkflowResumedEvent>(
        'workflow.resumed',
        { workflowId: exec.workflowId, executionId, fromStepIndex: fromStep },
        executionId,
      ),
    );

    void this.runToCompletion(executionId, def, undefined, fromStep).catch(async (err) => {
      const failed = await this.repo.getExecution(executionId);
      if (failed) {
        await this.repo.saveExecution({
          ...failed,
          status: 'failed',
          endedAt: new Date(),
          error: (err as Error).message,
        });
      }
    });
    return true;
  }

  /**
   * Cancel a running or paused execution.
   */
  async cancel(executionId: string): Promise<boolean> {
    const exec = await this.repo.getExecution(executionId);
    if (!exec || exec.status === 'completed' || exec.status === 'failed') return false;
    await this.repo.saveExecution({
      ...exec,
      status: 'cancelled',
      endedAt: new Date(),
    });
    return true;
  }

  /**
   * Replay an execution from the beginning with the same inputs.
   */
  async replay(executionId: string): Promise<string | undefined> {
    const exec = await this.repo.getExecution(executionId);
    if (!exec) return undefined;
    return this.start(exec.workflowId, exec.inputs, { version: exec.workflowVersion });
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | undefined> {
    return this.repo.getExecution(executionId);
  }

  async listExecutions(workflowId: string, limit?: number): Promise<readonly WorkflowExecution[]> {
    return this.repo.listExecutions(workflowId, limit);
  }

  // ─── Internal: run workflow to completion ───────────────────────────────

  private async runToCompletion(
    executionId: string,
    def: WorkflowDefinition,
    sessionId: string | undefined,
    fromStep = 0,
  ): Promise<void> {
    const context: Record<string, unknown> = {};
    Object.assign(context, { inputs: (await this.repo.getExecution(executionId))?.inputs ?? {} });

    let totalCost = 0;
    let totalTokens = 0;
    let stepsCompleted = 0;
    let stepsFailed = 0;

    for (let i = fromStep; i < def.steps.length; i++) {
      // Re-read execution to check pause/cancel.
      const current = await this.repo.getExecution(executionId);
      if (!current || current.status === 'paused' || current.status === 'cancelled') {
        // Record paused step for resume.
        if (current && current.status === 'paused') {
          await this.repo.saveExecution({ ...current, pausedAtStep: i });
          await this.events.publish(
            buildEvent<WorkflowPausedEvent>(
              'workflow.paused',
              { workflowId: def.id, executionId, atStepIndex: i },
              executionId,
            ),
          );
        }
        return;
      }

      const step = def.steps[i]!;

      // Evaluate condition (if any) against context.
      if (step.condition) {
        try {
          const fn = new Function('context', `with (context) { return ${step.condition}; }`);
          if (!fn(context)) {
            // Skip step
            const steps = [...current.steps];
            steps[i] = { ...steps[i]!, status: 'skipped' };
            await this.repo.saveExecution({ ...current, steps });
            continue;
          }
        } catch {
          // If condition evaluation fails, treat as falsy
          continue;
        }
      }

      // Resolve agent
      const agentId = step.agent ?? await this.resolveAgentByCapability(step.capability ?? 'coding');
      if (!agentId) {
        const steps = [...current.steps];
        steps[i] = { ...steps[i]!, status: 'failed', error: 'No eligible agent', endedAt: new Date() };
        await this.repo.saveExecution({ ...current, steps });
        stepsFailed++;
        continue;
      }

      // Build the task prompt, interpolating inputs from previous steps.
      const taskPrompt = this.interpolate(step.task, context, step.inputs);

      // Mark step as running
      const steps = [...current.steps];
      steps[i] = {
        ...steps[i]!,
        agentId,
        status: 'running',
        startedAt: new Date(),
      };
      await this.repo.saveExecution({ ...current, steps });

      await this.events.publish(
        buildEvent<WorkflowStepStartedEvent>(
          'workflow.step.started',
          {
            workflowId: def.id,
            executionId,
            stepIndex: i,
            stepName: step.name,
            agentId,
          },
          executionId,
        ),
      );

      // Build and execute the task
      const task: TaskRequest = {
        id: `${executionId}-step-${i}`,
        agentId,
        model: step.model ?? 'gpt-4',
        messages: [{ role: 'user', content: taskPrompt }],
        systemPrompt: step.systemPrompt,
        temperature: step.temperature,
        maxTokens: step.maxTokens,
        timeoutMs: step.timeoutMs,
        maxRetries: step.maxRetries,
        streaming: false,
        metadata: { sessionId, workflowId: def.id, executionId, stepIndex: i, stepName: step.name },
      };

      const stepStartedAt = Date.now();
      const result = await this.runtime.executeTask(task);
      const durationMs = Date.now() - stepStartedAt;

      // Update execution with step result
      const after = await this.repo.getExecution(executionId);
      if (!after) return;
      const afterSteps = [...after.steps];
      afterSteps[i] = {
        ...afterSteps[i]!,
        status: result.success ? 'completed' : 'failed',
        endedAt: new Date(),
        result,
        error: result.error?.message,
      };

      // Store step output in context under step.name
      if (result.success && result.response) {
        const content = result.response.choices[0]?.message.content;
        context[step.name] = content;
        stepsCompleted++;
      } else {
        stepsFailed++;
      }

      totalCost += result.costUsd;
      totalTokens += result.tokensUsed;

      await this.repo.saveExecution({
        ...after,
        steps: afterSteps,
        context,
        totalCostUsd: totalCost,
        totalTokensUsed: totalTokens,
      });

      await this.events.publish(
        buildEvent<WorkflowStepCompletedEvent>(
          'workflow.step.completed',
          {
            workflowId: def.id,
            executionId,
            stepIndex: i,
            stepName: step.name,
            agentId,
            durationMs,
            success: result.success,
          },
          executionId,
        ),
      );

      // If step failed and has no retry fallback, mark workflow as failed.
      if (!result.success) {
        const final = await this.repo.getExecution(executionId);
        if (final) {
          await this.repo.saveExecution({
            ...final,
            status: 'failed',
            endedAt: new Date(),
            error: `Step ${step.name} failed: ${result.error?.message}`,
          });
        }
        await this.emitCompleted(def.id, executionId, Date.now() - final!.startedAt.getTime(), stepsCompleted, stepsFailed, totalCost, false);
        return;
      }
    }

    // Build outputs
    const final = await this.repo.getExecution(executionId);
    if (!final) return;
    const outputs: Record<string, unknown> = {};
    if (def.outputs) {
      for (const out of def.outputs) {
        outputs[out.name] = context[out.fromStep];
      }
    }
    await this.repo.saveExecution({
      ...final,
      status: 'completed',
      endedAt: new Date(),
      outputs,
      context,
      totalCostUsd: totalCost,
      totalTokensUsed: totalTokens,
    });

    await this.emitCompleted(def.id, executionId, Date.now() - final.startedAt.getTime(), stepsCompleted, stepsFailed, totalCost, true);
  }

  private async emitCompleted(
    workflowId: string,
    executionId: string,
    durationMs: number,
    stepsCompleted: number,
    stepsFailed: number,
    totalCostUsd: number,
    success: boolean,
  ): Promise<void> {
    await this.events.publish(
      buildEvent<WorkflowCompletedEvent>(
        'workflow.completed',
        {
          workflowId,
          executionId,
          durationMs,
          stepsCompleted,
          stepsFailed,
          totalCostUsd,
          success,
        },
        executionId,
      ),
    );
  }

  private async resolveAgentByCapability(capability: string): Promise<string | undefined> {
    // Delegates to the agent registry via the runtime. The runtime doesn't
    // expose the registry directly, so we use a callback. For now, return
    // undefined and require explicit agent ids in steps.
    // Future: inject AgentRegistry here.
    return undefined;
  }

  /**
   * Interpolate `${stepName}` and `${inputs.foo}` references in a prompt.
   */
  private interpolate(
    template: string,
    context: Record<string, unknown>,
    inputSteps?: readonly string[],
  ): string {
    let result = template;
    // Replace ${inputs.foo}
    const inputs = (context['inputs'] as Record<string, unknown>) ?? {};
    for (const [k, v] of Object.entries(inputs)) {
      result = result.replaceAll(`\${inputs.${k}}`, String(v));
    }
    // Replace ${stepName} for each prior step result
    if (inputSteps) {
      for (const stepName of inputSteps) {
        const v = context[stepName];
        if (v !== undefined) {
          result = result.replaceAll(`\${${stepName}}`, String(v));
        }
      }
    }
    // Replace any remaining ${key}
    for (const [k, v] of Object.entries(context)) {
      if (k === 'inputs') continue;
      result = result.replaceAll(`\${${k}}`, String(v));
    }
    return result;
  }
}

/**
 * Built-in workflow templates. Use `engine.create(template)` to register.
 */
export const WORKFLOW_TEMPLATES = {
  softwareDevelopmentPipeline: {
    id: 'software-development-pipeline',
    name: 'Software Development Pipeline',
    description: 'Architect → Implement → Review → Test → Document',
    steps: [
      {
        name: 'architecture',
        agent: 'claude-code',
        model: 'claude-3-5-sonnet',
        task: 'Design the architecture for: ${inputs.feature}. Consider scalability, security, and maintainability. Output a brief architecture doc.',
        systemPrompt: 'You are a senior software architect.',
        maxTokens: 2000,
      },
      {
        name: 'implement',
        agent: 'deepseek-coder',
        model: 'deepseek-coder',
        task: 'Implement the feature based on this architecture:\n\n${architecture}\n\nFeature: ${inputs.feature}',
        inputs: ['architecture'],
        systemPrompt: 'You are a backend engineer. Write clean, tested code.',
        maxTokens: 4000,
      },
      {
        name: 'review',
        agent: 'claude-code',
        model: 'claude-3-5-sonnet',
        task: 'Review this implementation for bugs, security issues, and style:\n\n${implement}',
        inputs: ['implement'],
        systemPrompt: 'You are a code reviewer. Be thorough but constructive.',
        maxTokens: 1500,
      },
      {
        name: 'test',
        agent: 'codex-cli',
        model: 'gpt-4o',
        task: 'Write unit tests for this implementation:\n\n${implement}',
        inputs: ['implement'],
        systemPrompt: 'You are a test engineer. Cover edge cases.',
        maxTokens: 2000,
      },
      {
        name: 'document',
        agent: 'mistral-coder',
        model: 'mistral-large',
        task: 'Write documentation for this feature:\n\nFeature: ${inputs.feature}\n\nImplementation:\n${implement}',
        inputs: ['implement'],
        systemPrompt: 'You are a technical writer.',
        maxTokens: 1500,
      },
    ],
    inputs: [{ name: 'feature', description: 'The feature to build', required: true }],
    outputs: [
      { name: 'architecture', fromStep: 'architecture' },
      { name: 'implementation', fromStep: 'implement' },
      { name: 'review', fromStep: 'review' },
      { name: 'tests', fromStep: 'test' },
      { name: 'documentation', fromStep: 'document' },
    ],
    tags: ['software', 'development', 'pipeline'],
  },

  bugTriage: {
    id: 'bug-triage',
    name: 'Bug Triage & Fix',
    description: 'Reproduce → Diagnose → Fix → Verify',
    steps: [
      {
        name: 'reproduce',
        agent: 'codex-cli',
        model: 'gpt-4o',
        task: 'Reproduce this bug and describe the steps:\n\nBug report: ${inputs.bugReport}',
        systemPrompt: 'You are a QA engineer reproducing a reported bug.',
        maxTokens: 1000,
      },
      {
        name: 'diagnose',
        agent: 'claude-code',
        model: 'claude-3-5-sonnet',
        task: 'Diagnose the root cause based on reproduction:\n\n${reproduce}',
        inputs: ['reproduce'],
        systemPrompt: 'You are a senior engineer diagnosing a bug.',
        maxTokens: 1500,
      },
      {
        name: 'fix',
        agent: 'deepseek-coder',
        model: 'deepseek-coder',
        task: 'Write a fix based on this diagnosis:\n\n${diagnose}',
        inputs: ['diagnose'],
        systemPrompt: 'You are a backend engineer. Write a minimal, correct fix.',
        maxTokens: 2000,
      },
      {
        name: 'verify',
        agent: 'codex-cli',
        model: 'gpt-4o',
        task: 'Verify the fix resolves the bug. Write a regression test.\n\nFix:\n${fix}\n\nOriginal bug:\n${inputs.bugReport}',
        inputs: ['fix'],
        systemPrompt: 'You are a test engineer verifying a bug fix.',
        maxTokens: 1500,
      },
    ],
    inputs: [{ name: 'bugReport', description: 'The bug report', required: true }],
    outputs: [
      { name: 'diagnosis', fromStep: 'diagnose' },
      { name: 'fix', fromStep: 'fix' },
      { name: 'verification', fromStep: 'verify' },
    ],
    tags: ['bug', 'triage', 'fix'],
  },

  codeReview: {
    id: 'code-review',
    name: 'Multi-Agent Code Review',
    description: 'Security review + Performance review + Style review → Consensus',
    steps: [
      {
        name: 'security',
        agent: 'claude-code',
        model: 'claude-3-5-sonnet',
        task: 'Review this code for security vulnerabilities:\n\n${inputs.code}',
        systemPrompt: 'You are a security expert. Look for OWASP Top 10 issues.',
        maxTokens: 1500,
      },
      {
        name: 'performance',
        agent: 'deepseek-coder',
        model: 'deepseek-coder',
        task: 'Review this code for performance issues:\n\n${inputs.code}',
        systemPrompt: 'You are a performance engineer. Look for O(n²) loops, unnecessary allocations, N+1 queries.',
        maxTokens: 1500,
      },
      {
        name: 'style',
        agent: 'mistral-coder',
        model: 'mistral-large',
        task: 'Review this code for style and readability:\n\n${inputs.code}',
        systemPrompt: 'You are a code style reviewer. Focus on naming, comments, and structure.',
        maxTokens: 1000,
      },
      {
        name: 'consensus',
        agent: 'claude-code',
        model: 'claude-3-5-sonnet',
        task: 'Synthesize these three reviews into a single actionable list:\n\nSecurity:\n${security}\n\nPerformance:\n${performance}\n\nStyle:\n${style}',
        inputs: ['security', 'performance', 'style'],
        systemPrompt: 'You are a tech lead. Produce a single prioritized list of issues to fix.',
        maxTokens: 1500,
      },
    ],
    inputs: [{ name: 'code', description: 'The code to review', required: true }],
    outputs: [{ name: 'review', fromStep: 'consensus' }],
    tags: ['code', 'review', 'multi-agent'],
  },
} as const;

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Multi-Agent Orchestration — Planner / Executor / Critic roles.
 *
 * Implements the three core orchestration primitives that were previously
 * only declared as types:
 *
 *   - Planner: decomposes a complex task into subtasks and assigns them
 *     to agents based on capabilities.
 *   - Executor: executes a single subtask by routing it through the A2A
 *     coordinator to the assigned agent.
 *   - Critic: evaluates the output of an executor and decides whether
 *     to accept, reject (retry), or request human review.
 *
 * The Orchestrator ties them together: it receives a high-level task,
 * asks the Planner to decompose it, executes each subtask via the
 * Executor, and runs the Critic on each result. If the Critic rejects,
 * the Orchestrator retries (up to maxRetries) with feedback.
 *
 * This enables workflows like:
 *   "Build a REST API" →
 *     Planner: [design endpoints, implement auth, implement routes, write tests]
 *     Executor: routes each subtask to the best agent
 *     Critic: checks each output for completeness + correctness
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type { A2ACoordinator, AgentRegistry } from './index.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface SubTask {
  readonly id: string;
  readonly description: string;
  readonly requiredCapabilities: readonly string[];
  readonly assignedAgentId?: string;
  readonly status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'rejected';
  readonly result?: unknown;
  readonly feedback?: string;
  readonly attempt: number;
}

export interface OrchestrationPlan {
  readonly id: string;
  readonly taskDescription: string;
  readonly subtasks: SubTask[];
  readonly createdAt: string;
}

export interface CriticResult {
  readonly accepted: boolean;
  readonly score: number; // 0..1
  readonly feedback: string;
  readonly suggestions?: string[];
}

export interface OrchestrationResult {
  readonly planId: string;
  readonly taskDescription: string;
  readonly subtaskResults: Array<{ subtask: SubTask; result: unknown; criticResult: CriticResult }>;
  readonly overallStatus: 'completed' | 'partial' | 'failed';
  readonly totalAttempts: number;
  readonly durationMs: number;
}

// ─── Planner ────────────────────────────────────────────────────────────

/**
 * The Planner decomposes a high-level task into subtasks.
 * It uses keyword + pattern matching to identify task components
 * (no LLM call required — fast and deterministic).
 */
export class Planner {
  constructor(private readonly registry: AgentRegistry) {}

  plan(taskDescription: string): OrchestrationPlan {
    const subtasks = this.decompose(taskDescription);
    const assigned = subtasks.map((st) => this.assignAgent(st));
    return {
      id: randomUUID(),
      taskDescription,
      subtasks: assigned,
      createdAt: new Date().toISOString(),
    };
  }

  private decompose(task: string): SubTask[] {
    const lower = task.toLowerCase();
    const subtasks: SubTask[] = [];

    // Detect common software engineering task patterns
    if (/\b(build|create|develop|implement|scaffold)\b.*\b(api|app|service|backend|frontend|system)\b/.test(lower)) {
      subtasks.push(this.makeSubtask('Design the architecture and API endpoints', ['architecture', 'planning']));
      subtasks.push(this.makeSubtask('Implement the core backend logic', ['coding', 'backend']));
      subtasks.push(this.makeSubtask('Implement the frontend/UI', ['coding', 'frontend']));
      subtasks.push(this.makeSubtask('Write tests for the implementation', ['testing']));
      subtasks.push(this.makeSubtask('Document the API and usage', ['documentation']));
    } else if (/\b(fix|debug|resolve)\b.*\b(bug|error|issue|crash)\b/.test(lower)) {
      subtasks.push(this.makeSubtask('Reproduce and diagnose the issue', ['debugging', 'analysis']));
      subtasks.push(this.makeSubtask('Identify root cause', ['debugging', 'reasoning']));
      subtasks.push(this.makeSubtask('Implement the fix', ['coding']));
      subtasks.push(this.makeSubtask('Verify the fix with tests', ['testing']));
    } else if (/\b(review|audit|analyze)\b.*\b(code|implementation|design)\b/.test(lower)) {
      subtasks.push(this.makeSubtask('Review the code for correctness', ['code_review', 'analysis']));
      subtasks.push(this.makeSubtask('Check for security issues', ['security', 'code_review']));
      subtasks.push(this.makeSubtask('Suggest improvements', ['code_review', 'planning']));
    } else if (/\b(refactor|clean|optimize|improve)\b/.test(lower)) {
      subtasks.push(this.makeSubtask('Analyze current implementation', ['analysis', 'code_review']));
      subtasks.push(this.makeSubtask('Plan refactoring strategy', ['architecture', 'planning']));
      subtasks.push(this.makeSubtask('Execute the refactoring', ['coding']));
      subtasks.push(this.makeSubtask('Verify no regressions', ['testing']));
    } else if (/\b(write|create|generate)\b.*\b(test|spec|unit test)\b/.test(lower)) {
      subtasks.push(this.makeSubtask('Analyze the code to test', ['analysis', 'code_review']));
      subtasks.push(this.makeSubtask('Write unit tests', ['testing', 'coding']));
      subtasks.push(this.makeSubtask('Run tests and verify coverage', ['testing']));
    } else if (/\b(document|describe|explain)\b/.test(lower)) {
      subtasks.push(this.makeSubtask('Analyze the codebase', ['analysis']));
      subtasks.push(this.makeSubtask('Write documentation', ['documentation']));
    } else {
      // Generic decomposition: analyze → implement → verify
      subtasks.push(this.makeSubtask('Analyze the task requirements', ['analysis', 'planning']));
      subtasks.push(this.makeSubtask('Execute the task', ['coding']));
      subtasks.push(this.makeSubtask('Review and verify the output', ['code_review', 'testing']));
    }

    return subtasks;
  }

  private assignAgent(subtask: SubTask): SubTask {
    for (const cap of subtask.requiredCapabilities) {
      const candidates = this.registry.findByCapability(cap);
      if (candidates.length > 0) {
        return { ...subtask, assignedAgentId: candidates[0]!.id };
      }
    }
    return subtask; // No agent found — will be handled by orchestrator
  }

  private makeSubtask(description: string, capabilities: string[]): SubTask {
    return {
      id: randomUUID(),
      description,
      requiredCapabilities: capabilities,
      status: 'pending',
      attempt: 0,
    };
  }
}

// ─── Executor ───────────────────────────────────────────────────────────

/**
 * The Executor routes a subtask to its assigned agent via the A2A
 * coordinator and returns the result.
 */
export class Executor {
  constructor(
    private readonly coordinator: A2ACoordinator,
    private readonly orchestratorId: string = 'orchestrator',
  ) {}

  async execute(subtask: SubTask, context?: Record<string, unknown>): Promise<unknown> {
    if (!subtask.assignedAgentId) {
      throw new Error(`Subtask ${subtask.id} has no assigned agent`);
    }

    const payload = {
      type: 'subtask',
      subtaskId: subtask.id,
      description: subtask.description,
      requiredCapabilities: subtask.requiredCapabilities,
      context,
      attempt: subtask.attempt,
    };

    const result = await this.coordinator.request(
      this.orchestratorId,
      subtask.assignedAgentId,
      payload,
      120_000, // 2 min timeout
    );

    return result;
  }
}

// ─── Critic ────────────────────────────────────────────────────────────

/**
 * The Critic evaluates executor output and decides whether to accept,
 * reject (retry), or request human review.
 *
 * Uses heuristics (no LLM call — fast):
 *   - Non-empty result
 *   - Contains expected content type markers
 *   - No error markers
 *   - Minimum length check
 */
export class Critic {
  evaluate(subtask: SubTask, result: unknown): CriticResult {
    // Null/undefined result = automatic reject
    if (result === null || result === undefined) {
      return {
        accepted: false,
        score: 0,
        feedback: 'Result is empty (null/undefined). The agent did not produce output.',
      };
    }

    // String results: check for content
    if (typeof result === 'string') {
      if (result.length === 0) {
        return { accepted: false, score: 0, feedback: 'Result is an empty string.' };
      }
      if (result.length < 10) {
        return { accepted: false, score: 0.2, feedback: 'Result is too short (< 10 chars).' };
      }
      // Check for error markers
      if (/^(error|fail|exception|cannot|unable)/i.test(result)) {
        return { accepted: false, score: 0.1, feedback: `Result appears to be an error: "${result.slice(0, 100)}"` };
      }
      // Check for code markers (if coding was required)
      if (subtask.requiredCapabilities.includes('coding')) {
        const hasCode = /[{};()]/.test(result) || /function|class|def |const |let |var /.test(result);
        if (!hasCode && result.length > 50) {
          return {
            accepted: true,
            score: 0.7,
            feedback: 'Result contains text but no code markers. Accepted but may need review.',
            suggestions: ['Verify the output contains actual code.'],
          };
        }
      }
      return { accepted: true, score: 0.85, feedback: 'Result looks valid.' };
    }

    // Object results: check for success markers
    if (typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      if (obj['error']) {
        return { accepted: false, score: 0.1, feedback: `Result contains error: ${String(obj['error']).slice(0, 200)}` };
      }
      if (obj['success'] === false) {
        return { accepted: false, score: 0.2, feedback: 'Result indicates failure (success: false).' };
      }
      // Check for content
      const content = obj['content'] ?? obj['result'] ?? obj['output'] ?? obj['response'];
      if (content && typeof content === 'string' && content.length > 0) {
        return { accepted: true, score: 0.85, feedback: 'Result contains valid content.' };
      }
      // Object with no error markers — accept with moderate score
      return { accepted: true, score: 0.7, feedback: 'Result is a non-error object.' };
    }

    // Unknown type — accept with low confidence
    return { accepted: true, score: 0.5, feedback: 'Result type is unusual but not an error.' };
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────

/**
 * The Orchestrator ties Planner + Executor + Critic together.
 * It receives a high-level task, decomposes it, executes each subtask,
 * and runs the Critic on each result. Failed subtasks are retried with
 * feedback (up to maxRetries).
 */
export class Orchestrator {
  private readonly planner: Planner;
  private readonly executor: Executor;
  private readonly critic: Critic;
  private readonly maxRetries: number;

  constructor(
    registry: AgentRegistry,
    coordinator: A2ACoordinator,
    opts: { maxRetries?: number; orchestratorId?: string } = {},
  ) {
    this.planner = new Planner(registry);
    this.executor = new Executor(coordinator, opts.orchestratorId ?? 'orchestrator');
    this.critic = new Critic();
    this.maxRetries = opts.maxRetries ?? 2;
  }

  async orchestrate(
    taskDescription: string,
    context?: Record<string, unknown>,
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();

    // 1. Plan: decompose the task
    const plan = this.planner.plan(taskDescription);

    // 2. Execute each subtask + critique
    const results: OrchestrationResult['subtaskResults'] = [];
    let totalAttempts = 0;
    let completedCount = 0;
    let failedCount = 0;

    for (const subtask of plan.subtasks) {
      let currentSubtask = subtask;
      let lastResult: unknown;
      let lastCriticResult: CriticResult | undefined;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        totalAttempts++;
        currentSubtask = { ...currentSubtask, status: 'in_progress', attempt };

        try {
          lastResult = await this.executor.execute(currentSubtask, {
            ...context,
            feedback: currentSubtask.feedback,
            previousAttempt: attempt,
          });
        } catch (err) {
          lastResult = { error: (err as Error).message };
        }

        lastCriticResult = this.critic.evaluate(currentSubtask, lastResult);

        if (lastCriticResult.accepted) {
          currentSubtask = { ...currentSubtask, status: 'completed', result: lastResult };
          completedCount++;
          break;
        }

        // Rejected — prepare feedback for retry
        currentSubtask = {
          ...currentSubtask,
          status: 'rejected',
          feedback: lastCriticResult.feedback,
        };

        if (attempt === this.maxRetries) {
          currentSubtask = { ...currentSubtask, status: 'failed', result: lastResult };
          failedCount++;
        }
      }

      results.push({
        subtask: currentSubtask,
        result: lastResult,
        // Use the critic result from the final attempt — the one that determined
        // whether to accept or fail, not a re-evaluation on the mutated subtask.
        criticResult: lastCriticResult ?? this.critic.evaluate(currentSubtask, lastResult),
      });
    }

    const overallStatus: OrchestrationResult['overallStatus'] =
      failedCount === 0 ? 'completed' : completedCount > 0 ? 'partial' : 'failed';

    return {
      planId: plan.id,
      taskDescription,
      subtaskResults: results,
      overallStatus,
      totalAttempts,
      durationMs: Date.now() - startTime,
    };
  }

  /** Returns the planner (for testing / introspection). */
  getPlanner(): Planner { return this.planner; }

  /** Returns the critic (for testing). */
  getCritic(): Critic { return this.critic; }
}

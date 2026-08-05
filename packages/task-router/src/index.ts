import type { AgentRegistry, AgentRecord } from '@anx/agents';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Intelligent AI Task Router
 *
 * Upgrades the existing model-routing engine with agent-aware routing.
 *
 * Pipeline:
 *   1. TaskClassifier   — classify the user's request into task types
 *   2. CapabilityMatcher — map task types → required capabilities
 *   3. AgentSelector    — pick the best agent (from AgentRegistry) for each task
 *   4. ModelSelector    — pick the best model for the chosen agent
 *   5. ExecutionPlanner — assemble a plan (single-step or multi-step)
 *
 * Example:
 *   User: "Build a SaaS application"
 *   Plan:
 *     - architecture → Claude Opus
 *     - backend      → DeepSeek Coder
 *     - frontend     → Gemini
 *     - testing      → Codex
 *     - documentation → Mistral
 *
 * The router is deterministic given the same registry state — no random
 * sampling. This makes plans reproducible and testable.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type TaskType =
  | 'architecture'
  | 'backend'
  | 'frontend'
  | 'testing'
  | 'documentation'
  | 'review'
  | 'debugging'
  | 'refactoring'
  | 'security'
  | 'deployment'
  | 'data-analysis'
  | 'general';

export interface ClassifiedTask {
  readonly type: TaskType;
  readonly confidence: number;
  readonly detectedKeywords: readonly string[];
  readonly subtasks: readonly TaskType[];
}

export interface ExecutionStep {
  readonly taskType: TaskType;
  readonly agentId: string;
  readonly agentName: string;
  readonly model: string;
  readonly reason: string;
  readonly prompt: string;
}

export interface ExecutionPlan {
  readonly originalRequest: string;
  readonly classification: ClassifiedTask;
  readonly steps: readonly ExecutionStep[];
  readonly estimatedCostUsd: number;
  readonly estimatedDurationMs: number;
  readonly createdAt: Date;
}

// ─── 1. TaskClassifier ──────────────────────────────────────────────────────

export class TaskClassifier {
  private readonly keywords: Record<TaskType, readonly string[]> = {
    architecture: ['architecture', 'design', 'system design', 'schema', 'plan', 'blueprint'],
    backend: ['backend', 'api', 'server', 'database', 'endpoint', 'rest', 'graphql', 'sql'],
    frontend: ['frontend', 'ui', 'react', 'vue', 'css', 'tailwind', 'component', 'page'],
    testing: ['test', 'testing', 'unit test', 'integration test', 'coverage', 'jest', 'vitest'],
    documentation: ['document', 'docs', 'readme', 'explain', 'describe', 'comment'],
    review: ['review', 'audit', 'check', 'analyze', 'inspect'],
    debugging: ['debug', 'bug', 'fix', 'error', 'crash', 'traceback', 'stack trace'],
    refactoring: ['refactor', 'restructure', 'clean up', 'simplify', 'reorganize'],
    security: ['security', 'vulnerability', 'owasp', 'cve', 'auth', 'encryption'],
    deployment: ['deploy', 'deployment', 'docker', 'kubernetes', 'ci', 'cd', 'pipeline'],
    'data-analysis': ['analyze', 'data', 'metrics', 'statistics', 'report', 'chart'],
    general: [],
  };

  /**
   * Keyword-based classifier. Fast and deterministic. For production
   * deployments, swap with an LLM-backed classifier (the interface stays
   * the same).
   */
  classify(request: string): ClassifiedTask {
    const lower = request.toLowerCase();
    const scores = new Map<TaskType, { score: number; keywords: string[] }>();

    for (const [type, words] of Object.entries(this.keywords)) {
      const matched: string[] = [];
      for (const kw of words) {
        if (lower.includes(kw)) matched.push(kw);
      }
      if (matched.length > 0) {
        scores.set(type as TaskType, { score: matched.length, keywords: matched });
      }
    }

    if (scores.size === 0) {
      return {
        type: 'general',
        confidence: 0.3,
        detectedKeywords: [],
        subtasks: [],
      };
    }

    const sorted = Array.from(scores.entries()).sort((a, b) => b[1].score - a[1].score);
    const [primaryType, primary] = sorted[0]!;
    const totalScore = sorted.reduce((s, [, v]) => s + v.score, 0);
    const confidence = primary.score / totalScore;

    // Detect subtasks: if the request mentions multiple task keywords
    // (e.g. "build and test"), split into primary + secondary tasks.
    const subtasks: TaskType[] = sorted.slice(1).map(([t]) => t);

    return {
      type: primaryType,
      confidence,
      detectedKeywords: primary.keywords,
      subtasks,
    };
  }
}

// ─── 2. CapabilityMatcher ───────────────────────────────────────────────────

export class CapabilityMatcher {
  private readonly mapping: Record<TaskType, readonly string[]> = {
    architecture: ['architecture', 'planning'],
    backend: ['coding', 'backend'],
    frontend: ['coding', 'frontend'],
    testing: ['testing', 'coding'],
    documentation: ['documentation', 'coding'],
    review: ['review', 'coding'],
    debugging: ['debugging', 'coding'],
    refactoring: ['refactoring', 'coding'],
    security: ['review', 'coding'],
    deployment: ['deployment', 'coding'],
    'data-analysis': ['reasoning', 'coding'],
    general: ['coding'],
  };

  requiredCapabilities(taskType: TaskType): readonly string[] {
    return this.mapping[taskType] ?? ['coding'];
  }
}

// ─── 3. AgentSelector ───────────────────────────────────────────────────────

export interface AgentSelectionCriteria {
  readonly preferTags?: readonly string[];
  readonly preferCostEffective?: boolean;
  readonly preferHighQuality?: boolean;
  readonly maxConcurrencyPressure?: number;  // skip agents whose currentTaskCount >= this fraction of limit
}

export class AgentSelector {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly matcher: CapabilityMatcher = new CapabilityMatcher(),
  ) {}

  select(taskType: TaskType, criteria: AgentSelectionCriteria = {}): AgentRecord | undefined {
    const capabilities = this.matcher.requiredCapabilities(taskType);
    const eligible = this.registry.findEligible({ capabilities });
    if (eligible.length === 0) return undefined;

    // Score each eligible agent
    const scored = eligible.map((agent) => ({
      agent,
      score: this.score(agent, taskType, criteria),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.agent;
  }

  /**
   * Pick multiple agents — useful for parallel review (e.g. one per
   * specialization).
   */
  selectMany(taskType: TaskType, count: number, criteria: AgentSelectionCriteria = {}): readonly AgentRecord[] {
    const capabilities = this.matcher.requiredCapabilities(taskType);
    const eligible = this.registry.findEligible({ capabilities });
    const scored = eligible
      .map((agent) => ({ agent, score: this.score(agent, taskType, criteria) }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map((s) => s.agent);
  }

  private score(agent: AgentRecord, taskType: TaskType, criteria: AgentSelectionCriteria): number {
    let score = 0;

    // Tag preference
    if (criteria.preferTags) {
      for (const tag of criteria.preferTags) {
        if (agent.tags?.includes(tag)) score += 10;
      }
    }

    // Cost-effective preference: lower costMultiplier is better
    if (criteria.preferCostEffective) {
      score += (2 - (agent.costMultiplier ?? 1.0)) * 20;
    }

    // High-quality preference: higher costMultiplier is better (proxy)
    if (criteria.preferHighQuality) {
      score += (agent.costMultiplier ?? 1.0) * 20;
    }

    // Online agents get a big bonus
    if (agent.status === 'online') score += 50;
    else if (agent.status === 'busy') score -= 20;

    // Concurrency pressure: penalize near-capacity agents
    const limit = agent.concurrencyLimit ?? 1;
    const pressure = agent.currentTaskCount / limit;
    if (criteria.maxConcurrencyPressure !== undefined && pressure > criteria.maxConcurrencyPressure) {
      score -= 100;
    }
    score -= pressure * 30;

    // Task-specific bonus
    const taskBonus: Partial<Record<TaskType, string[]>> = {
      architecture: ['architecture'],
      backend: ['backend'],
      frontend: ['frontend'],
      testing: ['testing'],
      documentation: ['documentation'],
      review: ['review'],
      debugging: ['debugging'],
      refactoring: ['refactoring'],
    };
    const bonusCapabilities = taskBonus[taskType] ?? [];
    for (const cap of bonusCapabilities) {
      if (agent.capabilities.includes(cap)) score += 30;
    }

    return score;
  }
}

// ─── 4. ModelSelector ───────────────────────────────────────────────────────

export interface ModelSelectionCriteria {
  readonly preferQuality?: boolean;
  readonly preferSpeed?: boolean;
  readonly preferCost?: boolean;
  readonly maxContextTokens?: number;
}

export class ModelSelector {
  /**
   * Pick the best model for an agent given task criteria. If the agent
   * declares `models: ['*']`, we fall back to a default mapping.
   */
  select(agent: AgentRecord, taskType: TaskType, criteria: ModelSelectionCriteria = {}): string {
    const models = agent.models;
    if (models.length === 0) return 'gpt-4';
    if (models.length === 1) return models[0]!;

    // Default model preferences per task type
    const taskPreferences: Partial<Record<TaskType, readonly string[]>> = {
      architecture: ['claude-3-5-sonnet', 'claude-3-opus', 'gpt-4', 'o1'],
      backend: ['deepseek-coder', 'gpt-4o', 'claude-3-5-sonnet'],
      frontend: ['gemini-1.5-pro', 'gpt-4o', 'claude-3-5-sonnet'],
      testing: ['gpt-4o', 'codex-cli', 'deepseek-coder'],
      documentation: ['mistral-large', 'gpt-4o', 'claude-3-5-haiku'],
      review: ['claude-3-5-sonnet', 'gpt-4'],
      debugging: ['deepseek-coder', 'claude-3-5-sonnet', 'gpt-4o'],
      refactoring: ['claude-3-5-sonnet', 'gpt-4'],
      security: ['claude-3-5-sonnet', 'gpt-4', 'o1'],
      deployment: ['gpt-4o', 'claude-3-5-sonnet'],
      'data-analysis': ['gpt-4o', 'claude-3-5-sonnet'],
      general: ['gpt-4o', 'gpt-4'],
    };

    const preferences = taskPreferences[taskType] ?? ['gpt-4'];

    // If agent supports wildcard, use the task preference directly
    if (models.includes('*')) {
      return preferences[0] ?? 'gpt-4';
    }

    // Otherwise, find the first preferred model the agent supports
    for (const pref of preferences) {
      if (models.includes(pref)) return pref;
    }

    // Fall back to the agent's first model
    return models[0]!;
  }
}

// ─── 5. ExecutionPlanner ────────────────────────────────────────────────────

export class ExecutionPlanner {
  constructor(
    private readonly classifier: TaskClassifier = new TaskClassifier(),
    private readonly agentSelector: AgentSelector,
    private readonly modelSelector: ModelSelector = new ModelSelector(),
  ) {}

  /**
   * Build an execution plan for a user request.
   *
   * If the request is a single task type (e.g. "fix this bug"), returns
   * a single-step plan.
   *
   * If the request mentions multiple task types (e.g. "build and test"),
   * returns a multi-step plan with one step per subtask.
   *
   * If the request is a complex project (e.g. "build a SaaS app"),
   * returns a fixed multi-stage plan (architecture → backend → frontend →
   * testing → documentation).
   */
  plan(request: string, criteria: AgentSelectionCriteria = {}): ExecutionPlan {
    const classification = this.classifier.classify(request);

    // Detect complex project requests
    if (this.isComplexProject(request)) {
      return this.planComplexProject(request, classification, criteria);
    }

    // Single or multi-step plan
    const taskTypes = [classification.type, ...classification.subtasks];
    const steps: ExecutionStep[] = [];

    for (const taskType of taskTypes) {
      const agent = this.agentSelector.select(taskType, criteria);
      if (!agent) continue;
      const model = this.modelSelector.select(agent, taskType);
      steps.push({
        taskType,
        agentId: agent.id,
        agentName: agent.name,
        model,
        reason: `Best agent for ${taskType} (capabilities: ${agent.capabilities.join(', ')})`,
        prompt: this.buildPrompt(request, taskType),
      });
    }

    return {
      originalRequest: request,
      classification,
      steps,
      estimatedCostUsd: this.estimateCost(steps.length),
      estimatedDurationMs: steps.length * 5000,
      createdAt: new Date(),
    };
  }

  private isComplexProject(request: string): boolean {
    const lower = request.toLowerCase();
    const complexIndicators = [
      'build a', 'build an', 'create a', 'develop a', 'implement a',
      'saas', 'application', 'platform', 'system', 'service',
      'full-stack', 'fullstack', 'end-to-end',
    ];
    return complexIndicators.some((kw) => lower.includes(kw));
  }

  private planComplexProject(
    request: string,
    classification: ClassifiedTask,
    criteria: AgentSelectionCriteria,
  ): ExecutionPlan {
    const stages: readonly TaskType[] = ['architecture', 'backend', 'frontend', 'testing', 'documentation'];
    const steps: ExecutionStep[] = [];

    for (const stage of stages) {
      const agent = this.agentSelector.select(stage, criteria);
      if (!agent) continue;
      const model = this.modelSelector.select(agent, stage);
      steps.push({
        taskType: stage,
        agentId: agent.id,
        agentName: agent.name,
        model,
        reason: `Best agent for ${stage} stage`,
        prompt: this.buildStagePrompt(request, stage),
      });
    }

    return {
      originalRequest: request,
      classification,
      steps,
      estimatedCostUsd: this.estimateCost(steps.length),
      estimatedDurationMs: steps.length * 30_000,
      createdAt: new Date(),
    };
  }

  private buildPrompt(request: string, taskType: TaskType): string {
    const prompts: Partial<Record<TaskType, string>> = {
      architecture: `Design the architecture for: ${request}`,
      backend: `Implement the backend for: ${request}`,
      frontend: `Implement the frontend for: ${request}`,
      testing: `Write tests for: ${request}`,
      documentation: `Write documentation for: ${request}`,
      review: `Review: ${request}`,
      debugging: `Debug: ${request}`,
      refactoring: `Refactor: ${request}`,
      security: `Security review: ${request}`,
      deployment: `Set up deployment for: ${request}`,
      'data-analysis': `Analyze: ${request}`,
      general: request,
    };
    return prompts[taskType] ?? request;
  }

  private buildStagePrompt(request: string, stage: TaskType): string {
    const stagePrompts: Partial<Record<TaskType, string>> = {
      architecture: `You are the architect. Design the system architecture for: ${request}. Consider scalability, security, and maintainability.`,
      backend: `You are the backend engineer. Implement the backend based on the architecture for: ${request}`,
      frontend: `You are the frontend engineer. Implement the UI for: ${request}`,
      testing: `You are the test engineer. Write comprehensive tests for: ${request}`,
      documentation: `You are the technical writer. Document: ${request}`,
    };
    return stagePrompts[stage] ?? request;
  }

  private estimateCost(stepCount: number): number {
    // Rough estimate: $0.05 per step
    return stepCount * 0.05;
  }
}

/**
 * Convenience: construct a planner from an AgentRegistry.
 */
export function createPlanner(registry: AgentRegistry): ExecutionPlanner {
  return new ExecutionPlanner(
    new TaskClassifier(),
    new AgentSelector(registry),
    new ModelSelector(),
  );
}

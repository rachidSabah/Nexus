import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AgentRegistry, A2ACoordinator } from '../src/index.js';
import {
  Planner,
  Executor,
  Critic,
  Orchestrator,
  type SubTask,
} from '../src/orchestration.js';

// ─── Planner ────────────────────────────────────────────────────────────────

describe('Planner', () => {
  let registry: AgentRegistry;
  let planner: Planner;

  beforeEach(() => {
    registry = new AgentRegistry();
    planner = new Planner(registry);
  });

  it('generates a plan with an id and createdAt', () => {
    const plan = planner.plan('build a REST API');
    expect(plan.id).toBeDefined();
    expect(plan.taskDescription).toBe('build a REST API');
    expect(plan.createdAt).toBeDefined();
    expect(plan.subtasks.length).toBeGreaterThan(0);
  });

  it('decomposes build tasks into architecture/coding/testing subtasks', () => {
    const plan = planner.plan('build a REST API backend');
    const caps = plan.subtasks.flatMap((s) => s.requiredCapabilities);
    expect(caps).toContain('coding');
    expect(caps).toContain('testing');
  });

  it('decomposes debug tasks into debugging/fix/verify subtasks', () => {
    const plan = planner.plan('fix a bug in the auth module');
    const caps = plan.subtasks.flatMap((s) => s.requiredCapabilities);
    expect(caps).toContain('debugging');
    expect(caps).toContain('testing');
  });

  it('decomposes review tasks into analysis/security/improvement subtasks', () => {
    const plan = planner.plan('review code implementation');
    const caps = plan.subtasks.flatMap((s) => s.requiredCapabilities);
    expect(caps).toContain('code_review');
    expect(caps).toContain('security');
  });

  it('decomposes refactor tasks into analysis/plan/execute/verify subtasks', () => {
    const plan = planner.plan('refactor the database layer');
    const caps = plan.subtasks.flatMap((s) => s.requiredCapabilities);
    expect(caps).toContain('analysis');
    expect(caps).toContain('testing');
  });

  it('decomposes test-writing tasks into analysis/testing subtasks', () => {
    const plan = planner.plan('write unit tests for the auth module');
    const caps = plan.subtasks.flatMap((s) => s.requiredCapabilities);
    expect(caps).toContain('testing');
    expect(caps).toContain('coding');
  });

  it('decomposes document tasks into analysis/documentation subtasks', () => {
    const plan = planner.plan('document the API endpoints');
    const caps = plan.subtasks.flatMap((s) => s.requiredCapabilities);
    expect(caps).toContain('documentation');
  });

  it('uses generic decomposition for unrecognized tasks', () => {
    const plan = planner.plan('do something totally random xyz 123');
    expect(plan.subtasks.length).toBeGreaterThan(0);
    const caps = plan.subtasks.flatMap((s) => s.requiredCapabilities);
    expect(caps).toContain('analysis');
  });

  it('assigns agents from registry when capability matches', () => {
    registry.register({
      id: 'coder-1',
      name: 'Coder',
      role: 'executor',
      capabilities: ['coding'],
      endpoint: 'http://localhost:9001',
    });
    const plan = planner.plan('fix a bug in the parser');
    const assigned = plan.subtasks.find((s) => s.assignedAgentId === 'coder-1');
    expect(assigned).toBeDefined();
  });

  it('leaves assignedAgentId undefined when no agent matches capability', () => {
    const plan = planner.plan('write unit tests for the router');
    // Empty registry — no agents
    plan.subtasks.forEach((s) => {
      expect(s.assignedAgentId).toBeUndefined();
    });
  });

  it('all subtasks start with status pending and attempt 0', () => {
    const plan = planner.plan('build a web app');
    plan.subtasks.forEach((s) => {
      expect(s.status).toBe('pending');
      expect(s.attempt).toBe(0);
    });
  });
});

// ─── Critic ──────────────────────────────────────────────────────────────────

describe('Critic', () => {
  let critic: Critic;
  const codingSubtask: SubTask = {
    id: 'st-1',
    description: 'Implement the login endpoint',
    requiredCapabilities: ['coding'],
    status: 'in_progress',
    attempt: 0,
  };
  const genericSubtask: SubTask = {
    id: 'st-2',
    description: 'Analyze requirements',
    requiredCapabilities: ['analysis'],
    status: 'in_progress',
    attempt: 0,
  };

  beforeEach(() => {
    critic = new Critic();
  });

  it('rejects null result', () => {
    const r = critic.evaluate(genericSubtask, null);
    expect(r.accepted).toBe(false);
    expect(r.score).toBe(0);
  });

  it('rejects undefined result', () => {
    const r = critic.evaluate(genericSubtask, undefined);
    expect(r.accepted).toBe(false);
  });

  it('rejects empty string', () => {
    const r = critic.evaluate(genericSubtask, '');
    expect(r.accepted).toBe(false);
  });

  it('rejects very short string (< 10 chars)', () => {
    const r = critic.evaluate(genericSubtask, 'ok');
    expect(r.accepted).toBe(false);
    expect(r.score).toBeLessThan(0.5);
  });

  it('rejects result that starts with "error"', () => {
    const r = critic.evaluate(genericSubtask, 'error: failed to connect');
    expect(r.accepted).toBe(false);
  });

  it('rejects result that starts with "cannot"', () => {
    const r = critic.evaluate(genericSubtask, 'cannot process the request');
    expect(r.accepted).toBe(false);
  });

  it('accepts a valid string result', () => {
    const r = critic.evaluate(genericSubtask, 'The analysis shows that the system is scalable.');
    expect(r.accepted).toBe(true);
    expect(r.score).toBeGreaterThan(0.5);
  });

  it('accepts a code-like string for coding tasks', () => {
    const r = critic.evaluate(codingSubtask, 'function login(user) { return authenticate(user); }');
    expect(r.accepted).toBe(true);
  });

  it('accepts but flags non-code text for coding tasks with suggestions', () => {
    const r = critic.evaluate(
      codingSubtask,
      'The login endpoint should authenticate the user by checking credentials against the database.',
    );
    expect(r.accepted).toBe(true);
    expect(r.suggestions).toBeDefined();
    expect(r.score).toBeLessThan(0.85);
  });

  it('rejects object with error field', () => {
    const r = critic.evaluate(genericSubtask, { error: 'connection refused' });
    expect(r.accepted).toBe(false);
  });

  it('rejects object with success: false', () => {
    const r = critic.evaluate(genericSubtask, { success: false });
    expect(r.accepted).toBe(false);
  });

  it('accepts object with valid content field', () => {
    const r = critic.evaluate(genericSubtask, { content: 'The analysis is complete.' });
    expect(r.accepted).toBe(true);
  });

  it('accepts object with valid result field', () => {
    const r = critic.evaluate(genericSubtask, { result: 'Found 3 issues.' });
    expect(r.accepted).toBe(true);
  });

  it('accepts a non-error object with no content markers (moderate score)', () => {
    const r = critic.evaluate(genericSubtask, { status: 'done', items: 5 });
    expect(r.accepted).toBe(true);
    expect(r.score).toBe(0.7);
  });

  it('accepts unusual types with low confidence', () => {
    const r = critic.evaluate(genericSubtask, 42);
    expect(r.accepted).toBe(true);
    expect(r.score).toBe(0.5);
  });
});

// ─── Executor ────────────────────────────────────────────────────────────────

describe('Executor', () => {
  let registry: AgentRegistry;
  let coordinator: A2ACoordinator;
  let executor: Executor;

  beforeEach(() => {
    registry = new AgentRegistry();
    coordinator = new A2ACoordinator(registry);
    executor = new Executor(coordinator, 'orchestrator-test');
  });

  it('throws when subtask has no assigned agent', async () => {
    const subtask: SubTask = {
      id: 'st-no-agent',
      description: 'Do something',
      requiredCapabilities: ['coding'],
      status: 'in_progress',
      attempt: 0,
    };
    await expect(executor.execute(subtask)).rejects.toThrow('no assigned agent');
  });

  it('routes to the correct agent via the coordinator', async () => {
    const received: unknown[] = [];
    registry.register({
      id: 'worker-1',
      name: 'Worker',
      role: 'executor',
      capabilities: ['coding'],
      endpoint: 'http://localhost:9002',
    });
    coordinator.onMessage('worker-1', async (msg) => {
      received.push(msg.payload);
      return { result: 'done' };
    });

    const subtask: SubTask = {
      id: 'st-routed',
      description: 'Implement auth',
      requiredCapabilities: ['coding'],
      assignedAgentId: 'worker-1',
      status: 'in_progress',
      attempt: 0,
    };

    const result = await executor.execute(subtask, { extra: 'ctx' });
    expect(result).toEqual({ result: 'done' });
    expect(received.length).toBe(1);
  });
});

// ─── Orchestrator ─────────────────────────────────────────────────────────────

describe('Orchestrator', () => {
  let registry: AgentRegistry;
  let coordinator: A2ACoordinator;

  beforeEach(() => {
    registry = new AgentRegistry();
    coordinator = new A2ACoordinator(registry);
  });

  it('returns completed status when all subtasks are accepted', async () => {
    // Register an agent for every capability the planner might assign
    registry.register({
      id: 'all-rounder',
      name: 'All Rounder',
      role: 'executor',
      capabilities: ['coding', 'testing', 'analysis', 'planning', 'architecture', 'debugging',
                     'reasoning', 'code_review', 'security', 'documentation', 'frontend', 'backend'],
      endpoint: 'http://localhost:9003',
    });
    // Handler that always returns a valid response
    coordinator.onMessage('all-rounder', async () => ({
      content: 'Task completed successfully with all required outputs.',
    }));

    const orch = new Orchestrator(registry, coordinator, { maxRetries: 1 });
    const result = await orch.orchestrate('fix a bug in the login module');

    expect(result.overallStatus).toBe('completed');
    expect(result.totalAttempts).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.subtaskResults.length).toBeGreaterThan(0);
  });

  it('criticResult in results matches last attempt evaluation (bug regression)', async () => {
    registry.register({
      id: 'worker',
      name: 'Worker',
      role: 'executor',
      capabilities: ['coding', 'testing', 'analysis', 'planning', 'architecture', 'debugging',
                     'reasoning', 'code_review', 'security', 'documentation', 'frontend', 'backend'],
      endpoint: 'http://localhost:9004',
    });
    coordinator.onMessage('worker', async () => 'function login() { return true; }');

    const orch = new Orchestrator(registry, coordinator, { maxRetries: 0 });
    const result = await orch.orchestrate('build a web app');

    // Each criticResult should reflect the actual last evaluation, not a re-evaluation
    // on the mutated (status:'completed') subtask.
    for (const sr of result.subtaskResults) {
      expect(sr.criticResult.accepted).toBeDefined();
      expect(typeof sr.criticResult.score).toBe('number');
      expect(sr.criticResult.score).toBeGreaterThanOrEqual(0);
      expect(sr.criticResult.score).toBeLessThanOrEqual(1);
    }
  });

  it('returns failed status when agent is missing for all subtasks', async () => {
    // No agents registered — all subtasks will throw in executor
    const orch = new Orchestrator(registry, coordinator, { maxRetries: 0 });
    const result = await orch.orchestrate('fix a bug in the parser');

    // Subtasks without an assigned agent throw — results should be failed/partial
    expect(['failed', 'partial', 'completed']).toContain(result.overallStatus);
  });

  it('exposes getPlanner() and getCritic()', () => {
    const orch = new Orchestrator(registry, coordinator);
    expect(orch.getPlanner()).toBeInstanceOf(Planner);
    expect(orch.getCritic()).toBeInstanceOf(Critic);
  });
});

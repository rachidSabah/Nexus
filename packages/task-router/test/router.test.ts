import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryEventBus } from '@anx/core';
import { AgentRegistry, BUILTIN_AGENT_TEMPLATES, registerBuiltinAgents } from '@anx/agents';

import {
  TaskClassifier,
  CapabilityMatcher,
  AgentSelector,
  ModelSelector,
  ExecutionPlanner,
  createPlanner,
} from '../src/index.js';

describe('TaskClassifier', () => {
  const classifier = new TaskClassifier();

  it('classifies architecture requests', () => {
    const result = classifier.classify('Design the architecture for a SaaS application');
    expect(result.type).toBe('architecture');
    expect(result.detectedKeywords.length).toBeGreaterThan(0);
  });

  it('classifies backend requests', () => {
    const result = classifier.classify('Build a REST API with database');
    expect(['backend', 'architecture']).toContain(result.type);
  });

  it('classifies frontend requests', () => {
    const result = classifier.classify('Create a React component with Tailwind CSS');
    expect(['frontend']).toContain(result.type);
  });

  it('classifies testing requests', () => {
    const result = classifier.classify('Write unit tests with vitest');
    expect(result.type).toBe('testing');
  });

  it('classifies debugging requests', () => {
    const result = classifier.classify('Debug this crash and fix the bug');
    expect(['debugging']).toContain(result.type);
  });

  it('falls back to general for ambiguous requests', () => {
    const result = classifier.classify('hello world');
    expect(result.type).toBe('general');
  });

  it('detects multiple subtasks', () => {
    const result = classifier.classify('Build and test the API');
    expect(result.subtasks.length).toBeGreaterThan(0);
  });
});

describe('CapabilityMatcher', () => {
  const matcher = new CapabilityMatcher();

  it('returns capabilities for architecture', () => {
    const caps = matcher.requiredCapabilities('architecture');
    expect(caps).toContain('architecture');
  });

  it('returns capabilities for backend', () => {
    const caps = matcher.requiredCapabilities('backend');
    expect(caps).toContain('coding');
  });

  it('returns ["coding"] for unknown task types', () => {
    const caps = matcher.requiredCapabilities('general');
    expect(caps).toContain('coding');
  });
});

describe('AgentSelector', () => {
  let bus: InMemoryEventBus;
  let registry: AgentRegistry;
  let selector: AgentSelector;

  beforeEach(async () => {
    bus = new InMemoryEventBus();
    registry = new AgentRegistry(bus);
    await registerBuiltinAgents(registry);
    selector = new AgentSelector(registry);
  });

  it('selects an agent with the right capabilities', () => {
    const agent = selector.select('architecture');
    expect(agent).toBeDefined();
    expect(agent?.capabilities).toContain('architecture');
  });

  it('selects Claude Code for architecture (tag preference)', () => {
    const agent = selector.select('architecture', { preferTags: ['anthropic'] });
    expect(agent?.id).toBe('claude-code');
  });

  it('selects DeepSeek for backend with cost-effective preference', () => {
    const agent = selector.select('backend', { preferCostEffective: true });
    expect(agent?.id).toBe('deepseek-coder');
  });

  it('selects a frontend-capable agent for frontend', () => {
    const agent = selector.select('frontend');
    expect(agent?.capabilities).toContain('frontend');
  });

  it('selectMany returns N agents', () => {
    const agents = selector.selectMany('coding', 3);
    expect(agents.length).toBeLessThanOrEqual(3);
    expect(agents.length).toBeGreaterThan(0);
  });

  it('returns undefined when no agent matches', async () => {
    await registry.unregister('claude-code');
    await registry.unregister('codex-cli');
    await registry.unregister('opencode');
    await registry.unregister('openhands');
    await registry.unregister('aider');
    await registry.unregister('deepseek-coder');
    await registry.unregister('mistral-coder');
    await registry.unregister('hermes-cli');
    await registry.unregister('continue');
    const agent = selector.select('coding');
    expect(agent).toBeUndefined();
  });
});

describe('ModelSelector', () => {
  const selector = new ModelSelector();

  it('returns the only model if agent has one', () => {
    const agent = BUILTIN_AGENT_TEMPLATES.find((a) => a.id === 'aider')!;
    expect(selector.select(agent as never, 'coding')).toBe(agent.models[0]);
  });

  it('returns task-preferred model when agent supports it', () => {
    const agent = BUILTIN_AGENT_TEMPLATES.find((a) => a.id === 'claude-code')!;
    const model = selector.select(agent as never, 'architecture');
    expect(['claude-3-5-sonnet', 'claude-3-opus']).toContain(model);
  });

  it('returns first model if no preference matches', () => {
    const agent = BUILTIN_AGENT_TEMPLATES.find((a) => a.id === 'codex-cli')!;
    const model = selector.select(agent as never, 'backend');
    expect(model).toBeDefined();
  });

  it('returns task-preference when agent supports wildcard', () => {
    const agent = BUILTIN_AGENT_TEMPLATES.find((a) => a.id === 'opencode')!;
    const model = selector.select(agent as never, 'architecture');
    expect(model).toBe('claude-3-5-sonnet');
  });
});

describe('ExecutionPlanner', () => {
  let bus: InMemoryEventBus;
  let registry: AgentRegistry;
  let planner: ExecutionPlanner;

  beforeEach(async () => {
    bus = new InMemoryEventBus();
    registry = new AgentRegistry(bus);
    await registerBuiltinAgents(registry);
    planner = createPlanner(registry);
  });

  it('plans a single-step task', () => {
    const plan = planner.plan('Fix this bug: TypeError in line 42');
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(plan.classification.type).toBe('debugging');
  });

  it('plans a multi-stage project with architecture → backend → frontend → testing → documentation', () => {
    const plan = planner.plan('Build a SaaS application for project management');
    expect(plan.steps.length).toBe(5);
    const taskTypes = plan.steps.map((s) => s.taskType);
    expect(taskTypes).toEqual(['architecture', 'backend', 'frontend', 'testing', 'documentation']);
  });

  it('each step has an agent, model, and prompt', () => {
    const plan = planner.plan('Build a SaaS application');
    for (const step of plan.steps) {
      expect(step.agentId).toBeDefined();
      expect(step.agentName).toBeDefined();
      expect(step.model).toBeDefined();
      expect(step.prompt).toBeDefined();
      expect(step.prompt.length).toBeGreaterThan(0);
    }
  });

  it('estimates cost and duration', () => {
    const plan = planner.plan('Build a SaaS application');
    expect(plan.estimatedCostUsd).toBeGreaterThan(0);
    expect(plan.estimatedDurationMs).toBeGreaterThan(0);
  });

  it('respects cost-effective preference', () => {
    const plan = planner.plan('Build a SaaS application', { preferCostEffective: true });
    // For backend, should pick deepseek-coder
    const backendStep = plan.steps.find((s) => s.taskType === 'backend');
    expect(backendStep?.agentId).toBe('deepseek-coder');
  });

  it('respects high-quality preference', () => {
    const plan = planner.plan('Build a SaaS application', { preferHighQuality: true });
    // For architecture, should pick claude-code (high costMultiplier)
    const archStep = plan.steps.find((s) => s.taskType === 'architecture');
    expect(archStep?.agentId).toBe('claude-code');
  });
});

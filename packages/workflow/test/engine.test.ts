import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InMemoryEventBus, type ChatCompletionResponse } from '@anx/core';
import { AgentRegistry } from '@anx/agents';
import { AgentRuntime, InMemoryTaskExecutor } from '@anx/runtime';

import {
  WorkflowEngine,
  InMemoryWorkflowRepository,
  WORKFLOW_TEMPLATES,
} from '../src/index.js';

function makeResponse(content: string): ChatCompletionResponse {
  return {
    id: 'resp-1',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    provider: 'openai',
    endpoint: 'ep-1',
    latencyMs: 100,
    costUsd: 0.001,
  };
}

async function makeEngine(handler: (req: { messages: Array<{ content: string }> }) => Promise<ChatCompletionResponse>) {
  const bus = new InMemoryEventBus();
  const registry = new AgentRegistry(bus);
  for (const id of ['claude-code', 'deepseek-coder', 'codex-cli', 'mistral-coder']) {
    await registry.register({
      id,
      name: id,
      description: 'test',
      capabilities: ['coding'],
      tools: ['filesystem'],
      models: ['*'],
      permissions: ['filesystem.read'],
    });
  }
  const executor = new InMemoryTaskExecutor(handler as never);
  const runtime = new AgentRuntime(registry, executor, bus);
  const repo = new InMemoryWorkflowRepository();
  const engine = new WorkflowEngine(repo, runtime, bus);
  return { bus, registry, runtime, repo, engine };
}

describe('WorkflowEngine', () => {
  it('creates a new workflow with version 1', async () => {
    const { engine } = await makeEngine(async () => makeResponse('x'));
    const def = await engine.create({
      name: 'Test Workflow',
      description: 'test',
      steps: [{ name: 'step1', agent: 'claude-code', task: 'do thing' }],
    });
    expect(def.version).toBe(1);
    expect(def.id).toBeDefined();
  });

  it('bumps version when creating with existing id', async () => {
    const { engine } = await makeEngine(async () => makeResponse('x'));
    await engine.create({
      id: 'wf-1',
      name: 'V1',
      description: 'test',
      steps: [{ name: 'step1', agent: 'claude-code', task: 'do' }],
    });
    const v2 = await engine.create({
      id: 'wf-1',
      name: 'V2',
      description: 'test',
      steps: [{ name: 'step1', agent: 'claude-code', task: 'do' }],
    });
    expect(v2.version).toBe(2);
    expect(v2.name).toBe('V2');
  });

  it('lists versions', async () => {
    const { engine } = await makeEngine(async () => makeResponse('x'));
    await engine.create({ id: 'wf-1', name: 'V1', description: '', steps: [{ name: 's', agent: 'claude-code', task: 't' }] });
    await engine.create({ id: 'wf-1', name: 'V2', description: '', steps: [{ name: 's', agent: 'claude-code', task: 't' }] });
    const versions = await engine.listVersions('wf-1');
    expect(versions.length).toBe(2);
  });

  it('executes a simple 2-step workflow and chains outputs', async () => {
    const { engine } = await makeEngine(async (req) => {
      const userMsg = req.messages.find((m) => m.content?.includes?.('step1 result')) ?? req.messages[0]!;
      return makeResponse(`output-from-${userMsg.content!.slice(0, 10)}`);
    });

    const def = await engine.create({
      id: 'test-wf',
      name: 'Test',
      description: 'two steps',
      steps: [
        { name: 'step1', agent: 'claude-code', task: 'Do step 1' },
        { name: 'step2', agent: 'claude-code', task: 'Use this: ${step1}', inputs: ['step1'] },
      ],
      outputs: [{ name: 'final', fromStep: 'step2' }],
    });

    const executionId = await engine.start(def.id);
    // Give it a tick to run
    await new Promise((r) => setTimeout(r, 50));

    const exec = await engine.getExecution(executionId);
    expect(exec?.status).toBe('completed');
    expect(exec?.steps[0]?.status).toBe('completed');
    expect(exec?.steps[1]?.status).toBe('completed');
    expect(exec?.outputs?.['final']).toBeDefined();
    expect(exec?.totalCostUsd).toBeGreaterThan(0);
    expect(exec?.totalTokensUsed).toBe(30); // 15 * 2 steps
  });

  it('emits workflow.started, step.started, step.completed, workflow.completed events', async () => {
    const { engine, bus } = await makeEngine(async () => makeResponse('ok'));

    const events: string[] = [];
    bus.subscribe(
      ['workflow.started', 'workflow.step.started', 'workflow.step.completed', 'workflow.completed'],
      (e) => events.push(e.type),
    );

    const def = await engine.create({
      id: 'events-wf',
      name: 'Events Test',
      description: '',
      steps: [{ name: 's1', agent: 'claude-code', task: 'do' }],
    });

    const executionId = await engine.start(def.id);
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => queueMicrotask(r));

    expect(events).toContain('workflow.started');
    expect(events).toContain('workflow.step.started');
    expect(events).toContain('workflow.step.completed');
    expect(events).toContain('workflow.completed');
  });

  it('marks execution as failed when a step fails', async () => {
    const { engine } = await makeEngine(async () => {
      throw new Error('boom');
    });

    const def = await engine.create({
      id: 'fail-wf',
      name: 'Fail Test',
      description: '',
      steps: [{ name: 's1', agent: 'claude-code', task: 'do', maxRetries: 0 }],
    });

    const executionId = await engine.start(def.id);
    await new Promise((r) => setTimeout(r, 100));

    const exec = await engine.getExecution(executionId);
    expect(exec?.status).toBe('failed');
    expect(exec?.error).toContain('failed');
  });

  it('interpolates ${inputs.x} references', async () => {
    let captured = '';
    const { engine } = await makeEngine(async (req) => {
      captured = req.messages[req.messages.length - 1]!.content as string;
      return makeResponse('ok');
    });

    const def = await engine.create({
      id: 'interp-wf',
      name: 'Interp Test',
      description: '',
      steps: [
        { name: 's1', agent: 'claude-code', task: 'Build feature: ${inputs.featureName}' },
      ],
    });

    await engine.start(def.id, { featureName: 'user-auth' });
    await new Promise((r) => setTimeout(r, 50));
    expect(captured).toContain('user-auth');
  });

  it('lists executions for a workflow', async () => {
    const { engine } = await makeEngine(async () => makeResponse('ok'));
    const def = await engine.create({
      id: 'list-wf',
      name: 'List Test',
      description: '',
      steps: [{ name: 's1', agent: 'claude-code', task: 'do' }],
    });

    await engine.start(def.id);
    await engine.start(def.id);
    await new Promise((r) => setTimeout(r, 100));

    const executions = await engine.listExecutions(def.id);
    expect(executions.length).toBe(2);
  });

  it('WORKFLOW_TEMPLATES includes the software development pipeline', () => {
    expect(WORKFLOW_TEMPLATES.softwareDevelopmentPipeline.steps.length).toBe(5);
    expect(WORKFLOW_TEMPLATES.bugTriage.steps.length).toBe(4);
    expect(WORKFLOW_TEMPLATES.codeReview.steps.length).toBe(4);
  });

  it('replays an execution with the same inputs', async () => {
    const { engine } = await makeEngine(async () => makeResponse('ok'));
    const def = await engine.create({
      id: 'replay-wf',
      name: 'Replay Test',
      description: '',
      steps: [{ name: 's1', agent: 'claude-code', task: 'do ${inputs.x}' }],
    });

    const executionId = await engine.start(def.id, { x: 'hello' });
    await new Promise((r) => setTimeout(r, 50));
    const replayedId = await engine.replay(executionId);
    expect(replayedId).toBeDefined();
    expect(replayedId).not.toBe(executionId);
    await new Promise((r) => setTimeout(r, 50));
    const replayed = await engine.getExecution(replayedId!);
    expect(replayed?.status).toBe('completed');
    expect(replayed?.inputs['x']).toBe('hello');
  });

  it('cancels a running execution', async () => {
    let resolveFirst: (() => void) | undefined;
    const { engine } = await makeEngine(
      () =>
        new Promise<ChatCompletionResponse>((resolve) => {
          resolveFirst = () => resolve(makeResponse('ok'));
        }),
    );

    const def = await engine.create({
      id: 'cancel-wf',
      name: 'Cancel Test',
      description: '',
      steps: [
        { name: 's1', agent: 'claude-code', task: 'wait' },
        { name: 's2', agent: 'claude-code', task: 'do' },
      ],
    });

    const executionId = await engine.start(def.id);
    await new Promise((r) => setTimeout(r, 20));
    const cancelled = await engine.cancel(executionId);
    expect(cancelled).toBe(true);
    resolveFirst!();
    await new Promise((r) => setTimeout(r, 50));
    const exec = await engine.getExecution(executionId);
    expect(['cancelled', 'completed']).toContain(exec?.status);
  });
});

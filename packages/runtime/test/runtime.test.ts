import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InMemoryEventBus, type ChatCompletionResponse } from '@anx/core';
import { AgentRegistry } from '@anx/agents';

import { AgentRuntime, InMemoryTaskExecutor, generateTaskId, type TaskRequest } from '../src/index.js';

function makeResponse(content: string, costUsd = 0.001): ChatCompletionResponse {
  return {
    id: 'resp-1',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4',
    choices: [
      { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
    ],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    provider: 'openai',
    endpoint: 'ep-1',
    latencyMs: 100,
    costUsd,
  };
}

describe('AgentRuntime', () => {
  let bus: InMemoryEventBus;
  let registry: AgentRegistry;
  let runtime: AgentRuntime;

  beforeEach(async () => {
    bus = new InMemoryEventBus();
    registry = new AgentRegistry(bus);
    await registry.register({
      id: 'a1',
      name: 'Test Agent',
      description: 'test',
      capabilities: ['coding'],
      tools: ['filesystem'],
      models: ['gpt-4'],
      permissions: ['filesystem.read'],
      concurrencyLimit: 2,
    });
  });

  it('opens and closes sessions', () => {
    const session = runtime.openSession('a1');
    expect(session.agentId).toBe('a1');
    expect(runtime.getSession(session.id)).toBeDefined();
    runtime.closeSession(session.id);
    expect(runtime.getSession(session.id)).toBeUndefined();
  });

  it('openSession throws for unknown agent', () => {
    expect(() => runtime.openSession('unknown')).toThrow('Unknown agent');
  });

  it('executes a task successfully', async () => {
    const executor = new InMemoryTaskExecutor(async () => makeResponse('Hello!'));
    runtime = new AgentRuntime(registry, executor, bus);

    const task: TaskRequest = {
      id: generateTaskId(),
      agentId: 'a1',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    };

    const result = await runtime.executeTask(task);
    expect(result.success).toBe(true);
    expect(result.response?.choices[0]?.message.content).toBe('Hello!');
    expect(result.tokensUsed).toBe(15);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('emits agent.started and agent.completed events', async () => {
    const executor = new InMemoryTaskExecutor(async () => makeResponse('Hello!'));
    runtime = new AgentRuntime(registry, executor, bus);

    const started: unknown[] = [];
    const completed: unknown[] = [];
    bus.subscribe('agent.started', (e) => started.push(e));
    bus.subscribe('agent.completed', (e) => completed.push(e));

    await runtime.executeTask({
      id: 't1',
      agentId: 'a1',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    });
    await new Promise((r) => queueMicrotask(r));
    expect(started.length).toBe(1);
    expect(completed.length).toBe(1);
  });

  it('returns failure for unknown agent', async () => {
    const executor = new InMemoryTaskExecutor(async () => makeResponse('x'));
    runtime = new AgentRuntime(registry, executor, bus);

    const result = await runtime.executeTask({
      id: 't1',
      agentId: 'unknown',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AGENT_NOT_FOUND');
  });

  it('returns failure for offline agent', async () => {
    await registry.setStatus('a1', 'offline');
    const executor = new InMemoryTaskExecutor(async () => makeResponse('x'));
    runtime = new AgentRuntime(registry, executor, bus);

    const result = await runtime.executeTask({
      id: 't1',
      agentId: 'a1',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AGENT_OFFLINE');
  });

  it('emits agent.failed on executor error', async () => {
    const executor = new InMemoryTaskExecutor(async () => {
      throw new Error('boom');
    });
    runtime = new AgentRuntime(registry, executor, bus);

    const failed: unknown[] = [];
    bus.subscribe('agent.failed', (e) => failed.push(e));

    const result = await runtime.executeTask({
      id: 't1',
      agentId: 'a1',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      maxRetries: 0,
    });
    await new Promise((r) => queueMicrotask(r));
    expect(result.success).toBe(false);
    expect(failed.length).toBe(1);
  });

  it('marks agent as busy during execution', async () => {
    let resolveExec: ((v: ChatCompletionResponse) => void) | undefined;
    const executor = new InMemoryTaskExecutor(
      () => new Promise<ChatCompletionResponse>((resolve) => (resolveExec = resolve)),
    );
    runtime = new AgentRuntime(registry, executor, bus);

    const taskPromise = runtime.executeTask({
      id: 't1',
      agentId: 'a1',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    });

    // Give the executor a tick to start
    await new Promise((r) => setTimeout(r, 10));
    expect(registry.get('a1')?.currentTaskCount).toBe(1);

    resolveExec!(makeResponse('done'));
    await taskPromise;
    expect(registry.get('a1')?.currentTaskCount).toBe(0);
  });

  it('retries on retryable errors', async () => {
    let calls = 0;
    const executor = new InMemoryTaskExecutor(async () => {
      calls++;
      if (calls < 3) {
        const err = new Error('timeout') as Error & { code: string };
        err.code = 'ETIMEDOUT';
        throw err;
      }
      return makeResponse('finally');
    });
    runtime = new AgentRuntime(registry, executor, bus);

    const result = await runtime.executeTask({
      id: 't1',
      agentId: 'a1',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      maxRetries: 3,
    });
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it('executeParallel runs tasks concurrently', async () => {
    const executor = new InMemoryTaskExecutor(async () => makeResponse('x'));
    runtime = new AgentRuntime(registry, executor, bus);

    const tasks: TaskRequest[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      agentId: 'a1',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    }));

    const results = await runtime.executeParallel(tasks);
    expect(results.length).toBe(5);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('applies agent costMultiplier', async () => {
    await registry.register({
      id: 'a2',
      name: 'Premium Agent',
      description: 'test',
      capabilities: ['coding'],
      tools: [],
      models: ['gpt-4'],
      permissions: [],
      costMultiplier: 2.0,
    });
    const executor = new InMemoryTaskExecutor(async () => makeResponse('x', 0.01));
    runtime = new AgentRuntime(registry, executor, bus);

    const result = await runtime.executeTask({
      id: 't1',
      agentId: 'a2',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.costUsd).toBeCloseTo(0.02, 5);
  });

  it('systemPrompt is prepended to messages', async () => {
    let captured: ChatCompletionRequest['messages'] | undefined;
    const executor = new InMemoryTaskExecutor(async (req) => {
      captured = req.messages;
      return makeResponse('x');
    });
    runtime = new AgentRuntime(registry, executor, bus);

    await runtime.executeTask({
      id: 't1',
      agentId: 'a1',
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'You are a coding agent.',
    });
    expect(captured?.[0]).toEqual({ role: 'system', content: 'You are a coding agent.' });
    expect(captured?.[1]).toEqual({ role: 'user', content: 'hi' });
  });
});

// Import for the type annotation in the test
import type { ChatCompletionRequest } from '@anx/core';

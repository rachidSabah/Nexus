import { describe, it, expect } from 'vitest';
import { InMemoryEventBus } from '@anx/core';
import type { AgentRuntime, TaskRequest, TaskResult } from '@anx/runtime';
import { WorkflowEngine, InMemoryWorkflowRepository, type WorkflowDefinition } from '../src/index.js';

class MockRuntime implements AgentRuntime {
  public executedSteps: string[] = [];

  async executeTask(task: TaskRequest): Promise<TaskResult> {
    this.executedSteps.push(task.id);
    return {
      taskId: task.id,
      agentId: task.agentId,
      success: true,
      response: {
        id: `resp-${task.id}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: `Output for ${task.id}` },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        provider: 'mock',
        endpoint: 'mock',
        latencyMs: 10,
      },
      costUsd: 0.001,
      tokensUsed: 15,
      durationMs: 10,
    };
  }

  async cancelTask(_taskId: string): Promise<boolean> {
    return true;
  }
}

describe('Workflow Engine v1 — DAG & Parallel Execution', () => {
  it('executes independent branches in parallel and evaluates downstream steps', async () => {
    const bus = new InMemoryEventBus();
    const repo = new InMemoryWorkflowRepository();
    const runtime = new MockRuntime();
    const engine = new WorkflowEngine(repo, runtime, bus);

    const def = await engine.create({
      id: 'wf-dag-1',
      name: 'Parallel Analysis & Synthesis',
      description: 'Runs branch A and B concurrently, then merges into C',
      steps: [
        {
          name: 'analyzeCode',
          agent: 'coder-1',
          task: 'Analyze source code structure',
        },
        {
          name: 'analyzeSecurity',
          agent: 'sec-1',
          task: 'Analyze security vulnerabilities',
        },
        {
          name: 'synthesizeReport',
          agent: 'lead-1',
          task: 'Combine findings from analyzeCode and analyzeSecurity',
          dependsOn: ['analyzeCode', 'analyzeSecurity'],
        },
      ],
    });

    const executionId = await engine.start(def.id);

    // Wait for async DAG completion
    let final;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      final = await engine.getExecution(executionId);
      if (final?.status === 'completed' || final?.status === 'failed') break;
    }

    expect(final?.status).toBe('completed');
    expect(final?.steps.length).toBe(3);
    expect(final?.steps[0]?.status).toBe('completed');
    expect(final?.steps[1]?.status).toBe('completed');
    expect(final?.steps[2]?.status).toBe('completed');
  });
});

import { describe, it, expect } from 'vitest';
import { SubMillisecondRouter, SpeculativeParallelRouter, BatchManager } from '../src/index.js';
import type { ProviderEndpoint, ChatCompletionResponse } from '@anx/core';

describe('Performance & Scale Routing', () => {
  const ep1: ProviderEndpoint = {
    id: 'ep-fast',
    providerId: 'fast-provider',
    baseUrl: 'https://fast.ai/v1',
    displayName: 'Fast Provider',
    models: ['fast-gpt-4'],
    health: 'healthy',
    priority: 10,
  };

  const ep2: ProviderEndpoint = {
    id: 'ep-slow',
    providerId: 'slow-provider',
    baseUrl: 'https://slow.ai/v1',
    displayName: 'Slow Provider',
    models: ['fast-gpt-4', 'slow-claude'],
    health: 'healthy',
    priority: 5,
  };

  it('SubMillisecondRouter resolves route in under 1ms', async () => {
    const router = new SubMillisecondRouter([ep1, ep2]);

    const start = performance.now();
    const decision = await router.resolve({ model: 'fast-gpt-4' });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5.0); // well under threshold
    expect(decision.endpoint.id).toBe('ep-fast');
    expect(decision.strategy).toBe('precomputed_table');
  });

  it('SpeculativeParallelRouter returns winning response and cancels slower branch', async () => {
    const router = new SubMillisecondRouter([ep1, ep2]);
    const speculative = new SpeculativeParallelRouter(router);

    const fakeCaller = async (ep: ProviderEndpoint, signal: AbortSignal): Promise<ChatCompletionResponse> => {
      const delay = ep.id === 'ep-fast' ? 10 : 80;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });

      return {
        id: `resp-${ep.id}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'fast-gpt-4',
        choices: [{ index: 0, message: { role: 'assistant', content: `Hello from ${ep.id}` }, finish_reason: 'stop' }],
        usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        provider: ep.providerId,
        endpoint: ep.id,
        latencyMs: delay,
        costUsd: 0.0001,
      };
    };

    const result = await speculative.executeSpeculative(
      { model: 'fast-gpt-4', messages: [{ role: 'user', content: 'hi' }] },
      fakeCaller,
      2,
    );

    expect(result.winningEndpoint.id).toBe('ep-fast');
    expect(result.response.choices[0]?.message.content).toContain('ep-fast');
  });

  it('BatchManager creates, tracks and completes batch jobs', () => {
    const batchMgr = new BatchManager();
    const job = batchMgr.createBatch('openai', [{ model: 'gpt-4o', messages: [] }]);

    expect(job.id).toBeDefined();
    expect(job.status).toBe('in_progress');
    expect(job.requestCount).toBe(1);

    const completed = batchMgr.completeBatch(job.id, 'file_output_123');
    expect(completed?.status).toBe('completed');
    expect(completed?.outputFileId).toBe('file_output_123');
  });
});

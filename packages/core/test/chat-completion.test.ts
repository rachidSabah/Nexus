import { describe, it, expect } from 'vitest';

import { computeCost, ChatCompletionUseCase } from '../src/application/chat-completion.usecase.js';
import { InMemoryEventBus } from '../src/application/event-bus.js';
import { RoutingEngine } from '../src/application/routing-engine.js';
import { DefaultFailover } from '../src/application/failover.js';
import { DefaultCostCalculator } from '../src/application/cost-calculator.js';
import { AllProvidersExhaustedError } from '../src/domain/errors.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderEndpoint,
} from '../src/domain/types.js';
import type { ProviderAdapter } from '../src/application/ports.js';

describe('computeCost', () => {
  it('computes linear cost per 1K tokens', () => {
    const cost = computeCost(
      { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      { inputPer1K: 0.01, outputPer1K: 0.03 },
    );
    expect(cost.inputCostUsd).toBeCloseTo(0.01, 6);
    expect(cost.outputCostUsd).toBeCloseTo(0.015, 6);
    expect(cost.totalCostUsd).toBeCloseTo(0.025, 6);
  });

  it('applies cached input discount when provided', () => {
    const cost = computeCost(
      {
        promptTokens: 1000,
        completionTokens: 0,
        totalTokens: 1000,
        cachedTokens: 500,
      },
      { inputPer1K: 0.01, outputPer1K: 0.03, cachedInputPer1K: 0.001 },
    );
    // 500 non-cached in @ 0.01 + 500 cached @ 0.001 + 0 out
    expect(cost.cachedInputCostUsd).toBeCloseTo(0.0005, 6);
    expect(cost.inputCostUsd).toBeCloseTo(0.01, 6); // full prompt cost (cached billed separately)
    expect(cost.totalCostUsd).toBeCloseTo(0.0105, 6);
  });

  it('returns zero for empty usage', () => {
    const cost = computeCost(
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      { inputPer1K: 99, outputPer1K: 99 },
    );
    expect(cost.totalCostUsd).toBe(0);
  });
});

class FakeAdapter implements ProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  public nextResponse: ChatCompletionResponse | (() => Error) | null = null;

  constructor(providerId: string, displayName: string) {
    this.providerId = providerId;
    this.displayName = displayName;
  }

  async chatCompletion(): Promise<ChatCompletionResponse> {
    if (typeof this.nextResponse === 'function') throw this.nextResponse();
    if (!this.nextResponse) {
      throw new Error('FakeAdapter: no response configured');
    }
    return this.nextResponse;
  }

  async *streamChatCompletion() {
    // not used in this test
  }

  async healthCheck() {
    return true;
  }
}

function makeEndpoint(id: string, providerId: string): ProviderEndpoint {
  return {
    id,
    providerId,
    displayName: id,
    baseUrl: 'https://example.com',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      audio: false,
      speech: false,
      embeddings: false,
      reasoning: false,
      jsonMode: true,
      maxOutputTokens: 4096,
      maxInputTokens: 32768,
      supportedModalities: ['text'],
    },
    pricing: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
    priority: 1,
    weight: 1,
    region: 'us-east',
    tags: ['default'],
    timeoutMs: 30_000,
    maxRetries: 2,
    concurrencyLimit: 10,
    health: 'healthy',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('ChatCompletionUseCase', () => {
  function makeUsecase(adapters: Map<string, ProviderAdapter>) {
    const bus = new InMemoryEventBus();
    const engine = new RoutingEngine(bus);
    for (const [, adapter] of adapters) {
      engine.registerEndpoint(makeEndpoint(`ep-${adapter.providerId}`, adapter.providerId));
    }
    return {
      bus,
      engine,
      usecase: new ChatCompletionUseCase(
        engine,
        new DefaultFailover(),
        adapters,
        bus,
        new DefaultCostCalculator(),
      ),
    };
  }

  it('returns response on happy path', async () => {
    const adapter = new FakeAdapter('openai', 'OpenAI');
    adapter.nextResponse = {
      id: 'resp-1',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        },
      ],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      provider: 'openai',
      endpoint: 'ep-openai',
      latencyMs: 0,
    };

    const { usecase } = makeUsecase(new Map([['openai', adapter]]));
    const request: ChatCompletionRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    };

    const response = await usecase.execute(request);
    expect(response.choices[0]?.message.content).toBe('Hello!');
    expect(response.costUsd).toBeGreaterThan(0);
    expect(response.endpoint).toBe('ep-openai');
  });

  it('failovers when first provider throws retryable error', async () => {
    const primary = new FakeAdapter('openai', 'OpenAI');
    primary.nextResponse = () => {
      const err = new Error('timeout') as Error & { code: string; status?: number };
      err.code = 'ETIMEDOUT';
      err.status = 500;
      // Mimic ProviderResponseError shape
      Object.defineProperty(err, 'code', { value: 'ETIMEDOUT', enumerable: true });
      return err;
    };

    const fallback = new FakeAdapter('anthropic', 'Anthropic');
    fallback.nextResponse = {
      id: 'resp-2',
      object: 'chat.completion',
      created: 1,
      model: 'claude-3',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello from fallback!' },
          finish_reason: 'stop',
        },
      ],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      provider: 'anthropic',
      endpoint: 'ep-anthropic',
      latencyMs: 0,
    };

    const { usecase, bus } = makeUsecase(
      new Map([
        ['openai', primary],
        ['anthropic', fallback],
      ]),
    );

    const events: unknown[] = [];
    bus.subscribe('failover.triggered', (e) => events.push(e));

    const response = await usecase.execute({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.provider).toBe('anthropic');
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
  });

  it('throws AllProvidersExhaustedError when all providers fail', async () => {
    const adapter1 = new FakeAdapter('openai', 'OpenAI');
    adapter1.nextResponse = () => {
      const err = new Error('timeout') as Error & { code: string };
      err.code = 'ETIMEDOUT';
      return err;
    };

    const { usecase } = makeUsecase(new Map([['openai', adapter1]]));

    await expect(
      usecase.execute({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(AllProvidersExhaustedError);
  });
});

import { describe, it, expect } from 'vitest';

import { computeCost, ChatCompletionUseCase } from '../src/application/chat-completion.usecase.js';
import { InMemoryEventBus } from '../src/application/event-bus.js';
import { RoutingEngine } from '../src/application/routing-engine.js';
import { DefaultFailover } from '../src/application/failover.js';
import { DefaultCostCalculator } from '../src/application/cost-calculator.js';
import { AllProvidersExhaustedError, ProviderResponseError } from '../src/domain/errors.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderEndpoint,
} from '../src/domain/types.js';
import type { ProviderAdapter } from '../src/application/ports.js';
import { classifyFailure } from '../src/application/chat-completion.usecase.js';

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
      // Use the real ProviderResponseError so isRetryable() recognizes the 5xx status.
      return new ProviderResponseError('ep-openai', 500, 'timeout');
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

    const bus = new InMemoryEventBus();
    const engine = new RoutingEngine(bus);
    // openai has priority 1 (highest), anthropic has priority 2 (failover)
    const openaiEp = makeEndpoint('ep-openai', 'openai');
    engine.registerEndpoint({ ...openaiEp, priority: 1 });
    const anthropicEp = makeEndpoint('ep-anthropic', 'anthropic');
    engine.registerEndpoint({ ...anthropicEp, priority: 2 });

    const usecase = new ChatCompletionUseCase(
      engine,
      new DefaultFailover(),
      new Map([
        ['openai', primary],
        ['anthropic', fallback],
      ]),
      bus,
      new DefaultCostCalculator(),
    );

    const events: string[] = [];
    bus.subscribe('failover.triggered', () => events.push('failover'));
    bus.subscribe('provider.request.failed', () => events.push('failed'));
    bus.subscribe('provider.request.succeeded', () => events.push('succeeded'));

    const response = await usecase.execute({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      routing: { strategy: 'priority' },
    });

    expect(response.provider).toBe('anthropic');
    // Allow all pending microtasks (publish uses queueMicrotask internally)
    // to flush before asserting.
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toContain('failover');
    expect(events).toContain('failed');
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

/** Scripted streaming adapter: yields queued chunks, or throws when scripted. */
class FakeStreamingAdapter implements ProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  public chunks: ChatCompletionChunk[] = [];
  public midStreamError: Error | null = null;
  public calls = 0;

  constructor(providerId: string) {
    this.providerId = providerId;
    this.displayName = providerId;
  }

  async *streamChatCompletion(): AsyncGenerator<ChatCompletionChunk> {
    this.calls++;
    for (const c of this.chunks) {
      yield c;
      if (this.midStreamError) {
        const err = this.midStreamError;
        this.midStreamError = null;
        throw err;
      }
    }
    if (this.midStreamError) {
      const err = this.midStreamError;
      this.midStreamError = null;
      throw err;
    }
  }

  async chatCompletion(): Promise<ChatCompletionResponse> {
    throw new Error('not used');
  }

  async healthCheck() {
    return true;
  }
}

function chunk(id: string, content: string): ChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

describe('ChatCompletionUseCase streaming (TEST 9/10)', () => {
  function makeUsecase(adapters: Map<string, ProviderAdapter>) {
    const bus = new InMemoryEventBus();
    const engine = new RoutingEngine(bus);
    let priority = 1;
    for (const [, adapter] of adapters) {
      engine.registerEndpoint({
        ...makeEndpoint(`ep-${adapter.providerId}`, adapter.providerId),
        priority: priority++,
      });
    }
    return new ChatCompletionUseCase(
      engine,
      new DefaultFailover(),
      adapters,
      bus,
      new DefaultCostCalculator(),
    );
  }

  function sink() {
    const writes: ChatCompletionChunk[] = [];
    const events: string[] = [];
    return {
      writes,
      events,
      sink: {
        write: async (c: ChatCompletionChunk) => { writes.push(c); events.push('write'); },
        error: async () => { events.push('error'); },
        end: async () => { events.push('end'); },
      },
    };
  }

  it('TEST 9: 429 before first byte → safe failover, single clean output, no error event', async () => {
    const primary = new FakeStreamingAdapter('openai');
    primary.midStreamError = new ProviderResponseError('ep-openai', 429, 'rate limited');
    const fallback = new FakeStreamingAdapter('anthropic');
    fallback.chunks = [chunk('c1', 'Hello from fallback!')];

    const usecase = makeUsecase(new Map([['openai', primary], ['anthropic', fallback]]));
    const s = sink();
    const response = await usecase.execute(
      { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }], stream: true, routing: { strategy: 'priority' } },
      s.sink,
    );

    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(1);
    expect(s.writes.map((w) => w.choices[0]?.delta.content).join('')).toBe('Hello from fallback!');
    expect(s.events).not.toContain('error');
    expect(response.choices[0]?.message.content).toBe('Hello from fallback!');
  });

  it('TEST 10: failure AFTER bytes emitted → NO failover replay, clean rejection', async () => {
    const primary = new FakeStreamingAdapter('openai');
    primary.chunks = [chunk('c1', 'partial output')];
    primary.midStreamError = new ProviderResponseError('ep-openai', 429, 'mid-stream rate limit');
    const fallback = new FakeStreamingAdapter('anthropic');
    fallback.chunks = [chunk('c2', 'MUST NOT BE REPLAYED')];

    const usecase = makeUsecase(new Map([['openai', primary], ['anthropic', fallback]]));
    const s = sink();

    await expect(
      usecase.execute(
        { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }], stream: true, routing: { strategy: 'priority' } },
        s.sink,
      ),
    ).rejects.toThrow();

    // Bytes were emitted exactly once; the fallback provider was NEVER called
    // (no duplicate tool calls / duplicated output).
    expect(s.writes.map((w) => w.choices[0]?.delta.content).join('')).toBe('partial output');
    expect(fallback.calls).toBe(0);
  });

  it('TEST 6: FreeUsageLimitError (429) → failover, key cooldown path (keyAction=cooldown)', async () => {
    const primary = new FakeStreamingAdapter('openai');
    primary.midStreamError = new ProviderResponseError('ep-openai', 429, JSON.stringify({
      type: 'error',
      error: { type: 'FreeUsageLimitError', message: 'Rate limit exceeded. Please try again later.' },
    }));
    const fallback = new FakeStreamingAdapter('anthropic');
    fallback.chunks = [chunk('c1', 'ok')];

    const usecase = makeUsecase(new Map([['openai', primary], ['anthropic', fallback]]));
    const s = sink();
    const response = await usecase.execute(
      { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }], stream: true, routing: { strategy: 'priority' } },
      s.sink,
    );
    expect(response.choices[0]?.message.content).toBe('ok');

    const classification = classifyFailure(
      new ProviderResponseError('ep-openai', 429, 'FreeUsageLimitError'),
    );
    expect(classification.keyAction).toBe('cooldown');
    expect(classification.retryable).toBe(true);
  });

  it('P3: concrete-model dead-route recovers via nexus/auto when preferred provider is down', async () => {
    // Scenario (master prompt #10): a request names a concrete model `gpt-4`
    // that the model registry maps to `openai` (expressed as preferredProviders),
    // but openai is currently in a billing-blocked circuit_open state while
    // anthropic is healthy. A naive resolve would dead-end with
    // NoEligibleProviderError; the use case must fall back through nexus/auto
    // (which drops the model-specific preferredProviders) and recover.
    const openai = new FakeAdapter('openai', 'OpenAI');
    const anthropic = new FakeAdapter('anthropic', 'Anthropic');
    anthropic.nextResponse = {
      id: 'resp-3',
      object: 'chat.completion',
      created: 1,
      model: 'claude-3',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Recovered via auto!' }, finish_reason: 'stop' }],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      provider: 'anthropic',
      endpoint: 'ep-anthropic',
      latencyMs: 0,
    };

    const bus = new InMemoryEventBus();
    const engine = new RoutingEngine(bus);
    engine.registerEndpoint({ ...makeEndpoint('ep-openai', 'openai'), priority: 1 });
    engine.registerEndpoint({ ...makeEndpoint('ep-anthropic', 'anthropic'), priority: 2 });
    // Open openai's circuit (billing) so it is permanently excluded until a real success.
    await engine.recordFailure('ep-openai', new Error('billing dead'), true, 'mark_unavailable');

    const usecase = new ChatCompletionUseCase(
      engine,
      new DefaultFailover(),
      new Map([['openai', openai], ['anthropic', anthropic]]),
      bus,
      new DefaultCostCalculator(),
    );

    const response = await usecase.execute({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      routing: { preferredProviders: ['openai'], strategy: 'priority' },
    });

    // Recovered via nexus/auto to the healthy anthropic endpoint.
    expect(response.choices[0]?.message.content).toBe('Recovered via auto!');
    expect(response.endpoint).toBe('ep-anthropic');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ChatCompletionUseCase } from '../src/application/chat-completion.usecase.js';
import { InMemoryEventBus } from '../src/application/event-bus.js';
import { RoutingEngine } from '../src/application/routing-engine.js';
import { DefaultFailover } from '../src/application/failover.js';
import { DefaultCostCalculator } from '../src/application/cost-calculator.js';
import type { ProviderAdapter, ChunkSink } from '../src/application/ports.js';
import type { ChatCompletionChunk, ChatCompletionRequest, ProviderEndpoint } from '../src/domain/types.js';

describe('Hedged Speculative Fallback Streaming', () => {
  const primaryEndpoint: ProviderEndpoint = {
    id: 'primary-endpoint',
    providerId: 'primary-prov',
    displayName: 'Primary Provider',
    baseUrl: 'https://primary.ai/v1',
    capabilities: { streaming: true, toolCalling: true, vision: false, audio: false, speech: false, embeddings: false, reasoning: false, jsonMode: true, maxOutputTokens: 4096, maxInputTokens: 8192, supportedModalities: ['text'] },
    priority: 1,
    weight: 10,
    tags: ['cloud'],
    timeoutMs: 5000,
    maxRetries: 1,
    concurrencyLimit: 5,
    health: 'healthy',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const altEndpoint: ProviderEndpoint = {
    id: 'alt-endpoint',
    providerId: 'alt-prov',
    displayName: 'Alternative Provider',
    baseUrl: 'https://alt.ai/v1',
    capabilities: { streaming: true, toolCalling: true, vision: false, audio: false, speech: false, embeddings: false, reasoning: false, jsonMode: true, maxOutputTokens: 4096, maxInputTokens: 8192, supportedModalities: ['text'] },
    priority: 10,
    weight: 5,
    tags: ['cloud'],
    timeoutMs: 5000,
    maxRetries: 1,
    concurrencyLimit: 5,
    health: 'healthy',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('completes with primary when primary delivers chunk within hedged delay', async () => {
    const events = new InMemoryEventBus();
    const routing = new RoutingEngine(events);
    routing.registerEndpoint(primaryEndpoint);
    routing.registerEndpoint(altEndpoint);

    const primaryAdapter: ProviderAdapter = {
      name: 'primary-prov',
      chatCompletion: vi.fn(),
      async *streamChatCompletion() {
        yield { id: 'c1', object: 'chat.completion.chunk', created: Date.now(), model: 'gpt-4', choices: [{ index: 0, delta: { content: 'fast response' } }] } as ChatCompletionChunk;
      },
      models: vi.fn(),
      healthCheck: vi.fn(),
    };

    const altAdapter: ProviderAdapter = {
      name: 'alt-prov',
      chatCompletion: vi.fn(),
      async *streamChatCompletion() {
        yield { id: 'c2', object: 'chat.completion.chunk', created: Date.now(), model: 'gpt-4', choices: [{ index: 0, delta: { content: 'alt response' } }] } as ChatCompletionChunk;
      },
      models: vi.fn(),
      healthCheck: vi.fn(),
    };

    const adapters = new Map<string, ProviderAdapter>([
      ['primary-prov', primaryAdapter],
      ['alt-prov', altAdapter],
    ]);

    const useCase = new ChatCompletionUseCase(
      routing,
      new DefaultFailover(),
      adapters,
      events,
      new DefaultCostCalculator(),
    );

    const writtenChunks: ChatCompletionChunk[] = [];
    const sink: ChunkSink = {
      write: async (c) => { writtenChunks.push(c); },
      end: async () => {},
    };

    const req: ChatCompletionRequest = {
      model: 'gpt-4',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
      routing: {
        strategy: 'priority',
        speculativeFallback: true,
        hedgedDelayMs: 200,
      },
    };

    const res = await useCase.execute(req, sink);
    expect(res.choices[0].message.content).toBe('fast response');
    expect(writtenChunks.length).toBe(1);
    expect(writtenChunks[0].choices[0].delta.content).toBe('fast response');
  });

  it('triggers hedged alternative when primary stalls and alternative wins race', async () => {
    const events = new InMemoryEventBus();
    const raceEvents: unknown[] = [];
    events.subscribe('speculative.race.won', (e) => raceEvents.push(e));

    const routing = new RoutingEngine(events);
    routing.registerEndpoint(primaryEndpoint);
    routing.registerEndpoint(altEndpoint);

    const primaryAdapter: ProviderAdapter = {
      name: 'primary-prov',
      chatCompletion: vi.fn(),
      async *streamChatCompletion(_ep, _req, signal) {
        // Simulate stalled primary (300ms delay)
        await new Promise((r) => setTimeout(r, 300));
        if (signal?.aborted) return;
        yield { id: 'c1', object: 'chat.completion.chunk', created: Date.now(), model: 'gpt-4', choices: [{ index: 0, delta: { content: 'slow primary' } }] } as ChatCompletionChunk;
      },
      models: vi.fn(),
      healthCheck: vi.fn(),
    };

    const altAdapter: ProviderAdapter = {
      name: 'alt-prov',
      chatCompletion: vi.fn(),
      async *streamChatCompletion(_ep, _req, signal) {
        // Fast alternative (10ms)
        await new Promise((r) => setTimeout(r, 10));
        if (signal?.aborted) return;
        yield { id: 'c2', object: 'chat.completion.chunk', created: Date.now(), model: 'gpt-4', choices: [{ index: 0, delta: { content: 'fast alternative' } }] } as ChatCompletionChunk;
      },
      models: vi.fn(),
      healthCheck: vi.fn(),
    };

    const adapters = new Map<string, ProviderAdapter>([
      ['primary-prov', primaryAdapter],
      ['alt-prov', altAdapter],
    ]);

    const useCase = new ChatCompletionUseCase(
      routing,
      new DefaultFailover(),
      adapters,
      events,
      new DefaultCostCalculator(),
    );

    const writtenChunks: ChatCompletionChunk[] = [];
    const sink: ChunkSink = {
      write: async (c) => { writtenChunks.push(c); },
      end: async () => {},
    };

    const req: ChatCompletionRequest = {
      model: 'gpt-4',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
      routing: {
        strategy: 'priority',
        speculativeFallback: true,
        hedgedDelayMs: 50, // hedged alternative kicks in after 50ms
      },
    };

    const res = await useCase.execute(req, sink);
    expect(res.choices[0].message.content).toBe('fast alternative');
    expect(writtenChunks.length).toBe(1);
    expect(writtenChunks[0].choices[0].delta.content).toBe('fast alternative');
    expect(raceEvents.length).toBe(1);
  });
});

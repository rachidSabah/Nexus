import { describe, expect, it } from 'vitest';

import { ChatCompletionUseCase } from '../src/application/chat-completion.usecase.js';
import { DefaultCostCalculator } from '../src/application/cost-calculator.js';
import { InMemoryEventBus } from '../src/application/event-bus.js';
import { DefaultFailover } from '../src/application/failover.js';
import { RoutingEngine } from '../src/application/routing-engine.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  DomainEvent,
  ProviderAdapter,
  ProviderEndpoint,
  RequestCoalescedEvent,
} from '../src/index.js';

describe('ChatCompletionUseCase In-Flight Deduplication', () => {
  it('coalesces concurrent identical chat completion requests onto one provider call and publishes request.coalesced event', async () => {
    let callCount = 0;

    const mockAdapter: ProviderAdapter = {
      providerId: 'mock-provider',
      displayName: 'Mock Provider',
      chatCompletion: async (
        endpoint: ProviderEndpoint,
        req: ChatCompletionRequest,
      ): Promise<ChatCompletionResponse> => {
        callCount++;
        // simulate 40ms network latency
        await new Promise((r) => setTimeout(r, 40));
        return {
          id: 'upstream-id-123',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: req.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Deduplicated answer' },
              finish_reason: 'stop',
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          provider: 'mock-provider',
          endpoint: endpoint.id,
          latencyMs: 40,
        };
      },
      streamChatCompletion: async function* () {},
      healthCheck: async () => true,
    };

    const endpoint: ProviderEndpoint = {
      id: 'ep-mock',
      providerId: 'mock-provider',
      displayName: 'ep-mock',
      baseUrl: 'http://mock.local',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: false,
        audio: false,
        speech: false,
        embeddings: false,
        reasoning: false,
        jsonMode: true,
      },
      pricing: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
      priority: 1,
      weight: 1,
      health: 'healthy',
      timeoutMs: 30_000,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const events = new InMemoryEventBus();
    const routing = new RoutingEngine(events);
    routing.registerEndpoint(endpoint);
    const failover = new DefaultFailover();
    const adapters = new Map<string, ProviderAdapter>([['mock-provider', mockAdapter]]);
    const costs = new DefaultCostCalculator();


    const coalescedEvents: RequestCoalescedEvent[] = [];
    events.subscribe('request.coalesced', (e: DomainEvent) => {
      coalescedEvents.push(e as RequestCoalescedEvent);
    });

    const usecase = new ChatCompletionUseCase(
      routing,
      failover,
      adapters,
      events,
      costs,
      3,
      { enableDeduplication: true },
    );

    const req: ChatCompletionRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      temperature: 0.7,
    };

    // Dispatch 3 concurrent identical requests
    const [res1, res2, res3] = await Promise.all([
      usecase.execute(req),
      usecase.execute(req),
      usecase.execute(req),
    ]);

    // Provider was only called once!
    expect(callCount).toBe(1);

    // All callers got the expected answer
    expect(res1.choices[0]?.message.content).toBe('Deduplicated answer');
    expect(res2.choices[0]?.message.content).toBe('Deduplicated answer');
    expect(res3.choices[0]?.message.content).toBe('Deduplicated answer');

    // Waiters receive independent response IDs so upstream tracking is unique
    expect(res2.id).toBeDefined();
    expect(res3.id).toBeDefined();

    // At least 2 request.coalesced events were emitted!
    expect(coalescedEvents.length).toBeGreaterThanOrEqual(2);
    expect(coalescedEvents[0]?.payload.model).toBe('gpt-4o');
    expect(coalescedEvents[0]?.payload.waitersCount).toBeGreaterThan(1);

    // Coalescer stats show deduplication occurred
    const stats = usecase.getCoalescer()?.getStats();
    expect(stats?.totalExecutions).toBe(1);
    expect(stats?.totalCoalesced).toBe(2);
    expect(stats?.inFlightCount).toBe(0);
  });
});

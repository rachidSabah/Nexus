import { randomUUID } from 'node:crypto';

import {
  AllProvidersExhaustedError,
  NoEligibleProviderError,
  ProviderResponseError,
} from '../domain/errors.js';
import {
  buildEvent,
  type FailoverTriggeredEvent,
  type ProviderRequestFailedEvent,
  type ProviderRequestStartedEvent,
  type ProviderRequestSucceededEvent,
  type RequestReceivedEvent,
} from '../domain/events.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  CostBreakdown,
  ProviderEndpoint,
  TokenUsage,
} from '../domain/types.js';

import type {
  ChunkSink,
  CostCalculatorPort,
  EventBusPort,
  FailoverPort,
  ProviderAdapter,
  RoutingEnginePort,
} from './ports.js';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * ChatCompletionUseCase
 *
 * The flagship use case. Orchestrates:
 *   1. Route resolution
 *   2. Provider call (with failover)
 *   3. Event emission (for observability + dashboard)
 *   4. Cost & token accounting
 *
 * Both streaming and non-streaming paths share the same orchestration code;
 * only the inner "call provider" closure differs.
 * ───────────────────────────────────────────────────────────────────────────
 */
export class ChatCompletionUseCase {
  constructor(
    private readonly routing: RoutingEnginePort,
    private readonly failover: FailoverPort,
    private readonly adapters: Map<string, ProviderAdapter>,
    private readonly events: EventBusPort,
    private readonly costs: CostCalculatorPort,
    private readonly maxFailovers = 3,
  ) {}

  async execute(
    request: ChatCompletionRequest,
    sink?: ChunkSink,
    signal?: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const requestId = randomUUID();
    const correlationId = requestId;
    const startedAt = Date.now();

    await this.events.publish(
      buildEvent<RequestReceivedEvent>(
        'request.received',
        {
          requestId,
          model: request.model,
          streaming: Boolean(request.stream),
          userId: request.user,
          timestamp: startedAt,
        },
        correlationId,
      ),
    );

    const routingReq = {
      model: request.model,
      ...request.routing,
      capabilities: request.routing?.capabilities,
    };
    let decision = await this.routing.resolve(routingReq);
    let attempt = 0;
    const attempted: string[] = [];

    while (attempt <= this.maxFailovers) {
      const endpoint = decision.endpoint;
      attempted.push(endpoint.id);

      const adapter = this.adapters.get(endpoint.providerId);
      if (!adapter) {
        // Misconfiguration — record and failover.
        await this.routing.recordFailure(endpoint.id, new Error('No adapter registered'), false);
        const next = this.failover.next(decision, endpoint.id);
        if (!next) break;
        decision = { ...decision, endpoint: next };
        attempt++;
        continue;
      }

      await this.events.publish(
        buildEvent<ProviderRequestStartedEvent>(
          'provider.request.started',
          { requestId, endpointId: endpoint.id, providerId: endpoint.providerId, attempt },
          correlationId,
        ),
      );

      try {
        const effectiveSignal: AbortSignal = signal ?? new AbortController().signal;
        const response = request.stream
          ? await this.streamAndCollect(adapter, endpoint, request, sink, effectiveSignal)
          : await adapter.chatCompletion(endpoint, request, effectiveSignal);

        const latencyMs = Date.now() - startedAt;
        this.routing.recordSuccess(endpoint.id, latencyMs);

        const cost = this.costs.calculate(response.usage, {
          inputPer1K: endpoint.pricing?.inputPer1K ?? 0,
          outputPer1K: endpoint.pricing?.outputPer1K ?? 0,
          cachedInputPer1K: endpoint.pricing?.cachedInputPer1K,
        });

        await this.events.publish(
          buildEvent<ProviderRequestSucceededEvent>(
            'provider.request.succeeded',
            {
              requestId,
              endpointId: endpoint.id,
              providerId: endpoint.providerId,
              attempt,
              latencyMs,
              inputTokens: response.usage.promptTokens,
              outputTokens: response.usage.completionTokens,
              costUsd: cost.totalCostUsd,
            },
            correlationId,
          ),
        );

        return {
          ...response,
          provider: endpoint.providerId,
          endpoint: endpoint.id,
          latencyMs,
          costUsd: cost.totalCostUsd,
        };
      } catch (err) {
        const error = err as Error;
        const retryable = this.isRetryable(error);
        await this.routing.recordFailure(endpoint.id, error, retryable);

        await this.events.publish(
          buildEvent<ProviderRequestFailedEvent>(
            'provider.request.failed',
            {
              requestId,
              endpointId: endpoint.id,
              providerId: endpoint.providerId,
              attempt,
              error: error.message,
              code: (error as { code?: string }).code ?? 'UNKNOWN',
              retryable,
            },
            correlationId,
          ),
        );

        if (!retryable) throw error;

        const next = this.failover.next(decision, endpoint.id);
        if (!next) break;

        await this.events.publish(
          buildEvent<FailoverTriggeredEvent>(
            'failover.triggered',
            {
              requestId,
              fromEndpointId: endpoint.id,
              toEndpointId: next.id,
              reason: error.message,
            },
            correlationId,
          ),
        );

        decision = { ...decision, endpoint: next };
        attempt++;
      }
    }

    throw new AllProvidersExhaustedError(request.model, attempted);
  }

  /**
   * Drive the streaming response to the sink AND collect it so the
   * application layer can return a unified response shape.
   */
  private async streamAndCollect(
    adapter: ProviderAdapter,
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    sink: ChunkSink | undefined,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const chunks: ChatCompletionChunk[] = [];
    let contentBuffer = '';
    let lastUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason = 'stop';
    const id = randomUUID();

    try {
      for await (const chunk of adapter.streamChatCompletion(endpoint, request, signal)) {
        chunks.push(chunk);
        if (chunk.choices[0]?.delta?.content) {
          contentBuffer += chunk.choices[0].delta.content;
        }
        if (chunk.usage) lastUsage = chunk.usage;
        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
        if (sink) await sink.write(chunk);
      }
    } catch (err) {
      if (sink) await sink.error(err as Error);
      throw err;
    }

    if (sink) await sink.end();

    return {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: contentBuffer },
          finish_reason: finishReason,
        },
      ],
      usage: lastUsage,
      provider: endpoint.providerId,
      endpoint: endpoint.id,
      latencyMs: 0, // set by caller
    };
  }

  private isRetryable(error: Error): boolean {
    if (error instanceof ProviderResponseError) {
      // 5xx, 408, 429 are retryable per OpenAI guidance.
      return error.status >= 500 || error.status === 408 || error.status === 429;
    }
    const code = (error as { code?: string }).code;
    return (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'EAI_AGAIN' ||
      code === 'UND_ERR_CONNECT_TIMEOUT'
    );
  }
}

/**
 * Helper exported so callers can compute cost outside of a use case.
 */
export function computeCost(
  usage: TokenUsage,
  pricing: { inputPer1K: number; outputPer1K: number; cachedInputPer1K?: number },
): CostBreakdown {
  const inputCostUsd = (usage.promptTokens / 1000) * pricing.inputPer1K;
  const outputCostUsd = (usage.completionTokens / 1000) * pricing.outputPer1K;
  const cachedInputCostUsd = usage.cachedTokens
    ? (usage.cachedTokens / 1000) * (pricing.cachedInputPer1K ?? pricing.inputPer1K * 0.1)
    : 0;
  return {
    inputCostUsd,
    outputCostUsd,
    cachedInputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd + cachedInputCostUsd,
  };
}

export { NoEligibleProviderError };

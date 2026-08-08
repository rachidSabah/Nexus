import { randomUUID } from 'node:crypto';

import {
  AllProvidersExhaustedError,
  NoEligibleProviderError,
  ProviderResponseError,
} from '../domain/errors.js';
import {
  buildEvent,
  type CacheHitEvent,
  type CacheMissEvent,
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
  CachePort,
  ChunkSink,
  CostCalculatorPort,
  EventBusPort,
  FailoverPort,
  PluginRuntimePort,
  ProviderAdapter,
  RoutingEnginePort,
} from './ports.js';

export interface ChatCompletionUseCaseOptions {
  /** Optional cache. When provided, exact-match cache is consulted before routing. */
  cache?: CachePort;
  /** Optional plugin runtime. When provided, lifecycle hooks are invoked at every stage. */
  plugins?: PluginRuntimePort;
  /** Optional embedding function for semantic cache lookups. When provided alongside `cache`, similar requests can hit the cache even with different wording. */
  embed?: (text: string) => Promise<readonly number[]>;
  /** Cosine similarity threshold for semantic cache hits. Default: 0.92. */
  semanticThreshold?: number;
  /** TTL for cache entries written by this use case (ms). Default: 5 minutes. */
  cacheTtlMs?: number;
  /** When true, streaming requests skip the cache entirely (the cache is write-through for non-streaming only). Default: true. */
  skipCacheForStreaming?: boolean;
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * ChatCompletionUseCase
 *
 * The flagship use case. Orchestrates:
 *   1. Plugin `onRequest` hook (can mutate the request)
 *   2. Cache lookup (exact + semantic)
 *   3. Route resolution
 *   4. Plugin `onRouteResolved` hook
 *   5. Provider call (with failover)
 *   6. Plugin hooks at each lifecycle point (onProviderStart/Chunk/End)
 *   7. Plugin `onResponse` hook (can mutate the response)
 *   8. Event emission (for observability + dashboard)
 *   9. Cost & token accounting
 *   10. Cache store (on success)
 *
 * Both streaming and non-streaming paths share the same orchestration code;
 * only the inner "call provider" closure differs.
 * ───────────────────────────────────────────────────────────────────────────
 */
export class ChatCompletionUseCase {
  private readonly cache?: CachePort;
  private readonly plugins?: PluginRuntimePort;
  private readonly embed?: (text: string) => Promise<readonly number[]>;
  private readonly semanticThreshold: number;
  private readonly cacheTtlMs: number;
  private readonly skipCacheForStreaming: boolean;

  constructor(
    private readonly routing: RoutingEnginePort,
    private readonly failover: FailoverPort,
    private readonly adapters: Map<string, ProviderAdapter>,
    private readonly events: EventBusPort,
    private readonly costs: CostCalculatorPort,
    private readonly maxFailovers = 3,
    options: ChatCompletionUseCaseOptions = {},
  ) {
    this.cache = options.cache;
    this.plugins = options.plugins;
    this.embed = options.embed;
    this.semanticThreshold = options.semanticThreshold ?? 0.92;
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
    this.skipCacheForStreaming = options.skipCacheForStreaming ?? true;
  }

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

    // ─── Plugin hook: onRequest (can mutate the request) ──────────────────
    let effectiveRequest = request;
    if (this.plugins) {
      const results = await this.plugins.invokeHook<ChatCompletionRequest>('onRequest', request);
      // Last non-undefined result wins (transformer hooks pass value through).
      // Use a manual reverse scan instead of Array.findLast (not available in ES2022).
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i] !== undefined) {
          effectiveRequest = results[i]!;
          break;
        }
      }
    }

    // ─── Cache lookup (exact + semantic) ───────────────────────────────────
    // Streaming requests skip the cache entirely by default — partial
    // streamed responses can't be reliably replayed through the sink without
    // buffering the whole thing, which defeats the point of streaming.
    const cacheable = this.cache && !(request.stream && this.skipCacheForStreaming);
    if (cacheable) {
      const cacheKey = this.cacheKey(effectiveRequest);
      const cached = await this.cache!.get<ChatCompletionResponse>(cacheKey);
      if (cached) {
        await this.events.publish(
          buildEvent<CacheHitEvent>(
            'cache.hit',
            { requestId, cacheKey, cacheType: 'prompt' },
            correlationId,
          ),
        );
        if (this.plugins) {
          await this.plugins.invokeHook('onResponse', cached);
        }
        return cached;
      }

      // Semantic cache lookup — only if an embed function is configured.
      if (this.embed && this.cache!.semantic) {
        const embedding = await this.embed(this.requestToText(effectiveRequest));
        const semanticHit = await this.cache!.semantic(embedding, this.semanticThreshold);
        if (semanticHit) {
          await this.events.publish(
            buildEvent<CacheHitEvent>(
              'cache.hit',
              { requestId, cacheKey: semanticHit.key, cacheType: 'semantic' },
              correlationId,
            ),
          );
          if (this.plugins) {
            await this.plugins.invokeHook('onResponse', semanticHit.value);
          }
          return semanticHit.value as ChatCompletionResponse;
        }
      }

      await this.events.publish(
        buildEvent<CacheMissEvent>(
          'cache.miss',
          { requestId, cacheKey, cacheType: 'prompt' },
          correlationId,
        ),
      );
    }

    const routingReq = {
      model: effectiveRequest.model,
      ...effectiveRequest.routing,
      capabilities: effectiveRequest.routing?.capabilities,
    };
    let decision = await this.routing.resolve(routingReq);

    // ─── Plugin hook: onRouteResolved ──────────────────────────────────────
    if (this.plugins) {
      await this.plugins.invokeHook('onRouteResolved', {
        requestId,
        endpointId: decision.endpoint.id,
        providerId: decision.endpoint.providerId,
        alternativesCount: decision.alternatives.length,
      });
    }

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

      // ─── Plugin hook: onProviderStart ───────────────────────────────────
      if (this.plugins) {
        await this.plugins.invokeHook('onProviderStart', {
          requestId, endpointId: endpoint.id, providerId: endpoint.providerId, attempt,
        });
      }

      try {
        const effectiveSignal: AbortSignal = signal ?? new AbortController().signal;
        const response = effectiveRequest.stream
          ? await this.streamAndCollect(adapter, endpoint, effectiveRequest, sink, effectiveSignal)
          : await adapter.chatCompletion(endpoint, effectiveRequest, effectiveSignal);

        // ─── Plugin hook: onProviderEnd ───────────────────────────────────
        if (this.plugins) {
          await this.plugins.invokeHook('onProviderEnd', {
            requestId, endpointId: endpoint.id, providerId: endpoint.providerId, attempt,
          });
        }

        const latencyMs = Date.now() - startedAt;
        this.routing.recordSuccess(endpoint.id, latencyMs);

        const cost = this.costs.calculate(response.usage, {
          inputPer1K: endpoint.pricing?.inputPer1K ?? 0,
          outputPer1K: endpoint.pricing?.outputPer1K ?? 0,
          cachedInputPer1K: endpoint.pricing?.cachedInputPer1K,
        });

        const finalResponse: ChatCompletionResponse = {
          ...response,
          provider: endpoint.providerId,
          endpoint: endpoint.id,
          latencyMs,
          costUsd: cost.totalCostUsd,
        };

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

        // ─── Plugin hook: onResponse (can mutate the response) ──────────
        let finalResult = finalResponse;
        if (this.plugins) {
          const results = await this.plugins.invokeHook<ChatCompletionResponse>('onResponse', finalResponse);
          for (let i = results.length - 1; i >= 0; i--) {
            if (results[i] !== undefined) {
              finalResult = results[i]!;
              break;
            }
          }
        }

        // ─── Cache store (on success) ────────────────────────────────────
        if (cacheable) {
          const cacheKey = this.cacheKey(effectiveRequest);
          await this.cache!.set(cacheKey, finalResult, this.cacheTtlMs);
          // Semantic cache store (if embed fn is configured).
          if (this.embed && this.cache!.semanticStore) {
            const embedding = await this.embed(this.requestToText(effectiveRequest));
            await this.cache!.semanticStore!(embedding, cacheKey, finalResult, this.cacheTtlMs);
          }
        }

        return finalResult;
      } catch (err) {
        const error = err as Error;
        const retryable = this.isRetryable(error);
        await this.routing.recordFailure(endpoint.id, error, retryable);

        // ─── Plugin hook: onError ────────────────────────────────────────
        if (this.plugins) {
          await this.plugins.invokeHook('onError', {
            requestId, endpointId: endpoint.id, providerId: endpoint.providerId, error,
          });
        }

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
      for await (let chunk of adapter.streamChatCompletion(endpoint, request, signal)) {
        // ─── Plugin hook: onProviderChunk (can mutate the chunk) ────────
        if (this.plugins) {
          const results = await this.plugins.invokeHook<ChatCompletionChunk>('onProviderChunk', chunk);
          for (let i = results.length - 1; i >= 0; i--) {
            if (results[i] !== undefined) {
              chunk = results[i]!;
              break;
            }
          }
        }
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

  /**
   * Builds a deterministic cache key from a chat completion request.
   * Includes model + messages + temperature + tools (so different tools
   * produce different cache keys) but excludes streaming flag, user id,
   * and request.routing (which don't affect the response content).
   */
  private cacheKey(request: ChatCompletionRequest): string {
    const normalized = {
      model: request.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: request.temperature,
      topP: request.topP,
      maxTokens: request.maxTokens,
      maxOutputTokens: request.maxOutputTokens,
      tools: request.tools,
      toolChoice: request.toolChoice,
      responseFormat: request.responseFormat,
      seed: request.seed,
    };
    return 'chat:' + JSON.stringify(normalized);
  }

  /**
   * Flattens a chat completion request into a single text string suitable
   * for embedding. Used by the semantic cache.
   */
  private requestToText(request: ChatCompletionRequest): string {
    const parts: string[] = [request.model];
    for (const m of request.messages) {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      parts.push(`${m.role}: ${content}`);
    }
    return parts.join('\n');
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

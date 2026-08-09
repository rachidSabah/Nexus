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

import type { KeyRegistry, KeyRotationStrategy } from './key-registry.js';
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
import type { PrivacyConfig } from './privacy.js';
import { DEFAULT_PRIVACY } from './privacy.js';
import type { RequestTracer } from './request-tracer.js';

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
  /** Optional multi-key registry. When provided, the use case selects the best API key for the resolved provider on each attempt. */
  keyRegistry?: KeyRegistry;
  /** Strategy for key rotation. Default: 'adaptive'. */
  keyRotationStrategy?: KeyRotationStrategy;
  /** Privacy configuration. Default: redacted mode (no prompt/response content in logs). */
  privacy?: PrivacyConfig;
  /** Optional request tracer. When provided, full request traces are recorded for inspection via /v1/traces/:id. */
  tracer?: RequestTracer;
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
  private readonly keyRegistry?: KeyRegistry;
  private readonly keyRotationStrategy: KeyRotationStrategy;
  private readonly privacy: PrivacyConfig;
  private readonly tracer?: RequestTracer;

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
    this.keyRegistry = options.keyRegistry;
    this.keyRotationStrategy = options.keyRotationStrategy ?? 'adaptive';
    this.privacy = options.privacy ?? DEFAULT_PRIVACY;
    this.tracer = options.tracer;
  }

  async execute(
    request: ChatCompletionRequest,
    sink?: ChunkSink,
    signal?: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const requestId = randomUUID();
    const correlationId = requestId;
    const startedAt = Date.now();

    // Start a request trace (#30).
    if (this.tracer) {
      this.tracer.start(requestId, request.model);
    }

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
    // Privacy mode can also disable cache persistence (#31).
    const cacheable = this.cache
      && !(request.stream && this.skipCacheForStreaming)
      && !this.privacy.skipCachePersistence;
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
        if (this.tracer) {
          this.tracer.recordCacheHit(requestId, false);
          this.tracer.recordSuccess(requestId, {
            input: cached.usage.promptTokens,
            output: cached.usage.completionTokens,
            total: cached.usage.totalTokens,
          }, cached.costUsd ?? 0);
        }
        return cached;
      }

      // Semantic cache lookup — only if an embed function is configured.
      // Wrapped in try-catch so that if the embeddings endpoint is unavailable,
      // we gracefully skip the semantic cache (fall through to cache miss)
      // rather than failing the entire request.
      if (this.embed && this.cache!.semantic) {
        try {
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
            if (this.tracer) {
              this.tracer.recordCacheHit(requestId, true);
              this.tracer.recordSuccess(requestId, { input: 0, output: 0, total: 0 }, 0);
            }
            return semanticHit.value as ChatCompletionResponse;
          }
        } catch {
          // Embeddings endpoint unavailable — skip semantic cache, fall
          // through to cache miss. This is expected when no embeddings-
          // capable provider is configured or the gateway is still starting.
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

    // Trace: record routing decision.
    if (this.tracer) {
      this.tracer.recordRoutingDecision(
        requestId,
        decision.endpoint.id,
        decision.endpoint.providerId,
        decision.alternatives.length,
        (request.routing?.strategy as string) ?? 'default',
      );
    }

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

      // Hoisted out of `try` so the catch block can record key failures.
      let selectedKeyId: string | undefined;
      try {
        const effectiveSignal: AbortSignal = signal ?? new AbortController().signal;

        // ─── Multi-key selection ──────────────────────────────────────────
        // If a KeyRegistry is configured, pick the best API key for this
        // provider and inject it into the endpoint. The adapter's getApiKey()
        // reads from endpoint.apiKey (cast) — so we just override it here.
        // If no key is available (all on cooldown / invalid), we still try
        // with the endpoint's original key (env-var fallback in the adapter).
        let endpointWithKey: ProviderEndpoint = endpoint;
        if (this.keyRegistry) {
          selectedKeyId = this.keyRegistry.select(endpoint.providerId, {
            strategy: this.keyRotationStrategy,
          });
          if (selectedKeyId) {
            const plaintext = await this.keyRegistry.getPlaintext(selectedKeyId);
            if (plaintext) {
              endpointWithKey = { ...endpoint, apiKey: plaintext } as ProviderEndpoint & { apiKey: string };
            }
          }
        }

        const response = effectiveRequest.stream
          ? await this.streamAndCollect(adapter, endpointWithKey, effectiveRequest, sink, effectiveSignal)
          : await adapter.chatCompletion(endpointWithKey, effectiveRequest, effectiveSignal);

        // ─── Plugin hook: onProviderEnd ───────────────────────────────────
        if (this.plugins) {
          await this.plugins.invokeHook('onProviderEnd', {
            requestId, endpointId: endpoint.id, providerId: endpoint.providerId, attempt,
          });
        }

        const latencyMs = Date.now() - startedAt;
        this.routing.recordSuccess(endpoint.id, latencyMs);

        // Record key success for rotation health.
        if (this.keyRegistry && selectedKeyId) {
          const tokens = response.usage.totalTokens ?? (response.usage.promptTokens + response.usage.completionTokens);
          this.keyRegistry.recordSuccess(selectedKeyId, latencyMs, tokens);
        }

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

        // Trace: record success.
        if (this.tracer) {
          this.tracer.recordAttempt(requestId, {
            attempt,
            endpointId: endpoint.id,
            providerId: endpoint.providerId,
            keyId: selectedKeyId,
            status: 200,
            latencyMs,
          });
          this.tracer.recordSuccess(requestId, {
            input: response.usage.promptTokens,
            output: response.usage.completionTokens,
            total: response.usage.totalTokens,
          }, cost.totalCostUsd);
        }

        return finalResult;
      } catch (err) {
        const error = err as Error;
        const classification = classifyFailure(error);
        const retryable = classification.retryable;
        await this.routing.recordFailure(endpoint.id, error, retryable);

        // Trace: record failed attempt.
        if (this.tracer) {
          this.tracer.recordAttempt(requestId, {
            attempt,
            endpointId: endpoint.id,
            providerId: endpoint.providerId,
            keyId: selectedKeyId,
            status: classification.status,
            latencyMs: Date.now() - startedAt,
            error: error.message,
            failureReason: classification.reason,
          });
        }

        // Apply key-action classification (master prompt #14).
        // 429 → cooldown (handled by KeyRegistry.recordFailure with status=429)
        // 401/403 → invalidate (handled by KeyRegistry.recordFailure with status=401)
        // Other → no key action
        if (this.keyRegistry && selectedKeyId) {
          this.keyRegistry.recordFailure(selectedKeyId, classification.status || classification.code || 'error', retryable);
        }

        // ─── Plugin hook: onError ────────────────────────────────────────
        if (this.plugins) {
          await this.plugins.invokeHook('onError', {
            requestId, endpointId: endpoint.id, providerId: endpoint.providerId, error,
            classification,
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

    // Trace: record overall failure (all attempts exhausted).
    if (this.tracer) {
      this.tracer.recordFailure(requestId, `All providers exhausted for model '${request.model}'`);
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
}

/**
 * Granular failure classifier. Master prompt #14: "Not every error should
 * trigger the same retry strategy."
 *
 * Returns a structured classification that the chat use case + key registry
 * use to decide:
 *   - Should we retry on the SAME endpoint with a DIFFERENT key? (429)
 *   - Should we failover to a DIFFERENT endpoint entirely? (5xx, network)
 *   - Should we invalidate the key and not retry? (401, 403)
 *   - Should we mark the model unavailable and not retry? (404 model)
 *   - Should we treat this as transient provider degradation? (503)
 *   - Should we NOT retry because context was exceeded? (413)
 *
 * The classification drives:
 *   - `retryable` — whether ChatCompletionUseCase should failover to the
 *     next endpoint/alternative.
 *   - `keyAction` — what the KeyRegistry should do with the key that hit
 *     this error.
 *   - `endpointAction` — what the routing engine should do with the endpoint.
 */
export interface FailureClassification {
  /** HTTP status code (0 for network errors). */
  readonly status: number;
  /** Error code string (e.g. 'ECONNRESET', 'ETIMEDOUT'). */
  readonly code?: string;
  /** Whether ChatCompletionUseCase should failover to the next endpoint. */
  readonly retryable: boolean;
  /** What to do with the key that hit this error. */
  readonly keyAction: 'cooldown' | 'invalidate' | 'none';
  /** What to do with the endpoint that hit this error. */
  readonly endpointAction: 'record_failure' | 'mark_degraded' | 'mark_unavailable' | 'none';
  /** Human-readable reason for the classification (for the request trace). */
  readonly reason: string;
}

export function classifyFailure(error: Error): FailureClassification {
  // ProviderResponseError carries an HTTP status.
  if (error instanceof ProviderResponseError) {
    const status = error.status;
    // 401 Unauthorized / 403 Forbidden — key is bad. Invalidate (don't
    // retry on the same key). The endpoint itself is probably fine.
    if (status === 401 || status === 403) {
      return {
        status, code: undefined,
        retryable: false,
        keyAction: 'invalidate',
        endpointAction: 'none',
        reason: `HTTP ${status}: authentication/authorization failed — key invalidated`,
      };
    }
    // 404 Not Found — model doesn't exist on this provider. Mark the
    // endpoint as unavailable for this model (don't retry on it).
    if (status === 404) {
      return {
        status, code: undefined,
        retryable: false,
        keyAction: 'none',
        endpointAction: 'mark_unavailable',
        reason: `HTTP 404: model not found on this provider — endpoint marked unavailable`,
      };
    }
    // 408 Request Timeout — retryable, key is fine.
    if (status === 408) {
      return {
        status, code: undefined,
        retryable: true,
        keyAction: 'none',
        endpointAction: 'record_failure',
        reason: `HTTP 408: request timeout — will retry on next endpoint`,
      };
    }
    // 429 Too Many Requests — cooldown the key, retryable.
    if (status === 429) {
      return {
        status, code: undefined,
        retryable: true,
        keyAction: 'cooldown',
        endpointAction: 'record_failure',
        reason: `HTTP 429: rate limited — key on cooldown, failing over`,
      };
    }
    // 413 Request Entity Too Large — context window exceeded. Not retryable
    // (failing over won't help unless a different endpoint has a larger
    // context window, which the routing engine's capability_match would
    // have already accounted for).
    if (status === 413) {
      return {
        status, code: undefined,
        retryable: false,
        keyAction: 'none',
        endpointAction: 'none',
        reason: `HTTP 413: context window exceeded — not retryable`,
      };
    }
    // 4xx (other) — client error, not retryable, key is fine.
    if (status >= 400 && status < 500) {
      return {
        status, code: undefined,
        retryable: false,
        keyAction: 'none',
        endpointAction: 'none',
        reason: `HTTP ${status}: client error — not retryable`,
      };
    }
    // 5xx — server error, retryable, mark endpoint as degraded.
    if (status >= 500) {
      return {
        status, code: undefined,
        retryable: true,
        keyAction: 'none',
        endpointAction: 'mark_degraded',
        reason: `HTTP ${status}: server error — failing over to next endpoint`,
      };
    }
    // Fallback for any other status — treat as retryable to be safe.
    return {
      status, code: undefined,
      retryable: true,
      keyAction: 'none',
      endpointAction: 'record_failure',
      reason: `HTTP ${status}: treating as retryable (unknown status)`,
    };
  }

  // Network errors — retryable, mark endpoint as degraded.
  const code = (error as { code?: string }).code;
  const networkCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'];
  if (code && networkCodes.includes(code)) {
    return {
      status: 0, code,
      retryable: true,
      keyAction: 'none',
      endpointAction: 'mark_degraded',
      reason: `Network error ${code} — failing over to next endpoint`,
    };
  }

  // Unknown error — not retryable by default (could be a programming error).
  return {
    status: 0, code: code ?? 'UNKNOWN',
    retryable: false,
    keyAction: 'none',
    endpointAction: 'none',
    reason: `Unknown error: ${error.message}`,
  };
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

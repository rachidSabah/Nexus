import { randomUUID } from 'node:crypto';

import {
  AllProvidersExhaustedError,
  BudgetExceededError,
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
  type SpeculativeRaceWonEvent,
} from '../domain/events.js';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  CostBreakdown,
  ProviderEndpoint,
  RoutingDecision,
  TokenUsage,
} from '../domain/types.js';

import type { BudgetManager, BudgetMode } from './budget-manager.js';
import { repairJson, repairToolCallArguments } from './json-repair.js';
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
  /** Optional budget manager. When provided, budget mode (normal | cost_aware | free_only | blocked)
   *  shapes routing preference and spend is recorded on success. Disabled budgets are a no-op. */
  budgetManager?: BudgetManager;
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
  private readonly budgetManager?: BudgetManager;

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
    this.budgetManager = options.budgetManager;
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

    // ─── Budget-aware routing preference ──────────────────────────────────
    // When a BudgetManager is configured AND enabled, its current mode shapes
    // routing without ever blocking a request unless the budget is truly
    // exhausted (blocked). This is what makes "use free/cheap models non-stop"
    // the default behaviour once a budget is set — the gateway prefers the
    // cheapest/free endpoints automatically. Disabled budgets are a no-op.
    let budgetMode: BudgetMode = 'normal';
    if (this.budgetManager) {
      budgetMode = this.budgetManager.getMode();
      if (budgetMode === 'blocked') {
        await this.events.publish(
          buildEvent('request.blocked', { requestId, model: effectiveRequest.model, reason: 'budget_exceeded' }, correlationId),
        );
        const snap = this.budgetManager.getSnapshot();
        throw new BudgetExceededError(snap.remainingUsd, snap.config.limitUsd);
      }
      if (budgetMode === 'free_only' || budgetMode === 'cost_aware') {
        // free_only → only free-serving providers are eligible. The gateway
        // populates routing.freeProviderIds from the model registry; we just
        // switch the strategy and let freeProviderIds (if present on the
        // incoming request) do the filtering.
        routingReq.strategy = budgetMode === 'free_only' ? 'free_only' : 'budget_aware';
        // free_only → no budget remaining, so the engine prefers the cheapest
        // (free) endpoints; cost_aware → pass the real remaining budget.
        routingReq.budgetRemainingUsd =
          budgetMode === 'free_only' ? 0 : this.budgetManager.getSnapshot().remainingUsd;
      }
    }
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

    // TEST 10 guard: once any chunk has been written to the client's sink,
    // a later stream failure must NOT failover/replay — replay would emit
    // duplicated or contradictory output (and duplicate tool calls). The
    // request fails cleanly (SSE error/termination) instead.
    let streamBytesEmitted = false;
    const guardedSink: ChunkSink | undefined = sink
      ? {
          write: async (chunk: ChatCompletionChunk) => {
            if (chunk.choices[0]?.delta?.content || chunk.choices[0]?.delta?.reasoning) {
              streamBytesEmitted = true;
            }
            await sink.write(chunk);
          },
          error: sink.error,
          end: sink.end,
        }
      : undefined;

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

        const useSpeculativeHedge =
          effectiveRequest.stream &&
          attempt === 0 &&
          decision.alternatives.length > 0 &&
          (effectiveRequest.routing?.speculativeFallback || effectiveRequest.routing?.hedgedDelayMs);

        const response = useSpeculativeHedge
          ? await this.streamAndCollectHedged(
              decision,
              adapter,
              endpointWithKey,
              effectiveRequest,
              guardedSink,
              effectiveSignal,
              requestId,
              correlationId,
            )
          : effectiveRequest.stream
            ? await this.streamAndCollect(adapter, endpointWithKey, effectiveRequest, guardedSink, effectiveSignal)
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
          // Token accounting must always be a finite number: upstream usage can be
          // snake_case or omit fields, and NaN would serialize as JSON null and
          // poison the KeyRegistry (crashing the dashboard Keys page render).
          const usageRaw = (response.usage ?? {}) as unknown as {
            totalTokens?: unknown; total_tokens?: unknown;
            promptTokens?: unknown; prompt_tokens?: unknown;
            completionTokens?: unknown; completion_tokens?: unknown;
          };
          const finiteNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
          const tokens = finiteNum(usageRaw.totalTokens ?? usageRaw.total_tokens)
            || finiteNum(usageRaw.promptTokens ?? usageRaw.prompt_tokens)
            + finiteNum(usageRaw.completionTokens ?? usageRaw.completion_tokens);
          this.keyRegistry.recordSuccess(selectedKeyId, latencyMs, tokens);
        }

        const cost = this.costs.calculate(response.usage, {
          inputPer1K: endpoint.pricing?.inputPer1K ?? 0,
          outputPer1K: endpoint.pricing?.outputPer1K ?? 0,
          cachedInputPer1K: endpoint.pricing?.cachedInputPer1K,
        });

        // Record spend against the budget (no-op when budget disabled/unset).
        if (this.budgetManager) {
          this.budgetManager.recordSpend(cost.totalCostUsd);
        }

        // Self-Healing JSON & Tool Call Schema Repair:
        const isJsonMode = effectiveRequest.responseFormat?.type === 'json_object'
          || (effectiveRequest as { response_format?: { type?: string } }).response_format?.type === 'json_object';

        const repairedChoices = (response.choices ?? []).map((choice) => {
          let content = choice.message?.content;
          if (isJsonMode && typeof content === 'string') {
            const repaired = repairJson(content);
            if (repaired.isValidJson) {
              content = repaired.repaired;
            }
          }

          const toolCalls = choice.message?.tool_calls?.map((tc) => {
            if (tc.function?.arguments && typeof tc.function.arguments === 'string') {
              return {
                ...tc,
                function: {
                  ...tc.function,
                  arguments: repairToolCallArguments(tc.function.arguments),
                },
              };
            }
            return tc;
          });

          return {
            ...choice,
            message: {
              ...choice.message,
              content,
              ...(toolCalls ? { tool_calls: toolCalls } : {}),
            },
          };
        });

        const finalResponse: ChatCompletionResponse = {
          ...response,
          choices: repairedChoices,
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
          // Wrapped in try-catch: if the embeddings endpoint is unavailable,
          // skip the semantic store rather than failing a successful request.
          if (this.embed && this.cache!.semanticStore) {
            try {
              const embedding = await this.embed(this.requestToText(effectiveRequest));
              await this.cache!.semanticStore!(embedding, cacheKey, finalResult, this.cacheTtlMs);
            } catch {
              // Embeddings unavailable - exact-match cache still applies.
            }
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
        await this.routing.recordFailure(endpoint.id, error, retryable, classification.endpointAction);

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

        if (!retryable || streamBytesEmitted) throw error;

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
    let reasoningBuffer = '';
    let lastUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason = 'stop';
    const id = randomUUID();

    // Sink notification on error happens in the use case's retry decision (and the
    // HTTP handler's catch) — NOT here: a pre-byte failure that will be failed over
    // must not emit a terminal error event prematurely, and a post-byte failure must
    // not double-notify the client.
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
      if (chunk.choices[0]?.delta?.reasoning) {
        reasoningBuffer += chunk.choices[0].delta.reasoning;
      }
      if (chunk.usage) lastUsage = chunk.usage;
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
      if (sink) await sink.write(chunk);
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
          message: {
            role: 'assistant',
            content: contentBuffer,
            ...(reasoningBuffer ? { reasoningContent: reasoningBuffer } : {}),
          },
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
   * Hedged speculative streaming: launches request to primary, and if no token
   * is emitted within hedgedDelayMs (default: 800ms), speculatively starts a
   * concurrent stream to the first alternative endpoint. Whichever yields the
   * first token wins the race; the slower/stalled connection is aborted immediately.
   */
  private async streamAndCollectHedged(
    decision: RoutingDecision,
    primaryAdapter: ProviderAdapter,
    primaryEndpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    sink: ChunkSink | undefined,
    signal: AbortSignal,
    requestId: string,
    correlationId?: string,
  ): Promise<ChatCompletionResponse> {
    const hedgedDelayMs = request.routing?.hedgedDelayMs ?? 800;
    const altEndpoint = decision.alternatives[0];
    const altAdapter = altEndpoint ? this.adapters.get(altEndpoint.providerId) : undefined;

    if (!altEndpoint || !altAdapter) {
      return this.streamAndCollect(primaryAdapter, primaryEndpoint, request, sink, signal);
    }

    let altEndpointWithKey: ProviderEndpoint = altEndpoint;
    if (this.keyRegistry) {
      const altKeyId = this.keyRegistry.select(altEndpoint.providerId, {
        strategy: this.keyRotationStrategy,
      });
      if (altKeyId) {
        const altPlaintext = await this.keyRegistry.getPlaintext(altKeyId);
        if (altPlaintext) {
          altEndpointWithKey = { ...altEndpoint, apiKey: altPlaintext } as ProviderEndpoint & { apiKey: string };
        }
      }
    }

    const primaryCtrl = new AbortController();
    const altCtrl = new AbortController();

    const onParentAbort = () => {
      primaryCtrl.abort();
      altCtrl.abort();
    };
    signal.addEventListener('abort', onParentAbort);

    try {
      const primaryIter = primaryAdapter.streamChatCompletion(primaryEndpoint, request, primaryCtrl.signal)[Symbol.asyncIterator]();
      const primaryFirstPromise = primaryIter.next();

      let hedgedTimer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) => {
        hedgedTimer = setTimeout(() => resolve({ isTimeout: true }), hedgedDelayMs);
      });

      const firstRace = await Promise.race([
        primaryFirstPromise.then((res) => ({ isTimeout: false as const, res })),
        timeoutPromise,
      ]);

      if (!firstRace.isTimeout) {
        if (hedgedTimer) clearTimeout(hedgedTimer);
        // Primary yielded first token within delay window! Complete stream normally with primary.
        return await this.consumeStream(primaryIter, firstRace.res, primaryEndpoint, request, sink);
      }

      // Timer elapsed before primary emitted a token! Launch speculative hedged stream to alternative
      const altIter = altAdapter.streamChatCompletion(altEndpointWithKey, request, altCtrl.signal)[Symbol.asyncIterator]();
      const altFirstPromise = altIter.next();

      const secondRace = await Promise.race([
        primaryFirstPromise.then((res) => ({ winner: 'primary' as const, res })),
        altFirstPromise.then((res) => ({ winner: 'alt' as const, res })),
      ]);

      if (hedgedTimer) clearTimeout(hedgedTimer);

      if (secondRace.winner === 'primary') {
        altCtrl.abort();
        return await this.consumeStream(primaryIter, secondRace.res, primaryEndpoint, request, sink);
      } else {
        primaryCtrl.abort();
        await this.events.publish(
          buildEvent<SpeculativeRaceWonEvent>(
            'speculative.race.won',
            {
              requestId,
              winnerEndpointId: altEndpoint.id,
              loserEndpointId: primaryEndpoint.id,
              winnerProviderId: altEndpoint.providerId,
              loserProviderId: primaryEndpoint.providerId,
              hedgedDelayMs,
              timeSavedMs: hedgedDelayMs,
            },
            correlationId,
          ),
        );
        return await this.consumeStream(altIter, secondRace.res, altEndpoint, request, sink);
      }
    } finally {
      signal.removeEventListener('abort', onParentAbort);
    }
  }

  private async consumeStream(
    iter: AsyncIterator<ChatCompletionChunk>,
    firstRes: IteratorResult<ChatCompletionChunk>,
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    sink: ChunkSink | undefined,
  ): Promise<ChatCompletionResponse> {
    const chunks: ChatCompletionChunk[] = [];
    let contentBuffer = '';
    let reasoningBuffer = '';
    let lastUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason = 'stop';
    const id = randomUUID();

    const processChunk = async (chunk: ChatCompletionChunk) => {
      let c = chunk;
      if (this.plugins) {
        const results = await this.plugins.invokeHook<ChatCompletionChunk>('onProviderChunk', c);
        for (let i = results.length - 1; i >= 0; i--) {
          if (results[i] !== undefined) {
            c = results[i]!;
            break;
          }
        }
      }
      chunks.push(c);
      if (c.choices[0]?.delta?.content) contentBuffer += c.choices[0].delta.content;
      if (c.choices[0]?.delta?.reasoning) reasoningBuffer += c.choices[0].delta.reasoning;
      if (c.usage) lastUsage = c.usage;
      if (c.choices[0]?.finish_reason) finishReason = c.choices[0].finish_reason;
      if (sink) await sink.write(c);
    };

    if (!firstRes.done && firstRes.value) {
      await processChunk(firstRes.value);
    }

    let next = await iter.next();
    while (!next.done) {
      await processChunk(next.value);
      next = await iter.next();
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
          message: {
            role: 'assistant',
            content: contentBuffer,
            ...(reasoningBuffer ? { reasoningContent: reasoningBuffer } : {}),
          },
          finish_reason: finishReason,
        },
      ],
      usage: lastUsage,
      provider: endpoint.providerId,
      endpoint: endpoint.id,
      latencyMs: 0,
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
    // Billing / quota errors (402 Payment Required, or a 401 whose body
    // reports a billing problem such as "CreditsError" / "No payment method")
    // are NOT an auth failure — the key is valid, the account simply has no
    // remaining credit. These MUST fail over to the next endpoint (and the
    // broke endpoint should be circuit-broken so we don't keep retrying it).
    const billing =
      status === 402 ||
      ((status === 401 || status === 403) &&
        /credits? ?error|no payment method|insufficient (credit|funds)|quota exceeded|billing/i.test(
          error.message ?? '',
        ));
    if (billing) {
      return {
        status,
        code: undefined,
        retryable: true,
        keyAction: 'none',
        endpointAction: 'mark_unavailable',
        reason: `HTTP ${status}: billing/quota exhausted — failing over, endpoint marked unavailable`,
      };
    }
    // 401 Unauthorized / 403 Forbidden (without a billing signal) — key is
    // bad. Invalidate (don't retry on the same key). The endpoint itself is
    // probably fine.
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
        reason: `HTTP ${status}: model not found on this provider — endpoint marked unavailable`,
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

  if (error.message.includes('Missing API key') || error.message.includes('requires more credits')) {
    return {
      status: 401, code: 'AUTH_ERROR',
      retryable: true,
      keyAction: 'invalidate',
      endpointAction: 'record_failure',
      reason: `Auth/Quota error: ${error.message} — failing over to next endpoint`,
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

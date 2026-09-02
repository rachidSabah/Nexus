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
  type CompressionCompletedEvent,
  type CompressionFallbackEvent,
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
  ModelDescriptor,
  ProviderEndpoint,
  RoutingDecision,
  TokenUsage,
} from '../domain/types.js';

import type { BudgetManager, BudgetMode } from './budget-manager.js';
import type { ErrorDiagnosticRegistry } from './error-diagnostic-registry.js';
import { clampAndSanitizeContext } from './context-sanitizer.js';
import { repairJson } from './json-repair.js';
import { healToolCallArguments } from './tool-auto-healer.js';
import { filterSpecialTokens, filterStreamChunk, newStreamClampingState } from './special-tokens.js';
import type { KeyRegistry, KeyRotationStrategy } from './key-registry.js';
import type { ModelRegistry } from './model-registry.js';
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
import type { PromptCompressor } from './prompt-compressor.js';
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
  /**
   * Optional proactive rate-limit tracker. When provided, response headers
   * (`X-RateLimit-*`, `Retry-After`) are fed into it after every provider
   * call so key selection can prefer keys with remaining quota. The tracker
   * is otherwise dormant (it was previously constructed but never fed).
   */
  rateLimitTracker?: import('./rate-limit-tracker.js').ProactiveRateLimitTracker;
  /** Optional budget manager. When provided, budget mode (normal | cost_aware | free_only | blocked)
   *  shapes routing preference and spend is recorded on success. Disabled budgets are a no-op. */
  budgetManager?: BudgetManager;
  /** Optional live prompt compressor (runtime-selected profile). When provided, the
   *  request is compressed exactly once on the live path, fail-open, before routing. */
  promptCompressor?: PromptCompressor;
  /** Optional live error diagnostic registry for recording verified failures and recoveries. */
  errorRegistry?: ErrorDiagnosticRegistry;
  /** Optional live model registry for provider-model compatibility verification. */
  modelRegistry?: ModelRegistry;
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * ChatCompletionUseCase
 *
 * The flagship use case. Orchestrates:
 *   1. Token counting & budget check
 *   2. Plugin hook: onRequest
 *   3. Semantic cache lookup (exact-match, then cosine similarity)
 *   4. Routing resolution (least-latency, weighted, priority, or free-only)
 *   5. Multi-key selection (health, cooldown, least-used)
 *   6. Provider invocation via adapter
 *   7. Dynamic cost calculation based on actual token usage
 *   8. Automatic failover on retryable errors (with Retry-After compliance)
 *   9. Event publication (request started, succeeded, failed, cache hit/miss)
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
  private readonly rateLimitTracker?: import('./rate-limit-tracker.js').ProactiveRateLimitTracker;
  private readonly promptCompressor?: PromptCompressor;
  private readonly errorRegistry?: ErrorDiagnosticRegistry;
  private readonly modelRegistry?: ModelRegistry;

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
    this.rateLimitTracker = options.rateLimitTracker;
    this.promptCompressor = options.promptCompressor;
    this.errorRegistry = options.errorRegistry;
    this.modelRegistry = options.modelRegistry;
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

    // ─── Live request compression (single pass, fail-open) ─────────────────
    // This is the ONLY live compression point. The gateway demo route calls
    // the same PromptCompressor instance, so there is exactly one
    // implementation and no risk of double compression. The profile is
    // runtime-selectable (default 'none' = no behavior change). If the
    // compressor throws, we fall back to the original request and emit a
    // compression.fallback event — compression is an optimization, never a
    // dependency, so the agent request is never corrupted or blocked.
    if (this.promptCompressor && this.promptCompressor.getConfig().activeProfile !== 'none') {
      try {
        const start = Date.now();
        const result = await this.promptCompressor.compress(effectiveRequest);
        effectiveRequest = result.request;
        const durationMs = Date.now() - start;
        await this.events.publish(
          buildEvent<CompressionCompletedEvent>(
            'compression.completed',
            {
              requestId,
              profile: this.promptCompressor.getConfig().activeProfile,
              originalChars: result.originalChars,
              compressedChars: result.compressedChars,
              charsSaved: Math.max(0, result.originalChars - result.compressedChars),
              tokensSaved: result.tokensSaved,
              engines: result.strategies,
              durationMs,
            },
            correlationId,
          ),
        );
      } catch (compErr) {
        // Fail-open: keep the original (uncompressed) request.
        await this.events.publish(
          buildEvent<CompressionFallbackEvent>(
            'compression.fallback',
            {
              requestId,
              reason: (compErr as Error).message,
              preservedOriginal: true,
            },
            correlationId,
          ),
        );
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
    let decision: RoutingDecision;
    try {
      decision = await this.routing.resolve(routingReq);
    } catch (resolveErr) {
      // P3 (master prompt #10): a request for a *concrete* model that no
      // provider can currently serve would otherwise dead-end with
      // NoEligibleProviderError. The `nexus/auto` alias is already resilient
      // (it filters unhealthy/cooldown/no-key models), so — but only when the
      // caller asked for a specific model and the alias wasn't already used —
      // retry resolution through the auto chain before giving up. This never
      // re-masks a BudgetExceededError or other non-routing failures, and the
      // recursive retry only happens once (the fallback model is the alias).
      if (
        resolveErr instanceof NoEligibleProviderError &&
        routingReq.model &&
        !String(routingReq.model).startsWith('nexus/')
      ) {
        const autoReq: typeof routingReq = {
          // Drop model-specific provider pinning so the auto chain can pick any
          // healthy provider (the whole point of dead-route recovery). Other
          // constraints (region, tags, capabilities, budget) are preserved.
          ...routingReq,
          model: 'nexus/auto',
          preferredProviders: undefined,
          excludedProviders: undefined,
        };
        if (this.tracer) {
          this.tracer.recordRoutingDecision(
            requestId,
            'nexus/auto',
            'alias-fallback',
            0,
            'dead-route-recovery',
          );
        }
        decision = await this.routing.resolve(autoReq);
      } else {
        throw resolveErr;
      }
    }

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
        const next = this.failover.next(decision, endpoint.id, {
          scope: 'provider',
          failedProviderId: endpoint.providerId,
        });
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
            // NEVER inject the gateway's OWN bearer token (`nexus` /
            // NEXUS_API_KEY) as a provider API key — that would 401 upstream
            // as "Incorrect API key provided: nexus" and poison the real key
            // into `invalid`. If the only vaulted key for this provider is a
            // placeholder, leave endpoint.apiKey untouched so the adapter
            // surfaces an honest "no key configured" error instead of
            // corrupting provider state.
            const ownToken = process.env['NEXUS_API_KEY'] ?? 'nexus';
            if (plaintext && plaintext !== ownToken) {
              endpointWithKey = { ...endpoint, apiKey: plaintext } as ProviderEndpoint & { apiKey: string };
            }
          } else {
            // select() returned no key — normally means every key for this
            // provider is on cooldown or invalid. A COOLDOWN key is still a
            // VALID credential (a transient 429, not a revoked key): fall
            // back to it rather than giving up, otherwise a single
            // rate-limit permanently disables the provider ("All providers
            // exhausted") because the key can never succeed and clear its
            // own cooldown. Real auth failures are still handled: a genuine
            // 401/403 marks the key invalid and future requests skip it.
            const cooldownFallback = this.keyRegistry
              .listByProvider(endpoint.providerId)
              .find((k) => k.status === 'cooldown');
            if (cooldownFallback) {
              selectedKeyId = cooldownFallback.id;
              const plaintext = await this.keyRegistry.getPlaintext(cooldownFallback.id);
              const ownToken = process.env['NEXUS_API_KEY'] ?? 'nexus';
              if (plaintext && plaintext !== ownToken) {
                endpointWithKey = { ...endpoint, apiKey: plaintext } as ProviderEndpoint & { apiKey: string };
              }
            }
          }
        }

        // Ensure the model sent to the provider adapter is supported by this provider
        let requestForProvider = effectiveRequest;
        if (this.modelRegistry) {
          const providerModels: readonly ModelDescriptor[] = this.modelRegistry
            .list()
            .filter((m: ModelDescriptor) => !m.stale && m.providerId === endpoint.providerId);
          if (providerModels.length > 0) {
            const hasExact = providerModels.some(
              (m: ModelDescriptor) => m.id === effectiveRequest.model || m.id.toLowerCase() === effectiveRequest.model.toLowerCase(),
            );
            if (!hasExact) {
              const resolved = adapter.resolveModel?.(effectiveRequest.model);
              if (resolved && providerModels.some((m: ModelDescriptor) => m.id === resolved || m.id.toLowerCase() === resolved.toLowerCase())) {
                requestForProvider = { ...effectiveRequest, model: resolved };
              } else {
                const preferred = providerModels.find((m: ModelDescriptor) => m.capabilities?.toolCalling) ?? providerModels[0];
                if (preferred) {
                  requestForProvider = { ...effectiveRequest, model: preferred.id };
                }
              }
            }
          }
        }

        // Context-Length Clamping & Sanitization: clamp max_tokens and context window
        const matchedModelDescriptor = this.modelRegistry?.get(endpoint.providerId, requestForProvider.model)
          ?? this.modelRegistry?.get(endpoint.providerId, effectiveRequest.model);
        requestForProvider = clampAndSanitizeContext(requestForProvider, endpointWithKey, matchedModelDescriptor);

        const useSpeculativeHedge =
          requestForProvider.stream &&
          attempt === 0 &&
          decision.alternatives.length > 0 &&
          (requestForProvider.routing?.speculativeFallback || requestForProvider.routing?.hedgedDelayMs);

        let response: ChatCompletionResponse;
        try {
          response = useSpeculativeHedge
            ? await this.streamAndCollectHedged(
                decision,
                adapter,
                endpointWithKey,
                requestForProvider,
                guardedSink,
                effectiveSignal,
                requestId,
                correlationId,
              )
            : requestForProvider.stream
              ? await this.streamAndCollect(adapter, endpointWithKey, requestForProvider, guardedSink, effectiveSignal)
              : await adapter.chatCompletion(endpointWithKey, requestForProvider, effectiveSignal);
        } finally {
          // P5: release the concurrency reservation made by keyRegistry.select().
          if (this.keyRegistry && selectedKeyId) {
            this.keyRegistry.release(selectedKeyId);
          }
        }

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

        // Feed upstream rate-limit headers into the proactive tracker so key
        // selection can prefer keys with remaining quota (master prompt #5).
        // `responseHeaders` is optional — only populated by adapters that
        // surface raw headers — so absence is a no-op, not an error.
        if (this.rateLimitTracker && selectedKeyId && response.responseHeaders) {
          this.rateLimitTracker.recordHeaders(selectedKeyId, response.responseHeaders);
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
          if (typeof content === 'string') {
            content = filterSpecialTokens(content).cleaned;
            if (isJsonMode) {
              const repaired = repairJson(content);
              if (repaired.isValidJson) {
                content = repaired.repaired;
              }
            }
          }

          let reasoningContent = choice.message?.reasoningContent;
          if (typeof reasoningContent === 'string') {
            reasoningContent = filterSpecialTokens(reasoningContent).cleaned;
          }

          const toolCalls = choice.message?.tool_calls?.map((tc) => {
            const healed = healToolCallArguments(
              tc.function?.name ?? '',
              tc.function?.arguments ?? '{}',
              effectiveRequest.tools as never,
            );
            return {
              ...tc,
              function: {
                ...tc.function,
                arguments: healed.serialized,
              },
            };
          });

          return {
            ...choice,
            message: {
              ...choice.message,
              content,
              ...(reasoningContent !== undefined ? { reasoningContent } : {}),
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

        // Token accounting: upstreams vary in usage shape (OpenAI-compatible
        // providers emit snake_case `prompt_tokens`/`completion_tokens`, while
        // some gateways emit camelCase `promptTokens`). The KeyRegistry uses
        // the same dual fallback (see recordSuccess below); mirror it here so
        // the per-request telemetry matches the vault's token counts instead
        // of shipping `undefined`.
        const usage = response.usage as unknown as Record<string, unknown> | undefined;
        const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
        const inTok = num(usage?.promptTokens ?? usage?.prompt_tokens);
        const outTok = num(usage?.completionTokens ?? usage?.completion_tokens);

        await this.events.publish(
          buildEvent<ProviderRequestSucceededEvent>(
            'provider.request.succeeded',
            {
              requestId,
              endpointId: endpoint.id,
              providerId: endpoint.providerId,
              attempt,
              latencyMs,
              inputTokens: inTok,
              outputTokens: outTok,
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

        this.errorRegistry?.recordSuccess(endpoint.providerId, selectedKeyId, request.model);
        this.routing.recordModelSuccess?.(endpoint.id, request.model);

        return finalResult;
      } catch (err) {
        const error = err as Error;
        const classification = classifyFailure(error);
        const retryable = classification.retryable;
        await this.routing.recordFailure(endpoint.id, error, retryable, classification.endpointAction, classification.retryAfterMs);
        if (classification.code === 'MODEL_UNAVAILABLE' || classification.status === 429) {
          this.routing.recordModelFailure?.(endpoint.id, request.model, classification.retryAfterMs);
        }

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

        // Record error diagnostic into registry
        if (this.errorRegistry) {
          this.errorRegistry.recordError({
            providerId: endpoint.providerId,
            keyId: selectedKeyId,
            modelId: request.model,
            error,
            status: classification.status,
            latencyMs: Date.now() - startedAt,
            circuitBreakerState: endpoint.health === 'circuit_open' ? 'open' : undefined,
            cooldownUntil: classification.retryAfterMs ? Date.now() + classification.retryAfterMs : undefined,
          });
        }

        // Apply key-action classification (master prompt #14).
        // 429 → cooldown (handled by KeyRegistry.recordFailure with status=429)
        // 401/403 → invalidate (handled by KeyRegistry.recordFailure with status=401)
        // Other → no key action
        if (this.keyRegistry && selectedKeyId) {
          this.keyRegistry.recordFailure(selectedKeyId, classification.status || classification.code || 'error', retryable, classification.retryAfterMs);
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

        // Scope-aware failover (master prompt #19): bias the next candidate by
        // the *nature* of the failure. A credential error (401/403 invalid key)
        // means prefer staying on the same provider (a different valid key is
        // chosen downstream); a provider/network/billing failure means prefer a
        // different provider so we don't burn retries on the same outage.
        const failScope: 'provider' | 'credential' | undefined =
          classification.keyAction === 'invalidate'
            ? 'credential'
            : classification.endpointAction === 'mark_unavailable' ||
                classification.status >= 500 ||
                classification.status === 429
              ? 'provider'
              : undefined;

        const next = this.failover.next(decision, endpoint.id, {
          scope: failScope,
          failedProviderId: endpoint.providerId,
        });
        if (!next) break;

        // ─── Error-class-aware backoff with jitter (WS2 stability) ─────────
        // Retryable failures (429/5xx/network) would otherwise fail over
        // instantly, letting a burst of identical errors hammer the upstream
        // and deepen a rate-limit / overload condition. We pause before the
        // next attempt, honoring the provider's own Retry-After when present
        // (master prompt #5) and otherwise applying a capped exponential
        // backoff with FULL jitter to avoid thundering-herd on recovery.
        // Non-retryable failures never reach here (we threw above), and a
        // stream that already emitted bytes never retries (TEST 10 guard), so
        // this delay only affects genuine in-flight failovers.
        const base = classification.retryAfterMs && classification.retryAfterMs > 0
          ? classification.retryAfterMs
          : Math.min(2000, 250 * 2 ** Math.min(attempt, 4)); // 250ms…2s, capped
        const jitter = Math.random() * base; // full jitter: 0..base
        await new Promise((r) => setTimeout(r, Math.round(jitter)));

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
    const clampingState = newStreamClampingState();

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

      // Stream Token Sanitization & Runaway Loop Clamping
      let shouldTerminateStream = false;
      const delta = chunk.choices[0]?.delta;
      if (delta) {
        if (delta.content) {
          const res = filterStreamChunk(delta.content, clampingState);
          (chunk.choices[0] as any).delta.content = res.cleaned;
          if (res.shouldTerminate) shouldTerminateStream = true;
        }
        if (delta.reasoning) {
          const res = filterStreamChunk(delta.reasoning, clampingState);
          (chunk.choices[0] as any).delta.reasoning = res.cleaned;
          if (res.shouldTerminate) shouldTerminateStream = true;
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.arguments) {
              (tc as any).function.arguments = filterSpecialTokens(tc.function.arguments).cleaned;
            }
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
      if (shouldTerminateStream) {
        finishReason = 'length';
        if (chunk.choices[0]) {
          (chunk.choices[0] as any).finish_reason = 'length';
        }
      }

      if (sink) await sink.write(chunk);
      if (shouldTerminateStream) break;
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
      // Cooldown-fallback: a cooldown key is still a valid credential
      // (transient 429) — prefer it over giving up with no key at all.
      const altEffectiveKeyId =
        altKeyId ??
        this.keyRegistry
          .listByProvider(altEndpoint.providerId)
          .find((k) => k.status === 'cooldown')?.id;
      if (altEffectiveKeyId) {
        const altPlaintext = await this.keyRegistry.getPlaintext(altEffectiveKeyId);
        const ownToken = process.env['NEXUS_API_KEY'] ?? 'nexus';
        if (altPlaintext && altPlaintext !== ownToken) {
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
  /**
   * Provider-supplied `Retry-After` in milliseconds, when the error response
   * included one (typically on HTTP 429). Drives adaptive, provider-honoring
   * cooldowns instead of a fixed 60s penalty (master prompt #5). Undefined
   * when the provider did not advertise a retry window.
   */
  readonly retryAfterMs?: number;
}

/**
 * Extracts a `Retry-After` value (in milliseconds) from a provider error's
 * captured response headers, when the upstream advertised one. Honors both
 * the delta-seconds form (`Retry-After: 30`) and the HTTP-date form
 * (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). Returns undefined when no
 * usable value is present. This is what lets the router apply an *adaptive*,
 * provider-honoring cooldown instead of a fixed penalty (master prompt #5).
 */
function parseRetryAfterMs(error: Error): number | undefined {
  const ctx = (error as { context?: Record<string, unknown> }).context;
  if (!ctx) return undefined;
  const raw = ctx['retryAfter'] ?? ctx['retry-after'] ?? ctx['headers'];
  if (raw === undefined || raw === null) return undefined;
  // Headers may be a Record<string, string | string[]>; normalize the value
  // and lowercase keys so `Retry-After` and `retry-after` both match.
  const getHeader = (name: string): string | undefined => {
    if (typeof raw === 'object' && !Array.isArray(raw) && raw !== null) {
      const lower = new Map<string, unknown>();
      for (const [k, v] of Object.entries(raw)) lower.set(k.toLowerCase(), v);
      const v = lower.get(name.toLowerCase());
      if (Array.isArray(v)) return v[0];
      return typeof v === 'string' ? v : undefined;
    }
    return undefined;
  };
  const value = getHeader('retry-after');
  if (!value) return undefined;
  // HTTP-date form.
  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate) && asDate > Date.now()) {
    return Math.max(0, asDate - Date.now());
  }
  // Delta-seconds form.
  const asNum = parseInt(value, 10);
  if (!Number.isNaN(asNum)) return Math.max(0, asNum * 1000);
  return undefined;
}

export function classifyFailure(error: Error): FailureClassification {
  // ProviderResponseError carries an HTTP status.
  if (error instanceof ProviderResponseError) {
    const status = error.status;
    const retryAfterMs = parseRetryAfterMs(error);
    // Rate-limit errors (HTTP 429, or an upstream "FreeUsageLimitError" /
    // "Rate limit exceeded" body) are TRANSIENT — the provider is healthy, the
    // account/key is merely throttled. These MUST NOT trip the permanent
    // circuit breaker (mark_unavailable): doing so turns a brief throttle into
    // a permanently dead provider ("All providers exhausted" for every model
    // on it). They only cool down the key (record_failure) and fail over. This
    // is checked BEFORE the billing/quota branch because some providers wrap a
    // 429 rate-limit in a 402/401 body that would otherwise be misread as a
    // billing death.
    const msg = error.message ?? '';
    const isRateLimit =
      status === 429 ||
      /free ?usage ?limit|rate[ -]?limit|too many requests|429/i.test(msg);
    if (isRateLimit) {
      return {
        status: 429,
        code: undefined,
        retryable: true,
        keyAction: 'cooldown',
        endpointAction: 'record_failure',
        retryAfterMs,
        reason: `HTTP 429 / rate-limit: throttled — key on cooldown, failing over (provider stays healthy)${retryAfterMs ? ` — Retry-After ${Math.round(retryAfterMs / 1000)}s honored` : ''}`,
      };
    }
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
    // bad. Invalidate (don't retry on the same key). If alternative keys or
    // providers exist, failover can proceed.
    if (status === 401 || status === 403) {
      return {
        status, code: undefined,
        retryable: true,
        keyAction: 'invalidate',
        endpointAction: 'none',
        reason: `HTTP ${status}: authentication/authorization failed — key invalidated, attempting failover`,
      };
    }
    // 404 Not Found or 400/422 invalid_model / model unavailable — model
    // doesn't exist or is unsupported on this specific provider. This is a
    // *model*-level failure, NOT an unrecoverable client bug: surface a
    // distinct MODEL_UNAVAILABLE code with retryable=true so routing can
    // failover cleanly to an alternative provider offering this model/capability.
    const isModelUnavailable =
      status === 404 ||
      ((status === 400 || status === 422) &&
        /invalid[ -]?model|model[ -]?(not[ -]?found|unavailable|does not exist)|unsupported model/i.test(
          error.message ?? '',
        ));
    if (isModelUnavailable) {
      return {
        status, code: 'MODEL_UNAVAILABLE',
        retryable: true,
        keyAction: 'none',
        endpointAction: 'record_failure',
        reason: `HTTP ${status}: model not found or unsupported on this provider — failing over to alternative provider`,
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
        retryAfterMs,
        reason: `HTTP 429: rate limited${retryAfterMs ? ` — Retry-After ${Math.round(retryAfterMs / 1000)}s honored` : ''} — key on cooldown, failing over`,
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

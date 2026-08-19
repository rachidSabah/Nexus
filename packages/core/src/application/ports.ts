import type { DomainEvent } from '../domain/events.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelDescriptor,
  ProviderEndpoint,
  RoutingRequest,
  RoutingDecision,
  TokenUsage,
} from '../domain/types.js';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * PORTS (hexagonal boundaries)
 *
 * Every concrete adapter (HTTP server, provider SDK, Prometheus exporter,
 * Postgres repository, etc.) implements one of these interfaces. The core
 * domain never imports concrete adapters — only ports.
 * ───────────────────────────────────────────────────────────────────────────
 */

/**
 * Streams chat-completion chunks back to the caller. The HTTP/WS layer
 * implements this; the gateway application core consumes it as a sink.
 */
export interface ChunkSink {
  write(chunk: ChatCompletionChunk): Promise<void>;
  error(error: Error): Promise<void>;
  end(): Promise<void>;
}

/**
 * A provider adapter — the most important port in the system. Each provider
 * (Anthropic, OpenAI, Google, OpenRouter, …) implements this.
 */
export interface ProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;

  /**
   * Non-streaming chat completion.
   */
  chatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse>;

  /**
   * Streaming chat completion. Yields chunks as they arrive from the provider.
   * The adapter is responsible for normalising provider-specific SSE formats
   * into the OpenAI-compatible `ChatCompletionChunk` shape.
   */
  streamChatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk>;

  /**
   * Embeddings (optional — not all providers support embeddings).
   */
  embed?(
    endpoint: ProviderEndpoint,
    request: EmbeddingRequest,
    signal: AbortSignal,
  ): Promise<EmbeddingResponse>;

  /**
   * Translate a generic "model" alias into a provider-specific model name.
   */
  resolveModel?(alias: string): string | undefined;

  /**
   * Lightweight probe used by the health monitor. Should not count against
   * user quota. Implementations should return within ~2s.
   */
  healthCheck(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<boolean>;

  /**
   * Optional: discover the list of models this provider exposes via its
   * `GET /models` (or equivalent) endpoint. Returns normalized
   * `ModelDescriptor[]` entries that the ModelRegistry aggregates.
   *
   * Implementations should:
   *   - Call the provider's models endpoint (NOT a chat completion)
   *   - Normalize the response into `ModelDescriptor[]`
   *   - Detect free-tier models where pricing metadata is exposed
   *     (OpenRouter's `:free` suffix, OpenAI's `per_request_rate: 0`, etc.)
   *   - NOT throw on transient failures — return `[]` and let the
   *     background refresh loop retry on the next tick.
   *
   * If a provider doesn't expose model discovery, omit this method (return
   * undefined). The ModelRegistry will skip it.
   */
  discoverModels?(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<readonly ModelDescriptor[]>;
}

/**
 * The routing engine port.
 */
export interface RoutingEnginePort {
  /**
   * Resolve a routing request to a single endpoint, plus alternatives for
   * failover. Throws `NoEligibleProviderError` if nothing matches.
   */
  resolve(request: RoutingRequest): Promise<RoutingDecision>;

  /**
   * Notify the engine that an endpoint has succeeded. Used for least-latency
   * EWMA and circuit-breaker accounting.
   */
  recordSuccess(endpointId: string, latencyMs: number): void;

  /**
   * Notify the engine that an endpoint has failed. Used for circuit breakers.
   * `action` mirrors the failure classification's `endpointAction` so the
   * engine can apply the correct health transition (e.g. `mark_unavailable`
   * → circuit-open) instead of only counting retryable failures.
   */
  recordFailure(
    endpointId: string,
    error: Error,
    retryable: boolean,
    action?: 'mark_unavailable' | 'mark_degraded' | 'record_failure' | 'none',
    /**
     * Provider-supplied `Retry-After` in milliseconds, when the failed
     * response advertised one (e.g. HTTP 429). Drives an adaptive,
     * provider-honoring cooldown instead of the fixed default.
     */
    retryAfterMs?: number,
  ): void;

  /**
   * Register or update an endpoint at runtime.
   */
  registerEndpoint(endpoint: ProviderEndpoint): void;

  /**
   * Remove an endpoint.
   */
  unregisterEndpoint(endpointId: string): void;

  /**
   * Live-patch mutable endpoint fields (e.g. correct a wrong baseUrl, or
   * override health) without restarting the gateway.
   */
  updateEndpoint(endpointId: string, patch: Partial<Pick<ProviderEndpoint, 'baseUrl' | 'displayName' | 'health' | 'region' | 'tags' | 'priority' | 'weight'>>): void;

  /**
   * List all currently-registered endpoints (for dashboard/CLI).
   */
  listEndpoints(): readonly ProviderEndpoint[];

  /**
   * Returns the set of provider IDs that currently have at least one
   * selectable (registered, healthy, not in cooldown) endpoint. A discovered
   * model is only routable when its `providerId` is in this set — used to
   * avoid advertising models that no provider can actually serve.
   */
  getSelectableProviders(): readonly string[];
}

/**
 * The failover port — given a failed endpoint and a routing decision, picks
 * the next best alternative. The default implementation walks
 * `RoutingDecision.alternatives`.
 */
export interface FailoverPort {
  /**
   * @param decision The original routing decision (carries the candidate pool).
   * @param failedEndpointId The endpoint that just failed this request.
   * @param context Optional failure context enabling *scope-aware* failover
   *   (master prompt #19): on a provider-wide failure, prefer a candidate from
   *   a *different* provider before re-trying the same one; on a credential
   *   failure, prefer staying on the same provider (a different, still-valid
   *   key is selected downstream) before switching providers. Omitting the
   *   context preserves the original "first viable alternative" behavior.
   */
  next(
    decision: RoutingDecision,
    failedEndpointId: string,
    context?: FailoverContext,
  ): ProviderEndpoint | null;
}

/** Scope of a failure, used to bias failover toward provider or credential diversity. */
export interface FailoverContext {
  /** 'provider' = endpoint/network/billing failure (prefer a different provider);
   *  'credential' = 401/403 invalid key (prefer same provider, different key). */
  scope?: 'provider' | 'credential';
  /** Provider that failed, so diversity logic can avoid (or prefer) it. */
  failedProviderId?: string;
}

/**
 * Cache port — supports both exact-match prompt cache and semantic cache.
 */
export interface CachePort {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  semantic?(
    embedding: readonly number[],
    threshold: number,
  ): Promise<{ key: string; similarity: number; value: unknown } | undefined>;
  semanticStore?(embedding: readonly number[], key: string, value: unknown, ttlMs: number): Promise<void>;
  stats(): { hits: number; misses: number; size: number; hitRate: number };
}

/**
 * Repository port for persisting endpoints, audit logs, and request logs.
 * Implementations: in-memory (default), Postgres, SQLite.
 */
export interface EndpointRepository {
  list(): Promise<readonly ProviderEndpoint[]>;
  get(id: string): Promise<ProviderEndpoint | undefined>;
  save(endpoint: ProviderEndpoint): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * Audit log port. Every authorization decision, credential access, and
 * configuration change is recorded here.
 */
export interface AuditLogPort {
  append(entry: {
    principal: string;
    action: string;
    resource: string;
    result: 'allow' | 'deny';
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  query(filter: {
    principal?: string;
    action?: string;
    since?: Date;
    limit?: number;
  }): Promise<readonly { id: string; occurredAt: Date; entry: unknown }[]>;
}

/**
 * Event bus port — pub/sub for domain events. Used by observability, plugins,
 * and the dashboard's real-time WebSocket feed.
 */
export interface EventBusPort {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T extends DomainEvent>(
    type: T['type'] | T['type'][],
    handler: (event: T) => void | Promise<void>,
  ): () => void;
  /** Subscribe to ALL events (audit log / debug / scoped SSE views). */
  subscribeAll(handler: (event: DomainEvent) => void | Promise<void>): () => void;
}

/**
 * Credential vault port — encrypted at rest, decrypted only in-memory.
 */
export interface CredentialVaultPort {
  get(providerId: string): Promise<string | undefined>;
  set(providerId: string, secret: string): Promise<void>;
  delete(providerId: string): Promise<void>;
  list(): Promise<readonly string[]>;
}

/**
 * Telemetry port — the OpenTelemetry shim. Concrete implementation wraps
 * `@opentelemetry/api`.
 */
export interface TelemetryPort {
  startSpan(name: string, attributes?: Record<string, unknown>): {
    setAttribute(key: string, value: unknown): void;
    recordError(error: Error): void;
    end(): void;
  };
  meter(name: string): {
    counter(name: string): { add(value: number, attributes?: Record<string, unknown>): void };
    gauge(name: string): { set(value: number, attributes?: Record<string, unknown>): void };
    histogram(name: string): { record(value: number, attributes?: Record<string, unknown>): void };
  };
}

/**
 * Budget port — tracks remaining spend per principal / API key / project.
 */
export interface BudgetPort {
  getRemaining(budgetId: string): Promise<number>;
  reserve(budgetId: string, estimateUsd: number): Promise<boolean>;
  commit(budgetId: string, actualUsd: number): Promise<void>;
  release(budgetId: string, estimateUsd: number): Promise<void>;
}

/**
 * Health monitor port — actively probes endpoints and emits HealthChangedEvent.
 */
export interface HealthMonitorPort {
  start(): Promise<void>;
  stop(): Promise<void>;
  forceCheck(endpointId: string): Promise<void>;
}

/**
 * Plugin port — implemented by the plugin runtime. Application code never
 * touches plugin internals directly.
 */
export interface PluginRuntimePort {
  load(spec: PluginSpec): Promise<void>;
  unload(pluginId: string): Promise<void>;
  list(): readonly PluginDescriptor[];
  invokeHook<T>(hook: string, ...args: unknown[]): Promise<T[]>;
}

/**
 * Plugin spec — describes how to load a plugin. The `source` field tells
 * the loader how to resolve the plugin (inline factory, dynamic import, or
 * npm package name).
 */
export interface PluginSpec {
  readonly id: string;
  readonly source: 'inline' | 'module';
  readonly path?: string;
  readonly config?: Record<string, unknown>;
}

export interface PluginDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly hooks: readonly string[];
  readonly capabilities: readonly string[];
}

/**
 * Network port — abstracts outbound HTTP, including proxy selection, DNS-over-
 * HTTPS, and connection diagnostics.
 */
export interface NetworkPort {
  fetch(url: string, init?: RequestInit & { proxyId?: string; rotateProxy?: boolean }): Promise<Response>;
  measureLatency(url: string): Promise<number>;
  diagnose(): Promise<NetworkDiagnostics>;
}

export interface NetworkDiagnostics {
  readonly dns: { readonly resolver: string; readonly ok: boolean; readonly latencyMs: number };
  readonly proxies: ReadonlyArray<{
    readonly id: string;
    readonly url: string;
    readonly ok: boolean;
    readonly latencyMs: number;
  }>;
  readonly ipv4: { readonly ok: boolean; readonly latencyMs: number; readonly status?: 'OK' | 'UNREACHABLE' };
  readonly ipv6: { readonly ok: boolean; readonly latencyMs: number; readonly status?: 'OK' | 'UNREACHABLE' | 'UNAVAILABLE' };
  readonly directHttps?: { readonly ok: boolean; readonly latencyMs: number; readonly status?: 'OK' | 'UNREACHABLE' };
  readonly egressMode?: import('../domain/types.js').EgressMode;
  readonly activeEgress?: 'DIRECT' | 'PROXY';
  readonly proxyPool?: ReadonlyArray<import('../domain/types.js').ProxyEndpoint>;
  readonly poolSummary?: {
    readonly discovered: number;
    readonly testing: number;
    readonly healthy: number;
    readonly degraded: number;
    readonly dead: number;
    readonly quarantined: number;
    readonly disabled: number;
  };
}

/**
 * Cost calculator port — given usage and pricing, returns cost. Defaults to
 * a deterministic arithmetic implementation; can be swapped for a provider-
 * specific calculator (e.g. for tiered pricing).
 */
export interface CostCalculatorPort {
  calculate(
    usage: TokenUsage,
    pricing: { inputPer1K: number; outputPer1K: number; cachedInputPer1K?: number },
  ): { inputCostUsd: number; outputCostUsd: number; cachedInputCostUsd: number; totalCostUsd: number };
}

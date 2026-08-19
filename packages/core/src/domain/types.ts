/**
 * Capability flags advertised by a provider or model.
 * Used by the routing engine to filter providers that can serve a request.
 */
export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  audio: boolean;
  speech: boolean;
  embeddings: boolean;
  reasoning: boolean;
  jsonMode: boolean;
  maxOutputTokens: number;
  maxInputTokens: number;
  supportedModalities: Array<'text' | 'image' | 'audio' | 'video' | 'file'>;
}

/**
 * Pricing per 1K tokens (USD). Used by least-cost routing.
 */
export interface ProviderPricing {
  inputPer1K: number;
  outputPer1K: number;
  cachedInputPer1K?: number;
  currency: 'USD' | 'EUR';
}

// ── Model Fabric: canonical pricing (single representation) ────────────────
export type PricingSource = 'live' | 'provider_metadata' | 'adapter_fallback' | 'explicit' | 'unknown';

export type FreeTier =
  | 'FREE'
  | 'FREE_TIER'
  | 'ZERO_INPUT_PAID_OUTPUT'
  | 'PAID'
  | 'UNKNOWN';

export interface GatewayPricing {
  inputPer1M?: number;
  outputPer1M?: number;
  /** Cached-input (prompt cache read) price per 1M tokens, if published. */
  cachedInputPer1M?: number;
  /** Cached-output price per 1M tokens, if published. */
  cachedOutputPer1M?: number;
  /** True if the provider explicitly marks this as a free-tier model. */
  isFree?: boolean;
  /**
   * True when the provider exposes this model as a quota/rate-limited free
   * tier (e.g. an OpenRouter `:free` alias, an OpenCode Zen / NVIDIA `*-free`
   * alias). These are free but capacity-capped, distinct from genuinely
   * unrestricted free models (e.g. `pricing.prompt === '0'`).
   *
   * Source of truth: `hasFreeSuffix(id)` at the provider-adapter discovery
   * boundary (see `ports.ts` "Detect free-tier models" contract). Never
   * inferred from arbitrary naming; only from provider-enforced free aliases.
   */
  quotaLimited?: boolean;
  currency?: string;
  /** Source hierarchy: live > provider_metadata > adapter_fallback > unknown. */
  source?: PricingSource;
  /** When this pricing was observed (epoch ms). */
  updatedAt?: number;
  /** Derived classification (see classifyPricing in application/pricing.ts). */
  freeTier?: FreeTier;
}

/**
 * Health status of a provider endpoint at a point in time.
 */
export type ProviderHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'circuit_open'
  | 'unknown';

/**
 * A registered provider endpoint — the atomic routing unit.
 */
export interface ProviderEndpoint {
  readonly id: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly capabilities: ProviderCapabilities;
  readonly pricing?: ProviderPricing;
  readonly priority: number;
  readonly weight: number;
  readonly region?: string;
  readonly tags: readonly string[];
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly concurrencyLimit: number;
  health: ProviderHealthStatus;
  readonly createdAt: Date;
  updatedAt: Date;
}

/**
 * Routing strategy enumeration.
 */
export type RoutingStrategy =
  | 'weighted'
  | 'round_robin'
  | 'least_latency'
  | 'least_cost'
  | 'highest_quality'
  | 'capability_match'
  | 'priority'
  | 'budget_aware'
  | 'free_only';

/**
 * The full route-resolution request payload.
 */
export interface RoutingRequest {
  readonly model: string;
  readonly capabilities?: Partial<ProviderCapabilities>;
  readonly strategy?: RoutingStrategy;
  readonly preferredProviders?: readonly string[];
  readonly excludedProviders?: readonly string[];
  readonly maxLatencyMs?: number;
  readonly maxCostPer1K?: number;
  readonly region?: string;
  readonly tags?: readonly string[];
  readonly budgetRemainingUsd?: number;
  /** Provider IDs that currently serve a free (no-cost) model. When set and
   *  the strategy is 'free_only', route only to these providers. */
  readonly freeProviderIds?: readonly string[];
  /** When true, launches a hedged speculative request to alternative endpoint if primary TTFT stalls. */
  readonly speculativeFallback?: boolean;
  /** Milliseconds to wait before launching speculative hedged request (default: 800ms). */
  readonly hedgedDelayMs?: number;
}

/**
 * The result of route resolution.
 */
export interface RoutingDecision {
  readonly endpoint: ProviderEndpoint;
  readonly strategy: RoutingStrategy;
  readonly reason: string;
  readonly alternatives: readonly ProviderEndpoint[];
  readonly resolvedAt: Date;
}

/**
 * Token usage accounting.
 */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cachedTokens?: number;
  readonly reasoningTokens?: number;
}

/**
 * Cost accounting derived from TokenUsage and ProviderPricing.
 */
export interface CostBreakdown {
  readonly inputCostUsd: number;
  readonly outputCostUsd: number;
  readonly cachedInputCostUsd: number;
  readonly totalCostUsd: number;
}

/**
 * A message in the OpenAI-compatible chat format.
 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  readonly content: string | Array<ChatMessageContentPart>;
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly ToolCall[];
  /**
   * Reasoning text (thinking tokens) from reasoning-capable upstreams.
   * Serially: adapters capture `reasoning_content`/`reasoning` here so
   * multi-turn conversations can replay it (DeepSeek-style APIs reject
   * history that drops the thinking content), and the Anthropic bridge
   * emits it as a `thinking` block.
   */
  readonly reasoningContent?: string;
  readonly reasoning_content?: string;
}

export type ChatMessageContentPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image_url';
      readonly image_url: { readonly url: string; readonly detail?: 'auto' | 'low' | 'high' };
    }
  | { readonly type: 'input_audio'; readonly input_audio: { readonly data: string; readonly format: string } };

export interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/**
 * Request to generate a chat completion. Mirrors the OpenAI REST shape.
 */
export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly topP?: number;
  readonly n?: number;
  readonly stream?: boolean;
  readonly stop?: string | readonly string[];
  readonly maxTokens?: number;
  readonly maxOutputTokens?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly logitBias?: Record<string, number>;
  readonly user?: string;
  readonly tools?: readonly unknown[];
  readonly toolChoice?: unknown;
  readonly responseFormat?: { readonly type: 'text' | 'json_object' | 'json_schema'; readonly json_schema?: unknown };
  readonly seed?: number;
  readonly streamOptions?: { readonly include_usage?: boolean };
  readonly routing?: Partial<RoutingRequest>;
  readonly metadata?: Record<string, unknown>;
}

/**
 * A single streaming chunk (OpenAI-compatible SSE shape).
 */
export interface ChatCompletionChunk {
  readonly id: string;
  readonly object: 'chat.completion.chunk';
  readonly created: number;
  readonly model: string;
  readonly choices: readonly {
    readonly index: number;
    readonly delta: {
      readonly role?: string;
      readonly content?: string;
      readonly tool_calls?: readonly ToolCall[];
      readonly reasoning?: string;
    };
    readonly finish_reason: string | null;
  }[];
  readonly usage?: TokenUsage;
  readonly systemFingerprint?: string;
}

/**
 * Non-streaming chat completion response.
 */
export interface ChatCompletionResponse {
  readonly id: string;
  readonly object: 'chat.completion';
  readonly created: number;
  readonly model: string;
  readonly choices: readonly {
    readonly index: number;
    readonly message: ChatMessage;
    readonly finish_reason: string;
    readonly logprobs?: unknown;
  }[];
  readonly usage: TokenUsage;
  readonly systemFingerprint?: string;
  readonly provider: string;
  readonly endpoint: string;
  readonly latencyMs: number;
  readonly costUsd?: number;
  /**
   * Raw upstream response headers, captured by the provider adapter when the
   * transport exposes them. OPTIONAL — adapters that don't surface headers
   * simply omit this. Consumed by the ProactiveRateLimitTracker so the
   * gateway can honor `Retry-After` and `X-RateLimit-*` without re-probing
   * providers. Adding this field is strictly backward-compatible.
   */
  readonly responseHeaders?: Record<string, string>;
}

/**
 * Embeddings request/response.
 */
export interface EmbeddingRequest {
  readonly model: string;
  readonly input: string | readonly string[];
  readonly dimensions?: number;
  readonly encodingFormat?: 'float' | 'base64';
  readonly user?: string;
  readonly routing?: Partial<RoutingRequest>;
}

export interface EmbeddingResponse {
  readonly object: 'list';
  readonly data: readonly {
    readonly object: 'embedding';
    readonly index: number;
    readonly embedding: readonly number[];
  }[];
  readonly model: string;
  readonly usage: TokenUsage;
  readonly provider: string;
  readonly endpoint: string;
  readonly latencyMs: number;
}

/**
 * Normalized model descriptor — produced by a provider's `discoverModels()`
 * method and aggregated by the ModelRegistry. This is the future-proof
 * shape: the router consults `capabilities` and `pricing`, never hardcoded
 * model-name lists.
 */
export interface ModelDescriptor {
  /** The provider's canonical model id (e.g. "gpt-4o", "claude-3-5-sonnet-20241022"). */
  readonly id: string;
  /** The provider that exposes this model (e.g. "openai", "anthropic"). */
  readonly providerId: string;
  /** Human-readable name (often same as id). */
  readonly displayName?: string;
  /** Description from the provider, if available. */
  readonly description?: string;
  /** Max input context window in tokens, if known. */
  readonly contextWindow?: number;
  /** Max output tokens, if known. */
  readonly maxOutputTokens?: number;
  /** Pricing per 1M tokens — canonical GatewayPricing (see pricing.ts). */
    readonly pricing?: GatewayPricing;
  /** Capability flags (inferred from provider metadata or model name heuristics). */
  readonly capabilities?: {
    streaming?: boolean;
    toolCalling?: boolean;
    vision?: boolean;
    audio?: boolean;
    speech?: boolean;
    embeddings?: boolean;
    reasoning?: boolean;
    jsonMode?: boolean;
  };
  /** When this model was discovered (epoch ms). */
  readonly discoveredAt: number;
  /** True if the model disappeared on the last refresh (kept for one cycle so dashboard can show "recently removed"). */
  readonly stale?: boolean;
  /** Why the model is stale: 'disappeared' (provider stopped listing) or 'unhealthy' (runtime upstream error like 401/404). 'unhealthy' models are NOT auto-reinstated just because the provider still lists them — they must clear the failure first. */
  readonly staleReason?: 'disappeared' | 'unhealthy';
  /** Last error seen when probing/using this model (e.g. upstream 401/404/429). Surfaced in debug endpoints + dashboard. */
  readonly lastError?: string;
}

// ── Network Egress Fabric Domain Model ────────────────────────────────────

export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5';

export type ProxyStatus =
  | 'DISCOVERED'
  | 'TESTING'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'DEAD'
  | 'QUARANTINED'
  | 'DISABLED';

export type EgressMode = 'DIRECT' | 'PROXY_PREFERRED' | 'PROXY_ONLY' | 'AUTO';

export type ProxyFailureReason =
  | 'TCP_TIMEOUT'
  | 'TCP_REFUSED'
  | 'TLS_FAILURE'
  | 'HTTP_TIMEOUT'
  | 'HTTP_403'
  | 'HTTP_407'
  | 'HTTP_429'
  | 'HTTP_5XX'
  | 'CONNECTION_RESET'
  | 'DNS_FAILURE'
  | 'INVALID_PROXY'
  | 'AUTH_FAILURE'
  | 'TARGET_UNREACHABLE'
  | 'SSRF_BLOCKED'
  | 'UNKNOWN';

export interface LatencyBreakdown {
  tcpLatencyMs: number | null;
  tlsLatencyMs: number | null;
  httpLatencyMs: number | null;
  totalLatencyMs: number | null;
}

export interface ProxyEndpoint {
  id: string;
  url: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  // Note: Password MUST NEVER be returned in API/logs/diagnostics.
  source: string;
  discoveredAt: number;
  lastCheckedAt: number | null;
  lastSuccessfulAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  latencyMs: number | null;
  tcpLatencyMs: number | null;
  tlsLatencyMs: number | null;
  httpLatencyMs: number | null;
  status: ProxyStatus;
  healthScore: number; // 0.0 -> unusable, 1.0 -> pristine
  anonymityLevel?: 'transparent' | 'anonymous' | 'elite' | 'unknown';
  country?: string;
  asn?: string;
  supportsHttp: boolean;
  supportsHttps: boolean;
  supportsConnect: boolean;
  supportsIPv4: boolean;
  supportsIPv6: boolean;
  quarantineUntil: number | null;
  cooldownUntil: number | null;
  failureReason?: ProxyFailureReason;
  lastUsedAt?: number;
}


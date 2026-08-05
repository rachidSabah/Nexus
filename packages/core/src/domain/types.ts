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
  | 'budget_aware';

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

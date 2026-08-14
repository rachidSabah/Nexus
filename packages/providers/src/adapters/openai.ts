import { randomUUID } from 'node:crypto';

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelDescriptor,
  ProviderEndpoint,
} from '@anx/core';
import { ProviderResponseError, type ProviderAdapter } from '@anx/core';
import { classifyPricing, hasFreeSuffix } from '@anx/core';

import { buildHeaders, fetchJson, parseSseStream } from '../shared/http.js';

/**
 * OpenAI provider adapter. Also serves as the base class for any
 * OpenAI-compatible provider (DeepSeek, OpenRouter, Together, Groq, vLLM,
 * LM Studio, LiteLLM, Cerebras, Fireworks, …) — they only override
 * `baseUrl` defaults and a few header quirks.
 */
export class OpenAIAdapter implements ProviderAdapter {
  providerId = 'openai';
  displayName = 'OpenAI';

  protected apiBase = 'https://api.openai.com/v1';
  protected authHeaderName = 'Authorization';
  protected authHeaderPrefix = 'Bearer ';
  protected apiKeyEnv = 'OPENAI_API_KEY';
  // Whether the upstream accepts the OpenAI `user` field. OpenAI does; some
  // strict OpenAI-compatible schemas (Mistral) set `extra="forbid"` and reject
  // any unknown field, so they must never receive `user`.
  protected supportsUserField = true;

  resolveModel(alias: string): string | undefined {
    // Direct passthrough. Subclasses can override for alias maps.
    return alias;
  }

  async chatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const apiKey = this.getApiKey(endpoint);
    const url = `${this.resolveBase(endpoint)}/chat/completions`;
    const body = this.translateRequest(request, false);

    const raw = await fetchJson<OpenAIChatResponse>(url, {
      method: 'POST',
      headers: this.headers(endpoint, apiKey),
      body: JSON.stringify(body),
    }, endpoint, signal);

    return this.translateResponse(raw, endpoint);
  }

  async *streamChatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk> {
    const apiKey = this.getApiKey(endpoint);
    const url = `${this.resolveBase(endpoint)}/chat/completions`;
    const body = this.translateRequest(request, true);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(endpoint, apiKey),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderResponseError(endpoint.id, response.status, text, { url });
    }
    if (!response.body) {
      throw new ProviderResponseError(endpoint.id, 0, 'No response body for stream', { url });
    }

    for await (const evt of parseSseStream(response.body)) {
      const chunk = this.translateChunk(evt);
      if (chunk) yield chunk;
    }
  }

  async embed(
    endpoint: ProviderEndpoint,
    request: EmbeddingRequest,
    signal: AbortSignal,
  ): Promise<EmbeddingResponse> {
    const apiKey = this.getApiKey(endpoint);
    const url = `${this.resolveBase(endpoint)}/embeddings`;
    const body: Record<string, unknown> = {
      model: request.model,
      input: request.input,
      dimensions: request.dimensions,
      encoding_format: request.encodingFormat ?? 'float',
      // `user` MUST be a plain string per the OpenAI/Mistral spec. OpenCode Zen
      // free-tier telemetry sends the value as a JSON *string* of an object
      // ({device_id, account_uuid, session_id}) which strict schemas (Mistral)
      // reject with HTTP 422 — drop it unless it's a clean plain string and the
      // upstream actually accepts the field.
      ...(this.supportsUserField && typeof request.user === 'string' && !request.user.trim().startsWith('{')
        ? { user: request.user }
        : {}),
    };

    const raw = await fetchJson<OpenAIEmbeddingResponse>(url, {
      method: 'POST',
      headers: this.headers(endpoint, apiKey),
      body: JSON.stringify(body),
    }, endpoint, signal);

    return {
      object: 'list',
      data: raw.data.map((d) => ({ object: 'embedding', index: d.index, embedding: d.embedding })),
      model: raw.model,
      usage: raw.usage,
      provider: this.providerId,
      endpoint: endpoint.id,
      latencyMs: 0,
    };
  }

  async healthCheck(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<boolean> {
    try {
      const apiKey = this.getApiKey(endpoint);
      await fetchJson(`${this.resolveBase(endpoint)}/models`, {
        method: 'GET',
        headers: this.headers(endpoint, apiKey),
      }, endpoint, signal);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Discovers models via the OpenAI-compatible `GET /models` endpoint.
   * Used by the ModelRegistry's background refresh loop.
   *
   * OpenAI's response shape is `{ data: [{ id, object, owned_by, created }] }`.
   * Most OpenAI-compatible providers (OpenRouter, Groq, Together, etc.) follow
   * the same shape but add extra fields like `pricing` (OpenRouter) or
   * `context_length` (some). This implementation conservatively extracts
   * what's reliably present and applies heuristics for free-model detection.
   */
  async discoverModels(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<readonly ModelDescriptor[]> {
    try {
      const apiKey = this.getApiKey(endpoint);
      const url = this.resolveModelsUrl(endpoint);
      const raw = await fetchJson<OpenAIModelsResponse>(url, {
        method: 'GET',
        headers: this.headers(endpoint, apiKey),
      }, endpoint, signal);
      const now = Date.now();
      return (raw.data ?? []).map((m) => {
        const id = m.id;
        const extra = m as OpenAIModelExtra;
        // OpenRouter exposes pricing per-token in its /models response.
        const inputPer1M = extra.pricing?.prompt != null
          ? Number(extra.pricing.prompt) * 1_000_000
          : undefined;
        const outputPer1M = extra.pricing?.completion != null
          ? Number(extra.pricing.completion) * 1_000_000
          : undefined;
        // A model is "free" if:
        //  1. Its id has a known free suffix (`:free` OpenRouter, `-free`
        //     OpenCode Zen / NVIDIA, `_free` …), OR
        //  2. The provider exposes per_request_rate = 0 / pricing.prompt = "0"
        const livePricing = {
          inputPer1M,
          outputPer1M,
          isFree: hasFreeSuffix(id)
            || (extra.pricing?.prompt === '0' && extra.pricing?.completion === '0')
            || extra.per_request_rate === 0,
          currency: 'USD',
          // Live provider API metadata wins only when it actually carried
          // pricing; otherwise the source is genuinely unknown.
          source: (extra.pricing != null ? 'live' : 'unknown') as 'live' | 'unknown',
          updatedAt: now,
        };
        const classification = classifyPricing(livePricing);

        return {
          id,
          providerId: this.providerId,
          displayName: id,
          contextWindow:
            extra.context_window ??
            extra.context_length ??
            extra.max_context_length ??
            extra.max_input_tokens ??
            extra.contextLength ??
            extra.maxContextLength ??
            extra.max_model_len ??
            undefined,
          pricing: {
            ...livePricing,
            isFree: classification.isFree,
            freeTier: classification.freeTier,
          },
          capabilities: this.inferCapabilities(id),
          discoveredAt: now,
        } as ModelDescriptor;
      });
    } catch (err) {
      // Do NOT swallow: the registry's refresh() records per-endpoint errors
      // in lastErrors and continues. Silent `return []` made discovery
      // failures invisible (NVIDIA NIM showed 0 models with no error), so
      // agent model pickers never populated.
      throw new Error(`Model discovery failed for ${endpoint.providerId} (${this.resolveBase(endpoint)}): ${(err as Error).message}`, { cause: err });
    }
  }

  /**
   * Heuristic capability inference from model id. Provider metadata is
   * authoritative when present; this is a fallback for providers that
   * don't expose capability flags in their /models response.
   */
  protected inferCapabilities(modelId: string): ModelDescriptor['capabilities'] {
    const lower = modelId.toLowerCase();
    return {
      streaming: true, // OpenAI-compatible providers all stream
      toolCalling: !lower.includes('instruct') && !lower.includes('base'),
      vision: lower.includes('vision') || lower.includes('gpt-4o') || lower.includes('claude-3'),
      audio: false,
      speech: lower.includes('tts'),
      embeddings: lower.includes('embedding') || lower.includes('embed'),
      reasoning: lower.includes('o1') || lower.includes('o3') || lower.includes('reasoning') || lower.includes('thinking'),
      jsonMode: !lower.includes('instruct'),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hooks for subclasses
  // ─────────────────────────────────────────────────────────────────────────

  protected resolveModelsUrl(endpoint: ProviderEndpoint): string {
    const base = this.resolveBase(endpoint);
    return `${base}/models`;
  }

  protected resolveBase(endpoint: ProviderEndpoint): string {
    let base = (endpoint.baseUrl || this.apiBase).trim().replace(/\/+$/, '');
    if (base.endsWith('/models')) {
      base = base.replace(/\/models$/, '');
    }
    return base;
  }

  protected getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    const fromEnv = process.env[this.apiKeyEnv];
    if (!fromEnv) {
      throw new ProviderResponseError(endpoint.id, 401, `Missing API key for ${this.providerId}`, {
        envVar: this.apiKeyEnv,
      });
    }
    return fromEnv;
  }

  protected headers(endpoint: ProviderEndpoint, apiKey: string): Record<string, string> {
    const h = buildHeaders(endpoint, apiKey);
    if (this.authHeaderName !== 'Authorization') {
      delete h['Authorization'];
    }
    h[this.authHeaderName] = `${this.authHeaderPrefix}${apiKey}`;
    return h;
  }

  protected translateRequest(req: ChatCompletionRequest, streaming: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      // Upstream OpenAI-compatible services accept bare model names only.
      // Strip gateway routing prefixes (e.g. `anthropic/opencode/deepseek-v4-flash-free`
      // -> `deepseek-v4-flash-free`) so adapters like NVIDIA NIM don't 404 on
      // prefixed ids. Idempotent when OpenAICompatibleAdapter pre-strips too.
      model: req.model.replace(/^anthropic\//, '').replace(/^opencode(?:-zen|-go)?\//, ''),
      // Map core camelCase / OpenAI snake_case messages to the OpenAI wire format.
      // Inbound messages may originate from Anthropic bridge (camelCase) or
      // directly from OpenAI clients like Hermes (snake_case). Handle both.
      messages: req.messages.map((m) => {
        const toolCallId = m.toolCallId ?? m.tool_call_id;
        const toolCalls = m.toolCalls ?? m.tool_calls;
        const reasoningContent = m.reasoningContent ?? m.reasoning_content;
        return {
          role: m.role,
          content: m.content ?? '',
          ...(toolCallId ? { tool_call_id: toolCallId } : {}),
          ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        };
      }),
      stream: streaming,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.n !== undefined) body.n = req.n;
    if (req.stop !== undefined) body.stop = req.stop;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.maxOutputTokens !== undefined) body.max_tokens = req.maxOutputTokens;
    if (req.presencePenalty !== undefined) body.presence_penalty = req.presencePenalty;
    if (req.frequencyPenalty !== undefined) body.frequency_penalty = req.frequencyPenalty;
    if (req.logitBias !== undefined) body.logit_bias = req.logitBias;
    // `user` MUST be a plain string (end-user id) per the OpenAI/Mistral spec.
    // The inbound Anthropic request can carry `metadata.user_id` as a JSON
    // *string* of an object (e.g. opencode.ai/zen free-tier telemetry:
    // {device_id, account_uuid, session_id}). Forwarding that verbatim gets
    // rejected upstream with HTTP 422 "extra_forbidden" by strict schemas
    // (Mistral). Only forward a clean plain string, and only when the upstream
    // actually accepts the field (Mistral sets supportsUserField=false).
    if (this.supportsUserField && typeof req.user === 'string' && !req.user.trim().startsWith('{')) {
      body.user = req.user;
    }
    if (req.tools !== undefined) body.tools = req.tools;
    if (req.toolChoice !== undefined) body.tool_choice = req.toolChoice;
    if (req.responseFormat !== undefined) body.response_format = req.responseFormat;
    if (req.seed !== undefined) body.seed = req.seed;
    if (streaming && req.streamOptions !== undefined) body.stream_options = req.streamOptions;
    return body;
  }

  protected translateResponse(raw: OpenAIChatResponse, endpoint: ProviderEndpoint): ChatCompletionResponse {
    return {
      id: raw.id,
      object: 'chat.completion',
      created: raw.created,
      model: raw.model,
      choices: raw.choices.map((c) => ({
        index: c.index,
        message: {
          role: c.message.role,
          content: c.message.content,
          tool_calls: c.message.tool_calls,
          ...(c.message.reasoning_content ? { reasoningContent: c.message.reasoning_content } : {}),
        },
        finish_reason: c.finish_reason,
        logprobs: c.logprobs,
      })) as never,
      usage: normalizeUsage(raw.usage),
      systemFingerprint: raw.system_fingerprint,
      provider: this.providerId,
      endpoint: endpoint.id,
      latencyMs: 0,
    };
  }

  protected translateChunk(raw: Record<string, unknown>): ChatCompletionChunk | null {
    if (!raw['id'] || !raw['choices']) return null;
    const choices = (raw['choices'] as Array<Record<string, unknown>>).map((c) => ({
      index: c['index'] as number,
      delta: {
        ...((c['delta'] ?? {}) as {
          role?: string;
          content?: string;
          tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
        }),
        reasoning: ((c['delta'] ?? {}) as Record<string, unknown>)['reasoning_content'] as string | undefined,
      },
      finish_reason: (c['finish_reason'] as string | null) ?? null,
    }));
    return {
      id: raw['id'] as string,
      object: 'chat.completion.chunk',
      created: raw['created'] as number,
      model: raw['model'] as string,
      choices,
      usage: raw['usage'] as ChatCompletionChunk['usage'],
      systemFingerprint: raw['system_fingerprint'] as string | undefined,
    };
  }
}

/**
 * Upstream OpenAI-compatible APIs commonly return snake_case usage
 * (prompt_tokens/completion_tokens/total_tokens). Normalize to the internal
 * camelCase shape, coercing missing/NaN fields to finite numbers so token
 * accounting can never poison the KeyRegistry with NaN (JSON null).
 */
function normalizeUsage(u: OpenAIChatResponse['usage']): { promptTokens: number; completionTokens: number; totalTokens: number } {
  const src = (u ?? {}) as unknown as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const promptTokens = num(src['promptTokens'] ?? src['prompt_tokens']);
  const completionTokens = num(src['completionTokens'] ?? src['completion_tokens']);
  const totalTokens = num(src['totalTokens'] ?? src['total_tokens']) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null; tool_calls?: unknown[]; reasoning_content?: string };
    finish_reason: string;
    logprobs?: unknown;
  }>;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  system_fingerprint?: string;
}

interface OpenAIEmbeddingResponse {
  object: 'list';
  data: Array<{ object: 'embedding'; index: number; embedding: number[] }>;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/**
 * Generate a synthetic chunk (used by tests and by adapters that don't
 * natively support streaming — they call chatCompletion and emit one chunk).
 */
export function syntheticChunk(content: string, model: string): ChatCompletionChunk {
  return {
    id: randomUUID(),
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  };
}

// ─── Models discovery response shapes ──────────────────────────────────────

interface OpenAIModelsResponse {
  object?: 'list';
  data?: Array<{ id: string; object?: string; owned_by?: string; created?: number }>;
}

/**
 * Extra fields some OpenAI-compatible providers expose on /models entries.
 * OpenRouter: `pricing.prompt` / `pricing.completion` are strings (USD per token).
 * Others: `context_length` (Groq, Together), `per_request_rate`.
 */
interface OpenAIModelExtra {
  context_length?: number;
  context_window?: number;
  max_context_length?: number;
  max_input_tokens?: number;
  contextLength?: number;
  maxContextLength?: number;
  max_model_len?: number;
  per_request_rate?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
    image?: string;
  };
}

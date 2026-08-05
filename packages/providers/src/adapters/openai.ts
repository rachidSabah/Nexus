import { randomUUID } from 'node:crypto';

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ProviderEndpoint,
} from '@anx/core';
import { ProviderResponseError, type ProviderAdapter } from '@anx/core';

import { buildHeaders, fetchJson, parseSseStream } from '../shared/http.js';

/**
 * OpenAI provider adapter. Also serves as the base class for any
 * OpenAI-compatible provider (DeepSeek, OpenRouter, Together, Groq, vLLM,
 * LM Studio, LiteLLM, Cerebras, Fireworks, …) — they only override
 * `baseUrl` defaults and a few header quirks.
 */
export class OpenAIAdapter implements ProviderAdapter {
  readonly providerId = 'openai';
  readonly displayName = 'OpenAI';

  protected apiBase = 'https://api.openai.com/v1';
  protected authHeaderName = 'Authorization';
  protected authHeaderPrefix = 'Bearer ';
  protected apiKeyEnv = 'OPENAI_API_KEY';

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
    const body = {
      model: request.model,
      input: request.input,
      dimensions: request.dimensions,
      encoding_format: request.encodingFormat ?? 'float',
      user: request.user,
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

  // ─────────────────────────────────────────────────────────────────────────
  // Hooks for subclasses
  // ─────────────────────────────────────────────────────────────────────────

  protected resolveBase(endpoint: ProviderEndpoint): string {
    return endpoint.baseUrl || this.apiBase;
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
      model: req.model,
      messages: req.messages,
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
    if (req.user !== undefined) body.user = req.user;
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
        message: c.message,
        finish_reason: c.finish_reason,
        logprobs: c.logprobs,
      })),
      usage: raw.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
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
      delta: (c['delta'] ?? {}) as {
        role?: string;
        content?: string;
        tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
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

interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string | null; tool_calls?: unknown[] };
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

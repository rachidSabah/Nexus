import { randomUUID } from 'node:crypto';

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderEndpoint,
} from '@anx/core';
import { ProviderResponseError, type ProviderAdapter } from '@anx/core';

import { parseSseStream } from '../shared/http.js';

/**
 * Anthropic Messages API adapter.
 *
 * Translates OpenAI-compatible requests to Anthropic's Messages format and
 * translates Anthropic's response shape back to OpenAI-compatible.
 *
 * This is the canonical translation — it does NOT use any undocumented APIs
 * and respects Anthropic's required `anthropic-version` header.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly providerId = 'anthropic';
  readonly displayName = 'Anthropic';

  protected apiBase = 'https://api.anthropic.com';
  protected apiVersion = '2023-06-01';

  resolveModel(alias: string): string | undefined {
    // Map common OpenAI-style aliases to Anthropic models.
    const map: Record<string, string> = {
      'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
      'claude-3-opus': 'claude-3-opus-20240229',
      'claude-3-sonnet': 'claude-3-sonnet-20240229',
      'claude-3-haiku': 'claude-3-haiku-20240307',
    };
    return map[alias] ?? alias;
  }

  async chatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const apiKey = this.getApiKey(endpoint);
    const url = `${this.resolveBase(endpoint)}/v1/messages`;
    const body = this.translateRequest(request, false);

    const raw = await this.fetchAnthropic<AnthropicMessageResponse>(
      url,
      endpoint,
      apiKey,
      body,
      signal,
    );
    return this.translateResponse(raw, endpoint, request.model);
  }

  async *streamChatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk> {
    const apiKey = this.getApiKey(endpoint);
    const url = `${this.resolveBase(endpoint)}/v1/messages`;
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
      throw new ProviderResponseError(endpoint.id, 0, 'No body', { url });
    }

    for await (const evt of parseSseStream(response.body)) {
      const chunk = this.translateStreamEvent(evt, request.model);
      if (chunk) yield chunk;
    }
  }

  async healthCheck(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<boolean> {
    try {
      const apiKey = this.getApiKey(endpoint);
      // Anthropic doesn't have a public /models endpoint; do a tiny message.
      await this.fetchAnthropic<AnthropicMessageResponse>(
        `${this.resolveBase(endpoint)}/v1/messages`,
        endpoint,
        apiKey,
        {
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        },
        signal,
      );
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Translation
  // ─────────────────────────────────────────────────────────────────────────

  protected resolveBase(endpoint: ProviderEndpoint): string {
    return endpoint.baseUrl || this.apiBase;
  }

  protected getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    const fromEnv = process.env['ANTHROPIC_API_KEY'];
    if (!fromEnv) {
      throw new ProviderResponseError(endpoint.id, 401, 'Missing ANTHROPIC_API_KEY');
    }
    return fromEnv;
  }

  protected headers(endpoint: ProviderEndpoint, apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': this.apiVersion,
      'User-Agent': 'agent-nexus-gateway/0.1.0',
    };
  }

  protected translateRequest(req: ChatCompletionRequest, streaming: boolean): Record<string, unknown> {
    // Anthropic separates system message from conversation.
    const systemMessages = req.messages.filter((m) => m.role === 'system');
    const conversation = req.messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: this.resolveModel(req.model) ?? req.model,
      messages: conversation.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      max_tokens: req.maxTokens ?? req.maxOutputTokens ?? 4096,
      stream: streaming,
    };

    if (systemMessages.length > 0) {
      const systemText = systemMessages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n\n');
      body['system'] = systemText;
    }

    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.topP !== undefined) body['top_p'] = req.topP;
    if (req.stop !== undefined) body['stop_sequences'] = Array.isArray(req.stop) ? req.stop : [req.stop];
    if (req.tools !== undefined) {
      body['tools'] = (req.tools as Array<{ function?: { name: string; description?: string; parameters?: unknown } }>)
        .filter((t) => t.function)
        .map((t) => ({
          name: t.function!.name,
          description: t.function!.description,
          input_schema: t.function!.parameters,
        }));
    }
    if (req.toolChoice !== undefined) {
      if (req.toolChoice === 'auto') body['tool_choice'] = { type: 'auto' };
      else if (req.toolChoice === 'none') body['tool_choice'] = { type: 'none' };
      else if (typeof req.toolChoice === 'object')
        body['tool_choice'] = { type: 'tool', name: (req.toolChoice as { function?: { name: string } }).function?.name };
    }

    return body;
  }

  protected translateResponse(
    raw: AnthropicMessageResponse,
    endpoint: ProviderEndpoint,
    requestModel: string,
  ): ChatCompletionResponse {
    const content = (raw.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return {
      id: raw.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: raw.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: raw.stop_reason === 'end_turn' ? 'stop' : (raw.stop_reason ?? 'stop'),
        },
      ],
      usage: {
        promptTokens: raw.usage?.input_tokens ?? 0,
        completionTokens: raw.usage?.output_tokens ?? 0,
        totalTokens: (raw.usage?.input_tokens ?? 0) + (raw.usage?.output_tokens ?? 0),
        cachedTokens: raw.usage?.cache_read_input_tokens,
      },
      provider: this.providerId,
      endpoint: endpoint.id,
      latencyMs: 0,
    };
  }

  protected translateStreamEvent(
    evt: Record<string, unknown>,
    requestModel: string,
  ): ChatCompletionChunk | null {
    const type = evt['type'] as string | undefined;
    if (!type) return null;

    if (type === 'content_block_delta') {
      const delta = evt['delta'] as { type: string; text?: string } | undefined;
      if (delta?.type === 'text_delta' && delta.text) {
        return {
          id: randomUUID(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: requestModel,
          choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
        };
      }
    }
    if (type === 'message_stop') {
      return {
        id: randomUUID(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: requestModel,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
    }
    return null;
  }

  protected async fetchAnthropic<T>(
    url: string,
    endpoint: ProviderEndpoint,
    apiKey: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(endpoint.timeoutMs);
    const onAbort = () => controller.abort();
    timeout.addEventListener('abort', onAbort, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers(endpoint, apiKey),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ProviderResponseError(endpoint.id, response.status, text, { url });
      }
      return (await response.json()) as T;
    } finally {
      timeout.removeEventListener('abort', onAbort);
      signal.removeEventListener('abort', onAbort);
    }
  }
}

interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<{ type: 'text'; text: string }>;
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
}

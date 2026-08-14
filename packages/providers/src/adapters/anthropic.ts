import { randomUUID } from 'node:crypto';

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessageContentPart,
  ModelDescriptor,
  ProviderEndpoint,
  ToolCall,
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
  providerId = 'anthropic';
  displayName = 'Anthropic';

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

  /**
   * Anthropic exposes `GET /v1/models` since 2024. Returns the canonical
   * model list with ids like "claude-3-5-sonnet-20241022".
   */
  async discoverModels(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<readonly ModelDescriptor[]> {
    try {
      const apiKey = this.getApiKey(endpoint);
      const url = `${this.resolveBase(endpoint)}/v1/models`;
      const controller = new AbortController();
      const timeout = AbortSignal.timeout(endpoint.timeoutMs);
      const onAbort = () => controller.abort();
      timeout.addEventListener('abort', onAbort, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const r = await fetch(url, {
          method: 'GET',
          headers: this.headers(endpoint, apiKey),
          signal: controller.signal,
        });
        if (!r.ok) return [];
        const body = (await r.json()) as { data?: Array<{ id: string; display_name?: string; created_at?: string; type?: string }>; };
        const now = Date.now();
        return (body.data ?? []).map((m) => ({
          id: m.id,
          providerId: this.providerId,
          displayName: m.display_name ?? m.id,
          contextWindow: this.contextWindowFor(m.id),
          maxOutputTokens: 8192,
          pricing: { isFree: false, currency: 'USD', source: 'adapter_fallback' as const, updatedAt: Date.now(), freeTier: 'UNKNOWN' as const },
          capabilities: {
            streaming: true,
            toolCalling: true,
            vision: m.id.includes('sonnet') || m.id.includes('opus') || m.id.includes('haiku'),
            audio: false,
            speech: false,
            embeddings: false,
            reasoning: m.id.includes('opus') || m.id.includes('thinking'),
            jsonMode: true,
          },
          discoveredAt: now,
        } as ModelDescriptor));
      } finally {
        timeout.removeEventListener('abort', onAbort);
        signal.removeEventListener('abort', onAbort);
      }
    } catch (err) {
      // Do NOT swallow: the registry's refresh() records per-endpoint errors
      // in lastErrors and continues. Silent `return []` hid discovery failures.
      throw new Error(`Model discovery failed for ${endpoint.providerId}: ${(err as Error).message}`, { cause: err });
    }
  }

  /** Heuristic context window lookup for known Claude models. */
  private contextWindowFor(modelId: string): number | undefined {
    const lower = modelId.toLowerCase();
    if (lower.includes('opus')) return 200_000;
    if (lower.includes('sonnet')) return 200_000;
    if (lower.includes('haiku')) return 200_000;
    return undefined;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Translation
  // ─────────────────────────────────────────────────────────────────────────

  protected resolveBase(endpoint: ProviderEndpoint): string {
    let base = (endpoint.baseUrl || this.apiBase).trim().replace(/\/+$/, '');
    if (base.endsWith('/v1')) {
      base = base.substring(0, base.length - 3);
    }
    return base;
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

  protected headers(_endpoint: ProviderEndpoint, apiKey: string): Record<string, string> {
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
      messages: conversation.map((m) => this.translateMessage(m)),
      max_tokens: req.maxTokens ?? req.maxOutputTokens ?? 4096,
      stream: streaming,
    };

    if (systemMessages.length > 0) {
      const systemText = systemMessages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n\n');
      // Use Anthropic's prompt caching (cache_control) for the system prompt.
      // This caches the system prompt for 5 minutes, reducing cost by ~90%
      // on repeat requests with the same system prompt (common for coding agents
      // like Claude Code that send the same 2000-token system prompt every request).
      body['system'] = [
        { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
      ];
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

  /**
   * Translates an OpenAI-format message into Anthropic's Messages format.
   *
   * Key translations:
   *  - User/system text content → Anthropic `content: string` (simple case)
   *  - Multimodal content (array of parts) → Anthropic content blocks:
   *      { type: 'text', text }
   *      { type: 'image', source: { type: 'base64', media_type, data } }
   *  - Assistant tool_calls → Anthropic content blocks:
   *      { type: 'text', text }
   *      { type: 'tool_use', id, name, input }
   *  - Tool result messages (role: 'tool') → Anthropic user messages with:
   *      { type: 'tool_result', tool_use_id, content }
   */
  private translateMessage(m: {
    role: string;
    content: string | Array<ChatMessageContentPart>;
    toolCallId?: string;
    toolCalls?: readonly ToolCall[];
  }): { role: string; content: unknown } {
    // Tool result messages: role='tool', toolCallId set.
    // Anthropic expects these as user messages with a tool_result content block.
    if (m.role === 'tool' && m.toolCallId) {
      const resultText = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: resultText,
          },
        ],
      };
    }

    // Assistant messages with tool_calls: emit text + tool_use blocks.
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: unknown[] = [];
      // Include any text content first.
      const text = typeof m.content === 'string' ? m.content : '';
      if (text) {
        blocks.push({ type: 'text', text });
      }
      for (const tc of m.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = { raw: tc.function.arguments };
        }
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      return { role: 'assistant', content: blocks };
    }

    // Plain text content — Anthropic accepts a string.
    if (typeof m.content === 'string') {
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      };
    }

    // Multimodal content — translate each part.
    const blocks: unknown[] = [];
    for (const part of m.content) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'image_url') {
        const { url } = part.image_url;
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: match[1],
              data: match[2],
            },
          });
        }
        // Remote URLs require Anthropic's `url` source type (newer API feature).
        // Skip for now; could add `{ type: 'image', source: { type: 'url', url } }` later.
      } else if (part.type === 'input_audio') {
        // Anthropic doesn't currently support audio in the Messages API;
        // skip silently.
      }
    }
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: blocks,
    };
  }

  protected translateResponse(
    raw: AnthropicMessageResponse,
    endpoint: ProviderEndpoint,
    _requestModel: string,
  ): ChatCompletionResponse {
    // Extract text from text blocks.
    const text = (raw.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');

    // Extract tool_use blocks → OpenAI tool_calls.
    const toolCalls: ToolCall[] = (raw.content ?? [])
      .filter((b) => b.type === 'tool_use')
      .map((b, i) => ({
        id: b.id ?? `call_${i}`,
        type: 'function' as const,
        function: {
          name: b.name ?? '',
          arguments: JSON.stringify(b.input ?? {}),
        },
      }));

    const message: { role: 'assistant'; content: string; tool_calls?: readonly ToolCall[] } = {
      role: 'assistant',
      content: text,
    };
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id: raw.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: raw.model,
      choices: [
        {
          index: 0,
          message,
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

    if (type === 'content_block_start') {
      // A new content block is starting. If it's a tool_use block, emit a
      // tool_call delta with the tool name + empty args.
      const contentBlock = evt['content_block'] as
        | { type: string; id?: string; name?: string; text?: string }
        | undefined;
      if (contentBlock?.type === 'tool_use' && contentBlock.id && contentBlock.name) {
        return {
          id: randomUUID(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: requestModel,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                id: contentBlock.id,
                type: 'function',
                function: { name: contentBlock.name, arguments: '' },
              }],
            },
            finish_reason: null,
          }],
        };
      }
      if (contentBlock?.type === 'text' && contentBlock.text) {
        return {
          id: randomUUID(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: requestModel,
          choices: [{ index: 0, delta: { content: contentBlock.text }, finish_reason: null }],
        };
      }
      return null;
    }
    if (type === 'content_block_delta') {
      const delta = evt['delta'] as
        | { type: string; text?: string; partial_json?: string }
        | undefined;
      if (delta?.type === 'text_delta' && delta.text) {
        return {
          id: randomUUID(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: requestModel,
          choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
        };
      }
      // input_json_delta: incremental JSON for the current tool_use block.
      // Emit as a tool_calls arguments delta (index 0 — we don't track which block).
      if (delta?.type === 'input_json_delta' && delta.partial_json) {
        return {
          id: randomUUID(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: requestModel,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                id: 'pending',
                type: 'function',
                function: { name: '', arguments: delta.partial_json },
              }],
            },
            finish_reason: null,
          }],
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
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
}

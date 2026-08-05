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
 * Google Gemini adapter — uses the official Generative Language API.
 *
 * Translates OpenAI-compatible requests to Gemini's `generateContent` /
 * `streamGenerateContent` shape and back.
 */
export class GoogleAdapter implements ProviderAdapter {
  readonly providerId = 'google';
  readonly displayName = 'Google Gemini';

  protected apiBase = 'https://generativelanguage.googleapis.com/v1beta';

  resolveModel(alias: string): string | undefined {
    const map: Record<string, string> = {
      'gemini-pro': 'gemini-1.5-pro',
      'gemini-1.5-pro': 'gemini-1.5-pro-latest',
      'gemini-1.5-flash': 'gemini-1.5-flash-latest',
      'gemini-2.0-flash': 'gemini-2.0-flash-exp',
    };
    return map[alias] ?? alias;
  }

  async chatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const apiKey = this.getApiKey(endpoint);
    const model = this.resolveModel(request.model) ?? request.model;
    const url = `${this.resolveBase(endpoint)}/models/${model}:generateContent?key=${apiKey}`;
    const body = this.translateRequest(request);

    const raw = await this.fetchJson<GoogleGenerateResponse>(url, endpoint, body, signal);
    return this.translateResponse(raw, endpoint, request.model);
  }

  async *streamChatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk> {
    const apiKey = this.getApiKey(endpoint);
    const model = this.resolveModel(request.model) ?? request.model;
    const url = `${this.resolveBase(endpoint)}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const body = this.translateRequest(request);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      const url = `${this.resolveBase(endpoint)}/models?key=${apiKey}`;
      const controller = new AbortController();
      const timeout = AbortSignal.timeout(endpoint.timeoutMs);
      const onAbort = () => controller.abort();
      timeout.addEventListener('abort', onAbort, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const r = await fetch(url, { signal: controller.signal });
        return r.ok;
      } finally {
        timeout.removeEventListener('abort', onAbort);
        signal.removeEventListener('abort', onAbort);
      }
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  protected resolveBase(endpoint: ProviderEndpoint): string {
    return endpoint.baseUrl || this.apiBase;
  }

  protected getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    const fromEnv = process.env['GOOGLE_API_KEY'] ?? process.env['GEMINI_API_KEY'];
    if (!fromEnv) {
      throw new ProviderResponseError(endpoint.id, 401, 'Missing GOOGLE_API_KEY');
    }
    return fromEnv;
  }

  protected translateRequest(req: ChatCompletionRequest): Record<string, unknown> {
    const systemMessages = req.messages.filter((m) => m.role === 'system');
    const conversation = req.messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      contents: conversation.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
      })),
    };

    if (systemMessages.length > 0) {
      body['systemInstruction'] = {
        parts: [{ text: systemMessages.map((m) => m.content).join('\n\n') }],
      };
    }

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig['temperature'] = req.temperature;
    if (req.topP !== undefined) generationConfig['topP'] = req.topP;
    if (req.maxTokens !== undefined || req.maxOutputTokens !== undefined) {
      generationConfig['maxOutputTokens'] = req.maxTokens ?? req.maxOutputTokens;
    }
    if (req.stop !== undefined) {
      generationConfig['stopSequences'] = Array.isArray(req.stop) ? req.stop : [req.stop];
    }
    if (Object.keys(generationConfig).length > 0) body['generationConfig'] = generationConfig;

    return body;
  }

  protected translateResponse(
    raw: GoogleGenerateResponse,
    endpoint: ProviderEndpoint,
    requestModel: string,
  ): ChatCompletionResponse {
    const text = (raw.candidates ?? [])
      .flatMap((c) => c.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
    const finishReason = raw.candidates?.[0]?.finishReason ?? 'STOP';

    return {
      id: randomUUID(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: finishReason === 'STOP' ? 'stop' : finishReason.toLowerCase(),
        },
      ],
      usage: {
        promptTokens: raw.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: raw.usageMetadata?.totalTokenCount ?? 0,
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
    const candidates = evt['candidates'] as
      | Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
      | undefined;
    if (!candidates?.length) return null;

    const text = (candidates[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('');
    if (!text && !candidates[0]?.finishReason) return null;

    return {
      id: randomUUID(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [
        {
          index: 0,
          delta: text ? { content: text } : {},
          finish_reason: candidates[0]?.finishReason
            ? candidates[0].finishReason.toLowerCase()
            : null,
        },
      ],
    };
  }

  protected async fetchJson<T>(
    url: string,
    endpoint: ProviderEndpoint,
    body: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(endpoint.timeoutMs);
    const onAbort = () => controller.abort();
    timeout.addEventListener('abort', onAbort, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ProviderResponseError(endpoint.id, r.status, text, { url });
      }
      return (await r.json()) as T;
    } finally {
      timeout.removeEventListener('abort', onAbort);
      signal.removeEventListener('abort', onAbort);
    }
  }
}

interface GoogleGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

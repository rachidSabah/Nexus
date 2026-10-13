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

interface VertexGenerateResponse {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: Array<{
        text?: string;
        functionCall?: { name: string; args: Record<string, unknown> };
      }>;
    };
    finishReason?: string;
    index?: number;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface VertexClaudeResponse {
  id?: string;
  type?: string;
  role?: string;
  content?: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Google Cloud Vertex AI provider adapter.
 *
 * Supports both Google models (Gemini 1.5/2.0/2.5) and Partner models (Anthropic Claude on Vertex AI)
 * with full streaming, tool calling, and usage accounting parity.
 */
export class VertexAIAdapter implements ProviderAdapter {
  providerId = 'vertex-ai';
  displayName = 'Google Cloud Vertex AI';

  resolveModel(alias: string): string | undefined {
    const bare = alias.startsWith('vertex/') || alias.startsWith('vertex-ai/')
      ? alias.replace(/^vertex(-ai)?\//, '')
      : alias;
    const norm = bare.toLowerCase().trim();

    // Map common aliases to canonical Vertex AI model resource names
    const map: Record<string, string> = {
      'gemini-pro': 'gemini-1.5-pro-002',
      'gemini-1.5-pro': 'gemini-1.5-pro-002',
      'gemini-flash': 'gemini-1.5-flash-002',
      'gemini-1.5-flash': 'gemini-1.5-flash-002',
      'gemini-2.0-flash': 'gemini-2.0-flash-001',
      'gemini-2.0-flash-exp': 'gemini-2.0-flash-001',
      'gemini-2.5-flash': 'gemini-2.5-flash',
      'gemini-2.5-pro': 'gemini-2.5-pro',
      'claude-3-5-sonnet': 'claude-3-5-sonnet-v2@20241022',
      'claude-3-5-sonnet-v2': 'claude-3-5-sonnet-v2@20241022',
      'claude-3-7-sonnet': 'claude-3-7-sonnet@20250219',
      'claude-3-5-haiku': 'claude-3-5-haiku@20241022',
      'claude-3-haiku': 'claude-3-haiku@20240307',
      'claude-3-opus': 'claude-3-opus@20240229',
    };

    if (map[norm]) return map[norm];
    return bare;
  }

  async chatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const model = this.resolveModel(request.model) ?? request.model;
    const isClaude = this.isClaudeModel(model);

    if (isClaude) {
      return this.chatCompletionClaude(endpoint, model, request, signal);
    }
    return this.chatCompletionGemini(endpoint, model, request, signal);
  }

  async *streamChatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk> {
    const model = this.resolveModel(request.model) ?? request.model;
    const isClaude = this.isClaudeModel(model);

    if (isClaude) {
      yield* this.streamChatCompletionClaude(endpoint, model, request, signal);
    } else {
      yield* this.streamChatCompletionGemini(endpoint, model, request, signal);
    }
  }

  async healthCheck(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<boolean> {
    try {
      const { projectId, region, token } = this.getCredentials(endpoint);
      const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/gemini-1.5-flash-002`;
      const r = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      // 200 OK or 404 (model not found but authenticated) confirms reachability/auth
      return r.status === 200 || r.status === 404;
    } catch {
      return false;
    }
  }

  async discoverModels(_endpoint: ProviderEndpoint, _signal: AbortSignal): Promise<readonly ModelDescriptor[]> {
    const now = Date.now();
    const vertexModels = [
      { id: 'gemini-2.0-flash-001', displayName: 'Gemini 2.0 Flash (Vertex AI)', context: 1048576, maxOut: 8192 },
      { id: 'gemini-1.5-pro-002', displayName: 'Gemini 1.5 Pro (Vertex AI)', context: 2097152, maxOut: 8192 },
      { id: 'gemini-1.5-flash-002', displayName: 'Gemini 1.5 Flash (Vertex AI)', context: 1048576, maxOut: 8192 },
      { id: 'claude-3-5-sonnet-v2@20241022', displayName: 'Claude 3.5 Sonnet v2 (Vertex AI)', context: 200000, maxOut: 8192 },
      { id: 'claude-3-7-sonnet@20250219', displayName: 'Claude 3.7 Sonnet (Vertex AI)', context: 200000, maxOut: 8192 },
      { id: 'claude-3-5-haiku@20241022', displayName: 'Claude 3.5 Haiku (Vertex AI)', context: 200000, maxOut: 8192 },
    ];

    return vertexModels.map((m) => ({
      id: m.id,
      providerId: this.providerId,
      displayName: m.displayName,
      contextWindow: m.context,
      maxOutputTokens: m.maxOut,
      pricing: { isFree: false, currency: 'USD', source: 'adapter_fallback' as const, updatedAt: now, freeTier: 'UNKNOWN' as const },
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        audio: m.id.includes('gemini'),
        speech: false,
        embeddings: false,
        reasoning: m.id.includes('3-7') || m.id.includes('pro'),
        jsonMode: true,
      },
      discoveredAt: now,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Gemini on Vertex AI Implementation
  // ─────────────────────────────────────────────────────────────────────────

  private async chatCompletionGemini(
    endpoint: ProviderEndpoint,
    model: string,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const { projectId, region, token, baseUrl } = this.getCredentials(endpoint);
    const host = baseUrl || `https://${region}-aiplatform.googleapis.com`;
    const url = `${host}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;

    const body = this.translateRequestToGemini(request);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new ProviderResponseError(endpoint.id, r.status, text, { url });
    }

    const raw = (await r.json()) as VertexGenerateResponse;
    return this.translateGeminiResponse(raw, endpoint, request.model);
  }

  private async *streamChatCompletionGemini(
    endpoint: ProviderEndpoint,
    model: string,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk> {
    const { projectId, region, token, baseUrl } = this.getCredentials(endpoint);
    const host = baseUrl || `https://${region}-aiplatform.googleapis.com`;
    const url = `${host}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:streamGenerateContent?alt=sse`;

    const body = this.translateRequestToGemini(request);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new ProviderResponseError(endpoint.id, r.status, text, { url });
    }
    if (!r.body) {
      throw new ProviderResponseError(endpoint.id, 0, 'No body in streaming response', { url });
    }

    for await (const evt of parseSseStream(r.body)) {
      const chunk = this.translateGeminiStreamEvent(evt, request.model);
      if (chunk) yield chunk;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Claude on Vertex AI Implementation
  // ─────────────────────────────────────────────────────────────────────────

  private async chatCompletionClaude(
    endpoint: ProviderEndpoint,
    model: string,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const { projectId, region, token, baseUrl } = this.getCredentials(endpoint);
    const host = baseUrl || `https://${region}-aiplatform.googleapis.com`;
    const url = `${host}/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models/${model}:rawPredict`;

    const body = this.translateRequestToClaude(request, false);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new ProviderResponseError(endpoint.id, r.status, text, { url });
    }

    const raw = (await r.json()) as VertexClaudeResponse;
    return this.translateClaudeResponse(raw, endpoint, request.model);
  }

  private async *streamChatCompletionClaude(
    endpoint: ProviderEndpoint,
    model: string,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk> {
    const { projectId, region, token, baseUrl } = this.getCredentials(endpoint);
    const host = baseUrl || `https://${region}-aiplatform.googleapis.com`;
    const url = `${host}/v1/projects/${projectId}/locations/${region}/publishers/anthropic/models/${model}:streamRawPredict`;

    const body = this.translateRequestToClaude(request, true);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new ProviderResponseError(endpoint.id, r.status, text, { url });
    }
    if (!r.body) {
      throw new ProviderResponseError(endpoint.id, 0, 'No body in streaming response', { url });
    }

    for await (const evt of parseSseStream(r.body)) {
      const chunk = this.translateClaudeStreamEvent(evt, request.model);
      if (chunk) yield chunk;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Translators & Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private isClaudeModel(model: string): boolean {
    return model.toLowerCase().includes('claude');
  }

  private getCredentials(endpoint: ProviderEndpoint): {
    projectId: string;
    region: string;
    token: string;
    baseUrl?: string;
  } {
    const explicitKey = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    let token = process.env['VERTEX_API_KEY'] ?? process.env['GCP_ACCESS_TOKEN'] ?? process.env['GOOGLE_OAUTH_TOKEN'] ?? '';
    let projectId = process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['CLOUD_ML_PROJECT_ID'] ?? 'default-project';
    let region = (endpoint as ProviderEndpoint & { region?: string }).region ?? process.env['VERTEX_REGION'] ?? 'us-central1';

    if (explicitKey) {
      // Support apiKey in format "token" or "token:projectId:region"
      if (explicitKey.includes(':')) {
        const parts = explicitKey.split(':');
        token = parts[0] ?? token;
        if (parts[1]) projectId = parts[1];
        if (parts[2]) region = parts[2];
      } else {
        token = explicitKey;
      }
    }

    return {
      projectId,
      region,
      token,
      baseUrl: endpoint.baseUrl,
    };
  }

  private translateRequestToGemini(req: ChatCompletionRequest): Record<string, unknown> {
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
    let systemInstruction: { parts: Array<{ text: string }> } | undefined;

    for (const m of req.messages) {
      if (m.role === 'system') {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        systemInstruction = { parts: [{ text }] };
        continue;
      }

      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts: Array<Record<string, unknown>> = [];

      if (typeof m.content === 'string') {
        parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const p of m.content as ChatMessageContentPart[]) {
          if (p.type === 'text' && p.text) {
            parts.push({ text: p.text });
          } else if (p.type === 'image_url' && p.image_url?.url) {
            const url = p.image_url.url;
            if (url.startsWith('data:')) {
              const [mime, b64] = url.replace(/^data:/, '').split(';base64,');
              parts.push({ inlineData: { mimeType: mime, data: b64 } });
            }
          }
        }
      }

      contents.push({ role, parts });
    }

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body['systemInstruction'] = systemInstruction;

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig['temperature'] = req.temperature;
    if (req.topP !== undefined) generationConfig['topP'] = req.topP;
    if (req.maxTokens || req.maxOutputTokens) {
      generationConfig['maxOutputTokens'] = req.maxTokens ?? req.maxOutputTokens;
    }
    if (Object.keys(generationConfig).length > 0) {
      body['generationConfig'] = generationConfig;
    }

    if (req.tools && req.tools.length > 0) {
      body['tools'] = [{
        functionDeclarations: (req.tools as Array<{ function: { name: string; description?: string; parameters?: Record<string, unknown> } }>).map((t) => ({
          name: t.function.name,
          description: t.function.description ?? '',
          parameters: t.function.parameters ?? {},
        })),
      }];
    }

    return body;
  }

  private translateGeminiResponse(
    raw: VertexGenerateResponse,
    endpoint: ProviderEndpoint,
    requestModel: string,
  ): ChatCompletionResponse {
    const candidate = raw.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const p of parts) {
      if (p.text) text += p.text;
      if (p.functionCall) {
        toolCalls.push({
          id: `call_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
          type: 'function',
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args ?? {}),
          },
        });
      }
    }

    return {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: text || '',
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : (candidate?.finishReason?.toLowerCase() ?? 'stop'),
      }],

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

  private translateGeminiStreamEvent(
    evt: Record<string, unknown>,
    requestModel: string,
  ): ChatCompletionChunk | null {
    const candidates = evt['candidates'] as Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }> | undefined;

    if (!candidates?.length) return null;
    const text = candidates[0]?.content?.parts?.[0]?.text;
    const finish = candidates[0]?.finishReason;
    if (!text && !finish) return null;

    return {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [{
        index: 0,
        delta: text ? { content: text } : {},
        finish_reason: finish ? finish.toLowerCase() : null,
      }],
    };
  }

  private translateRequestToClaude(req: ChatCompletionRequest, stream: boolean): Record<string, unknown> {
    const messages: Array<{ role: string; content: string }> = [];
    let system = '';

    for (const m of req.messages) {
      if (m.role === 'system') {
        system += (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) + '\n';
      } else {
        messages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        });
      }
    }

    const body: Record<string, unknown> = {
      anthropic_version: 'vertex-2023-10-16',
      messages,
      max_tokens: req.maxTokens ?? req.maxOutputTokens ?? 4096,
      stream,
    };
    if (system.trim()) body['system'] = system.trim();
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.topP !== undefined) body['top_p'] = req.topP;
    if (req.tools) {
      body['tools'] = (req.tools as Array<{ function: { name: string; description?: string; parameters?: Record<string, unknown> } }>).map((t) => ({
        name: t.function.name,
        description: t.function.description ?? '',
        input_schema: t.function.parameters ?? {},
      }));
    }

    return body;
  }

  private translateClaudeResponse(
    raw: VertexClaudeResponse,
    endpoint: ProviderEndpoint,
    requestModel: string,
  ): ChatCompletionResponse {
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const c of raw.content ?? []) {
      if (c.type === 'text' && c.text) text += c.text;
      if (c.type === 'tool_use' && c.name) {
        toolCalls.push({
          id: c.id ?? `call_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
          type: 'function',
          function: {
            name: c.name,
            arguments: JSON.stringify(c.input ?? {}),
          },
        });
      }
    }

    return {
      id: raw.id ?? `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: text || '',
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : (raw.stop_reason ?? 'stop'),
      }],

      usage: {
        promptTokens: raw.usage?.input_tokens ?? 0,
        completionTokens: raw.usage?.output_tokens ?? 0,
        totalTokens: (raw.usage?.input_tokens ?? 0) + (raw.usage?.output_tokens ?? 0),
      },
      provider: this.providerId,
      endpoint: endpoint.id,
      latencyMs: 0,
    };
  }

  private translateClaudeStreamEvent(
    evt: Record<string, unknown>,
    requestModel: string,
  ): ChatCompletionChunk | null {
    const type = evt['type'] as string | undefined;
    if (type === 'content_block_delta') {
      const delta = evt['delta'] as { text?: string } | undefined;
      if (delta?.text) {
        return {
          id: `chatcmpl-${randomUUID()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: requestModel,
          choices: [{
            index: 0,
            delta: { content: delta.text },
            finish_reason: null,
          }],
        };
      }
    } else if (type === 'message_delta') {
      const delta = evt['delta'] as { stop_reason?: string } | undefined;
      if (delta?.stop_reason) {
        return {
          id: `chatcmpl-${randomUUID()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: requestModel,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: delta.stop_reason,
          }],
        };
      }
    }
    return null;
  }
}

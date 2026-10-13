import { createHmac, createHash, randomUUID } from 'node:crypto';

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelDescriptor,
  ProviderEndpoint,
  ToolCall,
} from '@anx/core';
import { ProviderResponseError, type ProviderAdapter } from '@anx/core';

import { parseSseStream } from '../shared/http.js';

interface BedrockConverseResponse {
  output?: {
    message?: {
      role?: string;
      content?: Array<{
        text?: string;
        toolUse?: {
          toolUseId: string;
          name: string;
          input: Record<string, unknown>;
        };
      }>;
    };
  };
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  metrics?: {
    latencyMs?: number;
  };
}

interface BedrockOpenAIResponse {
  id?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * AWS Bedrock adapter — routes through Bedrock's official Converse API
 * (`/model/{modelId}/converse`) or OpenAI-compatible inference proxies.
 *
 * Uses AWS SigV4 signing for authentication with support for:
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_SESSION_TOKEN (STS / temporary credentials)
 *   - AWS_REGION (default: us-east-1)
 */
export class BedrockAdapter implements ProviderAdapter {
  providerId = 'aws-bedrock';
  displayName = 'AWS Bedrock';

  protected apiBase = 'https://bedrock-runtime.amazonaws.com';

  resolveModel(alias: string): string | undefined {
    const bare = alias.startsWith('bedrock/') || alias.startsWith('aws-bedrock/')
      ? alias.replace(/^aws-bedrock\/|^bedrock\//, '')
      : alias;
    const norm = bare.toLowerCase().trim();

    const map: Record<string, string> = {
      'claude-3-5-sonnet': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'claude-3-5-sonnet-v2': 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      'claude-3-7-sonnet': 'anthropic.claude-3-7-sonnet-20250219-v1:0',
      'claude-3-5-haiku': 'anthropic.claude-3-5-haiku-20241022-v1:0',
      'claude-3-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
      'claude-3-opus': 'anthropic.claude-3-opus-20240229-v1:0',
      'llama-3.3-70b': 'meta.llama3-3-70b-instruct-v1:0',
      'llama-3.1-70b': 'meta.llama3-1-70b-instruct-v1:0',
      'llama-3.1-8b': 'meta.llama3-1-8b-instruct-v1:0',
      'nova-pro': 'amazon.nova-pro-v1:0',
      'nova-lite': 'amazon.nova-lite-v1:0',
      'nova-micro': 'amazon.nova-micro-v1:0',
      'titan-text': 'amazon.titan-text-express-v1',
      'mistral-large': 'mistral.mistral-large-2407-v1:0',
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
    const isConverse = this.usesConverseApi(endpoint);

    const { url, headers, body } = await this.prepareRequest(endpoint, model, request, false, isConverse);

    const controller = new AbortController();
    const timeout = AbortSignal.timeout(endpoint.timeoutMs);
    const onAbort = () => controller.abort();
    timeout.addEventListener('abort', onAbort, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ProviderResponseError(endpoint.id, r.status, text, { url });
      }

      if (isConverse) {
        const raw = (await r.json()) as BedrockConverseResponse;
        return this.translateConverseResponse(raw, endpoint, request.model);
      } else {
        const raw = (await r.json()) as BedrockOpenAIResponse;
        return this.translateOpenAIResponse(raw, endpoint, request.model);
      }
    } finally {
      timeout.removeEventListener('abort', onAbort);
      signal.removeEventListener('abort', onAbort);
    }
  }

  async *streamChatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk> {
    const model = this.resolveModel(request.model) ?? request.model;
    const isConverse = this.usesConverseApi(endpoint);

    const { url, headers, body } = await this.prepareRequest(endpoint, model, request, true, isConverse);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderResponseError(endpoint.id, response.status, text, { url });
    }
    if (!response.body) {
      throw new ProviderResponseError(endpoint.id, 0, 'No body in streaming response', { url });
    }

    for await (const evt of parseSseStream(response.body)) {
      const chunk = isConverse
        ? this.translateConverseChunk(evt, request.model)
        : this.translateOpenAIChunk(evt, request.model);
      if (chunk) yield chunk;
    }
  }

  async healthCheck(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<boolean> {
    try {
      const region = this.getRegion(endpoint);
      const accessKey = this.getAccessKey(endpoint);
      const secretKey = this.getSecretKey(endpoint);
      const sessionToken = this.getSessionToken(endpoint);
      const url = `https://bedrock.${region}.amazonaws.com/foundation-models`;
      const headers = this.signRequest('GET', url, '', accessKey, secretKey, region, sessionToken);
      const r = await fetch(url, { method: 'GET', headers, signal });
      return r.ok || r.status === 403;
    } catch {
      return false;
    }
  }

  async discoverModels(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<readonly ModelDescriptor[]> {
    const now = Date.now();
    try {
      const region = this.getRegion(endpoint);
      const accessKey = this.getAccessKey(endpoint);
      const secretKey = this.getSecretKey(endpoint);
      const sessionToken = this.getSessionToken(endpoint);
      const url = `https://bedrock.${region}.amazonaws.com/foundation-models`;
      const headers = this.signRequest('GET', url, '', accessKey, secretKey, region, sessionToken);
      const r = await fetch(url, { method: 'GET', headers, signal });
      if (r.ok) {
        const body = (await r.json()) as {
          modelSummaries?: Array<{
            modelId: string;
            modelName?: string;
            inputModalities?: string[];
            outputModalities?: string[];
            responseStreamingSupported?: boolean;
          }>;
        };
        if (body.modelSummaries && body.modelSummaries.length > 0) {
          return body.modelSummaries.map((m) => ({
            id: m.modelId,
            providerId: this.providerId,
            displayName: m.modelName ?? m.modelId,
            contextWindow: 200000,
            maxOutputTokens: 8192,
            pricing: { isFree: false, currency: 'USD', source: 'adapter_fallback' as const, updatedAt: now, freeTier: 'UNKNOWN' as const },
            capabilities: {
              streaming: Boolean(m.responseStreamingSupported),
              toolCalling: true,
              vision: Boolean(m.inputModalities?.includes('IMAGE')),
              audio: Boolean(m.inputModalities?.includes('AUDIO')),
              speech: false,
              embeddings: m.modelId.includes('embed'),
              reasoning: m.modelId.includes('3-7') || m.modelId.includes('sonnet'),
              jsonMode: true,
            },
            discoveredAt: now,
          }));
        }
      }
    } catch {
      // fallback to static catalog
    }

    const staticModels = [
      { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', name: 'Claude 3.5 Sonnet v2', vision: true },
      { id: 'anthropic.claude-3-7-sonnet-20250219-v1:0', name: 'Claude 3.7 Sonnet', vision: true },
      { id: 'anthropic.claude-3-5-haiku-20241022-v1:0', name: 'Claude 3.5 Haiku', vision: true },
      { id: 'meta.llama3-3-70b-instruct-v1:0', name: 'Llama 3.3 70B Instruct', vision: false },
      { id: 'amazon.nova-pro-v1:0', name: 'Amazon Nova Pro', vision: true },
      { id: 'amazon.nova-lite-v1:0', name: 'Amazon Nova Lite', vision: true },
    ];

    return staticModels.map((m) => ({
      id: m.id,
      providerId: this.providerId,
      displayName: `${m.name} (AWS Bedrock)`,
      contextWindow: 200000,
      maxOutputTokens: 8192,
      pricing: { isFree: false, currency: 'USD', source: 'adapter_fallback' as const, updatedAt: now, freeTier: 'UNKNOWN' as const },
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: m.vision,
        audio: false,
        speech: false,
        embeddings: false,
        reasoning: m.id.includes('3-7'),
        jsonMode: true,
      },
      discoveredAt: now,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────

  private usesConverseApi(endpoint: ProviderEndpoint): boolean {
    if (endpoint.baseUrl && (endpoint.baseUrl.includes('/v1') || endpoint.baseUrl.includes('chat/completions'))) {
      return false;
    }
    return true;
  }

  private async prepareRequest(
    endpoint: ProviderEndpoint,
    model: string,
    request: ChatCompletionRequest,
    streaming: boolean,
    isConverse: boolean,
  ): Promise<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> {
    const region = this.getRegion(endpoint);
    const accessKey = this.getAccessKey(endpoint);
    const secretKey = this.getSecretKey(endpoint);
    const sessionToken = this.getSessionToken(endpoint);
    const baseUrl = endpoint.baseUrl || `https://bedrock-runtime.${region}.amazonaws.com`;

    let url: string;
    let body: Record<string, unknown>;

    if (isConverse) {
      const action = streaming ? 'converse-stream' : 'converse';
      url = `${baseUrl}/model/${encodeURIComponent(model)}/${action}`;
      body = this.translateRequestToConverse(request);
    } else {
      url = `${baseUrl}/v1/chat/completions`;
      body = this.translateRequestToOpenAI(request, streaming);
    }

    const serialized = JSON.stringify(body);
    const headers = this.signRequest('POST', url, serialized, accessKey, secretKey, region, sessionToken);
    headers['Content-Type'] = 'application/json';

    return { url, headers, body };
  }

  private translateRequestToConverse(req: ChatCompletionRequest): Record<string, unknown> {
    const messages: Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }> = [];
    const system: Array<{ text: string }> = [];

    for (const m of req.messages) {
      if (m.role === 'system') {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        system.push({ text });
        continue;
      }

      const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user';
      const content: Array<Record<string, unknown>> = [];

      if (typeof m.content === 'string') {
        content.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text' && part.text) {
            content.push({ text: part.text });
          }
        }
      }

      if (content.length > 0) {
        messages.push({ role, content });
      }
    }

    const inferenceConfig: Record<string, unknown> = {
      maxTokens: req.maxTokens ?? req.maxOutputTokens ?? 4096,
    };
    if (req.temperature !== undefined) inferenceConfig['temperature'] = req.temperature;
    if (req.topP !== undefined) inferenceConfig['topP'] = req.topP;
    if (req.stop) {
      inferenceConfig['stopSequences'] = Array.isArray(req.stop) ? req.stop : [req.stop];
    }

    const payload: Record<string, unknown> = {
      messages,
      inferenceConfig,
    };

    if (system.length > 0) {
      payload['system'] = system;
    }

    if (req.tools && req.tools.length > 0) {
      payload['toolConfig'] = {
        tools: (req.tools as Array<{ function: { name: string; description?: string; parameters?: Record<string, unknown> } }>).map((t) => ({
          toolSpec: {
            name: t.function.name,
            description: t.function.description ?? '',
            inputSchema: {
              json: t.function.parameters ?? {},
            },
          },
        })),
      };
    }


    return payload;
  }

  private translateRequestToOpenAI(req: ChatCompletionRequest, streaming = false): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: req.maxTokens ?? req.maxOutputTokens ?? 4096,
      stream: streaming,
    };
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.topP !== undefined) body['top_p'] = req.topP;
    if (req.stop !== undefined) body['stop'] = Array.isArray(req.stop) ? req.stop : [req.stop];
    if (req.tools) body['tools'] = req.tools;
    if (req.toolChoice) body['tool_choice'] = req.toolChoice;
    return body;
  }

  private translateConverseResponse(
    raw: BedrockConverseResponse,
    endpoint: ProviderEndpoint,
    requestModel: string,
  ): ChatCompletionResponse {
    const msg = raw.output?.message;
    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const c of msg?.content ?? []) {
      if (c.text) text += c.text;
      if (c.toolUse) {
        toolCalls.push({
          id: c.toolUse.toolUseId,
          type: 'function',
          function: {
            name: c.toolUse.name,
            arguments: JSON.stringify(c.toolUse.input ?? {}),
          },
        });
      }
    }

    let finishReason = 'stop';
    if (toolCalls.length > 0) finishReason = 'tool_calls';
    else if (raw.stopReason === 'max_tokens') finishReason = 'length';
    else if (raw.stopReason === 'end_turn') finishReason = 'stop';

    return {
      id: `bedrock-${randomUUID()}`,
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

        finish_reason: finishReason,
      }],
      usage: {
        promptTokens: raw.usage?.inputTokens ?? 0,
        completionTokens: raw.usage?.outputTokens ?? 0,
        totalTokens: raw.usage?.totalTokens ?? 0,
      },
      provider: this.providerId,
      endpoint: endpoint.id,
      latencyMs: raw.metrics?.latencyMs ?? 0,
    };
  }

  private translateOpenAIResponse(
    raw: BedrockOpenAIResponse,
    endpoint: ProviderEndpoint,
    requestModel: string,
  ): ChatCompletionResponse {
    return {
      id: raw.id ?? `bedrock-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: (raw.choices ?? []).map((c) => ({
        index: c.index ?? 0,
        message: {
          role: 'assistant',
          content: c.message?.content ?? '',
          ...(c.message?.tool_calls ? { tool_calls: c.message.tool_calls } : {}),
        },
        finish_reason: c.finish_reason ?? 'stop',
      })),
      usage: {
        promptTokens: raw.usage?.prompt_tokens ?? 0,
        completionTokens: raw.usage?.completion_tokens ?? 0,
        totalTokens: raw.usage?.total_tokens ?? 0,
      },
      provider: this.providerId,
      endpoint: endpoint.id,
      latencyMs: 0,
    };
  }

  private translateConverseChunk(evt: Record<string, unknown>, requestModel: string): ChatCompletionChunk | null {
    const delta = evt['contentBlockDelta'] as { delta?: { text?: string } } | undefined;
    const text = delta?.delta?.text;
    const messageStop = evt['messageStop'] as { stopReason?: string } | undefined;
    const finish = messageStop?.stopReason ? (messageStop.stopReason === 'end_turn' ? 'stop' : messageStop.stopReason) : null;

    if (!text && !finish) return null;

    return {
      id: `bedrock-chunk-${randomUUID()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [{
        index: 0,
        delta: text ? { content: text } : {},
        finish_reason: finish,
      }],
    };
  }

  private translateOpenAIChunk(evt: Record<string, unknown>, requestModel: string): ChatCompletionChunk | null {
    const choices = evt['choices'] as Array<{ delta?: { content?: string }; finish_reason?: string }> | undefined;
    if (!choices?.length) return null;
    const delta = choices[0]?.delta;
    if (!delta?.content && !choices[0]?.finish_reason) return null;

    return {
      id: randomUUID(),
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: [{
        index: 0,
        delta: delta?.content ? { content: delta.content } : {},
        finish_reason: choices[0]?.finish_reason ?? null,
      }],
    };
  }

  // ─── AWS SigV4 ────────────────────────────────────────────────────────

  private getRegion(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { region?: string }).region;
    if (explicit && !explicit.includes('auto')) return explicit;
    return process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? 'us-east-1';
  }

  private getAccessKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit.split(':')[0] ?? '';
    return process.env['AWS_ACCESS_KEY_ID'] ?? '';
  }

  private getSecretKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit && explicit.includes(':')) return explicit.split(':')[1] ?? '';
    return process.env['AWS_SECRET_ACCESS_KEY'] ?? '';
  }

  private getSessionToken(endpoint: ProviderEndpoint): string | undefined {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit && explicit.split(':').length > 2) {
      return explicit.split(':')[2];
    }
    return process.env['AWS_SESSION_TOKEN'] ?? process.env['AWS_SECURITY_TOKEN'];
  }

  /**
   * Signs a request using AWS Signature Version 4 including x-amz-security-token support.
   */
  private signRequest(
    method: string,
    url: string,
    body: string,
    accessKey: string,
    secretKey: string,
    region: string,
    sessionToken?: string,
  ): Record<string, string> {
    const parsed = new URL(url);
    const service = 'bedrock';
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = timestamp.slice(0, 8);

    const host = parsed.host;
    let canonicalHeaders = `host:${host}\nx-amz-date:${timestamp}\n`;
    let signedHeaders = 'host;x-amz-date';

    if (sessionToken) {
      canonicalHeaders += `x-amz-security-token:${sessionToken}\n`;
      signedHeaders += ';x-amz-security-token';
    }

    const canonicalQuery = parsed.search.slice(1) || '';
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const canonicalRequest = `${method}\n${parsed.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const scope = `${date}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${createHash('sha256').update(canonicalRequest).digest('hex')}`;

    const kDate = this.hmac(`AWS4${secretKey}`, date);
    const kRegion = this.hmac(kDate, region);
    const kService = this.hmac(kRegion, service);
    const kSigning = this.hmac(kService, 'aws4_request');
    const signature = this.hmac(kSigning, stringToSign).toString('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers: Record<string, string> = {
      Authorization: authorization,
      'x-amz-date': timestamp,
      Host: host,
    };

    if (sessionToken) {
      headers['x-amz-security-token'] = sessionToken;
    }

    return headers;
  }

  private hmac(key: string | Buffer, data: string): Buffer {
    return createHmac('sha256', key).update(data).digest();
  }
}

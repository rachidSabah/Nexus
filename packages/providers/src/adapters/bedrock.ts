import { createHmac, createHash, randomUUID } from 'node:crypto';

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderEndpoint,
} from '@anx/core';
import { ProviderResponseError, type ProviderAdapter } from '@anx/core';

import { parseSseStream } from '../shared/http.js';

/**
 * AWS Bedrock adapter — routes through Bedrock's OpenAI-compatible endpoint
 * (cross-region inference) or the native invoke-api.
 *
 * Uses AWS SigV4 signing for authentication. The user provides:
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_REGION (default: us-east-1)
 *
 * Bedrock's OpenAI-compatible endpoint is at:
 *   https://{region}.bedrock-runtime.amazonaws.com/v1/chat/completions
 *
 * This adapter extends the OpenAI-compatible pattern but adds SigV4 auth headers.
 */
export class BedrockAdapter implements ProviderAdapter {
  providerId = 'aws-bedrock';
  displayName = 'AWS Bedrock';

  protected apiBase = 'https://bedrock-runtime.amazonaws.com';

  resolveModel(alias: string): string | undefined {
    // Bedrock model IDs look like: anthropic.claude-3-5-sonnet-20241022-v1:0
    // Allow direct passthrough.
    return alias;
  }

  async chatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const { url, headers } = await this.prepareRequest(endpoint, request, false);
    const body = this.translateRequest(request);

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
      const raw = (await r.json()) as BedrockResponse;
      return this.translateResponse(raw, endpoint, request.model);
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
    const { url, headers } = await this.prepareRequest(endpoint, request, true);
    const body = this.translateRequest(request);

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
      throw new ProviderResponseError(endpoint.id, 0, 'No body', { url });
    }

    for await (const evt of parseSseStream(response.body)) {
      const chunk = this.translateChunk(evt, request.model);
      if (chunk) yield chunk;
    }
  }

  async healthCheck(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<boolean> {
    try {
      // List foundation models — lightweight call.
      const region = this.getRegion(endpoint);
      const accessKey = this.getAccessKey(endpoint);
      const secretKey = this.getSecretKey(endpoint);
      const url = `https://bedrock.${region}.amazonaws.com/foundation-models`;
      const headers = this.signRequest('GET', url, '', accessKey, secretKey, region);
      const r = await fetch(url, { method: 'GET', headers, signal });
      return r.ok;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async prepareRequest(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    streaming: boolean,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const region = this.getRegion(endpoint);
    const accessKey = this.getAccessKey(endpoint);
    const secretKey = this.getSecretKey(endpoint);
    const baseUrl = endpoint.baseUrl || `https://bedrock-runtime.${region}.amazonaws.com`;
    const url = `${baseUrl}/v1/chat/completions`;
    const body = JSON.stringify(this.translateRequest(request, streaming));
    const headers = this.signRequest('POST', url, body, accessKey, secretKey, region);
    headers['Content-Type'] = 'application/json';
    return { url, headers };
  }

  private translateRequest(req: ChatCompletionRequest, streaming = false): Record<string, unknown> {
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

  private translateResponse(
    raw: BedrockResponse,
    endpoint: ProviderEndpoint,
    requestModel: string,
  ): ChatCompletionResponse {
    return {
      id: raw.id ?? '',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: requestModel,
      choices: (raw.choices ?? []).map((c) => ({
        index: c.index ?? 0,
        message: { role: 'assistant', content: c.message?.content ?? '' },
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

  private translateChunk(evt: Record<string, unknown>, requestModel: string): ChatCompletionChunk | null {
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

  /**
   * Signs a request using AWS Signature Version 4.
   * Returns the headers to add to the fetch request.
   */
  private signRequest(
    method: string,
    url: string,
    body: string,
    accessKey: string,
    secretKey: string,
    region: string,
  ): Record<string, string> {
    const parsed = new URL(url);
    const service = 'bedrock';
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = timestamp.slice(0, 8);

    // Canonical headers
    const host = parsed.host;
    const canonicalHeaders = `host:${host}\nx-amz-date:${timestamp}\n`;
    const signedHeaders = 'host;x-amz-date';

    // Canonical request
    const canonicalQuery = parsed.search.slice(1) || '';
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const canonicalRequest = `${method}\n${parsed.pathname}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    // String to sign
    const scope = `${date}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${createHash('sha256').update(canonicalRequest).digest('hex')}`;

    // Signing key
    const kDate = this.hmac(`AWS4${secretKey}`, date);
    const kRegion = this.hmac(kDate, region);
    const kService = this.hmac(kRegion, service);
    const kSigning = this.hmac(kService, 'aws4_request');
    const signature = this.hmac(kSigning, stringToSign).toString('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      Authorization: authorization,
      'x-amz-date': timestamp,
      Host: host,
    };
  }

  private hmac(key: string | Buffer, data: string): Buffer {
    return createHmac('sha256', key).update(data).digest();
  }
}

// randomUUID is imported at the top of the file.

interface BedrockResponse {
  id?: string;
  choices?: Array<{
    index?: number;
    message?: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

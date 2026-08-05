import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
} from '@anx/core';

/**
 * TypeScript SDK for Agent Nexus Gateway.
 *
 * Drop-in replacement for the OpenAI SDK's basic chat interface, but routes
 * through the gateway's intelligent routing / failover / observability.
 *
 * @example
 * ```ts
 * import { NexusClient } from '@anx/sdk';
 *
 * const client = new NexusClient({
 *   baseUrl: 'http://localhost:8787',
 *   apiKey: process.env.NEXUS_API_KEY,
 * });
 *
 * const response = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 *
 * // Streaming
 * const stream = await client.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [...],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
 * }
 * ```
 */
export class NexusClient {
  readonly chat: ChatResource;

  constructor(private readonly options: { baseUrl: string; apiKey?: string; headers?: Record<string, string> }) {
    this.chat = new ChatResource(this);
  }

  protected async request<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.options.headers ?? {}),
    };
    if (this.options.apiKey) headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    const r = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Nexus API error ${r.status}: ${text}`);
    }
    return (await r.json()) as T;
  }

  protected async requestStream(
    path: string,
    init: RequestInit & { signal?: AbortSignal } = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(this.options.headers ?? {}),
    };
    if (this.options.apiKey) headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    const r = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> ?? {}) },
    });
    if (!r.ok || !r.body) {
      const text = await r.text().catch(() => '');
      throw new Error(`Nexus API error ${r.status}: ${text}`);
    }
    return r.body;
  }
}

class ChatResource {
  readonly completions: CompletionsResource;
  constructor(private readonly client: NexusClient) {
    this.completions = new CompletionsResource(client);
  }
}

class CompletionsResource {
  constructor(private readonly client: NexusClient) {}

  async create(
    request: ChatCompletionRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<ChatCompletionResponse | AsyncIterable<ChatCompletionChunk>> {
    if (request.stream) {
      const body = await this.client.requestStream('/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify(request),
        signal: options.signal,
      });
      return this.parseStream(body);
    }
    return this.client.request<ChatCompletionResponse>('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(request),
      signal: options.signal,
    });
  }

  private async *parseStream(body: ReadableStream<Uint8Array>): AsyncIterable<ChatCompletionChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as ChatCompletionChunk;
          } catch {
            // skip
          }
        }
      }
    }
  }
}

/**
 * Embeddings resource — mirrors the OpenAI SDK.
 */
export class EmbeddingsResource {
  constructor(private readonly client: NexusClient) {}

  async create(request: EmbeddingRequest, options: { signal?: AbortSignal } = {}): Promise<EmbeddingResponse> {
    return this.client.request<EmbeddingResponse>('/v1/embeddings', {
      method: 'POST',
      body: JSON.stringify(request),
      signal: options.signal,
    });
  }
}

// Attach embeddings to the client.
declare module './index.js' {
  interface NexusClient {
    readonly embeddings: EmbeddingsResource;
  }
}
Object.defineProperty(NexusClient.prototype, 'embeddings', {
  get() {
    return new EmbeddingsResource(this);
  },
});

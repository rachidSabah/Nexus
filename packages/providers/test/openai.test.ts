import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OpenAIAdapter } from '../src/adapters/openai.js';
import type { ChatCompletionRequest, ProviderEndpoint } from '@anx/core';

function makeEndpoint(overrides: Partial<ProviderEndpoint & { apiKey?: string }> = {}): ProviderEndpoint & { apiKey?: string } {
  return {
    id: 'ep-openai',
    providerId: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      audio: false,
      speech: false,
      embeddings: true,
      reasoning: false,
      jsonMode: true,
      maxOutputTokens: 4096,
      maxInputTokens: 32768,
      supportedModalities: ['text'],
    },
    pricing: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
    priority: 1,
    weight: 1,
    region: 'us-east',
    tags: [],
    timeoutMs: 30_000,
    maxRetries: 2,
    concurrencyLimit: 10,
    health: 'healthy',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('OpenAIAdapter', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('translates request to OpenAI shape', () => {
    const adapter = new OpenAIAdapter();
    const req: ChatCompletionRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 100,
      stream: false,
    };
    // Access protected method via type cast
    const translated = (adapter as unknown as {
      translateRequest: (r: ChatCompletionRequest, s: boolean) => Record<string, unknown>;
    }).translateRequest(req, false);
    expect(translated['model']).toBe('gpt-4');
    expect(translated['temperature']).toBe(0.7);
    expect(translated['max_tokens']).toBe(100);
    expect(translated['stream']).toBe(false);
  });

  it('throws on 401 with descriptive ProviderResponseError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }));

    const adapter = new OpenAIAdapter();
    const endpoint = makeEndpoint();
    await expect(
      adapter.chatCompletion(endpoint, {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hi' }],
      }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_ERROR', status: 401 });
  });

  it('parses non-streaming response correctly', async () => {
    const body = {
      id: 'resp-1',
      object: 'chat.completion',
      created: 1234,
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        },
      ],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      system_fingerprint: 'fp-1',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }));

    const adapter = new OpenAIAdapter();
    const endpoint = makeEndpoint();
    const result = await adapter.chatCompletion(
      endpoint,
      { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] },
      new AbortController().signal,
    );
    expect(result.choices[0]?.message.content).toBe('Hello!');
    expect(result.usage.totalTokens).toBe(7);
    expect(result.provider).toBe('openai');
  });

  it('parses SSE stream correctly', async () => {
    const encoder = new TextEncoder();
    const sse = [
      'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
      'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sse));
          controller.close();
        },
      }),
    }));

    const adapter = new OpenAIAdapter();
    const endpoint = makeEndpoint();
    const chunks: string[] = [];
    for await (const chunk of adapter.streamChatCompletion(
      endpoint,
      { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }], stream: true },
      new AbortController().signal,
    )) {
      if (chunk.choices[0]?.delta.content) chunks.push(chunk.choices[0].delta.content);
    }
    expect(chunks.join('')).toBe('Hello');
  });
});

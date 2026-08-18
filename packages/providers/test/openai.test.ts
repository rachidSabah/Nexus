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

  it('preserves tool_call_id and tool_calls for both camelCase and snake_case messages', () => {
    const adapter = new OpenAIAdapter();
    const req: ChatCompletionRequest = {
      model: 'meta/llama-3.1-405b-instruct',
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"location":"Paris"}' } }],
        } as never,
        {
          role: 'tool',
          content: '{"temp":22}',
          tool_call_id: 'call_1',
        } as never,
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_2', type: 'function', function: { name: 'get_time', arguments: '{}' } }],
        },
        {
          role: 'tool',
          content: '{"time":"12:00"}',
          toolCallId: 'call_2',
        },
      ],
    };
    const translated = (adapter as unknown as {
      translateRequest: (r: ChatCompletionRequest, s: boolean) => { messages: Array<Record<string, unknown>> };
    }).translateRequest(req, false);

    expect(translated.messages[0]?.tool_calls).toHaveLength(1);
    expect(translated.messages[1]?.tool_call_id).toBe('call_1');
    expect(translated.messages[2]?.tool_calls).toHaveLength(1);
    expect(translated.messages[3]?.tool_call_id).toBe('call_2');
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

  it('classifies quota-limited free aliases (suffix) as FREE_TIER through discovery', async () => {
    // Representative free-suffixed catalog IDs observed in Nexus.
    const modelsPayload = {
      data: [
        // OpenRouter `:free` alias → quota-limited free tier.
        { id: 'meta-llama/llama-3.1-8b-instruct:free', object: 'model', owned_by: 'meta' },
        // OpenCode Zen / NVIDIA `*-free` alias → quota-limited free tier.
        { id: 'deepseek-v4-flash-free', object: 'model', owned_by: 'deepseek' },
        { id: 'hy3-free', object: 'model', owned_by: 'opencode' },
        { id: 'nemotron-3.5-lightning-free', object: 'model', owned_by: 'nvidia' },
        // Genuinely paid model with numeric pricing (OpenRouter pricing table).
        {
          id: 'anthropic/claude-3.5-sonnet',
          object: 'model',
          owned_by: 'anthropic',
          pricing: { prompt: '0.000003', completion: '0.000015' },
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => modelsPayload,
      text: async () => JSON.stringify(modelsPayload),
    }));

    const adapter = new OpenAIAdapter();
    const endpoint = makeEndpoint({ providerId: 'openrouter' });
    const discovered = await adapter.discoverModels(endpoint, new AbortController().signal);

    const byId = Object.fromEntries(discovered.map((m) => [m.id, m]));

    // All suffix-free models that ARE free are quota-limited → FREE_TIER.
    for (const id of [
      'meta-llama/llama-3.1-8b-instruct:free',
      'deepseek-v4-flash-free',
      'hy3-free',
      'nemotron-3.5-lightning-free',
    ]) {
      const m = byId[id];
      expect(m, `model ${id} present`).toBeDefined();
      expect(m.pricing?.isFree, `${id} isFree`).toBe(true);
      expect(m.pricing?.quotaLimited, `${id} quotaLimited`).toBe(true);
      expect(m.pricing?.freeTier, `${id} freeTier`).toBe('FREE_TIER');
    }

    // Paid model stays PAID with no quota flag.
    const paid = byId['anthropic/claude-3.5-sonnet'];
    expect(paid.pricing?.freeTier).toBe('PAID');
    expect(paid.pricing?.quotaLimited).toBeFalsy();
  });

  it('classifies local Ollama models as FREE (unrestricted), not FREE_TIER', async () => {
    const modelsPayload = {
      data: [
        { id: 'llama3.1:8b', object: 'model', owned_by: 'ollama' },
        { id: 'qwen2.5:7b', object: 'model', owned_by: 'ollama' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => modelsPayload,
      text: async () => JSON.stringify(modelsPayload),
    }));

    const adapter = new OpenAIAdapter();
    const endpoint = makeEndpoint({ providerId: 'ollama' });
    const discovered = await adapter.discoverModels(endpoint, new AbortController().signal);
    const byId = Object.fromEntries(discovered.map((m) => [m.id, m]));

    for (const id of ['llama3.1:8b', 'qwen2.5:7b']) {
      const m = byId[id];
      expect(m, `model ${id} present`).toBeDefined();
      expect(m.pricing?.isFree, `${id} isFree`).toBe(true);
      // Local/self-hosted → unrestricted → FREE, NOT quota-limited FREE_TIER.
      expect(m.pricing?.quotaLimited, `${id} quotaLimited`).toBeFalsy();
      expect(m.pricing?.freeTier, `${id} freeTier`).toBe('FREE');
      expect(m.pricing?.source, `${id} source`).toBe('provider_metadata');
    }
  });

  it('keeps honest UNKNOWN when API returns no pricing for a non-suffix model', async () => {
    // OpenCode Zen / NVIDIA / Groq models without a `-free` suffix and no
    // per-model pricing must stay UNKNOWN — we must NOT fabricate $0 as free.
    const modelsPayload = {
      data: [
        { id: 'some-provider-model-x', object: 'model', owned_by: 'opencode-zen' },
        { id: 'groq-large-unknown', object: 'model', owned_by: 'groq' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => modelsPayload,
      text: async () => JSON.stringify(modelsPayload),
    }));

    const adapter = new OpenAIAdapter();
    const endpoint = makeEndpoint({ providerId: 'opencode-zen' });
    const discovered = await adapter.discoverModels(endpoint, new AbortController().signal);
    const byId = Object.fromEntries(discovered.map((m) => [m.id, m]));

    for (const id of ['some-provider-model-x', 'groq-large-unknown']) {
      const m = byId[id];
      expect(m, `model ${id} present`).toBeDefined();
      expect(m.pricing?.freeTier, `${id} freeTier`).toBe('UNKNOWN');
      expect(m.pricing?.isFree, `${id} isFree`).toBe(false);
      expect(m.pricing?.source, `${id} source`).toBe('unknown');
    }
  });

  it('tags provider_metadata source for a free-suffix model even without live pricing', async () => {
    const modelsPayload = {
      data: [{ id: 'deepseek-v4-flash-free', object: 'model', owned_by: 'deepseek' }],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => modelsPayload,
      text: async () => JSON.stringify(modelsPayload),
    }));

    const adapter = new OpenAIAdapter();
    const endpoint = makeEndpoint({ providerId: 'opencode-zen' });
    const discovered = await adapter.discoverModels(endpoint, new AbortController().signal);
    const m = discovered.find((x) => x.id === 'deepseek-v4-flash-free');
    expect(m?.pricing?.freeTier).toBe('FREE_TIER');
    // We KNOW it is a free alias (suffix), so the source is metadata, not unknown.
    expect(m?.pricing?.source).toBe('provider_metadata');
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

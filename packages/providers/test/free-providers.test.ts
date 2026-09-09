import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  CohereAdapter,
  HuggingFaceAdapter,
  ZhipuAdapter,
  ModelScopeAdapter,
  ElectronHubAdapter,
  ExperientialAdapter,
  KiloGatewayAdapter,
  PollinationsAdapter,
  AiHordeAdapter,
  RadeonAdapter,
  AnyApiAdapter,
  GitHubModelsAdapter,
  SambaNovaAdapter,
  HyperbolicAdapter,
  NovitaAdapter,
  SiliconFlowAdapter,
  createDefaultAdapters,
  SUPPORTED_PROVIDERS,
} from '../src/index.js';
import type { ChatCompletionRequest, ProviderEndpoint } from '@anx/core';

function makeEndpoint(overrides: Partial<ProviderEndpoint & { apiKey?: string }> = {}): ProviderEndpoint & { apiKey?: string } {
  return {
    id: 'ep-test',
    providerId: 'test',
    displayName: 'Test',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      audio: false,
      speech: false,
      embeddings: false,
      reasoning: false,
      jsonMode: true,
      maxOutputTokens: 4096,
      maxInputTokens: 32768,
      supportedModalities: ['text'],
    },
    pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
    priority: 1,
    weight: 1,
    region: 'auto',
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

function chatOk(text: string): unknown {
  const payload = {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1700000000,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  };
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

function httpErr(status: number): unknown {
  const payload = { error: { message: 'denied' } };
  return {
    ok: false,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

describe('free-tier provider registration', () => {
  it('registers all six adapters with grounded base URLs', () => {
    const map = createDefaultAdapters();
    const bases: Record<string, string> = {
      cohere: 'https://api.cohere.ai/compatibility/v1',
      huggingface: 'https://router.huggingface.co/v1',
      zhipu: 'https://open.bigmodel.cn/api/paas/v4',
      modelscope: 'https://api-inference.modelscope.cn/v1',
      electronhub: 'https://api.electronhub.ai/v1',
      experiential: 'https://api.experientiallabs.ai/v1',
    };
    for (const [id, base] of Object.entries(bases)) {
      const adapter = map.get(id);
      expect(adapter, id).toBeDefined();
      const resolved = (adapter as unknown as { resolveBase: (e: ProviderEndpoint) => string }).resolveBase(
        makeEndpoint({ providerId: id, baseUrl: '' }),
      );
      expect(resolved, id).toBe(base);
    }
  });

  it('aliases hf to huggingface and lists all six as supported', () => {
    const map = createDefaultAdapters();
    expect(map.get('hf')).toBe(map.get('huggingface'));
    for (const id of ['cohere', 'huggingface', 'hf', 'zhipu', 'modelscope', 'electronhub', 'experiential']) {
      expect((SUPPORTED_PROVIDERS as readonly string[]).includes(id), id).toBe(true);
    }
  });

  it('exposes display names', () => {
    expect(new CohereAdapter().displayName).toBe('Cohere');
    expect(new HuggingFaceAdapter().displayName).toBe('Hugging Face');
    expect(new ZhipuAdapter().displayName).toBe('Zhipu AI (Z.ai)');
    expect(new ModelScopeAdapter().displayName).toBe('ModelScope');
    expect(new ElectronHubAdapter().displayName).toBe('ElectronHub');
    expect(new ExperientialAdapter().displayName).toBe('Experiential Labs');
  });
});

describe('Cohere tool-schema stripping', () => {
  it('drops additionalProperties and $schema, keeps everything else', () => {
    const adapter = new CohereAdapter();
    const req: ChatCompletionRequest = {
      model: 'command-r',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: {
              type: 'object',
              additionalProperties: false,
              $schema: 'http://json-schema.org/draft-07/schema#',
              properties: {
                city: { type: 'string', additionalProperties: true },
              },
              required: ['city'],
            },
          },
        },
      ],
    };
    const translated = (adapter as unknown as {
      translateRequest: (r: ChatCompletionRequest, s: boolean) => Record<string, unknown>;
    }).translateRequest(req, false);
    const tools = translated['tools'] as { function: { parameters: Record<string, unknown> } }[];
    const params = tools[0].function.parameters;
    expect(params['additionalProperties']).toBeUndefined();
    expect(params['$schema']).toBeUndefined();
    expect(params['type']).toBe('object');
    expect((params['properties'] as Record<string, Record<string, unknown>>)['city']).toEqual({ type: 'string' });
    expect(params['required']).toEqual(['city']);
  });

  it('passes requests without tools through untouched', () => {
    const adapter = new CohereAdapter();
    const translated = (adapter as unknown as {
      translateRequest: (r: ChatCompletionRequest, s: boolean) => Record<string, unknown>;
    }).translateRequest({ model: 'command-r', messages: [{ role: 'user', content: 'hi' }] }, false);
    expect(translated['tools']).toBeUndefined();
  });
});

describe('native env var compatibility', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('honors HF_TOKEN for Hugging Face', () => {
    vi.stubEnv('HF_TOKEN', 'hf-native');
    const adapter = new HuggingFaceAdapter();
    const key = (adapter as unknown as { getApiKey: (e: ProviderEndpoint) => string }).getApiKey(
      makeEndpoint({ apiKey: undefined }),
    );
    expect(key).toBe('hf-native');
  });

  it('honors MODELSCOPE_API_TOKEN for ModelScope', () => {
    vi.stubEnv('MODELSCOPE_API_TOKEN', 'ms-native');
    const adapter = new ModelScopeAdapter();
    const key = (adapter as unknown as { getApiKey: (e: ProviderEndpoint) => string }).getApiKey(
      makeEndpoint({ apiKey: undefined }),
    );
    expect(key).toBe('ms-native');
  });

  it('honors EXPLABS_API_KEY for Experiential Labs', () => {
    vi.stubEnv('EXPLABS_API_KEY', 'xpl-native');
    const adapter = new ExperientialAdapter();
    const key = (adapter as unknown as { getApiKey: (e: ProviderEndpoint) => string }).getApiKey(
      makeEndpoint({ apiKey: undefined }),
    );
    expect(key).toBe('xpl-native');
  });

  it('prefers explicit endpoint keys over env', () => {
    vi.stubEnv('HF_TOKEN', 'hf-native');
    const adapter = new HuggingFaceAdapter();
    const key = (adapter as unknown as { getApiKey: (e: ProviderEndpoint) => string }).getApiKey(
      makeEndpoint({ apiKey: 'explicit' }),
    );
    expect(key).toBe('explicit');
  });

  it('throws the standard missing-key error when nothing is set', () => {
    const adapter = new ElectronHubAdapter();
    expect(() =>
      (adapter as unknown as { getApiKey: (e: ProviderEndpoint) => string }).getApiKey(
        makeEndpoint({ apiKey: undefined }),
      ),
    ).toThrow(/Missing API key/);
  });
});

describe('Zhipu dual-console fallback', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const req: ChatCompletionRequest = { model: 'glm-4', messages: [{ role: 'user', content: 'hi' }] };

  it('uses the domestic host when it accepts the key', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return chatOk('domestic-hi');
    }));
    const adapter = new ZhipuAdapter();
    const res = await adapter.chatCompletion(makeEndpoint({ providerId: 'zhipu' }), req, new AbortController().signal);
    expect(res.choices[0].message.content).toBe('domestic-hi');
    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith('https://open.bigmodel.cn/api/paas/v4')).toBe(true);
  });

  it('retries the global host after a domestic 401 and remembers the key', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      urls.push(String(url));
      if (String(url).startsWith('https://open.bigmodel.cn')) return httpErr(401);
      return chatOk('global-hi');
    }));
    const adapter = new ZhipuAdapter();
    const ep = makeEndpoint({ providerId: 'zhipu' });
    const first = await adapter.chatCompletion(ep, req, new AbortController().signal);
    expect(first.choices[0].message.content).toBe('global-hi');
    expect(urls).toHaveLength(2);
    const second = await adapter.chatCompletion(ep, req, new AbortController().signal);
    expect(second.choices[0].message.content).toBe('global-hi');
    expect(urls).toHaveLength(3);
    expect(urls[2].startsWith('https://api.z.ai/api/paas/v4')).toBe(true);
  });

  it('surfaces the error when both consoles reject the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => httpErr(401)));
    const adapter = new ZhipuAdapter();
    await expect(
      adapter.chatCompletion(makeEndpoint({ providerId: 'zhipu' }), req, new AbortController().signal),
    ).rejects.toThrow();
  });
});

describe('ModelScope chat-probe health check', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('probes POST /chat/completions (GET /models ignores auth)', async () => {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: unknown) => {
      const u = String(url);
      const m = ((init as { method?: string }).method ?? 'GET');
      calls.push({ url: u, method: m });
      if (u.endsWith('/models')) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: [{ id: 'qwen3' }] }), text: async () => '' };
      }
      return chatOk('pong');
    }));
    const adapter = new ModelScopeAdapter();
    const ok = await adapter.healthCheck(makeEndpoint({ providerId: 'modelscope' }), new AbortController().signal);
    expect(ok).toBe(true);
    const probe = calls.find((c) => c.url.endsWith('/chat/completions'));
    expect(probe?.method).toBe('POST');
  });

  it('reports false on a 401 probe (garbage key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/models')) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: [] }), text: async () => '' };
      }
      return httpErr(401);
    }));
    const adapter = new ModelScopeAdapter();
    const ok = await adapter.healthCheck(makeEndpoint({ providerId: 'modelscope' }), new AbortController().signal);
    expect(ok).toBe(false);
  });
});

describe('keyless free providers (Kilo, Pollinations, AI Horde)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('registers Kilo, Pollinations, and AI Horde in default adapters', () => {
    const map = createDefaultAdapters();
    expect(map.get('kilo')).toBeInstanceOf(KiloGatewayAdapter);
    expect(map.get('pollinations')).toBeInstanceOf(PollinationsAdapter);
    expect(map.get('aihorde')).toBeInstanceOf(AiHordeAdapter);
    expect(map.get('horde')).toBe(map.get('aihorde'));
  });

  it('Kilo allows keyless requests and omits Authorization when key is empty', () => {
    const adapter = new KiloGatewayAdapter();
    const ep = makeEndpoint({ providerId: 'kilo', apiKey: undefined });
    const key = (adapter as unknown as { getApiKey: (e: ProviderEndpoint) => string }).getApiKey(ep);
    expect(key).toBe('');
    const headers = (adapter as unknown as { headers: (e: ProviderEndpoint, k: string) => Record<string, string> }).headers(ep, key);
    expect(headers['Authorization']).toBeUndefined();

    // When key is provided, sets Authorization
    const headersWithKey = (adapter as unknown as { headers: (e: ProviderEndpoint, k: string) => Record<string, string> }).headers(ep, 'kilo-secret');
    expect(headersWithKey['Authorization']).toBe('Bearer kilo-secret');
  });

  it('Pollinations is completely keyless and discovers models', async () => {
    const adapter = new PollinationsAdapter();
    const ep = makeEndpoint({ providerId: 'pollinations', apiKey: undefined });
    const key = (adapter as unknown as { getApiKey: (e: ProviderEndpoint) => string }).getApiKey(ep);
    expect(key).toBe('');
    const headers = (adapter as unknown as { headers: (e: ProviderEndpoint, k: string) => Record<string, string> }).headers(ep, key);
    expect(headers['Authorization']).toBeUndefined();

    // Mock models endpoint returning array of objects
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ name: 'openai' }, { name: 'mistral' }],
    })));

    const models = await adapter.discoverModels(ep, new AbortController().signal);
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('openai');
    expect(models[0].isFree).toBe(true);
    expect(models[0].providerId).toBe('pollinations');
  });

  it('AI Horde defaults to anonymous key 0000000000 and sets Client-Agent', () => {
    const adapter = new AiHordeAdapter();
    const ep = makeEndpoint({ providerId: 'aihorde', apiKey: undefined });
    const key = (adapter as unknown as { getApiKey: (e: ProviderEndpoint) => string }).getApiKey(ep);
    expect(key).toBe('0000000000');

    const headers = (adapter as unknown as { headers: (e: ProviderEndpoint, k: string) => Record<string, string> }).headers(ep, key);
    expect(headers['Authorization']).toBe('Bearer 0000000000');
    expect(headers['Client-Agent']).toBe('Nexus:0.5.0:nexus@local');
  });
});

describe('specialized presets (Radeon, AnyAPI, GitHub Models)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('registers Radeon, AnyAPI, and GitHub Models in default adapters and aliases', () => {
    const map = createDefaultAdapters();
    expect(map.get('radeon')).toBeInstanceOf(RadeonAdapter);
    expect(map.get('amd')).toBe(map.get('radeon'));
    expect(map.get('anyapi')).toBeInstanceOf(AnyApiAdapter);
    expect(map.get('github')).toBeInstanceOf(GitHubModelsAdapter);
    expect(map.get('gh')).toBe(map.get('github'));
  });

  it('Radeon forces single tool call and parallel_tool_calls: false', () => {
    const adapter = new RadeonAdapter();
    const req: ChatCompletionRequest = {
      model: 'deepseek-r1',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        { type: 'function', function: { name: 'tool1' } },
        { type: 'function', function: { name: 'tool2' } },
      ],
    };
    const translated = (adapter as unknown as {
      translateRequest: (r: ChatCompletionRequest, s: boolean) => Record<string, unknown>;
    }).translateRequest(req, false);

    expect(Array.isArray(translated['tools'])).toBe(true);
    expect((translated['tools'] as unknown[]).length).toBe(1);
    expect(translated['parallel_tool_calls']).toBe(false);
  });

  it('GitHub Models sets User-Agent and honors GITHUB_TOKEN', () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_secret');
    const adapter = new GitHubModelsAdapter();
    const ep = makeEndpoint({ providerId: 'github', apiKey: undefined });
    const key = (adapter as unknown as { getApiKey: (e: ProviderEndpoint) => string }).getApiKey(ep);
    expect(key).toBe('ghp_secret');

    const headers = (adapter as unknown as { headers: (e: ProviderEndpoint, k: string) => Record<string, string> }).headers(ep, key);
    expect(headers['Authorization']).toBe('Bearer ghp_secret');
    expect(headers['User-Agent']).toBe('Nexus-Gateway/0.5.0');
  });

  it('AnyAPI resolves model aliases properly', () => {
    const adapter = new AnyApiAdapter();
    expect(adapter.resolveModel('anyapi/llama-3-8b')).toBe('llama-3-8b');
    expect(adapter.resolveModel('deepseek-v3')).toBe('deepseek-v3');
  });

  it('registers and resolves SambaNova, Hyperbolic, Novita, and SiliconFlow adapters', () => {
    const map = createDefaultAdapters();
    expect(map.get('sambanova')).toBeDefined();
    expect(map.get('hyperbolic')).toBeDefined();
    expect(map.get('novita')).toBeDefined();
    expect(map.get('siliconflow')).toBeDefined();

    const samba = new SambaNovaAdapter();
    expect((samba as unknown as { resolveBase: (e: ProviderEndpoint) => string }).resolveBase(
      makeEndpoint({ providerId: 'sambanova', baseUrl: '' }),
    )).toBe('https://api.sambanova.ai/v1');
    expect(samba.resolveModel('sambanova/Meta-Llama-3.1-405B-Instruct')).toBe('Meta-Llama-3.1-405B-Instruct');

    const hyp = new HyperbolicAdapter();
    expect((hyp as unknown as { resolveBase: (e: ProviderEndpoint) => string }).resolveBase(
      makeEndpoint({ providerId: 'hyperbolic', baseUrl: '' }),
    )).toBe('https://api.hyperbolic.xyz/v1');
    expect(hyp.resolveModel('hyperbolic/meta-llama/Llama-3.3-70B-Instruct')).toBe('meta-llama/Llama-3.3-70B-Instruct');

    const novita = new NovitaAdapter();
    expect((novita as unknown as { resolveBase: (e: ProviderEndpoint) => string }).resolveBase(
      makeEndpoint({ providerId: 'novita', baseUrl: '' }),
    )).toBe('https://api.novita.ai/v3/openai');
    expect(novita.resolveModel('novita/deepseek/deepseek-r1')).toBe('deepseek/deepseek-r1');

    const silicon = new SiliconFlowAdapter();
    expect((silicon as unknown as { resolveBase: (e: ProviderEndpoint) => string }).resolveBase(
      makeEndpoint({ providerId: 'siliconflow', baseUrl: '' }),
    )).toBe('https://api.siliconflow.cn/v1');
    expect(silicon.resolveModel('siliconflow/deepseek-ai/DeepSeek-V3')).toBe('deepseek-ai/DeepSeek-V3');
  });
});


import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, ModelDescriptor, ProviderEndpoint } from '@anx/core';

import { ProviderResponseError } from '@anx/core';
import { buildHeaders } from '../shared/http.js';
import { fetchJson, parseSseStream } from '../shared/http.js';

import { OpenAIAdapter } from './openai.js';
import type { OpenAIChatResponse } from './openai.js';

/**
 * OpenRouter — OpenAI-compatible aggregator.
 */
export class OpenRouterAdapter extends OpenAIAdapter {
  readonly providerId = 'openrouter';
  readonly displayName = 'OpenRouter';
  protected apiBase = 'https://openrouter.ai/api/v1';
  protected apiKeyEnv = 'OPENROUTER_API_KEY';
}

/**
 * DeepSeek — OpenAI-compatible.
 */
export class DeepSeekAdapter extends OpenAIAdapter {
  readonly providerId = 'deepseek';
  readonly displayName = 'DeepSeek';
  protected apiBase = 'https://api.deepseek.com/v1';
  protected apiKeyEnv = 'DEEPSEEK_API_KEY';

  override resolveModel(alias: string): string | undefined {
    const norm = alias.toLowerCase().trim();
    if (norm === 'deepseek-v4-pro' || norm === 'deepseek-r1' || norm.includes('reasoner') || norm.includes('thinking')) {
      return 'deepseek-reasoner';
    }
    if (norm === 'deepseek-v4-flash' || norm === 'deepseek-v4' || norm.includes('chat') || norm.includes('v3')) {
      return 'deepseek-chat';
    }
    return alias;
  }

  protected override translateRequest(req: ChatCompletionRequest, streaming: boolean): Record<string, unknown> {
    let model = req.model
      .replace(/^anthropic\//, '')
      .replace(/^deepseek\//, '')
      .replace(new RegExp('^' + this.providerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/'), '');
    const resolved = this.resolveModel(model);
    if (resolved) model = resolved;
    return super.translateRequest({ ...req, model }, streaming);
  }
}

/**
 * Mistral — OpenAI-compatible.
 */
export class MistralAdapter extends OpenAIAdapter {
  readonly providerId = 'mistral';
  readonly displayName = 'Mistral AI';
  protected apiBase = 'https://api.mistral.ai/v1';
  protected apiKeyEnv = 'MISTRAL_API_KEY';
  // Mistral's schema uses `extra="forbid"`, so the OpenAI `user` field is
  // rejected with HTTP 422 "extra_forbidden" — never forward it.
  protected supportsUserField = false;

  /**
   * Mistral's `/v1/models` endpoint returns a *federated marketplace* catalog:
   * alongside its ~40 native models (`mistral-*`, `codestral-*`, `ministral-*`,
   * …) it also lists hundreds of foreign-provider models under namespaced ids
   * (`z-ai/glm-5.2`, `deepseek/deepseek-v4-flash-vision-exp`, `qwen/qwen3.8-27b`, …).
   * Mistral cannot actually *serve* those foreign models — a chat request for
   * `glm-5-2` routed to `auto-mistral` fails with HTTP 403 "not available in
   * your subscription tier". Registering them under `providerId: mistral`
   * mis-routes requests away from the provider that genuinely serves them
   * (OpenRouter for `z-ai/glm-5.2`) and produces the "All providers exhausted"
   * / 403 interruption class. Only keep Mistral-native models (ids without a
   * `/` provider-namespace separator) for discovery.
   */
  async discoverModels(
    endpoint: ProviderEndpoint,
    signal: AbortSignal,
  ): Promise<readonly ModelDescriptor[]> {
    const all = await super.discoverModels(endpoint, signal);
    // Mistral's `/v1/models` returns a *federated marketplace* catalog: it lists
    // hundreds of foreign-provider models (gpt-*, gemini-*, claude-*, glm-*,
    // qwen*, deepseek-*, …) alongside its ~40 native models, and reports
    // `owned_by: "mistral"` for ALL of them (so the upstream owned_by field is
    // useless for filtering). Mistral cannot actually *serve* those foreign
    // models — a chat request for `glm-5-2` routed to `auto-mistral` fails with
    // HTTP 403 "not available in your subscription tier". Registering them under
    // `providerId: mistral` mis-routes requests away from the provider that
    // genuinely serves them (OpenRouter for `z-ai/glm-5.2`) and produces the
    // "All providers exhausted" / 403 interruption class. Keep only models in
    // Mistral's own namespace (stable, documented prefix convention).
    const MISTRAL_NATIVE = /^(mistral|ministral|codestral|pixtral|magistral|voxtral|mixtral|open-mistral|open-codestral|mistral-)/i;
    return all.filter((m) => MISTRAL_NATIVE.test(m.id));
  }

  override resolveModel(alias: string): string | undefined {
    const norm = alias.toLowerCase().trim();
    if (norm.includes('codestral') || norm.includes('coding') || norm.includes('coder')) {
      return 'codestral-latest';
    }
    if (norm.includes('large') || norm.includes('pro') || norm.includes('best') || norm.includes('claude') || norm.includes('gpt')) {
      return 'mistral-large-latest';
    }
    if (norm.includes('small') || norm.includes('fast') || norm.includes('flash')) {
      return 'mistral-small-latest';
    }
    if (/^(mistral|ministral|codestral|pixtral|magistral|voxtral|mixtral|open-mistral|open-codestral)/i.test(norm)) {
      return alias;
    }
    return 'codestral-latest';
  }
}

/**
 * xAI (Grok) — OpenAI-compatible.
 */
export class XaiAdapter extends OpenAIAdapter {
  readonly providerId = 'xai';
  readonly displayName = 'xAI (Grok)';
  protected apiBase = 'https://api.x.ai/v1';
  protected apiKeyEnv = 'XAI_API_KEY';
}

/**
 * Groq — OpenAI-compatible, ultra-low latency.
 */
export class GroqAdapter extends OpenAIAdapter {
  readonly providerId = 'groq';
  readonly displayName = 'Groq';
  protected apiBase = 'https://api.groq.com/openai/v1';
  protected apiKeyEnv = 'GROQ_API_KEY';
}

/**
 * Together AI — OpenAI-compatible.
 */
export class TogetherAdapter extends OpenAIAdapter {
  readonly providerId = 'together';
  readonly displayName = 'Together AI';
  protected apiBase = 'https://api.together.xyz/v1';
  protected apiKeyEnv = 'TOGETHER_API_KEY';
}

/**
 * Fireworks AI — OpenAI-compatible.
 */
export class FireworksAdapter extends OpenAIAdapter {
  readonly providerId = 'fireworks';
  readonly displayName = 'Fireworks AI';
  protected apiBase = 'https://api.fireworks.ai/inference/v1';
  protected apiKeyEnv = 'FIREWORKS_API_KEY';
}

/**
 * Cerebras — OpenAI-compatible, ultra-fast inference.
 */
export class CerebrasAdapter extends OpenAIAdapter {
  readonly providerId = 'cerebras';
  readonly displayName = 'Cerebras';
  protected apiBase = 'https://api.cerebras.ai/v1';
  protected apiKeyEnv = 'CEREBRAS_API_KEY';

  // Cerebras's GET /models exposes no context window, so we seed known limits
  // here. Any model not listed falls back to runtime learning from upstream
  // context_length_exceeded errors (see gateway reportUpstreamModelError).
  private static readonly KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
    'gpt-oss-120b': 128_000,
    'zai-glm-4.7': 8192,
  };

  async discoverModels(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<ModelDescriptor[]> {
    const models = await super.discoverModels(endpoint, signal);
    return models.map((m) => ({
      ...m,
      contextWindow: m.contextWindow ?? CerebrasAdapter.KNOWN_CONTEXT_WINDOWS[m.id],
    }));
  }
}

/**
 * Cloudflare Workers AI — OpenAI-compatible.
 */
export class CloudflareAdapter extends OpenAIAdapter {
  readonly providerId = 'cloudflare';
  readonly displayName = 'Cloudflare Workers AI';
  protected apiBase = 'https://api.cloudflare.com/client/v4/accounts';
  protected apiKeyEnv = 'CLOUDFLARE_API_TOKEN';

  /**
   * Cloudflare requires the account ID in the URL path. We expect the user
   * to set baseUrl to: https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1
   */
}

/**
 * Ollama — local, OpenAI-compatible.
 */
export class OllamaAdapter extends OpenAIAdapter {
  readonly providerId = 'ollama';
  readonly displayName = 'Ollama (Local)';
  protected apiBase = 'http://localhost:11434/v1';

  protected getApiKey(endpoint: ProviderEndpoint): string {
    // Ollama doesn't require an API key. Return a dummy.
    return (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey ?? 'ollama';
  }
}

/**
 * vLLM — local, OpenAI-compatible.
 */
export class VllmAdapter extends OpenAIAdapter {
  readonly providerId = 'vllm';
  readonly displayName = 'vLLM (Local)';
  protected apiBase = 'http://localhost:8000/v1';

  protected getApiKey(endpoint: ProviderEndpoint): string {
    return (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey ?? 'vllm';
  }
}

/**
 * LM Studio — local, OpenAI-compatible.
 */
export class LmStudioAdapter extends OpenAIAdapter {
  readonly providerId = 'lmstudio';
  readonly displayName = 'LM Studio (Local)';
  protected apiBase = 'http://localhost:1234/v1';

  protected getApiKey(endpoint: ProviderEndpoint): string {
    return (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey ?? 'lm-studio';
  }
}

/**
 * LiteLLM — local proxy, OpenAI-compatible.
 */
export class LitellmAdapter extends OpenAIAdapter {
  readonly providerId = 'litellm';
  readonly displayName = 'LiteLLM Proxy';
  protected apiBase = 'http://localhost:4000/v1';
  protected apiKeyEnv = 'LITELLM_API_KEY';
}

/**
 * Azure OpenAI — uses api-key header and a deployment-based URL scheme.
 */
/**
 * OpenCode Zen — OpenAI's official API for open-source models.
 */
export class OpenCodeZenAdapter extends OpenAIAdapter {
  readonly providerId: string = 'opencode-zen';
  readonly displayName: string = 'OpenCode Zen';
  protected apiBase = 'https://opencode.ai/zen/v1';
  protected apiKeyEnv = 'OPENCODE_ZEN_API_KEY';

  /**
   * OpenCode free-tier models accept keyless requests (same behaviour as
   * the free-claude-code launcher). FCC-style placeholder keys
   * (`opencode-zen-key-*`) mean "no key" — never send them upstream.
   */
  protected getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit && !/^opencode-zen-key-/i.test(explicit)) return explicit;
    return process.env[this.apiKeyEnv] ?? '';
  }

  protected headers(endpoint: ProviderEndpoint, apiKey: string): Record<string, string> {
    const h = buildHeaders(endpoint, '');
    delete h['Authorization'];
    if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
    return h;
  }

  override resolveModel(alias: string): string | undefined {
    const norm = alias.toLowerCase().trim();
    // If the input is already a concrete model (e.g. ends with -free or includes a specific model name), preserve it
    if (norm.endsWith('-free') || norm === 'big-pickle' || norm.includes('qwen-2.5-coder')) {
      return alias;
    }
    if (
      norm === 'deepseek-v4-flash' ||
      norm === 'deepseek-v4' ||
      norm === 'deepseek-v4-pro' ||
      norm === 'deepseek-chat' ||
      norm === 'deepseek-reasoner' ||
      norm.includes('deepseek')
    ) {
      return 'deepseek-v4-flash-free';
    }
    if (norm.includes('qwen')) {
      return 'qwen-2.5-coder-32b-instruct';
    }
    if (
      norm.includes('claude') ||
      norm.includes('gpt') ||
      norm.includes('auto') ||
      norm.includes('coding') ||
      norm.includes('reason')
    ) {
      // Default to a healthy free model on Zen
      return 'mimo-v2.5-free';
    }
    // Return undefined to let the requested model pass through unchanged
    return undefined;
  }

  /**
   * Upstream accepts bare model names only (e.g. `deepseek-v4-flash-free`).
   * Strip routing prefixes like `anthropic/opencode/` or `opencode/`.
   */
  protected translateRequest(req: ChatCompletionRequest, streaming: boolean): Record<string, unknown> {
    let model = req.model
      .replace(/^anthropic\//, '')
      .replace(/^opencode(?:-zen|-go)?\//, '')
      .replace(new RegExp('^' + this.providerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/'), '');
    const resolved = this.resolveModel(model);
    if (resolved) model = resolved;
    return super.translateRequest({ ...req, model }, streaming);
  }
}

/**
 * OpenCode Go — subscription tier of OpenCode's hosted gateway.
 * Same OpenAI-compatible surface as OpenCode Zen but a different base URL.
 */
export class OpenCodeGoAdapter extends OpenCodeZenAdapter {
  readonly providerId = 'opencode-go';
  readonly displayName = 'OpenCode Go';
  protected apiBase = 'https://opencode.ai/zen/go/v1';
  protected apiKeyEnv = 'OPENCODE_GO_API_KEY';

  override resolveModel(alias: string): string | undefined {
    const norm = alias.toLowerCase().trim();
    // OpenCode Go has its own native catalog (hy4-preview, hy3, qwen3.7-plus, etc.).
    // Never force to Zen's -free models.
    if (norm.includes('qwen')) return 'qwen3.7-plus';
    if (norm.includes('claude') || norm.includes('auto') || norm.includes('coding')) return 'hy4-preview';
    // Preserve requested model verbatim
    return alias;
  }

  /**
   * OpenCode Go keys follow the same FCC-style placeholder convention;
   * placeholder keys mean "no key" and must never be sent upstream.
   */
  protected getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit && !/^opencode-(?:go|zen)-key-/i.test(explicit)) return explicit;
    return process.env[this.apiKeyEnv] ?? '';
  }
}

/**
 * NVIDIA NIM — OpenAI-compatible hosted inference.
 */
export class NvidiaNimAdapter extends OpenAIAdapter {
  readonly providerId = 'nvidia-nim';
  readonly displayName = 'NVIDIA NIM';
  protected apiBase = 'https://integrate.api.nvidia.com/v1';
  protected apiKeyEnv = 'NVIDIA_API_KEY';

  override resolveModel(alias: string): string | undefined {
    return alias;
  }

  /**
   * NVIDIA's `/v1/models` catalog is public — model discovery must work
   * without a key (vault keys are only attached to request-time leases,
   * never to the endpoint objects the discovery loop iterates). Requests
   * that actually need auth will still fail upstream with a clean error.
   */
  protected getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    return process.env[this.apiKeyEnv] ?? '';
  }
}

export class AzureOpenAIAdapter extends OpenAIAdapter {
  readonly providerId = 'azure-openai';
  readonly displayName = 'Azure OpenAI';
  protected apiKeyEnv = 'AZURE_OPENAI_API_KEY';

  protected authHeaderName = 'api-key';
  protected authHeaderPrefix = '';

  /**
   * Azure expects: {base}/openai/deployments/{deployment}/chat/completions?api-version=2024-10-21
   * The user must set baseUrl to the Azure resource endpoint, and we look up
   * the deployment name from `endpoint.tags[0]` or the model alias.
   */
  async chatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const apiKey = this.getApiKey(endpoint);
    const deployment = endpoint.tags[0] ?? request.model;
    const apiVersion = '2024-10-21';
    const url = `${this.resolveBase(endpoint)}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
    const body = this.translateRequest(request, false);
    // Azure does not accept `model` in body for deployment-based calls.
    delete body['model'];

    // We need to fetchJson with the custom header set, so do it inline.
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(endpoint, apiKey),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new (await import('@anx/core')).ProviderResponseError(
        endpoint.id,
        response.status,
        text,
        { url },
      );
    }
    const raw = (await response.json()) as Record<string, unknown>;
    return this.translateResponse(
      {
        id: raw['id'] as string,
        object: 'chat.completion',
        created: raw['created'] as number,
        model: deployment,
        choices: raw['choices'] as never,
        usage: raw['usage'] as never,
        system_fingerprint: raw['system_fingerprint'] as string | undefined,
      },
      endpoint,
    );
  }
}

export class GenericOpenAIAdapter extends OpenAIAdapter {
  readonly providerId: string;
  readonly displayName: string;
  protected override apiBase: string;
  protected override apiKeyEnv: string;

  constructor(providerId: string, displayName?: string, apiBase?: string) {
    super();
    this.providerId = providerId;
    this.displayName = displayName ?? providerId;
    this.apiBase = apiBase ?? '';
    this.apiKeyEnv = `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  }
}

// ── Free-tier expansion (FreeLLMAPI parity) ──────────────────────────────
// Six free-serving OpenAI-compatible providers, each grounded against the
// upstream platform docs and FreeLLMAPI's provider quirks (verified 2026-09):
// Cohere (compat endpoint + tool-schema strip), Hugging Face (router),
// Zhipu AI / Z.ai (dual-console host fallback), ModelScope (chat-probe
// health check — its GET /models answers 200 even for garbage keys),
// ElectronHub, Experiential Labs.

/** JSON-Schema keywords Cohere's compat endpoint rejects with HTTP 400. */
const COHERE_UNSUPPORTED_SCHEMA_KEYS = new Set(['additionalProperties', '$schema']);

/** Recursively drop Cohere-rejected schema keywords (deep clone). */
function stripCohereSchemaKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCohereSchemaKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (COHERE_UNSUPPORTED_SCHEMA_KEYS.has(k)) continue;
      out[k] = stripCohereSchemaKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * Cohere — OpenAI-compatible via /compatibility/v1. Bearer auth.
 * Quirk: the tool-schema validator rejects additionalProperties/$schema,
 * which strict clients send by default — stripped here before sending.
 */
export class CohereAdapter extends OpenAIAdapter {
  readonly providerId = 'cohere';
  readonly displayName = 'Cohere';
  protected apiBase = 'https://api.cohere.ai/compatibility/v1';
  protected apiKeyEnv = 'COHERE_API_KEY';

  protected override translateRequest(req: ChatCompletionRequest, streaming: boolean): Record<string, unknown> {
    const body = super.translateRequest(req, streaming);
    const tools = body['tools'];
    if (Array.isArray(tools)) {
      body['tools'] = tools.map((t) => {
        if (t !== null && typeof t === 'object' && 'function' in t) {
          const fn = (t as { function?: unknown }).function;
          if (fn !== null && typeof fn === 'object') {
            const params = (fn as { parameters?: unknown }).parameters;
            return { ...t, function: { ...(fn as Record<string, unknown>), parameters: stripCohereSchemaKeys(params) } };
          }
        }
        return t;
      });
    }
    return body;
  }
}

/**
 * Hugging Face Inference Providers — OpenAI-compatible router.
 * Bearer auth; honors the native HF_TOKEN env alongside HUGGINGFACE_API_KEY.
 */
export class HuggingFaceAdapter extends OpenAIAdapter {
  readonly providerId = 'huggingface';
  readonly displayName = 'Hugging Face';
  protected apiBase = 'https://router.huggingface.co/v1';
  protected apiKeyEnv = 'HUGGINGFACE_API_KEY';

  protected override getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    const fromEnv = process.env['HF_TOKEN'] ?? process.env[this.apiKeyEnv];
    if (fromEnv) return fromEnv;
    return super.getApiKey(endpoint);
  }
}

/** Zhipu AI domestic console (bigmodel.cn) — the historical default host. */
const ZHIPU_DOMESTIC_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
/** Z.ai global console — same surface, disjoint key namespace. */
const ZHIPU_GLOBAL_BASE_URL = 'https://api.z.ai/api/paas/v4';

/**
 * Zhipu AI / Z.ai — OpenAI-compatible. One platform, two consoles whose keys
 * are NOT interchangeable (a z.ai key is a 401 at open.bigmodel.cn and vice
 * versa). The domestic host stays the default; only a key the domestic host
 * actually rejects is retried against the global host, and the verdict is
 * remembered per key so follow-up traffic goes straight to the right host.
 */
export class ZhipuAdapter extends OpenAIAdapter {
  readonly providerId = 'zhipu';
  readonly displayName = 'Zhipu AI (Z.ai)';
  protected apiBase = ZHIPU_DOMESTIC_BASE_URL;
  protected apiKeyEnv = 'ZHIPU_API_KEY';

  /** Keys proven to belong to the global console (in-memory, re-derivable). */
  private readonly globalKeys = new Set<string>();

  private zhipuBaseFor(apiKey: string): string {
    return this.globalKeys.has(apiKey) ? ZHIPU_GLOBAL_BASE_URL : ZHIPU_DOMESTIC_BASE_URL;
  }

  override async chatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const apiKey = this.getApiKey(endpoint);
    const body = this.translateRequest(request, false);
    const run = async (base: string): Promise<ChatCompletionResponse> => {
      const url = base + '/chat/completions';
      let responseHeaders: Record<string, string> | undefined;
      const raw = await fetchJson<OpenAIChatResponse>(url, {
        method: 'POST',
        headers: this.headers(endpoint, apiKey),
        body: JSON.stringify(body),
      }, endpoint, signal, (h) => { responseHeaders = h; });
      return this.translateResponse(raw, endpoint, responseHeaders);
    };
    try {
      return await run(this.zhipuBaseFor(apiKey));
    } catch (err) {
      if ((err as { status?: number }).status === 401 && !this.globalKeys.has(apiKey)) {
        this.globalKeys.add(apiKey);
        try {
          return await run(ZHIPU_GLOBAL_BASE_URL);
        } catch (err2) {
          this.globalKeys.delete(apiKey);
          throw err2;
        }
      }
      throw err;
    }
  }

  override async *streamChatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk> {
    const apiKey = this.getApiKey(endpoint);
    const body = this.translateRequest(request, true);
    let base = this.zhipuBaseFor(apiKey);
    const openStream = async (b: string) => {
      const url = b + '/chat/completions';
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
        throw new ProviderResponseError(endpoint.id, 0, 'No response body for stream', { url });
      }
      return response.body;
    };
    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await openStream(base);
    } catch (err) {
      if ((err as { status?: number }).status === 401 && !this.globalKeys.has(apiKey)) {
        this.globalKeys.add(apiKey);
        base = ZHIPU_GLOBAL_BASE_URL;
        try {
          stream = await openStream(base);
        } catch (err2) {
          this.globalKeys.delete(apiKey);
          throw err2;
        }
      } else {
        throw err;
      }
    }
    for await (const evt of parseSseStream(stream)) {
      const chunk = this.translateChunk(evt);
      if (chunk) yield chunk;
    }
  }
}

/**
 * ModelScope (Alibaba) — OpenAI-compatible inference API. Bearer auth;
 * honors the native MODELSCOPE_API_TOKEN env alongside MODELSCOPE_API_KEY.
 * Health-check trap: GET /v1/models answers 200 WITHOUT auth (even for
 * garbage keys), so validation must be a 1-token chat probe. Successful
 * probes are cached per endpoint for 24h to avoid burning the grain quota;
 * a revoked key is still caught by the next real request's 401 handling.
 */
export class ModelScopeAdapter extends OpenAIAdapter {
  readonly providerId = 'modelscope';
  readonly displayName = 'ModelScope';
  protected apiBase = 'https://api-inference.modelscope.cn/v1';
  protected apiKeyEnv = 'MODELSCOPE_API_KEY';

  private static readonly VALIDATE_CACHE_MS = 24 * 60 * 60 * 1000;
  private readonly validatedAt = new Map<string, number>();

  protected override getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    const fromEnv = process.env['MODELSCOPE_API_TOKEN'] ?? process.env[this.apiKeyEnv];
    if (fromEnv) return fromEnv;
    return super.getApiKey(endpoint);
  }

  override async healthCheck(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<boolean> {
    const last = this.validatedAt.get(endpoint.id);
    if (last !== undefined && Date.now() - last < ModelScopeAdapter.VALIDATE_CACHE_MS) return true;
    try {
      const apiKey = this.getApiKey(endpoint);
      const base = this.resolveBase(endpoint);
      let probeModel = 'Qwen/Qwen2.5-7B-Instruct';
      try {
        const listRes = await fetch(base + '/models', {
          method: 'GET',
          headers: this.headers(endpoint, apiKey),
          signal,
        });
        const list = (await listRes.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
        const first = list?.data?.find((m) => typeof m?.id === 'string')?.id as string | undefined;
        if (first) probeModel = first;
      } catch {
        // Roster lookup failed — fall back to the well-known default id.
      }
      const res = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { ...this.headers(endpoint, apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: probeModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal,
      });
      if (!res.ok) return false;
      this.validatedAt.set(endpoint.id, Date.now());
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * ElectronHub — OpenAI-compatible gateway (also speaks Anthropic at its
 * root, but the OpenAI surface is what this adapter uses). Bearer ek- keys.
 */
export class ElectronHubAdapter extends OpenAIAdapter {
  readonly providerId = 'electronhub';
  readonly displayName = 'ElectronHub';
  protected apiBase = 'https://api.electronhub.ai/v1';
  protected apiKeyEnv = 'ELECTRONHUB_API_KEY';
}

/**
 * Experiential Labs — open-source gateway (BYOK + hosted), OpenAI-compatible
 * (also serves /v1/messages). Bearer xpl- keys; honors EXPLABS_API_KEY.
 */
export class ExperientialAdapter extends OpenAIAdapter {
  readonly providerId = 'experiential';
  readonly displayName = 'Experiential Labs';
  protected apiBase = 'https://api.experientiallabs.ai/v1';
  protected apiKeyEnv = 'EXPERIENTIAL_API_KEY';

  protected override getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    const fromEnv = process.env['EXPLABS_API_KEY'] ?? process.env[this.apiKeyEnv];
    if (fromEnv) return fromEnv;
    return super.getApiKey(endpoint);
  }
}

/**
 * Kilo Gateway — OpenAI-compatible keyless free gateway & proxy.
 * Base: https://api.kilo.ai/api/gateway/v1. Keyless operation permitted.
 */
export class KiloGatewayAdapter extends OpenAIAdapter {
  readonly providerId = 'kilo';
  readonly displayName = 'Kilo Gateway';
  protected apiBase = 'https://api.kilo.ai/api/gateway/v1';
  protected apiKeyEnv = 'KILO_API_KEY';

  protected override getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit && !/^kilo-placeholder/i.test(explicit)) return explicit;
    return process.env[this.apiKeyEnv] ?? '';
  }

  protected override headers(endpoint: ProviderEndpoint, apiKey: string): Record<string, string> {
    const h = buildHeaders(endpoint, '');
    delete h['Authorization'];
    if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
    return h;
  }

  protected override resolveModelsUrl(endpoint: ProviderEndpoint): string {
    return `${this.resolveBase(endpoint)}/models`;
  }

  override resolveModel(alias: string): string | undefined {
    let m = alias.replace(/^(?:anthropic\/)?kilo\//i, '').trim();
    return m || undefined;
  }
}

/**
 * Pollinations AI — completely keyless, unlimited free text and image generation.
 * Base: https://text.pollinations.ai/openai.
 */
export class PollinationsAdapter extends OpenAIAdapter {
  readonly providerId = 'pollinations';
  readonly displayName = 'Pollinations AI';
  protected apiBase = 'https://text.pollinations.ai/openai';
  protected apiKeyEnv = 'POLLINATIONS_API_KEY';

  protected override getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    return process.env[this.apiKeyEnv] ?? '';
  }

  protected override headers(endpoint: ProviderEndpoint, apiKey: string): Record<string, string> {
    const h = buildHeaders(endpoint, '');
    delete h['Authorization'];
    if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
    return h;
  }

  override resolveModel(alias: string): string | undefined {
    let m = alias.replace(/^(?:anthropic\/)?pollinations\//i, '').trim();
    return m || undefined;
  }

  override async discoverModels(endpoint: ProviderEndpoint, signal: AbortSignal): Promise<readonly ModelDescriptor[]> {
    try {
      const apiKey = this.getApiKey(endpoint);
      const url = `${this.resolveBase(endpoint)}/models`;
      const res = await fetch(url, {
        method: 'GET',
        headers: this.headers(endpoint, apiKey),
        signal,
      });
      if (res.ok) {
        const json = (await res.json()) as unknown;
        const now = Date.now();
        if (json && typeof json === 'object' && Array.isArray((json as { data?: unknown[] }).data)) {
          return ((json as { data: Array<{ id: string }> }).data).map((m) => ({
            id: m.id,
            providerId: this.providerId,
            displayName: m.id,
            contextWindow: 32768,
            maxOutputTokens: 4096,
            isFree: true,
            discoveredAt: now,
          }));
        }
        if (Array.isArray(json)) {
          return json.map((item) => {
            const id = typeof item === 'string' ? item : ((item as { name?: string; id?: string }).name ?? (item as { id?: string }).id ?? 'openai');
            return {
              id,
              providerId: this.providerId,
              displayName: id,
              contextWindow: 32768,
              maxOutputTokens: 4096,
              isFree: true,
              discoveredAt: now,
            };
          });
        }
      }
    } catch {
      // Fall through to default catalog
    }
    const defaultModels = ['openai', 'mistral', 'qwen', 'searchgpt'];
    const now = Date.now();
    return defaultModels.map((id) => ({
      id,
      providerId: this.providerId,
      displayName: id,
      contextWindow: 32768,
      maxOutputTokens: 4096,
      isFree: true,
      discoveredAt: now,
    }));
  }

  override async media(
    endpoint: ProviderEndpoint,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<{ readonly status: number; readonly contentType: string; readonly data: Uint8Array }> {
    if (path.includes('images')) {
      const b = (typeof body === 'string' ? JSON.parse(body) : (body ?? {})) as {
        prompt?: string;
        model?: string;
        size?: string;
        n?: number;
      };
      const prompt = b.prompt || 'a serene landscape';
      const sizeParts = (b.size || '1024x1024').split('x');
      const width = parseInt(sizeParts[0] || '1024', 10) || 1024;
      const height = parseInt(sizeParts[1] || '1024', 10) || 1024;
      const model = b.model && b.model !== 'auto' ? `&model=${encodeURIComponent(b.model)}` : '';
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true${model}`;

      const responsePayload = {
        created: Math.floor(Date.now() / 1000),
        data: [
          {
            url: imageUrl,
            revised_prompt: prompt,
          },
        ],
      };
      const bytes = new TextEncoder().encode(JSON.stringify(responsePayload));
      return {
        status: 200,
        contentType: 'application/json',
        data: bytes,
      };
    }
    return super.media(endpoint, path, body, signal);
  }
}

/**
 * AI Horde — volunteer-powered crowdsourced compute with anonymous fallback key '0000000000'.
 * Official OpenAI-compatible gateway: https://oai.aihorde.net/v1.
 */
export class AiHordeAdapter extends OpenAIAdapter {
  readonly providerId = 'aihorde';
  readonly displayName = 'AI Horde';
  protected apiBase = 'https://oai.aihorde.net/v1';
  protected apiKeyEnv = 'AIHORDE_API_KEY';

  protected override getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit && !/^aihorde-placeholder/i.test(explicit)) return explicit;
    return process.env[this.apiKeyEnv] ?? '0000000000';
  }

  protected override headers(endpoint: ProviderEndpoint, apiKey: string): Record<string, string> {
    const h = super.headers(endpoint, apiKey);
    h['Client-Agent'] = 'Nexus:0.5.0:nexus@local';
    return h;
  }

  override resolveModel(alias: string): string | undefined {
    let m = alias.replace(/^(?:anthropic\/)?(?:aihorde|horde)\//i, '').trim();
    return m || undefined;
  }
}

/**
 * AMD Radeon Cloud — specialized inference preset with single tool call requirement.
 * Base: https://developer.amd.com.cn/radeon/api/v1.
 */
export class RadeonAdapter extends OpenAIAdapter {
  readonly providerId = 'radeon';
  readonly displayName = 'AMD Radeon Cloud';
  protected apiBase = 'https://developer.amd.com.cn/radeon/api/v1';
  protected apiKeyEnv = 'RADEON_API_KEY';

  protected override getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    const fromEnv = process.env['RADEON_API_KEY'] ?? process.env['AMD_RADEON_API_KEY'];
    if (fromEnv) return fromEnv;
    return super.getApiKey(endpoint);
  }

  override resolveModel(alias: string): string | undefined {
    let m = alias.replace(/^(?:anthropic\/)?(?:radeon|amd)\//i, '').trim();
    return m || undefined;
  }

  protected override translateRequest(req: ChatCompletionRequest, streaming: boolean): Record<string, unknown> {
    const body = super.translateRequest(req, streaming);
    const tools = body['tools'];
    // AMD Radeon Cloud requires single tool call handling
    if (Array.isArray(tools) && tools.length > 1) {
      body['tools'] = [tools[0]];
    }
    body['parallel_tool_calls'] = false;
    return body;
  }
}

/**
 * AnyAPI — hosted OpenAI-compatible router with 100K daily tokens free-tier quota.
 * Base: https://api.anyapi.ai/v1.
 */
export class AnyApiAdapter extends OpenAIAdapter {
  readonly providerId = 'anyapi';
  readonly displayName = 'AnyAPI';
  protected apiBase = 'https://api.anyapi.ai/v1';
  protected apiKeyEnv = 'ANYAPI_API_KEY';

  override resolveModel(alias: string): string | undefined {
    let m = alias.replace(/^(?:anthropic\/)?anyapi\//i, '').trim();
    return m || undefined;
  }
}

/**
 * GitHub Models — Azure-backed developer inference catalog. Bearer auth via GITHUB_TOKEN.
 * Base: https://models.github.ai/inference.
 */
export class GitHubModelsAdapter extends OpenAIAdapter {
  readonly providerId = 'github';
  readonly displayName = 'GitHub Models';
  protected apiBase = 'https://models.github.ai/inference';
  protected apiKeyEnv = 'GITHUB_TOKEN';

  protected override getApiKey(endpoint: ProviderEndpoint): string {
    const explicit = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
    if (explicit) return explicit;
    const fromEnv = process.env['GITHUB_TOKEN'] ?? process.env['GITHUB_MODELS_API_KEY'] ?? process.env['GH_TOKEN'];
    if (fromEnv) return fromEnv;
    return super.getApiKey(endpoint);
  }

  protected override headers(endpoint: ProviderEndpoint, apiKey: string): Record<string, string> {
    const h = super.headers(endpoint, apiKey);
    h['User-Agent'] = 'Nexus-Gateway/0.5.0';
    return h;
  }

  override resolveModel(alias: string): string | undefined {
    let m = alias.replace(/^(?:anthropic\/)?(?:github|gh)\//i, '').trim();
    return m || undefined;
  }
}

// Re-export the type so subclasses can import it together.
// (Type imports are hoisted to the top of the file for ESLint import/order compliance.)

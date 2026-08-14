import type { ChatCompletionRequest, ChatCompletionResponse, ModelDescriptor, ProviderEndpoint } from '@anx/core';

import { buildHeaders } from '../shared/http.js';

import { OpenAIAdapter } from './openai.js';

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

  /**
   * Upstream accepts bare model names only (e.g. `deepseek-v4-flash-free`).
   * Strip routing prefixes like `anthropic/opencode/` or `opencode/`.
   */
  protected translateRequest(req: ChatCompletionRequest, streaming: boolean): Record<string, unknown> {
    const model = req.model.replace(/^anthropic\//, '').replace(/^opencode(?:-zen|-go)?\//, '');
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

// Re-export the type so subclasses can import it together.
// (Type imports are hoisted to the top of the file for ESLint import/order compliance.)

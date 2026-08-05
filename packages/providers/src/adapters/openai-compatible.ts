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

// Re-export the type so subclasses can import it together.
import type { ChatCompletionRequest, ChatCompletionResponse, ProviderEndpoint } from '@anx/core';

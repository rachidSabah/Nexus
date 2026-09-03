import type { ProviderCapabilities, RoutingEnginePort, CredentialVaultPort } from '@anx/core';

import type { GatewayConfig } from './config.js';

/**
 * Probes an endpoint's base URL before registration so unreachable services
 * (e.g. Ollama when not installed) are never advertised as healthy. The
 * routing engine only selects healthy/degraded endpoints — a dead endpoint
 * registered as 'healthy' gets picked by weighted routing and 500s every
 * request routed to it.
 */
async function probeBaseUrl(baseUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      signal: AbortSignal.timeout(4_000),
    });
    // 2xx/3xx/401/403 all mean "server is up"; only 5xx or network errors mean down.
    return r.status < 500;
  } catch {
    return false;
  }
}

/**
 * Per-provider default capabilities. Previously a single `DEFAULT_CAPS` was
 * applied to every auto-registered provider, which silently disabled
 * embeddings/vision/reasoning even for providers that actually support them
 * (OpenAI, Google, etc.). This table reflects what each provider's official
 * API actually supports.
 */
const PROVIDER_DEFAULT_CAPS: Record<string, ProviderCapabilities> = {
  openai: {
    streaming: true, toolCalling: true, vision: true, audio: false, speech: true,
    embeddings: true, reasoning: false, jsonMode: true,
    maxOutputTokens: 16384, maxInputTokens: 128000, supportedModalities: ['text', 'image'],
  },
  anthropic: {
    streaming: true, toolCalling: true, vision: true, audio: false, speech: false,
    embeddings: false, reasoning: true, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 200000, supportedModalities: ['text', 'image'],
  },
  google: {
    streaming: true, toolCalling: true, vision: true, audio: true, speech: true,
    embeddings: true, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 1000000, supportedModalities: ['text', 'image', 'audio'],
  },
  deepseek: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: true, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 64000, supportedModalities: ['text'],
  },
  openrouter: {
    streaming: true, toolCalling: true, vision: true, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 128000, supportedModalities: ['text', 'image'],
  },
  groq: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 128000, supportedModalities: ['text'],
  },
  mistral: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: true, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32000, supportedModalities: ['text'],
  },
  xai: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: true, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 128000, supportedModalities: ['text'],
  },
  ollama: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: true, reasoning: false, jsonMode: false,
    maxOutputTokens: 8192, maxInputTokens: 128000, supportedModalities: ['text'],
  },
  vllm: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: true, reasoning: false, jsonMode: false,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  lmstudio: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: true, reasoning: false, jsonMode: false,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  together: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  fireworks: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  cerebras: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  cloudflare: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  litellm: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  azure: {
    streaming: true, toolCalling: true, vision: true, audio: false, speech: true,
    embeddings: true, reasoning: false, jsonMode: true,
    maxOutputTokens: 16384, maxInputTokens: 128000, supportedModalities: ['text', 'image'],
  },
  'opencode-zen': {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  'opencode-go': {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  'nvidia-nim': {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  nvidia: {
    streaming: true, toolCalling: true, vision: false, audio: false, speech: false,
    embeddings: false, reasoning: false, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 32768, supportedModalities: ['text'],
  },
  'antigravity-cli': {
    streaming: true, toolCalling: true, vision: true, audio: false, speech: false,
    embeddings: false, reasoning: true, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 1000000, supportedModalities: ['text', 'image'],
  },
  antigravity: {
    streaming: true, toolCalling: true, vision: true, audio: false, speech: false,
    embeddings: false, reasoning: true, jsonMode: true,
    maxOutputTokens: 8192, maxInputTokens: 1000000, supportedModalities: ['text', 'image'],
  },
};

const FALLBACK_CAPS: ProviderCapabilities = {
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
};

/** Returns the default capability set for a given provider id. */
export function defaultCapabilitiesFor(providerId: string): ProviderCapabilities {
  return PROVIDER_DEFAULT_CAPS[providerId] ?? FALLBACK_CAPS;
}

/** Default API base URL per provider (used when auto-registering endpoints from keys). */
const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  together: 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  cloudflare: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
  'nvidia-nim': 'https://integrate.api.nvidia.com/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  'opencode-zen': 'https://opencode.ai/zen/v1',
  'opencode-go': 'https://opencode.ai/zen/go/v1',
  ollama: 'http://localhost:11434/v1',
  vllm: 'http://localhost:8000/v1',
  lmstudio: 'http://localhost:1234/v1',
  litellm: 'http://localhost:4000/v1',
  // AzureOpenAIAdapter appends `/openai/deployments/{deployment}/chat/completions`
  // itself, so the base must be the resource root (no `/openai/v1` suffix —
  // that would yield a double `/openai/` path and 404 upstream).
  'azure-openai': 'https://{resource}.openai.azure.com',
  'aws-bedrock': 'https://bedrock-runtime.{region}.amazonaws.com',
};

/** Default pricing (per 1K tokens, USD) per provider for auto-registered endpoints. */
const PROVIDER_DEFAULT_PRICING: Record<string, { inputPer1K: number; outputPer1K: number; currency: 'USD' | 'EUR' }> = {
  openai: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
  anthropic: { inputPer1K: 0.003, outputPer1K: 0.015, currency: 'USD' },
  google: { inputPer1K: 0.00125, outputPer1K: 0.005, currency: 'USD' },
  deepseek: { inputPer1K: 0.001, outputPer1K: 0.002, currency: 'USD' },
  openrouter: { inputPer1K: 0.005, outputPer1K: 0.015, currency: 'USD' },
  groq: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  mistral: { inputPer1K: 0.001, outputPer1K: 0.003, currency: 'USD' },
  xai: { inputPer1K: 0.005, outputPer1K: 0.015, currency: 'USD' },
  together: { inputPer1K: 0.002, outputPer1K: 0.008, currency: 'USD' },
  fireworks: { inputPer1K: 0.002, outputPer1K: 0.008, currency: 'USD' },
  cerebras: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  'nvidia-nim': { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  nvidia: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  'opencode-zen': { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  'opencode-go': { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  ollama: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  vllm: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  lmstudio: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  litellm: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
  'azure-openai': { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
};

/** Returns the default base URL for a given provider id. */
export function defaultBaseUrlFor(providerId: string): string {
  return PROVIDER_DEFAULT_BASE_URLS[providerId] ?? '';
}

/** Returns the default pricing for a given provider id (per 1K tokens, USD). */
export function defaultPricingFor(providerId: string): { inputPer1K: number; outputPer1K: number; currency: 'USD' | 'EUR' } {
  return PROVIDER_DEFAULT_PRICING[providerId] ?? { inputPer1K: 0, outputPer1K: 0, currency: 'USD' };
}

/**
 * Register endpoints from config into the routing engine. If config has no
 * endpoints, register a sensible default set (OpenAI + Anthropic) but only
 * if their API keys are present in env — otherwise the gateway starts
 * empty and the user adds endpoints via the dashboard / config.
 */
export async function registerDefaultEndpoints(
  routing: RoutingEnginePort,
  config: GatewayConfig,
  vault: CredentialVaultPort,
): Promise<void> {
  // Register explicitly-configured endpoints.
  for (const e of config.endpoints) {
    if (e.apiKey) {
      await vault.set(e.id, e.apiKey);
    }
    routing.registerEndpoint({
      id: e.id,
      providerId: e.providerId,
      displayName: e.displayName,
      baseUrl: e.baseUrl ?? '',
      capabilities: { ...defaultCapabilitiesFor(e.providerId), ...(e.capabilities as Partial<ProviderCapabilities> | undefined) },
      pricing: e.pricing,
      priority: e.priority,
      weight: e.weight,
      region: e.region,
      tags: e.tags ?? [],
      timeoutMs: e.timeoutMs ?? 30_000,
      maxRetries: e.maxRetries ?? 2,
      concurrencyLimit: e.concurrencyLimit ?? 10,
      health: 'healthy',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // Auto-register providers from env vars if no explicit endpoints.
  if (config.endpoints.length === 0) {
    const autoEndpoints: Array<{ providerId: string; envVar: string; baseUrl: string; keyless: boolean; pricing: { inputPer1K: number; outputPer1K: number; currency: 'USD' | 'EUR' } }> = [
      { providerId: 'openai', envVar: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', keyless: false, pricing: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' } },
      { providerId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com', keyless: false, pricing: { inputPer1K: 0.003, outputPer1K: 0.015, currency: 'USD' } },
      { providerId: 'deepseek', envVar: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com/v1', keyless: false, pricing: { inputPer1K: 0.001, outputPer1K: 0.002, currency: 'USD' } },
      { providerId: 'openrouter', envVar: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', keyless: false, pricing: { inputPer1K: 0.005, outputPer1K: 0.015, currency: 'USD' } },
      { providerId: 'groq', envVar: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', keyless: false, pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'google', envVar: 'GOOGLE_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyless: false, pricing: { inputPer1K: 0.00125, outputPer1K: 0.005, currency: 'USD' } },
      { providerId: 'mistral', envVar: 'MISTRAL_API_KEY', baseUrl: 'https://api.mistral.ai/v1', keyless: false, pricing: { inputPer1K: 0.001, outputPer1K: 0.003, currency: 'USD' } },
      { providerId: 'xai', envVar: 'XAI_API_KEY', baseUrl: 'https://api.x.ai/v1', keyless: false, pricing: { inputPer1K: 0.005, outputPer1K: 0.015, currency: 'USD' } },
      { providerId: 'together', envVar: 'TOGETHER_API_KEY', baseUrl: 'https://api.together.xyz/v1', keyless: false, pricing: { inputPer1K: 0.002, outputPer1K: 0.008, currency: 'USD' } },
      { providerId: 'fireworks', envVar: 'FIREWORKS_API_KEY', baseUrl: 'https://api.fireworks.ai/inference/v1', keyless: false, pricing: { inputPer1K: 0.002, outputPer1K: 0.008, currency: 'USD' } },
      { providerId: 'cerebras', envVar: 'CEREBRAS_API_KEY', baseUrl: 'https://api.cerebras.ai/v1', keyless: false, pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'nvidia-nim', envVar: 'NVIDIA_API_KEY', baseUrl: 'https://integrate.api.nvidia.com/v1', keyless: false, pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'opencode-zen', envVar: 'OPENCODE_ZEN_API_KEY', baseUrl: 'https://opencode.ai/zen/v1', keyless: false, pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'opencode-go', envVar: 'OPENCODE_GO_API_KEY', baseUrl: 'https://opencode.ai/zen/go/v1', keyless: false, pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      // ── First-class self-hosted / local providers (keyless, probed at boot) ──
      // Ollama, vLLM, and LM Studio expose OpenAI-compatible /v1 endpoints.
      // Registered with the same health-probe + failover treatment as cloud
      // providers, so local models participate in routing (privacy/air-gapped).
      { providerId: 'ollama', envVar: '', baseUrl: 'http://localhost:11434/v1', keyless: true, pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'vllm', envVar: '', baseUrl: 'http://localhost:8000/v1', keyless: true, pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'lm-studio', envVar: '', baseUrl: 'http://localhost:1234/v1', keyless: true, pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
    ];

    for (const e of autoEndpoints) {
      const apiKey = e.envVar ? process.env[e.envVar] : undefined;
      if (!apiKey && !e.keyless) continue;
      // Persist real keys only — never write placeholder/local sentinels to
      // the vault (auto-endpoints are re-derived from env at every boot).
      if (apiKey) await vault.set(e.providerId, apiKey);
      const reachable = await probeBaseUrl(e.baseUrl);
      routing.registerEndpoint({
        id: `auto-${e.providerId}`,
        providerId: e.providerId,
        displayName: e.providerId,
        baseUrl: e.baseUrl,
        capabilities: defaultCapabilitiesFor(e.providerId),
        pricing: e.pricing,
        priority: 1,
        weight: 1,
        region: 'auto',
        tags: ['auto'],
        timeoutMs: 30_000,
        maxRetries: 2,
        concurrencyLimit: 10,
        health: reachable ? 'healthy' : 'unhealthy',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      if (!reachable) {
        console.log(`[endpoints] auto-${e.providerId} unreachable at ${e.baseUrl} — registered unhealthy (excluded from routing)`);
      }
    }

    // Allow test environments (and explicit opt-out) to suppress the CLI provider.
    if (!process.env['ANX_DISABLE_ANTIGRAVITY_CLI']) {
      try {
        const { AntigravityCliAdapter } = await import('@anx/providers');
      const agyAdapter = new AntigravityCliAdapter();
      const agyExe = await agyAdapter.findExecutable();
      const agyHealthy = agyExe ? await agyAdapter.healthCheck({ id: 'auto-antigravity-cli' } as ProviderEndpoint, AbortSignal.timeout(3000)) : false;

      routing.registerEndpoint({
        id: 'auto-antigravity-cli',
        providerId: 'antigravity-cli',
        displayName: 'Google Antigravity CLI',
        baseUrl: agyExe ? `cli://${agyExe}` : 'cli://agy',
        capabilities: defaultCapabilitiesFor('antigravity-cli'),
        pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
        priority: 2,
        weight: 1,
        region: 'local',
        tags: ['cli', 'local', 'antigravity'],
        timeoutMs: 300_000,
        maxRetries: 1,
        concurrencyLimit: 5,
        health: agyHealthy ? 'healthy' : 'unhealthy',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      if (!agyHealthy) {
        console.log('[endpoints] auto-antigravity-cli executable not found or unauthenticated — registered unhealthy');
      } else {
        console.log(`[endpoints] auto-antigravity-cli registered healthy at ${agyExe}`);
      }
    } catch (err) {
      console.log(`[endpoints] failed to register auto-antigravity-cli: ${(err as Error).message}`);
    }
    } // end if(!ANX_DISABLE_ANTIGRAVITY_CLI)
  }
}

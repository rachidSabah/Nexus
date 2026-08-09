import type { ProviderCapabilities, RoutingEnginePort, CredentialVaultPort } from '@anx/core';

import type { GatewayConfig } from './config.js';

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
    const autoEndpoints: Array<{ providerId: string; envVar: string; baseUrl: string; pricing: { inputPer1K: number; outputPer1K: number; currency: 'USD' | 'EUR' } }> = [
      { providerId: 'openai', envVar: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', pricing: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' } },
      { providerId: 'anthropic', envVar: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com', pricing: { inputPer1K: 0.003, outputPer1K: 0.015, currency: 'USD' } },
      { providerId: 'deepseek', envVar: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com/v1', pricing: { inputPer1K: 0.001, outputPer1K: 0.002, currency: 'USD' } },
      { providerId: 'openrouter', envVar: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', pricing: { inputPer1K: 0.005, outputPer1K: 0.015, currency: 'USD' } },
      { providerId: 'groq', envVar: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'google', envVar: 'GOOGLE_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', pricing: { inputPer1K: 0.00125, outputPer1K: 0.005, currency: 'USD' } },
      { providerId: 'mistral', envVar: 'MISTRAL_API_KEY', baseUrl: 'https://api.mistral.ai/v1', pricing: { inputPer1K: 0.001, outputPer1K: 0.003, currency: 'USD' } },
      { providerId: 'xai', envVar: 'XAI_API_KEY', baseUrl: 'https://api.x.ai/v1', pricing: { inputPer1K: 0.005, outputPer1K: 0.015, currency: 'USD' } },
      { providerId: 'together', envVar: 'TOGETHER_API_KEY', baseUrl: 'https://api.together.xyz/v1', pricing: { inputPer1K: 0.002, outputPer1K: 0.008, currency: 'USD' } },
      { providerId: 'fireworks', envVar: 'FIREWORKS_API_KEY', baseUrl: 'https://api.fireworks.ai/inference/v1', pricing: { inputPer1K: 0.002, outputPer1K: 0.008, currency: 'USD' } },
      { providerId: 'cerebras', envVar: 'CEREBRAS_API_KEY', baseUrl: 'https://api.cerebras.ai/v1', pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'nvidia-nim', envVar: 'NVIDIA_API_KEY', baseUrl: 'https://integrate.api.nvidia.com/v1', pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'opencode-zen', envVar: 'OPENCODE_ZEN_API_KEY', baseUrl: 'https://api.opencode.ai/zen/v1', pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'opencode-go', envVar: 'OPENCODE_GO_API_KEY', baseUrl: 'https://api.opencode.ai/go/v1', pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
      { providerId: 'ollama', envVar: '', baseUrl: 'http://localhost:11434/v1', pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' } },
    ];

    for (const e of autoEndpoints) {
      const apiKey = e.envVar ? process.env[e.envVar] : 'local';
      if (!apiKey && e.envVar) continue;
      await vault.set(e.providerId, apiKey ?? 'local');
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
        health: 'healthy',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
}

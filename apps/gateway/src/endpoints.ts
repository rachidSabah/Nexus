import type { ProviderEndpoint, ProviderCapabilities, RoutingEnginePort, CredentialVaultPort } from '@anx/core';
import type { GatewayConfig } from './config.js';

const DEFAULT_CAPS: ProviderCapabilities = {
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
      capabilities: { ...DEFAULT_CAPS, ...(e.capabilities as Partial<ProviderCapabilities> | undefined) },
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
      { providerId: 'groq', envVar: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', pricing: { inputPer1K: 0.0005, outputPer1K: 0.0008, currency: 'USD' } },
      { providerId: 'google', envVar: 'GOOGLE_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', pricing: { inputPer1K: 0.00125, outputPer1K: 0.005, currency: 'USD' } },
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
        capabilities: DEFAULT_CAPS,
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

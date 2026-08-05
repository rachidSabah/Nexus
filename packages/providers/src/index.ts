export { OpenAIAdapter, syntheticChunk } from './adapters/openai.js';
export { AnthropicAdapter } from './adapters/anthropic.js';
export { GoogleAdapter } from './adapters/google.js';
export {
  OpenRouterAdapter,
  DeepSeekAdapter,
  MistralAdapter,
  XaiAdapter,
  GroqAdapter,
  TogetherAdapter,
  FireworksAdapter,
  CerebrasAdapter,
  CloudflareAdapter,
  OllamaAdapter,
  VllmAdapter,
  LmStudioAdapter,
  LitellmAdapter,
  AzureOpenAIAdapter,
} from './adapters/openai-compatible.js';

import type { ProviderAdapter } from '@anx/core';

import { AnthropicAdapter } from './adapters/anthropic.js';
import { GoogleAdapter } from './adapters/google.js';
import {
  OpenRouterAdapter,
  DeepSeekAdapter,
  MistralAdapter,
  XaiAdapter,
  GroqAdapter,
  TogetherAdapter,
  FireworksAdapter,
  CerebrasAdapter,
  CloudflareAdapter,
  OllamaAdapter,
  VllmAdapter,
  LmStudioAdapter,
  LitellmAdapter,
  AzureOpenAIAdapter,
} from './adapters/openai-compatible.js';
import { OpenAIAdapter } from './adapters/openai.js';

/**
 * Registry of all built-in provider adapters, keyed by `providerId`.
 * The gateway uses this to look up the adapter for a given endpoint.
 */
export function createDefaultAdapters(): Map<string, ProviderAdapter> {
  const adapters: ProviderAdapter[] = [
    new OpenAIAdapter(),
    new AnthropicAdapter(),
    new GoogleAdapter(),
    new OpenRouterAdapter(),
    new DeepSeekAdapter(),
    new MistralAdapter(),
    new XaiAdapter(),
    new GroqAdapter(),
    new TogetherAdapter(),
    new FireworksAdapter(),
    new CerebrasAdapter(),
    new CloudflareAdapter(),
    new OllamaAdapter(),
    new VllmAdapter(),
    new LmStudioAdapter(),
    new LitellmAdapter(),
    new AzureOpenAIAdapter(),
  ];
  const map = new Map<string, ProviderAdapter>();
  for (const a of adapters) map.set(a.providerId, a);
  return map;
}

export const SUPPORTED_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'deepseek',
  'mistral',
  'xai',
  'groq',
  'together',
  'fireworks',
  'cerebras',
  'cloudflare',
  'ollama',
  'vllm',
  'lmstudio',
  'litellm',
  'azure-openai',
  // Stubs for adapters to be implemented in a future release:
  'aws-bedrock',
  'vertex-ai',
] as const;

export type SupportedProviderId = (typeof SUPPORTED_PROVIDERS)[number];

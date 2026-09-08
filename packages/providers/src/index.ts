export { OpenAIAdapter, syntheticChunk } from './adapters/openai.js';
export { AnthropicAdapter } from './adapters/anthropic.js';
export { GoogleAdapter } from './adapters/google.js';
export { BedrockAdapter } from './adapters/bedrock.js';
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
  OllamaAdapter,
  VllmAdapter,
  LmStudioAdapter,
  LitellmAdapter,
  AzureOpenAIAdapter,
  OpenCodeZenAdapter,
  OpenCodeGoAdapter,
  NvidiaNimAdapter,
  GenericOpenAIAdapter,
} from './adapters/openai-compatible.js';
export { AntigravityCliAdapter } from './adapters/antigravity-cli.js';

import type { ProviderAdapter } from '@anx/core';

import { AnthropicAdapter } from './adapters/anthropic.js';
import { AntigravityCliAdapter } from './adapters/antigravity-cli.js';
import { BedrockAdapter } from './adapters/bedrock.js';
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
  OllamaAdapter,
  VllmAdapter,
  LmStudioAdapter,
  LitellmAdapter,
  AzureOpenAIAdapter,
  OpenCodeZenAdapter,
  OpenCodeGoAdapter,
  NvidiaNimAdapter,
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
    new CohereAdapter(),
    new HuggingFaceAdapter(),
    new ZhipuAdapter(),
    new ModelScopeAdapter(),
    new ElectronHubAdapter(),
    new ExperientialAdapter(),
    new KiloGatewayAdapter(),
    new PollinationsAdapter(),
    new AiHordeAdapter(),
    new RadeonAdapter(),
    new AnyApiAdapter(),
    new GitHubModelsAdapter(),
    new OllamaAdapter(),
    new VllmAdapter(),
    new LmStudioAdapter(),
    new LitellmAdapter(),
    new AzureOpenAIAdapter(),
    new OpenCodeZenAdapter(),
    new OpenCodeGoAdapter(),
    new NvidiaNimAdapter(),
    new BedrockAdapter(),
    new AntigravityCliAdapter(),
  ];
  const map = new Map<string, ProviderAdapter>();
  for (const a of adapters) map.set(a.providerId, a);
  // Alias common shorthand provider IDs
  const nvidia = map.get('nvidia-nim');
  if (nvidia) map.set('nvidia', nvidia);
  const agy = map.get('antigravity-cli');
  if (agy) map.set('antigravity', agy);
  const hf = map.get('huggingface');
  if (hf) map.set('hf', hf);
  const horde = map.get('aihorde');
  if (horde) map.set('horde', horde);
  const radeon = map.get('radeon');
  if (radeon) map.set('amd', radeon);
  const github = map.get('github');
  if (github) map.set('gh', github);
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
  'cohere',
  'huggingface',
  'hf',
  'zhipu',
  'modelscope',
  'electronhub',
  'experiential',
  'kilo',
  'pollinations',
  'aihorde',
  'horde',
  'radeon',
  'amd',
  'anyapi',
  'github',
  'gh',
  'ollama',
  'vllm',
  'lmstudio',
  'litellm',
  'azure-openai',
  'opencode-zen',
  'opencode-go',
  'nvidia-nim',
  'nvidia',
  'antigravity-cli',
  'antigravity',
  // Stubs for adapters to be implemented in a future release:
  'aws-bedrock',
  'vertex-ai',
] as const;

export type SupportedProviderId = (typeof SUPPORTED_PROVIDERS)[number];

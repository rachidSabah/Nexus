import { describe, it, expect } from 'vitest';
import {
  AzureOpenAIAdapter,
  CloudflareAIAdapter,
  PerplexityAdapter,
  ReplicateAdapter,
  createDefaultAdapters,
} from '../src/index.js';

describe('Cloud Providers and Azure Streaming Fixes', () => {
  it('registers new cloud adapters in default registry', () => {
    const map = createDefaultAdapters();
    expect(map.has('azure-openai')).toBe(true);
    expect(map.has('cloudflare-ai')).toBe(true);
    expect(map.has('perplexity')).toBe(true);
    expect(map.has('replicate')).toBe(true);
  });

  it('CloudflareAIAdapter resolves account ID base URL', () => {
    const adapter = new CloudflareAIAdapter();
    const epWithTag = {
      id: 'cf-test',
      providerId: 'cloudflare-ai',
      baseUrl: 'https://api.cloudflare.com/client/v4',
      displayName: 'Cloudflare',
      models: [],
      health: 'healthy' as const,
      tags: ['acc-12345'],
    };
    // @ts-expect-error accessing protected resolveBase for unit testing
    const base = adapter.resolveBase(epWithTag);
    expect(base).toContain('acc-12345');
  });

  it('AzureOpenAIAdapter has streamChatCompletion implemented', () => {
    const adapter = new AzureOpenAIAdapter();
    expect(typeof adapter.streamChatCompletion).toBe('function');
  });

  it('PerplexityAdapter and ReplicateAdapter have correct metadata', () => {
    const perplexity = new PerplexityAdapter();
    expect(perplexity.providerId).toBe('perplexity');
    expect(perplexity.displayName).toBe('Perplexity');

    const replicate = new ReplicateAdapter();
    expect(replicate.providerId).toBe('replicate');
    expect(replicate.displayName).toBe('Replicate');
  });
});

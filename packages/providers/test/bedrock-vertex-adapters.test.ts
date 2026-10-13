import { describe, expect, it, vi } from 'vitest';

import type { ChatCompletionRequest, ProviderEndpoint } from '@anx/core';

import { BedrockAdapter } from '../src/adapters/bedrock.js';
import { VertexAIAdapter } from '../src/adapters/vertex.js';
import { createDefaultAdapters, SUPPORTED_PROVIDERS } from '../src/index.js';

describe('AWS Bedrock & Google Cloud Vertex AI Adapter Parity', () => {
  describe('Provider Registry Parity', () => {
    it('registers both aws-bedrock and vertex-ai in default adapters', () => {
      const adapters = createDefaultAdapters();
      expect(adapters.has('aws-bedrock')).toBe(true);
      expect(adapters.has('bedrock')).toBe(true);
      expect(adapters.has('vertex-ai')).toBe(true);
      expect(adapters.has('vertex')).toBe(true);
      expect(adapters.has('gcp-vertex')).toBe(true);
    });

    it('lists both providers in SUPPORTED_PROVIDERS', () => {
      expect(SUPPORTED_PROVIDERS).toContain('aws-bedrock');
      expect(SUPPORTED_PROVIDERS).toContain('bedrock');
      expect(SUPPORTED_PROVIDERS).toContain('vertex-ai');
      expect(SUPPORTED_PROVIDERS).toContain('vertex');
    });
  });

  describe('BedrockAdapter', () => {
    const adapter = new BedrockAdapter();

    it('resolves model aliases correctly', () => {
      expect(adapter.resolveModel('claude-3-5-sonnet')).toBe('anthropic.claude-3-5-sonnet-20241022-v2:0');
      expect(adapter.resolveModel('claude-3-7-sonnet')).toBe('anthropic.claude-3-7-sonnet-20250219-v1:0');
      expect(adapter.resolveModel('llama-3.3-70b')).toBe('meta.llama3-3-70b-instruct-v1:0');
      expect(adapter.resolveModel('nova-pro')).toBe('amazon.nova-pro-v1:0');
      expect(adapter.resolveModel('bedrock/titan-text')).toBe('amazon.titan-text-express-v1');
    });

    it('executes chat completion through Bedrock Converse API with tool translation and usage', async () => {
      const mockEndpoint: ProviderEndpoint = {
        id: 'ep-bedrock-prod',
        providerId: 'aws-bedrock',
        baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
        apiKey: 'AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY:sessionToken123',
        priority: 1,
        weight: 1,
        health: 'healthy',
        timeoutMs: 5000,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const request: ChatCompletionRequest = {
        model: 'claude-3-5-sonnet',
        messages: [
          { role: 'system', content: 'You are an autonomous agent.' },
          { role: 'user', content: 'What is the weather in Paris?' },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather for city',
              parameters: {
                type: 'object',
                properties: { city: { type: 'string' } },
                required: ['city'],
              },
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        expect(url).toContain('/model/anthropic.claude-3-5-sonnet-20241022-v2%3A0/converse');
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toContain('AWS4-HMAC-SHA256');
        expect(headers['x-amz-security-token']).toBe('sessionToken123');

        const parsedBody = JSON.parse(init.body as string);
        expect(parsedBody.system[0].text).toBe('You are an autonomous agent.');
        expect(parsedBody.messages[0].role).toBe('user');
        expect(parsedBody.toolConfig.tools[0].toolSpec.name).toBe('get_weather');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            output: {
              message: {
                role: 'assistant',
                content: [
                  {
                    toolUse: {
                      toolUseId: 'call_paris_weather_1',
                      name: 'get_weather',
                      input: { city: 'Paris' },
                    },
                  },
                ],
              },
            },
            stopReason: 'tool_use',
            usage: {
              inputTokens: 42,
              outputTokens: 18,
              totalTokens: 60,
            },
            metrics: { latencyMs: 120 },
          }),
        } as unknown as Response;
      });

      try {
        const res = await adapter.chatCompletion(mockEndpoint, request, new AbortController().signal);
        expect(res.choices[0]?.message.tool_calls?.[0]?.function.name).toBe('get_weather');
        expect(res.choices[0]?.finish_reason).toBe('tool_calls');
        expect(res.usage.totalTokens).toBe(60);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns available model descriptors from discoverModels', async () => {
      const mockEndpoint: ProviderEndpoint = {
        id: 'ep-bedrock-prod',
        providerId: 'aws-bedrock',
        apiKey: 'AKIAEXAMPLE:SECRETEXAMPLE',
        priority: 1,
        weight: 1,
        health: 'healthy',
        timeoutMs: 5000,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const models = await adapter.discoverModels(mockEndpoint, new AbortController().signal);
      expect(models.length).toBeGreaterThanOrEqual(4);
      expect(models.some((m) => m.id.includes('claude-3-5-sonnet'))).toBe(true);
      expect(models.some((m) => m.capabilities.toolCalling)).toBe(true);
    });
  });

  describe('VertexAIAdapter', () => {
    const adapter = new VertexAIAdapter();

    it('resolves model aliases correctly', () => {
      expect(adapter.resolveModel('gemini-1.5-pro')).toBe('gemini-1.5-pro-002');
      expect(adapter.resolveModel('gemini-2.0-flash')).toBe('gemini-2.0-flash-001');
      expect(adapter.resolveModel('claude-3-5-sonnet')).toBe('claude-3-5-sonnet-v2@20241022');
      expect(adapter.resolveModel('claude-3-7-sonnet')).toBe('claude-3-7-sonnet@20250219');
    });

    it('executes Gemini completion on Vertex AI with function calling and token usage', async () => {
      const mockEndpoint: ProviderEndpoint = {
        id: 'ep-vertex-prod',
        providerId: 'vertex-ai',
        apiKey: 'ya29.fake-token:my-gcp-project:europe-west1',
        priority: 1,
        weight: 1,
        health: 'healthy',
        timeoutMs: 5000,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const request: ChatCompletionRequest = {
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'Search user DB' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_users',
              description: 'Query database',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        expect(url).toContain('https://europe-west1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/europe-west1/publishers/google/models/gemini-2.0-flash-001:generateContent');
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer ya29.fake-token');

        const parsed = JSON.parse(init.body as string);
        expect(parsed.contents[0].parts[0].text).toBe('Search user DB');
        expect(parsed.tools[0].functionDeclarations[0].name).toBe('search_users');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: 'search_users',
                        args: { query: 'active' },
                      },
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 25,
              candidatesTokenCount: 15,
              totalTokenCount: 40,
            },
          }),
        } as unknown as Response;
      });

      try {
        const res = await adapter.chatCompletion(mockEndpoint, request, new AbortController().signal);
        expect(res.choices[0]?.message.tool_calls?.[0]?.function.name).toBe('search_users');
        expect(res.usage.totalTokens).toBe(40);
        expect(res.provider).toBe('vertex-ai');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('executes Claude completion on Vertex AI through rawPredict', async () => {
      const mockEndpoint: ProviderEndpoint = {
        id: 'ep-vertex-claude',
        providerId: 'vertex-ai',
        apiKey: 'ya29.claude-token:gcp-enterprise-project:us-east5',
        priority: 1,
        weight: 1,
        health: 'healthy',
        timeoutMs: 5000,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const request: ChatCompletionRequest = {
        model: 'claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'Hello Claude on Vertex' }],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        expect(url).toContain('https://us-east5-aiplatform.googleapis.com/v1/projects/gcp-enterprise-project/locations/us-east5/publishers/anthropic/models/claude-3-5-sonnet-v2@20241022:rawPredict');
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer ya29.claude-token');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'msg_vtx_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello from Claude on Vertex AI!' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 12, output_tokens: 8 },
          }),
        } as unknown as Response;
      });

      try {
        const res = await adapter.chatCompletion(mockEndpoint, request, new AbortController().signal);
        expect(res.choices[0]?.message.content).toBe('Hello from Claude on Vertex AI!');
        expect(res.usage.totalTokens).toBe(20);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('discovers Vertex AI models', async () => {
      const mockEndpoint: ProviderEndpoint = {
        id: 'ep-vertex-prod',
        providerId: 'vertex-ai',
        apiKey: 'fake-token:project:us-central1',
        priority: 1,
        weight: 1,
        health: 'healthy',
        timeoutMs: 5000,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const models = await adapter.discoverModels(mockEndpoint, new AbortController().signal);
      expect(models.length).toBeGreaterThanOrEqual(4);
      expect(models.some((m) => m.id.includes('gemini-2.0-flash'))).toBe(true);
      expect(models.some((m) => m.id.includes('claude-3-5-sonnet'))).toBe(true);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { clampAndSanitizeContext, estimateMessageTokens } from '../src/application/context-sanitizer.js';
import type { ChatCompletionRequest, ProviderEndpoint } from '../src/domain/types.js';

describe('clampAndSanitizeContext', () => {
  const dummyEndpoint: ProviderEndpoint = {
    id: 'test-endpoint',
    providerId: 'test-provider',
    displayName: 'Test Provider',
    baseUrl: 'https://api.test.com/v1',
    health: 'healthy',
    priority: 1,
    weight: 1,
    tags: [],
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      audio: false,
      speech: false,
      embeddings: true,
      reasoning: false,
      jsonMode: true,
      maxOutputTokens: 4096,
      maxInputTokens: 1000,
      supportedModalities: ['text'],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('clamps maxTokens when it exceeds provider maxOutputTokens', () => {
    const req: ChatCompletionRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 16000,
    };

    const clamped = clampAndSanitizeContext(req, dummyEndpoint);
    expect(clamped.maxTokens).toBe(4096);
  });

  it('preserves system prompt and clamps long message histories within budget', () => {
    const systemContent = 'You are an AI coding assistant.';
    const longText = 'A'.repeat(2000); // ~526 tokens

    const req: ChatCompletionRequest = {
      model: 'test-model',
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: `Old message 1: ${longText}` },
        { role: 'assistant', content: `Old message 2: ${longText}` },
        { role: 'user', content: 'Latest goal: write a function' },
      ],
    };

    const clamped = clampAndSanitizeContext(req, dummyEndpoint);
    expect(clamped.messages[0]?.role).toBe('system');
    expect(clamped.messages[0]?.content).toBe(systemContent);
    const lastMsg = clamped.messages[clamped.messages.length - 1];
    expect(lastMsg?.role).toBe('user');
    expect(lastMsg?.content).toBe('Latest goal: write a function');
  });

  it('correctly estimates tokens from strings and tool calls', () => {
    const tokens = estimateMessageTokens({
      role: 'assistant',
      content: 'hello world',
      tool_calls: [{
        id: 'tc-1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
      }],
    });
    expect(tokens).toBeGreaterThan(5);
  });
});

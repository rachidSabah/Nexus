import { describe, it, expect } from 'vitest';

import { translateAnthropicRequest } from '../src/anthropic-compat.js';

/**
 * Regression tests for the reasoning_content forwarding fix.
 *
 * Non-reasoning providers (Mistral, Cerebras, GLM, OpenAI) reject the
 * `reasoning_content` field with HTTP 400/422. The translator must only emit it
 * when the resolved target model supports reasoning.
 */
describe('translateAnthropicRequest — reasoning_content gating', () => {
  const req = {
    model: 'claude-gw-mistral-mistral-large-latest',
    max_tokens: 256,
    messages: [
      { role: 'user' as const, content: 'What is 2+2?' },
      {
        role: 'assistant' as const,
        content: [
          { type: 'thinking' as const, thinking: 'Let me reason: 2+2 is 4.' },
          { type: 'text' as const, text: '4' },
        ],
      },
      { role: 'user' as const, content: 'Thanks' },
    ],
  };

  it('omits reasoning_content for non-reasoning targets (default)', () => {
    const out = translateAnthropicRequest(req);
    const assistant = out.messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect((assistant as Record<string, unknown>)['reasoningContent']).toBeUndefined();
    // The visible text is still forwarded.
    expect(assistant?.content).toContain('4');
  });

  it('omits reasoning_content when targetSupportsReasoning is explicitly false', () => {
    const out = translateAnthropicRequest(req, { targetSupportsReasoning: false });
    const assistant = out.messages.find((m) => m.role === 'assistant');
    expect((assistant as Record<string, unknown>)['reasoningContent']).toBeUndefined();
  });

  it('preserves reasoning_content for reasoning-capable targets (DeepSeek-style)', () => {
    const out = translateAnthropicRequest(req, { targetSupportsReasoning: true });
    const assistant = out.messages.find((m) => m.role === 'assistant');
    expect((assistant as Record<string, unknown>)['reasoningContent']).toBe('Let me reason: 2+2 is 4.');
  });

  it('never attaches reasoning_content to user messages', () => {
    const userReq = {
      model: 'x',
      max_tokens: 10,
      messages: [{ role: 'user' as const, content: [{ type: 'thinking' as const, thinking: 'leak' }, { type: 'text' as const, text: 'hi' }] }],
    };
    const out = translateAnthropicRequest(userReq, { targetSupportsReasoning: true });
    const user = out.messages.find((m) => m.role === 'user');
    expect((user as Record<string, unknown>)['reasoningContent']).toBeUndefined();
  });

  it('preserves all tool_result messages when multiple tool results arrive in a single turn', () => {
    const multiToolReq = {
      model: 'claude-gw-mistral-mistral-small-latest',
      max_tokens: 256,
      messages: [
        {
          role: 'user' as const,
          content: 'Read both files',
        },
        {
          role: 'assistant' as const,
          content: [
            { type: 'tool_use' as const, id: 'call_1', name: 'read_file', input: { path: 'a.txt' } },
            { type: 'tool_use' as const, id: 'call_2', name: 'read_file', input: { path: 'b.txt' } },
          ],
        },
        {
          role: 'user' as const,
          content: [
            { type: 'tool_result' as const, tool_use_id: 'call_1', content: 'contents of A' },
            { type: 'tool_result' as const, tool_use_id: 'call_2', content: 'contents of B' },
          ],
        },
      ],
    };
    const out = translateAnthropicRequest(multiToolReq);
    const toolMessages = out.messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages[0]?.toolCallId).toBe('call_1');
    expect(toolMessages[0]?.content).toBe('contents of A');
    expect(toolMessages[1]?.toolCallId).toBe('call_2');
    expect(toolMessages[1]?.content).toBe('contents of B');
  });

  it('preserves accompanying user text when returned alongside tool_results', () => {
    const textAndToolReq = {
      model: 'claude-gw-mistral-mistral-small-latest',
      max_tokens: 256,
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'tool_result' as const, tool_use_id: 'call_1', content: 'file content' },
            { type: 'text' as const, text: 'Also check this note.' },
          ],
        },
      ],
    };
    const out = translateAnthropicRequest(textAndToolReq);
    const toolMsg = out.messages.find((m) => m.role === 'tool');
    const userMsg = out.messages.find((m) => m.role === 'user');
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.toolCallId).toBe('call_1');
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toBe('Also check this note.');
  });
});

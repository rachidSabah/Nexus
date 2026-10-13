import { describe, it, expect } from 'vitest';
import {
  countTiktokenTokens,
  accountChatRequestTokens,
} from '../src/tiktoken-accounting.js';

describe('Tiktoken Token Accounting', () => {
  it('counts tokens for plain text accurately', () => {
    const text = 'Hello world! How are you today?';
    const count = countTiktokenTokens(text, 'cl100k_base');
    expect(count).toBeGreaterThan(4);
    expect(count).toBeLessThan(12);
  });

  it('accounts for ChatML message framing overhead', () => {
    const messages = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Can you help me?' },
    ];
    const accounting = accountChatRequestTokens(messages, { model: 'gpt-4o' });

    expect(accounting.totalTokens).toBeGreaterThan(accounting.messageTokens);
    // Overhead: 3 primer + 3 per message (2 messages) = 9
    expect(accounting.overheadTokens).toBe(9);
    expect(accounting.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('accounts for tool calls and function arguments', () => {
    const messages = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location":"San Francisco, CA"}',
            },
          },
        ],
      },
    ];
    const accounting = accountChatRequestTokens(messages);
    expect(accounting.toolTokens).toBeGreaterThan(5);
  });
});

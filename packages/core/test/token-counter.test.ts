import { describe, it, expect } from 'vitest';

import {
  NaiveTokenCounter,
  CodeAwareTokenCounter,
  defaultTokenCounter,
  type TokenCounter,
} from '../src/application/token-counter.js';

// ─── NaiveTokenCounter ───────────────────────────────────────────────────────

describe('NaiveTokenCounter', () => {
  let counter: NaiveTokenCounter;

  counter = new NaiveTokenCounter();

  it('implements the TokenCounter interface', () => {
    const c: TokenCounter = new NaiveTokenCounter();
    expect(typeof c.count).toBe('function');
    expect(typeof c.countMessages).toBe('function');
  });

  it('returns 0 for empty string', () => {
    expect(counter.count('')).toBe(0);
  });

  it('estimates ~1 token per 4 Latin chars', () => {
    // "aaaa" → ceil(4/4) = 1
    expect(counter.count('aaaa')).toBe(1);
    // 100 chars → ceil(100/4) = 25
    expect(counter.count('a'.repeat(100))).toBe(25);
  });

  it('estimates ~2 chars per token for CJK characters', () => {
    // 4 CJK chars → ceil(0/4 + 4/2) = 2
    const cjk = '你好世界'; // 4 CJK chars
    expect(counter.count(cjk)).toBe(2);
  });

  it('handles mixed CJK and Latin text', () => {
    // 4 Latin + 4 CJK → ceil(4/4 + 4/2) = ceil(1 + 2) = 3
    const mixed = 'abcd你好世界';
    expect(counter.count(mixed)).toBe(3);
  });

  it('countMessages adds 4 overhead per message + 3 priming', () => {
    const messages = [
      { role: 'user', content: 'abcd' },    // 4 overhead + 1 token = 5
    ];
    // 5 + 3 priming = 8
    expect(counter.countMessages(messages)).toBe(8);
  });

  it('countMessages handles multiple messages', () => {
    const messages = [
      { role: 'user', content: 'aaaa' },     // 4 + 1 = 5
      { role: 'assistant', content: 'bbbb' }, // 4 + 1 = 5
    ];
    // 10 + 3 = 13
    expect(counter.countMessages(messages)).toBe(13);
  });

  it('countMessages handles non-string content as JSON', () => {
    const messages = [
      { role: 'user', content: { text: 'aaaa' } }, // 4 + count(JSON.stringify)
    ];
    const result = counter.countMessages(messages);
    expect(result).toBeGreaterThan(4);
  });

  it('countMessages handles null/undefined content as 0', () => {
    const messages = [
      { role: 'user', content: null as unknown as string },
    ];
    // 4 overhead + 0 content + 3 priming = 7
    expect(counter.countMessages(messages)).toBe(7);
  });
});

// ─── CodeAwareTokenCounter ───────────────────────────────────────────────────

describe('CodeAwareTokenCounter', () => {
  let counter: CodeAwareTokenCounter;

  counter = new CodeAwareTokenCounter();

  it('implements the TokenCounter interface', () => {
    const c: TokenCounter = new CodeAwareTokenCounter();
    expect(typeof c.count).toBe('function');
  });

  it('returns 0 for empty string', () => {
    expect(counter.count('')).toBe(0);
  });

  it('detects code by curly braces and uses 3 chars/token', () => {
    // "aaaa{}" has code marker → 3 chars/token
    // 6 Latin chars → ceil(6/3) = 2
    expect(counter.count('aaaa{}')).toBe(2);
  });

  it('detects code by indentation (\\n    ) and uses 3 chars/token', () => {
    const code = 'function foo() {\n    return true;\n}';
    const result = counter.count(code);
    // Should use ~3 chars/token, so fewer tokens per char vs prose
    const naiveResult = new NaiveTokenCounter().count(code);
    // Code-aware should estimate MORE tokens than naive (3 < 4 chars/token)
    expect(result).toBeGreaterThanOrEqual(naiveResult);
  });

  it('uses 4 chars/token for plain prose (no code markers)', () => {
    const prose = 'The quick brown fox jumps over the lazy dog.';
    const codeResult = counter.count(prose);
    const naiveResult = new NaiveTokenCounter().count(prose);
    // Without code markers, both should be equivalent
    expect(codeResult).toBe(naiveResult);
  });

  it('handles CJK text same as NaiveTokenCounter', () => {
    const cjk = '日本語テキスト'; // 7 CJK chars — no Latin, no code markers
    const codeAware = counter.count(cjk);
    expect(codeAware).toBe(Math.ceil(7 / 2)); // ~2 CJK chars/token → 4
  });

  it('countMessages includes overhead and priming tokens', () => {
    const messages = [
      { role: 'user', content: 'function foo() {}' }, // code → 3 chars/token
    ];
    const result = counter.countMessages(messages);
    expect(result).toBeGreaterThan(4 + 3); // at least overhead + priming
  });

  it('countMessages handles multiple messages consistently', () => {
    const msgs = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Write a function to sort an array.' },
    ];
    const result = counter.countMessages(msgs);
    expect(result).toBeGreaterThan(0);
    // Result should be stable (deterministic)
    expect(counter.countMessages(msgs)).toBe(result);
  });
});

// ─── defaultTokenCounter ─────────────────────────────────────────────────────

describe('defaultTokenCounter', () => {
  it('is an instance of CodeAwareTokenCounter', () => {
    expect(defaultTokenCounter).toBeInstanceOf(CodeAwareTokenCounter);
  });

  it('can count tokens on a real-world prompt', () => {
    const prompt = `You are an expert software engineer specializing in TypeScript and Node.js.
Your task is to review the following code and identify any potential issues.

\`\`\`typescript
function authenticate(user: string, password: string): boolean {
  return users.find(u => u.name === user && u.password === password) !== undefined;
}
\`\`\`

Please provide a detailed analysis of the security issues.`;
    const tokens = defaultTokenCounter.count(prompt);
    // Rough sanity check: should be in range [50, 300] for this prompt
    expect(tokens).toBeGreaterThan(50);
    expect(tokens).toBeLessThan(300);
  });

  it('estimates more tokens for code-dense content vs prose', () => {
    const code = '{ '.repeat(100) + '} '.repeat(100); // 400 chars, code markers
    const prose = 'The quick brown fox jumps over the lazy dog and then runs away. '.repeat(6); // ~384 chars

    const codeTokens = defaultTokenCounter.count(code);
    const proseTokens = defaultTokenCounter.count(prose);

    // Code (3 chars/token) should produce more tokens per char than prose (4 chars/token)
    expect(codeTokens / code.length).toBeGreaterThan(proseTokens / prose.length);
  });
});

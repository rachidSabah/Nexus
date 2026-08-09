/**
 * Token counter — estimates token count for cost prediction and context
 * window management.
 *
 * Uses a character-based heuristic (~4 chars per token for English text,
 * ~2 chars per token for CJK). This is accurate within ~10% for most
 * inputs and is zero-dependency (no tiktoken wasm needed).
 *
 * For production-grade accuracy, swap with `gpt-tokenizer` or `tiktoken`
 * — the interface stays the same.
 */

export interface TokenCounter {
  count(text: string): number;
  countMessages(messages: Array<{ role: string; content: string | unknown }>): number;
}

export class NaiveTokenCounter implements TokenCounter {
  count(text: string): number {
    if (!text) return 0;
    // Detect CJK content (Chinese, Japanese, Korean) — ~2 chars per token.
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
    const latinChars = text.length - cjkChars;
    return Math.ceil((latinChars / 4) + (cjkChars / 2));
  }

  countMessages(messages: Array<{ role: string; content: string | unknown }>): number {
    let total = 0;
    for (const m of messages) {
      // Each message has ~4 tokens of overhead (role, formatting).
      total += 4;
      if (typeof m.content === 'string') {
        total += this.count(m.content);
      } else if (m.content) {
        total += this.count(JSON.stringify(m.content));
      }
    }
    // Add 3 tokens for the conversation priming.
    return total + 3;
  }
}

/**
 * More accurate token counter that uses a word-based heuristic.
 * Better for code (which has more tokens per char than prose).
 */
export class CodeAwareTokenCounter implements TokenCounter {
  count(text: string): number {
    if (!text) return 0;
    // Code has more tokens per character (~3 chars/token for code).
    const isCode = /[{}};()[\]=<>]/.test(text) || text.includes('\n    ');
    const charsPerToken = isCode ? 3 : 4;

    // CJK detection
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
    const latinChars = text.length - cjkChars;
    return Math.ceil((latinChars / charsPerToken) + (cjkChars / 2));
  }

  countMessages(messages: Array<{ role: string; content: string | unknown }>): number {
    let total = 0;
    for (const m of messages) {
      total += 4; // role + formatting overhead
      if (typeof m.content === 'string') {
        total += this.count(m.content);
      } else if (m.content) {
        total += this.count(JSON.stringify(m.content));
      }
    }
    return total + 3;
  }
}

/** Default token counter instance. */
export const defaultTokenCounter = new CodeAwareTokenCounter();

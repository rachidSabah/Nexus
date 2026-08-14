import { describe, it, expect } from 'vitest';
import { compressToolOutput, compressMessageContent } from '../src/index.js';

const errorLine = 'ERROR TS2322: Type X is not assignable to type Y';

describe('compressToolOutput — repeated-line grouping (§23)', () => {
  it('collapses a 3,842-line repeated error log to one line + count', () => {
    const log = `${errorLine}\n`.repeat(3842);
    const res = compressToolOutput(log);
    expect(res.collapsedRuns).toBe(1);
    expect(res.removedLines).toBe(3841);
    expect(res.text).toContain(`[same line repeated 3842 times] ${errorLine}`);
    expect(res.truncated).toBe(false);
  });

  it('preserves unique content byte-exact', () => {
    const text = [
      'error: file.ts:83',
      "  Type 'X' is not assignable to type 'Y'",
      'at fn (file.ts:83:5)',
      'exit code 1',
    ].join('\n');
    const res = compressToolOutput(text);
    expect(res.text).toBe(text);
    expect(res.collapsedRuns).toBe(0);
  });

  it('never touches short runs (diffs/code protection, §32)', () => {
    // A diff with 4 identical context lines must stay intact.
    const diff = ['-old', '+new', ' unchanged', ' unchanged', ' unchanged', ' unchanged', '+end'].join('\n');
    const res = compressToolOutput(diff);
    expect(res.text).toBe(diff);
    expect(res.collapsedRuns).toBe(0);
  });

  it('collapses multiple distinct runs and keeps everything else', () => {
    const text = ['head', `${errorLine}`, `${errorLine}`, `${errorLine}`, `${errorLine}`, `${errorLine}`, 'mid', 'tail'].join('\n');
    const res = compressToolOutput(text);
    expect(res.collapsedRuns).toBe(1);
    expect(res.text).toContain('[same line repeated 5 times]');
    expect(res.text).toContain('head');
    expect(res.text).toContain('mid');
    expect(res.text).toContain('tail');
  });

  it('leaves empty and short inputs untouched', () => {
    expect(compressToolOutput('').text).toBe('');
    const small = 'a\nb\nc';
    expect(compressToolOutput(small).text).toBe(small);
  });
});

describe('compressToolOutput — AGGRESSIVE head/tail truncation (§24)', () => {
  it('truncates with an explicit marker (never silent loss)', () => {
    // Distinct lines so grouping cannot consume the input (§24 target: logs).
    const big = Array.from({ length: 3000 }, (_, i) => `log ${i}: ${'trace'.repeat(12)}`).join('\n');
    const res = compressToolOutput(big, { maxChars: 10_000 });
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBeLessThan(big.length);
    expect(res.text).toContain('lines elided (truncated to 10000 chars)');
    // Head and tail content survive.
    expect(res.text).toContain('log 0:');
    expect(res.text).toContain('log 2999:');
  });

  it('BALANCED (unlimited budget) only groups lines, never truncates', () => {
    const big = `${errorLine}\n`.repeat(20_000);
    const res = compressToolOutput(big, { maxChars: Number.MAX_SAFE_INTEGER });
    expect(res.truncated).toBe(false);
    expect(res.collapsedRuns).toBe(1);
  });
});

describe('compressMessageContent — message-level integration', () => {
  it('compresses string content only', () => {
    const res = compressMessageContent(`${errorLine}\n`.repeat(10));
    expect(res.result).not.toBeNull();
    expect(res.content).toContain('[same line repeated 10 times]');
  });

  it('leaves non-string (block-array) content untouched', () => {
    const blocks = [{ type: 'text', text: 'hello' }];
    const res = compressMessageContent(blocks);
    expect(res.result).toBeNull();
    expect(res.content).toBe(blocks);
  });
});

describe('tool-output compression honors CRLF and trailing newlines', () => {
  it('handles Windows line endings', () => {
    const log = `line\r\nline\r\nline\r\nline\r\nline\r\n`;
    const res = compressToolOutput(log);
    expect(res.collapsedRuns).toBe(1);
    expect(res.text).toContain('[same line repeated 5 times] line');
  });
});

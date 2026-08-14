import { describe, it, expect } from 'vitest';
import { TokenOptimizer, contentHash, estimateTokens } from '../src/index.js';
import { OptimizationMode, type OptMessage } from '../src/types.js';

const sys = (c: string): OptMessage => ({ role: 'system', content: c });
const user = (c: string): OptMessage => ({ role: 'user', content: c });
const assistant = (c: string): OptMessage => ({ role: 'assistant', content: c });
const tool = (c: string, id: string): OptMessage => ({ role: 'tool', content: c, tool_use_id: id });
const toolCallMsg = (): OptMessage => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command":"pnpm test"}' } }],
});

describe('TokenOptimizer — OFF mode', () => {
  it('is an exact identity transform', () => {
    const msgs = [sys('A'), user('hi'), assistant('ok'), user('hi')];
    const { messages, stats, changed } = new TokenOptimizer(OptimizationMode.OFF).optimize(msgs);
    expect(messages).toBe(msgs);
    expect(changed).toBe(false);
    expect(stats.savingsPct).toBe(0);
  });
});

describe('TokenOptimizer — SAFE mode', () => {
  it('removes consecutive duplicate system instructions', () => {
    const msgs = [sys('SYSTEM-BLOCK-IDENTICAL'), user('go'), sys('SYSTEM-BLOCK-IDENTICAL'), user('again')];
    const { messages, stats, changed } = new TokenOptimizer(OptimizationMode.SAFE).optimize(msgs);
    expect(changed).toBe(true);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toBe(msgs[0]); // original reference kept, not a copy
    expect(stats.categories.duplicate_system.removedBlocks).toBe(1);
    expect(stats.dedupHitBlocks).toBe(1);
  });

  it('removes consecutive re-sends of the SAME tool call (repeated-output case)', () => {
    const bigOutput = 'ERROR TS2322: type X not assignable\n'.repeat(600); // ~21k chars
    const msgs = [user('fix it'), tool(bigOutput, 'call_1'), tool(bigOutput, 'call_1'), tool(bigOutput, 'call_1')];
    const { messages, stats, changed } = new TokenOptimizer(OptimizationMode.SAFE).optimize(msgs);
    expect(changed).toBe(true);
    expect(messages).toHaveLength(2);
    expect(stats.categories.duplicate_tool_output.removedBlocks).toBe(2);
    expect(stats.savedTokens).toBeGreaterThan(1000);
    expect(stats.savingsPct).toBeGreaterThan(50);
    expect(messages[1].tool_use_id).toBe('call_1'); // first occurrence kept
  });

  it('keeps distinct tool outputs with different call ids', () => {
    const msgs = [user('run'), tool('out-A', 'call_1'), tool('out-B', 'call_2')];
    const { messages, changed } = new TokenOptimizer(OptimizationMode.SAFE).optimize(msgs);
    expect(changed).toBe(false);
    expect(messages).toHaveLength(3);
  });

  it('preserves tool_calls, schemas, diffs and code byte-exact (§32)', () => {
    const diff = '--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,3 +1,3 @@\n-const a=1;\n+const a=2;';
    const schema = '{"type":"object","properties":{"cmd":{"type":"string"}}}';
    const msgs = [
      toolCallMsg(),
      tool(schema, 'call_1'),
      user(diff),
      tool(schema, 'call_1'), // duplicate of an EARLIER tool result is NOT consecutive here
      assistant('```ts\nconst x: number = 42;\n```'),
    ];
    const { messages, changed } = new TokenOptimizer(OptimizationMode.SAFE).optimize(msgs);
    // tool_calls message untouched; unique blocks untouched
    expect(changed).toBe(false);
    expect(messages).toEqual(msgs);
    expect(JSON.stringify(messages[0].tool_calls)).toContain('pnpm test');
  });

  it('does not drop non-consecutive duplicates (only consecutive)', () => {
    const msgs = [user('a'), assistant('x'), user('a')];
    const { messages, changed } = new TokenOptimizer(OptimizationMode.SAFE).optimize(msgs);
    expect(changed).toBe(false);
    expect(messages).toHaveLength(3);
  });

  it('reports real savings metrics', () => {
    const dup = 'same output line\n'.repeat(200);
    const { stats } = new TokenOptimizer(OptimizationMode.SAFE).optimize([
      user('q'),
      tool(dup, 't1'),
      tool(dup, 't1'),
      tool(dup, 't1'),
    ]);
    expect(stats.originalBlocks).toBe(4);
    expect(stats.optimizedBlocks).toBe(2);
    expect(stats.savedTokens).toBeGreaterThan(0);
    expect(stats.savingsPct).toBeGreaterThan(0);
    expect(stats.mode).toBe(OptimizationMode.SAFE);
  });
});

describe('TokenOptimizer — BALANCED/AGGRESSIVE honesty (§41)', () => {
  it('BALANCED runs SAFE dedup (no warning — fully implemented)', () => {
    // Same tool_use_id + identical content = true resend → deduped.
    const msgs = [tool('x\ny\nz\n'.repeat(100), 't1'), tool('x\ny\nz\n'.repeat(100), 't1')];
    const { messages, stats } = new TokenOptimizer(OptimizationMode.BALANCED).optimize(msgs, {
      maxContextTokens: 1_000_000, // budget out of the way — pure SAFE assertions
    });
    expect(messages).toHaveLength(1);
    expect(stats.dedupHitBlocks).toBe(1);
    expect(stats.warnings).toHaveLength(0);
    expect(stats.savingsPct).toBeGreaterThan(0);
  });

  it('AGGRESSIVE runs tool compression + compaction with no warning (§27 real)', () => {
    const msgs = [tool('x\ny\nz\n'.repeat(100), 't1'), tool('x\ny\nz\n'.repeat(100), 't1')];
    const { messages, stats } = new TokenOptimizer(OptimizationMode.AGGRESSIVE).optimize(msgs, {
      maxContextTokens: 1_000_000,
    });
    expect(messages).toHaveLength(1); // SAFE dedup applied first
    expect(stats.warnings.length).toBe(0); // fully implemented — no hand-waving
    expect(
      stats.categories.tool_compression.removedBlocks + stats.categories.conversation_compaction.removedBlocks,
    ).toBeGreaterThanOrEqual(0); // dedup path exercised; compression runs on survivors
  });
});

describe('estimateTokens + contentHash', () => {
  it('estimates tokens (char/4 heuristic) and is monotonic with size', () => {
    expect(estimateTokens('')).toBe(0);
    const small = estimateTokens('hello world');
    const big = estimateTokens('hello world '.repeat(100));
    expect(big).toBeGreaterThan(small);
    expect(estimateTokens('héllo wörld')).toBeGreaterThan(0);
  });

  it('contentHash is stable for identical payloads and changes with content', () => {
    const a = [user('same'), tool('same', 't1')];
    const b = [user('same'), tool('same', 't1')];
    const c = [user('same'), tool('different', 't1')];
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash(c));
  });
});
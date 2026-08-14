import { describe, it, expect } from 'vitest';
import { compactText, compactConversation, TokenOptimizer } from '../src/index.js';
import { OptimizationMode, type OptMessage } from '../src/types.js';

const para = 'I need to fix the failing test suite now.';

describe('compactText (§27–§28)', () => {
  it('collapses a run of identical paragraphs with an explicit count', () => {
    const text = `${para}\n\n`.repeat(20) + 'Unique final paragraph.';
    const res = compactText(text);
    expect(res.collapsedRuns).toBe(1);
    expect(res.text).toContain(`[paragraph repeated 20 times] ${para}`);
    expect(res.text).toContain('Unique final paragraph.');
    expect(res.removedChars).toBeGreaterThan(0);
    expect(res.removedTokens).toBeGreaterThan(0);
  });

  it('never touches short runs (2–4 repeats) — byte-exact (§32)', () => {
    const text = `${para}\n\n`.repeat(4) + 'End.';
    const res = compactText(text);
    expect(res.changed).toBe(false);
    expect(res.text).toBe(text);
    expect(res.removedChars).toBe(0);
  });

  it('never touches paragraphs containing code — backticks', () => {
    const codePara = 'const x = 1;\n`code`'; // includes a backtick
    const text = `${codePara}\n\n`.repeat(10);
    const res = compactText(text);
    expect(res.changed).toBe(false);
    expect(res.text).toBe(text);
  });

  it('never touches code-fenced blocks', () => {
    const fenced = '```ts\nconst x = 1;\n```';
    const text = `${fenced}\n\n`.repeat(8);
    const res = compactText(text);
    expect(res.changed).toBe(false);
  });

  it('never touches code-like paragraphs (import/function/braces)', () => {
    const codeLike = 'import { foo } from "./bar";';
    const text = `${codeLike}\n\n`.repeat(12);
    const res = compactText(text);
    expect(res.changed).toBe(false);
  });

  it('keeps unique prose untouched', () => {
    const text = 'one\n\ntwo\n\nthree\n\nfour\n\nfive';
    const res = compactText(text);
    expect(res.changed).toBe(false);
    expect(res.text).toBe(text);
  });

  it('collapses multiple independent runs in one message', () => {
    const text = `${para}\n\n`.repeat(10) + `ok\n\n`.repeat(9) + 'end';
    const res = compactText(text);
    expect(res.collapsedRuns).toBe(2);
    expect(res.text).toContain('[paragraph repeated 10 times]');
    expect(res.text).toContain('[paragraph repeated 9 times] ok');
  });
});

describe('compactConversation (§27)', () => {
  it('compacts user and assistant text, never system or tool messages', () => {
    const msgs: OptMessage[] = [
      { role: 'system', content: 'You are a senior engineer.\n\n'.repeat(12) }, // P0 — never touched
      { role: 'user', content: `${para}\n\n`.repeat(10) },
      { role: 'assistant', content: `${para}\n\n`.repeat(8) },
      { role: 'tool', content: `${para}\n\n`.repeat(30), tool_call_id: 't1' }, // handled by tool-output layer
      { role: 'user', content: 'final' },
    ];
    const res = compactConversation(msgs);
    expect(res.compactedMessages).toBe(2); // user + assistant only
    expect(String(res.messages[0]?.content)).toContain('You are a senior engineer.');
    expect(res.messages[0]?.content).toBe(msgs[0]?.content); // system byte-exact
    expect(res.messages[3]?.content).toBe(msgs[3]?.content); // tool byte-exact
    expect(String(res.messages[4]?.content)).toBe('final'); // tail preserved
  });

  it('passes block-array content through untouched', () => {
    const blocks = [{ type: 'text', text: 'hello' }];
    const msgs: OptMessage[] = [{ role: 'user', content: blocks }];
    const res = compactConversation(msgs);
    expect(res.compactedMessages).toBe(0);
    expect(res.messages[0]?.content).toBe(blocks);
  });
});

describe('optimizer integration — AGGRESSIVE-only (§27 gating)', () => {
  const chatMsgs = (): OptMessage[] => [
    { role: 'system', content: 'You are a senior engineer.' },
    { role: 'user', content: 'Status:\n\n'.repeat(40) + 'What now?', name: 'status' },
  ];

  it('AGGRESSIVE compacts prose and reports the category', () => {
    const res = new TokenOptimizer(OptimizationMode.AGGRESSIVE, {
      maxContextTokens: 1_000_000,
    }).optimize(chatMsgs());
    const cat = res.stats.categories.conversation_compaction;
    expect(cat.removedBlocks).toBe(1); // one user message compacted
    expect(cat.removedChars).toBeGreaterThan(0);
    expect(cat.removedTokens).toBeGreaterThan(0);
    expect(String(res.messages[1]?.content)).toContain('[paragraph repeated 40 times]');
    expect(res.stats.savedTokens).toBeGreaterThan(0);
  });

  it('BALANCED does NOT compact conversation prose', () => {
    const res = new TokenOptimizer(OptimizationMode.BALANCED, {
      maxContextTokens: 1_000_000,
    }).optimize(chatMsgs());
    expect(res.stats.categories.conversation_compaction.removedBlocks).toBe(0);
    expect(res.messages[1]?.content).toBe('Status:\n\n'.repeat(40) + 'What now?');
  });
});
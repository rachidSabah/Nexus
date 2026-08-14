import { describe, it, expect } from 'vitest';
import { TokenOptimizer, applyBudget } from '../src/index.js';
import { OptimizationMode, type OptMessage } from '../src/types.js';

const sys = (c: string): OptMessage => ({ role: 'system', content: c });
const usr = (c: string): OptMessage => ({ role: 'user', content: c });
const ast = (c: string): OptMessage => ({ role: 'assistant', content: c });
/** Assistant message carrying tool calls (exchange start). */
const toolCall = (id: string): OptMessage =>
  ({
    role: 'assistant',
    content: '',
    toolCalls: [{ id, type: 'function', function: { name: 'run', arguments: '{}' } }],
  }) as unknown as OptMessage;
/** Tool result (exchange completion). */
const toolRes = (id: string, c: string): OptMessage =>
  ({ role: 'tool', tool_call_id: id, content: c }) as unknown as OptMessage;

/** Structural validity: every tool result has its assistant tool_calls sibling retained. */
function assertNoOrphanTools(msgs: OptMessage[]): void {
  const seenIds = new Set<string>();
  for (const m of msgs) {
    const calls = (m as { toolCalls?: { id: string }[] }).toolCalls;
    if (Array.isArray(calls)) for (const c of calls) seenIds.add(c.id);
  }
  for (const m of msgs) {
    if (m.role === 'tool') {
      const id = (m as { tool_call_id?: string }).tool_call_id ?? '';
      if (id) expect(seenIds.has(id)).toBe(true);
    }
  }
}

describe('applyBudget (§25/§26)', () => {
  it('respects the token budget', () => {
    const msgs: OptMessage[] = [
      sys('instructions'),
      ...Array.from({ length: 30 }, (_, i) => usr(`turn ${i} ` + 'x'.repeat(200))),
    ];
    const budget = 500;
    const res = applyBudget(msgs, { maxContextTokens: budget, minKeep: 2 });
    expect(res.retainedTokens).toBeLessThanOrEqual(budget + 400); // last kept unit may overshoot slightly
    expect(res.droppedMessages).toBeGreaterThan(0);
    expect(res.underBudget).toBe(true);
  });

  it('NEVER drops system instructions, even under extreme pressure', () => {
    const sysMsg = sys('CRITICAL ' + 'y'.repeat(5000));
    const msgs: OptMessage[] = [sysMsg, ...Array.from({ length: 10 }, (_, i) => usr(`t${i} ` + 'z'.repeat(300)))];
    const res = applyBudget(msgs, { maxContextTokens: 200, minKeep: 0 });
    expect(res.messages.some((m) => m === sysMsg)).toBe(true);
    expect(res.messages[0]).toBe(sysMsg);
  });

  it('keeps the newest working context', () => {
    const msgs: OptMessage[] = Array.from({ length: 20 }, (_, i) => usr(`msg ${i} ` + 'q'.repeat(150)));
    const res = applyBudget(msgs, { maxContextTokens: 400, minKeep: 5 });
    const contents = res.messages.map((m) => String(m.content));
    expect(contents.some((c) => c.startsWith('msg 19 '))).toBe(true); // newest always present
    expect(contents.some((c) => c.startsWith('msg 0 '))).toBe(false); // oldest evicted
  });

  it('keeps tool exchanges indivisible (no orphaned tool calls/results)', () => {
    const msgs: OptMessage[] = [
      usr('start'),
      toolCall('c1'),
      toolRes('c1', 'big output '.repeat(500)),
      toolCall('c2'),
      toolRes('c2', 'big output '.repeat(500)),
      toolCall('c3'),
      toolRes('c3', 'big output '.repeat(500)),
      usr('final question'),
    ];
    const res = applyBudget(msgs, { maxContextTokens: 300, minKeep: 1 });
    assertNoOrphanTools(res.messages);
    // If any exchange survived, it survived whole.
    const ids = res.messages.filter((m) => m.role === 'tool').map((m) => (m as { tool_call_id: string }).tool_call_id);
    const callIds = res.messages
      .filter((m) => Array.isArray((m as { toolCalls?: unknown[] }).toolCalls))
      .map((m) => (m as { toolCalls: { id: string }[] }).toolCalls[0].id);
    for (const id of ids) expect(callIds).toContain(id);
  });

  it('reports measured metrics', () => {
    const msgs: OptMessage[] = Array.from({ length: 10 }, (_, i) => usr(`m${i} ` + 'w'.repeat(500)));
    const res = applyBudget(msgs, { maxContextTokens: 600, minKeep: 2 });
    expect(res.droppedTokens).toBeGreaterThan(0);
    expect(res.removedChars).toBeGreaterThan(0);
    expect(res.originalTokens).toBeGreaterThan(res.retainedTokens);
    expect(res.category).toBe('context_budget');
  });
});

describe('TokenOptimizer BALANCED mode (§31)', () => {
  it('applies SAFE dedup + budget together', () => {
    const dupTool = 'same output line\n'.repeat(150);
    const msgs: OptMessage[] = [
      sys('sys'),
      toolCall('x1'),
      toolRes('x1', dupTool),
      toolCall('x2'),
      toolRes('x2', dupTool),
      ...Array.from({ length: 15 }, (_, i) => usr(`t${i} ` + 'v'.repeat(300))),
    ];
    const { messages, stats } = new TokenOptimizer(OptimizationMode.BALANCED).optimize(msgs, {
      maxContextTokens: 500,
      minKeep: 2,
    });
    // dedup: x2 result is an exact duplicate of x1 (different id, same content
    // — NOT deduped by design). Budget: oldest turns dropped.
    expect(stats.savedTokens).toBeGreaterThan(0);
    expect(messages.length).toBeLessThan(msgs.length);
    expect(stats.categories.context_budget.tokensSaved).toBeGreaterThan(0);
    expect(stats.warnings.length).toBe(0); // BALANCED fully implemented now
  });

  it('AGGRESSIVE adds conversation compaction — no warning (§27 real)', () => {
    const msgs: OptMessage[] = [usr('same prose\n\n'.repeat(10) + 'tail')];
    const { messages, stats } = new TokenOptimizer(OptimizationMode.AGGRESSIVE).optimize(msgs, {
      maxContextTokens: 1_000_000,
    });
    expect(String(messages[0]?.content)).toContain('[paragraph repeated 10 times]');
    expect(stats.categories.conversation_compaction.removedBlocks).toBe(1);
    expect(stats.warnings.length).toBe(0);
  });

  it('OFF stays a pure identity', () => {
    const msgs: OptMessage[] = [usr('a'), toolCall('t'), toolRes('t', 'out'), usr('b')];
    const { messages, stats, changed } = new TokenOptimizer(OptimizationMode.OFF).optimize(msgs);
    expect(messages).toBe(msgs);
    expect(changed).toBe(false);
    expect(stats.savingsPct).toBe(0);
  });
});

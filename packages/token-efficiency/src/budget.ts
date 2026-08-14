/**
 * ───────────────────────────────────────────────────────────────────────────
 * Context Budget Manager — spec §25 / §26.
 *
 * Enforces a configurable token budget over a request's message history:
 *   - SYSTEM units are NEVER dropped (critical instructions, §26).
 *   - The last `minKeep` units form the working context and are always kept.
 *   - Older units are evicted oldest-first until the budget fits.
 *   - Tool exchanges (assistant tool_calls + their role:'tool' results) are
 *     INDIVISIBLE: both members are dropped/kept together, so the trimmed
 *     history never contains orphaned tool calls or results.
 *
 * Priorities (P0..P4, §26): P0 system → P1 working context (last units) →
 * P2/P3 older text exchanges → P4 oldest tool exchanges.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { estimateTokens, canonicalizeContent } from './estimate.js';
import type { OptMessage } from './types.js';
import type { OptimizationCategory, TokenBudgetResult } from './types.js';

export interface BudgetOptions {
  /** Max context tokens to retain (default 190_000 ≈ a 200k-context model). */
  maxContextTokens?: number;
  /** Minimum number of trailing units always kept (default 8). */
  minKeep?: number;
}

interface Unit {
  type: 'system' | 'tool' | 'text';
  msgs: OptMessage[];
  tokens: number;
}

/** True when the message carries agent tool calls (exchange leader). */
function hasToolCalls(m: OptMessage): boolean {
  const tc = (m as { toolCalls?: unknown[] }).toolCalls;
  return Array.isArray(tc) && tc.length > 0;
}

/** Group messages into eviction units (tool exchanges stay indivisible). */
export function groupUnits(messages: OptMessage[]): Unit[] {
  const units: Unit[] = [];
  let i = 0;
  const n = messages.length;
  while (i < n) {
    const m = messages[i];
    if (m === undefined) {
      i += 1;
      continue;
    }
    if (m.role === 'system') {
      units.push({ type: 'system', msgs: [m], tokens: estimateTokens(String(m.content ?? '')) });
      i += 1;
    } else if (m.role === 'assistant' && hasToolCalls(m)) {
      const run: OptMessage[] = [m];
      i += 1;
      while (i < n && messages[i]?.role === 'tool') {
        const tm = messages[i];
        if (tm !== undefined) run.push(tm);
        i += 1;
      }
      const tokens = run.reduce((acc, x) => acc + estimateTokens(String(x.content ?? '')), 0);
      units.push({ type: 'tool', msgs: run, tokens });
    } else {
      units.push({ type: 'text', msgs: [m], tokens: estimateTokens(String(m.content ?? '')) });
      i += 1;
    }
  }
  return units;
}

export function applyBudget(
  messages: OptMessage[],
  opts: BudgetOptions = {},
): TokenBudgetResult {
  const maxTokens = opts.maxContextTokens ?? 190_000;
  const minKeep = opts.minKeep ?? 8;

  const units = groupUnits(messages);
  const systemUnits = units.filter((u) => u.type === 'system');
  const droppable = units.filter((u) => u.type !== 'system');

  // Working context: the last minKeep droppable units are always retained.
  const keepLast = droppable.slice(-minKeep);
  const evictable = droppable.slice(0, Math.max(0, droppable.length - minKeep));

  const retainedUnits = new Set<Unit>([...systemUnits, ...keepLast]);
  let used = retainedUnits.size > 0
    ? [...retainedUnits].reduce((acc, u) => acc + u.tokens, 0)
    : 0;

  // Fill with the NEXT-NEWEST evictable units first (§26 P1 recency bias:
  // recent context outranks old context; the oldest is evicted first).
  const droppedUnits: Unit[] = [];
  for (let j = evictable.length - 1; j >= 0; j -= 1) {
    const unit = evictable[j];
    if (unit === undefined) continue;
    if (used + unit.tokens <= maxTokens) {
      retainedUnits.add(unit);
      used += unit.tokens;
    } else {
      droppedUnits.push(unit);
    }
  }

  // Emit in ORIGINAL order (conversation order must never be scrambled).
  const retainedMsgs = units
    .filter((u) => retainedUnits.has(u))
    .flatMap((u) => u.msgs);

  const droppedMsgs = droppedUnits.flatMap((u) => u.msgs);
  const droppedTokens = droppedUnits.reduce((acc, u) => acc + u.tokens, 0);
  const removedChars = droppedMsgs.reduce(
    (acc, m) => acc + canonicalizeContent(m.content).length,
    0,
  );
  const originalTokens = units.reduce((acc, u) => acc + u.tokens, 0);

  return {
    messages: retainedMsgs,
    droppedTokens,
    droppedMessages: droppedMsgs.length,
    removedChars,
    originalTokens,
    retainedTokens: used,
    underBudget: used <= maxTokens,
    category: 'context_budget',
  };
}

export type { OptimizationCategory, TokenBudgetResult };
/**
 * ───────────────────────────────────────────────────────────────────────────
 * TokenOptimizer — SAFE-mode token-efficiency engine.
 *
 * Master spec §15–§36. Implemented tier: SAFE (§31 SAFE).
 *
 * SAFE guarantees:
 *   - ONLY exact-duplicate consecutive messages are removed.
 *   - Everything else is preserved BYTE-EXACT: tool_calls, tool schemas,
 *     code blocks, diffs, file paths, JSON schemas, ordering (§32).
 *   - Never rewrites content; never summarizes; never drops unique data.
 *
 * BALANCED / AGGRESSIVE: + context budget (§25) and tool-output compression (§22)
 * `warnings: ["mode 'balanced' not implemented yet — no-op"]` in stats,
 * per §41 (no fake features). Wired default is OFF (no behavior change).
 * ───────────────────────────────────────────────────────────────────────────
 */

import {
  OptimizationMode,
  type OptMessage,
  type OptimizationCategory,
  type OptimizationResult,
  type OptimizationStats,
  type CategoryStats,
} from './types.js';
import { estimateTokens, canonicalizeContent, stableKey } from './estimate.js';
import { applyBudget } from './budget.js';
import { compactConversation } from './compaction.js';
import { compressMessageContent } from './tool-output.js';

const CATEGORIES: OptimizationCategory[] = [
  'duplicate_system',
  'duplicate_message',
  'duplicate_tool_output',
  'context_budget',
  'tool_compression',
  'conversation_compaction',
];

function emptyCategoryStats(): CategoryStats {
  return { removedBlocks: 0, removedChars: 0, removedTokens: 0, tokensSaved: 0 };
}

function emptyStats(mode: OptimizationMode): OptimizationStats {
  return {
    mode,
    originalBlocks: 0,
    optimizedBlocks: 0,
    originalTokens: 0,
    optimizedTokens: 0,
    savedTokens: 0,
    savingsPct: 0,
    dedupHitBlocks: 0,
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, emptyCategoryStats()])) as Record<
      OptimizationCategory,
      CategoryStats
    >,
    warnings: [],
  };
}

/** Whole-message canonical dedup key: role + canonical content + (for tools) call id. */
function dedupKey(m: OptMessage): string {
  const core = `${m.role}\u0000${canonicalizeContent(m.content)}`;
  // Tool results tagged with a DIFFERENT tool_use_id/tool_call_id are
  // semantically distinct (different invocation) — keep them distinct.
  const id = (m.tool_use_id as string) ?? (m.tool_call_id as string) ?? '';
  return id ? `${core}\u0000${id}` : core;
}

export class TokenOptimizer {
  private readonly mode: OptimizationMode;

  constructor(mode: OptimizationMode = OptimizationMode.OFF) {
    this.mode = mode;
  }

  private recordDedup(stats: OptimizationStats, category: OptimizationCategory, msg: OptMessage): void {
    const canonicalText = canonicalizeContent(msg.content);
    const saved = estimateTokens(canonicalText);
    const cat = stats.categories[category];
    cat.removedBlocks += 1;
    cat.removedChars += canonicalText.length;
    cat.tokensSaved += saved;
    stats.dedupHitBlocks += 1;
  }

  optimize(
    messages: OptMessage[],
    opts: { maxContextTokens?: number; minKeep?: number } = {},
  ): OptimizationResult {
    const stats = emptyStats(this.mode);
    stats.originalBlocks = messages.length;

    if (this.mode === OptimizationMode.OFF) {
      stats.optimizedBlocks = messages.length;
      stats.originalTokens = this.countTokens(messages);
      stats.optimizedTokens = stats.originalTokens;
      return { messages, stats, changed: false };
    }

    // ── SAFE: exact-duplicate removal ───────────────────────────────────
    //   - system:  ANY exact duplicate elsewhere (static instructions are
    //              pure waste when repeated; identical text loses nothing)
    //   - tool:    CONSECUTIVE duplicates of the SAME call
    //              (same tool_use_id + identical content = true resend)
    //   - user/assistant: CONSECUTIVE exact duplicates only (a re-asked
    //              question is meaningful and must survive)
    let out: OptMessage[] = [];
    const originalTokens = this.countTokens(messages);
    const seenSystem = new Set<string>();
    let lastMessageKey: string | undefined;

    for (const msg of messages) {
      const key = dedupKey(msg);
      if (msg.role === 'system') {
        if (seenSystem.has(key)) {
          this.recordDedup(stats, 'duplicate_system', msg);
          continue;
        }
        seenSystem.add(key);
        out.push(msg);
        lastMessageKey = key;
        continue;
      }
      if (msg.role === 'tool') {
        if (lastMessageKey !== undefined && lastMessageKey === key) {
          this.recordDedup(stats, 'duplicate_tool_output', msg);
          continue;
        }
        out.push(msg);
        lastMessageKey = key;
        continue;
      }
      // user / assistant
      if (lastMessageKey !== undefined && lastMessageKey === key) {
        this.recordDedup(stats, 'duplicate_message', msg);
        continue;
      }
      out.push(msg);
      lastMessageKey = key;
    }

    stats.optimizedBlocks = out.length;
    stats.originalTokens = originalTokens;
    stats.optimizedTokens = this.countTokens(out);
    stats.savedTokens = Math.max(0, stats.originalTokens - stats.optimizedTokens);
    stats.savingsPct = stats.originalTokens > 0 ? Math.round((stats.savedTokens / stats.originalTokens) * 1000) / 10 : 0;

    // ── BALANCED / AGGRESSIVE: tool-output compression (§22–§24) ──────
    if (this.mode === OptimizationMode.BALANCED || this.mode === OptimizationMode.AGGRESSIVE) {
      const compressOpts =
        this.mode === OptimizationMode.AGGRESSIVE
          ? { maxChars: 50_000 }
          : { maxChars: Number.MAX_SAFE_INTEGER };
      const next: OptMessage[] = [];
      for (const msg of out) {
        if (msg.role === 'tool') {
          const { content, result } = compressMessageContent(msg.content, compressOpts);
          if (result !== null && (result.collapsedRuns > 0 || result.truncated)) {
            const cat = stats.categories.tool_compression;
            cat.removedChars += result.removedChars;
            cat.removedBlocks += 1;
            next.push({ ...msg, content });
            continue;
          }
        }
        next.push(msg);
      }
      out = next;
    }

    // ── AGGRESSIVE: conversation compaction (§27–§28) ───────────────
    if (this.mode === OptimizationMode.AGGRESSIVE) {
      const cc = compactConversation(out, { minRepeat: 5, maxParagraphChars: 300 });
      if (cc.compactedMessages > 0) {
        const cat = stats.categories.conversation_compaction;
        cat.removedBlocks += cc.compactedMessages;
        cat.removedChars += cc.removedChars;
        cat.removedTokens += cc.removedTokens;
        out = cc.messages;
      }
    }

    // ── BALANCED / AGGRESSIVE: context budget stage (§25/§26) ─────────
    if (this.mode === OptimizationMode.BALANCED || this.mode === OptimizationMode.AGGRESSIVE) {
      const budget = applyBudget(out, {
        maxContextTokens: opts.maxContextTokens,
        minKeep: opts.minKeep,
      });
      if (budget.droppedMessages > 0) {
        const cat = stats.categories.context_budget;
        cat.removedBlocks += budget.droppedMessages;
        cat.removedChars += budget.removedChars;
        cat.tokensSaved += budget.droppedTokens;
        stats.optimizedBlocks = budget.messages.length;
        stats.optimizedTokens = this.countTokens(budget.messages);
        stats.savedTokens = Math.max(0, stats.originalTokens - stats.optimizedTokens);
        stats.savingsPct = stats.originalTokens > 0 ? Math.round((stats.savedTokens / stats.originalTokens) * 1000) / 10 : 0;
        out = budget.messages;
      }
    }

    // Finalize AFTER all stages (dedup → compression → compaction → budget):
    // savings must reflect every transform, not just the first.
    stats.optimizedBlocks = out.length;
    stats.optimizedTokens = this.countTokens(out);
    stats.savedTokens = Math.max(0, stats.originalTokens - stats.optimizedTokens);
    stats.savingsPct = stats.originalTokens > 0 ? Math.round((stats.savedTokens / stats.originalTokens) * 1000) / 10 : 0;

    return { messages: out, stats, changed: out.length !== messages.length };
  }

  private countTokens(messages: OptMessage[]): number {
    let total = 0;
    for (const m of messages) {
      total += estimateTokens(canonicalizeContent(m.content));
      const calls = m.tool_calls;
      if (Array.isArray(calls)) total += estimateTokens(JSON.stringify(calls));
    }
    return total;
  }
}

/** Hash a serialized request for cache diagnostics (§17). */
export function contentHash(messages: OptMessage[]): string {
  let acc = 0;
  for (const m of messages) {
    const key = stableKey({ role: m.role, c: canonicalizeContent(m.content) } as Record<string, unknown>);
    for (let i = 0; i < key.length; i++) {
      acc = (acc * 31 + key.charCodeAt(i)) >>> 0;
    }
  }
  return acc.toString(16).padStart(8, '0');
}
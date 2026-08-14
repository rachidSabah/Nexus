/**
 * ───────────────────────────────────────────────────────────────────────────
 * Conversation compaction — spec §27–§28.
 *
 * Deterministic, LOSSLESS-BY-CONSTRUCTION compaction of repetitive prose in
 * user/assistant text messages:
 *
 *  1. Identical consecutive paragraphs (blank-line separated) in ONE message
 *     collapse to a single instance with an explicit repeat-count marker:
 *       `[paragraph repeated 17 times]`
 *     The count IS the information — nothing is silently discarded.
 *  2. Guards (§32 "when uncertain, preserve"):
 *     - runs shorter than `minRepeat` (default 5) are never touched
 *     - paragraphs containing code (backticks / fences / code-ish lines) are
 *       never touched
 *     - system messages are NEVER compacted (P0 — critical instructions)
 *     - tool-role messages are handled by the tool-output layer, not here
 *     - non-string content (block arrays) is passed through untouched
 *
 * Modes: AGGRESSIVE only. BALANCED relies on the budget manager; SAFE never
 * rewrites message content (only removes whole exact-duplicate messages).
 * ───────────────────────────────────────────────────────────────────────────
 */

import { estimateTokens } from './estimate.js';
import type { OptMessage } from './types.js';

export interface CompactionOptions {
  /** Minimum identical-consecutive run that may be collapsed. */
  minRepeat?: number;
  /** Max paragraph length (chars) eligible for collapse. */
  maxParagraphChars?: number;
}

export interface CompactionResult {
  text: string;
  removedChars: number;
  removedTokens: number;
  collapsedRuns: number;
  changed: boolean;
}

const CODE_HINT = /`|^[\s]*(?:function|const|let|class|import|export|interface|type|def |async|await|\{|\}|if |for |while |return )/;
const FENCE = /^```/;

/**
 * Collapse runs of identical consecutive paragraphs inside one text message.
 * Preserves paragraph order and the first occurrence verbatim; appends an
 * explicit marker carrying the repeat count.
 */
export function compactText(text: string, opts: CompactionOptions = {}): CompactionResult {
  const minRepeat = opts.minRepeat ?? 5;
  const maxParagraphChars = opts.maxParagraphChars ?? 300;
  if (text.length < minRepeat * 2) {
    return { text, removedChars: 0, removedTokens: 0, collapsedRuns: 0, changed: false };
  }

  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length < minRepeat) {
    return { text, removedChars: 0, removedTokens: 0, collapsedRuns: 0, changed: false };
  }

  const out: string[] = [];
  let removedChars = 0;
  let collapsedRuns = 0;
  let i = 0;
  while (i < paragraphs.length) {
    const para = paragraphs[i];
    if (para === undefined) {
      i += 1;
      continue;
    }
    const isEligible =
      para.length > 0 &&
      para.length <= maxParagraphChars &&
      !FENCE.test(para) &&
      !CODE_HINT.test(para) &&
      !para.includes('\n'); // single-paragraph blocks (real paragraphs only)

    if (!isEligible) {
      out.push(para);
      i += 1;
      continue;
    }

    let run = 1;
    while (i + run < paragraphs.length && paragraphs[i + run] === para) {
      run += 1;
    }
    if (run >= minRepeat) {
      out.push(`[paragraph repeated ${run} times] ${para}`);
      removedChars += para.length * (run - 1);
      collapsedRuns += 1;
    } else {
      for (let k = 0; k < run; k += 1) out.push(para);
    }
    i += run;
  }

  const changed = collapsedRuns > 0;
  return {
    text: out.join('\n\n'),
    removedChars,
    removedTokens: estimateTokens('x'.repeat(removedChars)),
    collapsedRuns,
    changed,
  };
}

export interface ConversationCompactionResult {
  messages: OptMessage[];
  removedChars: number;
  removedTokens: number;
  collapsedRuns: number;
  compactedMessages: number;
}

/**
 * Compact repetitive prose across user/assistant messages (§27).
 * System and tool messages are never touched; block-array content passes
 * through untouched.
 */
export function compactConversation(
  messages: OptMessage[],
  opts: CompactionOptions = {},
): ConversationCompactionResult {
  let removedChars = 0;
  let removedTokens = 0;
  let collapsedRuns = 0;
  let compactedMessages = 0;

  const out = messages.map((m) => {
    if (m.role !== 'user' && m.role !== 'assistant') return m;
    if (typeof m.content !== 'string') return m;
    const res = compactText(m.content, opts);
    if (!res.changed) return m;
    removedChars += res.removedChars;
    removedTokens += res.removedTokens;
    collapsedRuns += res.collapsedRuns;
    compactedMessages += 1;
    return { ...m, content: res.text };
  });

  return { messages: out, removedChars, removedTokens, collapsedRuns, compactedMessages };
}

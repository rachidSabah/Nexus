/**
 * ───────────────────────────────────────────────────────────────────────────
 * Tool-output compression — spec §22–§24.
 *
 * Coding agents routinely forward huge tool results (npm test, git diff,
 * logs). Two deterministic transforms, strictly information-preserving:
 *
 *  SAFE/BALANCED  — repeated-line grouping: N identical consecutive lines
 *                   collapse to `<same line repeated N times>`. The count
 *                   IS the information; unique content never changes.
 *  AGGRESSIVE     — additionally head/tail truncation for very large
 *                   outputs, with an explicit truncation marker so the
 *                   model KNOWS data was elided (never silent loss).
 *
 * Rules that protect correctness (§32):
 *   - Only IDENTICAL consecutive lines are collapsed (never similar).
 *   - Runs shorter than `minRepeat` (default 5) are never touched —
 *     diffs/code with short repeated lines stay byte-exact.
 *   - Unique content, errors, stack traces, paths: byte-exact.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface ToolCompressionResult {
  text: string;
  collapsedRuns: number;
  removedLines: number;
  removedChars: number;
  truncated: boolean;
  /** Original line count when truncation applied (for the marker). */
  originalLines?: number;
}

export interface ToolCompressionOptions {
  /** Collapse runs of >= N identical lines (default 5). */
  minRepeat?: number;
  /** AGGRESSIVE: max chars retained before head/tail truncation (default 50_000). */
  maxChars?: number;
  /** Fraction of the budget given to the head (default 0.3). */
  headRatio?: number;
}

export function compressToolOutput(
  text: string,
  opts: ToolCompressionOptions = {},
): ToolCompressionResult {
  const minRepeat = opts.minRepeat ?? 5;
  const maxChars = opts.maxChars ?? 50_000;
  const headRatio = opts.headRatio ?? 0.3;

  if (text.length === 0) {
    return { text, collapsedRuns: 0, removedLines: 0, removedChars: 0, truncated: false };
  }

  // ── Pass 1: repeated-line grouping ───────────────────────────────────
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let collapsedRuns = 0;
  let removedLines = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      i += 1;
      continue;
    }
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run += 1;
    if (run >= minRepeat) {
      // Information-preserving collapse: the repeat count is kept.
      out.push(`[same line repeated ${run} times] ${line}`);
      removedLines += run - 1;
      collapsedRuns += 1;
    } else {
      // Short runs stay byte-exact — emit every copy (§32).
      for (let k = 0; k < run; k += 1) out.push(line);
    }
    i += run;
  }

  let collapsed = out.join('\n');
  let removedChars = text.length - collapsed.length;
  let truncated = false;
  let originalLines: number | undefined;

  // ── Pass 2 (AGGRESSIVE): head/tail truncation with explicit marker ──
  if (collapsed.length > maxChars) {
    originalLines = out.length;
    const headLen = Math.floor(maxChars * headRatio);
    const tailLen = maxChars - headLen;
    let head = collapsed.slice(0, headLen);
    let tail = collapsed.slice(collapsed.length - tailLen);
    // Cut at line boundaries so the marker sits between whole lines.
    const headNl = head.lastIndexOf('\n');
    const tailNl = tail.indexOf('\n');
    if (headNl > 0) head = head.slice(0, headNl);
    if (tailNl > 0) tail = tail.slice(tailNl + 1);
    const elided = collapsed.slice(head.length, collapsed.length - tail.length);
    collapsed = `${head}\n[... ${elided.split('\n').length} lines elided (truncated to ${maxChars} chars) ...]\n${tail}`;
    removedChars = text.length - collapsed.length;
    truncated = true;
  }

  return {
    text: collapsed,
    collapsedRuns,
    removedLines,
    removedChars: Math.max(0, removedChars),
    truncated,
    ...(originalLines !== undefined ? { originalLines } : {}),
  };
}

/**
 * Apply tool-output compression to a message's content when it is a string.
 * Non-string (block-array) content is returned untouched.
 */
export function compressMessageContent(
  content: unknown,
  opts?: ToolCompressionOptions,
): { content: unknown; result: ToolCompressionResult | null } {
  if (typeof content !== 'string' || content.length === 0) {
    return { content, result: null };
  }
  const result = compressToolOutput(content, opts);
  return { content: result.text, result };
}

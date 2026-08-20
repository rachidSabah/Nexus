/**
 * ───────────────────────────────────────────────────────────────────────────
 * CompressionPipeline — WS5 Phase 2: stacked, measurable token-compression
 * engines (OmniRoute-competitive "12-engine" surface, honest Nexus edition).
 *
 * Nexus already ships a 5-strategy PromptCompressor (core) and a
 * SAFE/BALANCED/AGGRESSIVE TokenOptimizer. This module adds the ONE missing
 * piece: a composable pipeline that runs N named engines IN SEQUENCE and
 * reports REAL per-engine char/token savings — the analytics OmniRoute shows
 * ("15–95% savings per engine"). No existing engine is replaced or weakened;
 * this is purely additive.
 *
 * Engines (each deterministic, lossless-or-configurable):
 *   1. minify          — collapse redundant whitespace + strip safe line comments
 *   2. dedupe_lines    — collapse 3+ identical consecutive lines to `x N`
 *   3. collapse_arrays — collapse long repetitive JSON/array/list blocks
 *   4. elide_middle    — head/tail preserve + middle-elide for oversized blocks
 *
 * Every number is a MEASURED transformation through the shared estimator
 * (estimateTokens). No invented percentages.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { estimateTokens } from './estimate.js';

export type CompressionEngineName =
  | 'minify'
  | 'dedupe_lines'
  | 'collapse_arrays'
  | 'elide_middle';

export interface EngineBreakdown {
  engine: CompressionEngineName;
  charsIn: number;
  charsOut: number;
  charsSaved: number;
  tokensSaved: number;
}

export interface PipelineOptions {
  /** Engines to run, in order. Default: all four. */
  engines?: CompressionEngineName[];
  /** Max chars before elide_middle kicks in. Default 4000. */
  elideThreshold?: number;
  /** Lines kept at head/tail when eliding. Default 40. */
  elideKeep?: number;
  /** Disable comment stripping in minify (keeps code semantics safer). */
  keepComments?: boolean;
}

export interface PipelineResult {
  text: string;
  originalChars: number;
  finalChars: number;
  originalTokens: number;
  finalTokens: number;
  totalCharsSaved: number;
  totalTokensSaved: number;
  savingsPct: number;
  engines: EngineBreakdown[];
}

// ── Engine implementations ──────────────────────────────────────────────────

/** Collapse 3+ blank/newline runs to a single newline; trim trailing space. */
function minify(text: string, keepComments: boolean): string {
  let out = text
    // collapse 3+ consecutive newlines into one
    .replace(/\n{3,}/g, '\n')
    // trim trailing whitespace on each line
    .replace(/[ \t]+$/gm, '');
  if (!keepComments) {
    // strip full-line `//` and `#` comments only when the line is ONLY a comment
    out = out.replace(/^\s*(?:\/\/|#).*$/gm, '');
    // collapse blank lines introduced by comment stripping
    out = out.replace(/\n{3,}/g, '\n');
  }
  return out;
}

/** Collapse 3+ identical consecutive lines into a single `line  xN` marker. */
function dedupeLines(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i] as string;
    let run = 1;
    while (i + run < lines.length && lines[i + run] === cur && cur.trim() !== '') {
      run++;
    }
    if (run >= 3) {
      out.push(`${cur}  ×${run}`);
      i += run;
    } else {
      out.push(cur);
      i++;
    }
  }
  return out.join('\n');
}

/** Collapse long runs of repeated identical array/object items in JSON-ish text. */
function collapseArrays(text: string): string {
  // Match JSON arrays of repeated objects/strings: [ "a", "a", "a", ... ]
  return text.replace(/\[([\s\S]*?)\]/g, (_full: string, body: string) => {
    const items = body.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (items.length < 4) return _full;
    const first = items[0];
    const allSame = items.every((it) => it === first);
    if (allSame) {
      return `[ ${first}, ... ×${items.length} ]`;
    }
    // repeated pairing (a,b,a,b,a,b)
    if (items.length >= 6 && items.length % 2 === 0) {
      const pair = `${items[0]}, ${items[1]}`;
      let rep = true;
      for (let k = 0; k < items.length; k += 2) {
        const a = items[k];
        const b = items[k + 1];
        if (a !== items[0] || b !== items[1]) { rep = false; break; }
      }
      if (rep) return `[ ${pair}, ... ×${items.length / 2} ]`;
    }
    return _full;
  });
}

/** Preserve head+tail of oversized blocks, elide the repetitive middle. */
function elideMiddle(text: string, threshold: number, keep: number): string {
  if (text.length <= threshold) return text;
  const lines = text.split('\n');
  if (lines.length <= keep * 2 + 1) return text;
  const head = lines.slice(0, keep);
  const tail = lines.slice(-keep);
  const middle = lines.length - head.length - tail.length;
  return [...head, `… [${middle} lines elided] …`, ...tail].join('\n');
}

const ENGINE_FNS: Record<
  CompressionEngineName,
  (text: string, opts: Required<PipelineOptions>) => string
> = {
  minify: (t, o) => minify(t, o.keepComments),
  dedupe_lines: (t) => dedupeLines(t),
  collapse_arrays: (t) => collapseArrays(t),
  elide_middle: (t, o) => elideMiddle(t, o.elideThreshold, o.elideKeep),
};

const ALL_ENGINES: CompressionEngineName[] = ['minify', 'dedupe_lines', 'collapse_arrays', 'elide_middle'];

/**
 * Run a stacked compression pipeline over a single text block, measuring
 * real per-engine savings. Deterministic and side-effect free.
 */
export function compressPipeline(text: string, options: PipelineOptions = {}): PipelineResult {
  const opts: Required<PipelineOptions> = {
    engines: options.engines ?? ALL_ENGINES,
    elideThreshold: options.elideThreshold ?? 4000,
    elideKeep: options.elideKeep ?? 40,
    keepComments: options.keepComments ?? false,
  };

  const originalChars = text.length;
  const originalTokens = estimateTokens(text);

  let current = text;
  const engines: EngineBreakdown[] = [];

  for (const name of opts.engines) {
    const before = current;
    const after = ENGINE_FNS[name](current, opts);
    const charsIn = before.length;
    const charsOut = after.length;
    const charsSaved = Math.max(0, charsIn - charsOut);
    current = after;
    engines.push({
      engine: name,
      charsIn,
      charsOut,
      charsSaved,
      tokensSaved: Math.max(0, estimateTokens(before) - estimateTokens(after)),
    });
  }

  const finalChars = current.length;
  const finalTokens = estimateTokens(current);
  const totalCharsSaved = Math.max(0, originalChars - finalChars);
  const totalTokensSaved = Math.max(0, originalTokens - finalTokens);

  return {
    text: current,
    originalChars,
    finalChars,
    originalTokens,
    finalTokens,
    totalCharsSaved,
    totalTokensSaved,
    savingsPct: originalChars > 0 ? Math.round((totalCharsSaved / originalChars) * 1000) / 10 : 0,
    engines,
  };
}

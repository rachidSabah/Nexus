/**
 * Lightweight token estimator.
 *
 * This is an ESTIMATE (chars/4 with code-dense weighting), used for
 * comparative savings metrics — never for billing or claim-level accuracy.
 * Costs/limits decisions that require exactness must use provider usage
 * reports instead (§30: "All numbers must be real measurements" — these
 * are measured bytes transformed through a documented heuristic).
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let weight = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch > 0x2e80) weight += 2.5; // CJK — dense
    else if (ch < 0x20) weight += 0.5; // control chars
    else weight += 1;
  }
  return Math.max(1, Math.round(weight / 4));
}

/** Canonical string form of arbitrary message content, stable for hashing. */
export function canonicalizeContent(content: unknown): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  return JSON.stringify(content);
}

/** Stable serialization used for dedup keys — key-sorted JSON. */
export function stableKey(obj: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return JSON.stringify(out);
}
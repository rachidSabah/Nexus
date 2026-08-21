/**
 * Pluggable external compression adapters (honest edition).
 *
 * OmniRoute advertises "external" engines (Caveman, RTK, LLMLingua-2…) that
 * call upstream services. Nexus does NOT ship those keys or hardcode any
 * upstream. Instead we expose a REGISTRY: an operator registers an external
 * compressor by supplying a `compress` function that talks to THEIR configured
 * upstream. Nexus measures the REAL before/after and reports it — never a
 * fabricated percentage.
 *
 * If no external compressor is registered for a name, the pipeline simply skips
 * it (logs a `delegated: false` note) so there is no silent fake saving.
 */

export interface ExternalCompressorHandle {
  readonly name: string;
  /** Human description, e.g. "Caveman (upstream RTK service)" — surfaced in UI. */
  readonly description: string;
  /**
   * Compress `text`. MUST return the real compressed output from the operator's
   * upstream. Throwing is allowed — the pipeline catches and treats it as a no-op
   * (original text returned) so a misconfigured external engine never corrupts a
   * prompt.
   */
  compress(text: string): Promise<string> | string;
}

export class ExternalCompressorRegistry {
  private readonly engines = new Map<string, ExternalCompressorHandle>();

  register(handle: ExternalCompressorHandle): void {
    this.engines.set(handle.name, handle);
  }

  unregister(name: string): boolean {
    return this.engines.delete(name);
  }

  has(name: string): boolean {
    return this.engines.has(name);
  }

  list(): readonly ExternalCompressorHandle[] {
    return Array.from(this.engines.values());
  }

  /**
   * Run a registered external compressor, measuring REAL char savings.
   * Returns `{ delegated: false }` when the engine is not registered (honest
   * skip — no fabricated saving) and `{ delegated: true, charsSaved, output }`
   * when it ran.
   */
  async run(name: string, text: string): Promise<{
    delegated: boolean;
    output: string;
    charsIn: number;
    charsOut: number;
    charsSaved: number;
    error?: string;
  }> {
    const handle = this.engines.get(name);
    if (!handle) {
      return { delegated: false, output: text, charsIn: text.length, charsOut: text.length, charsSaved: 0 };
    }
    const charsIn = text.length;
    try {
      const output = await handle.compress(text);
      const charsOut = output.length;
      return {
        delegated: true,
        output,
        charsIn,
        charsOut,
        charsSaved: Math.max(0, charsIn - charsOut),
      };
    } catch (err) {
      // Misconfigured external engine: don't corrupt the prompt, don't fake a save.
      return {
        delegated: true,
        output: text,
        charsIn,
        charsOut: charsIn,
        charsSaved: 0,
        error: (err as Error).message,
      };
    }
  }
}

/** Shared singleton registry (operators register their upstreams at boot). */
export const externalCompressors = new ExternalCompressorRegistry();


/**
 * ───────────────────────────────────────────────────────────────────────────
 * SpecialTokenFilter — Stream Token Sanitization & Runaway Clamping Engine
 *
 * Catches tokenizer vocabulary leaks, special token pollution, and runaway
 * repetitive loops (<unk>, <pad>, <|im_end|>, etc.) across streaming and
 * non-streaming completions:
 *   1. Scrubs special tokens from model deltas and final responses.
 *   2. Detects runaway <unk> repetition loops (3+ repetitions).
 *   3. Detects runaway substring repetitions (5+ identical chunks).
 *   4. Gracefully clamps the stream and signals safe termination.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface StreamClampingState {
  chunkCount: number;
  recentSpecialCount: number;
  recentBuffer: string;
  terminated: boolean;
}

export function newStreamClampingState(): StreamClampingState {
  return {
    chunkCount: 0,
    recentSpecialCount: 0,
    recentBuffer: '',
    terminated: false,
  };
}

/** Matches special tokens emitted by various upstream tokenizers */
export const SPECIAL_TOKENS_REGEX = /<unk>|<pad>|<s>|<\/s>|<\|im_end\|>|<\|im_start\|>|<\|endoftext\|>|<\|startoftext\|>|<\|eot_id\|>|<\|end_of_text\|>|\[UNK\]|\[PAD\]|\[CLS\]|\[SEP\]|\[MASK\]|�/gi;

/**
 * Strips special tokens from static text.
 */
export function filterSpecialTokens(text: string): { cleaned: string; hasSpecialTokens: boolean; specialCount: number } {
  if (!text || typeof text !== 'string') {
    return { cleaned: '', hasSpecialTokens: false, specialCount: 0 };
  }

  let count = 0;
  const cleaned = text.replace(SPECIAL_TOKENS_REGEX, () => {
    count++;
    return '';
  });

  return {
    cleaned,
    hasSpecialTokens: count > 0,
    specialCount: count,
  };
}

/**
 * Inspects streaming chunk deltas, sanitizes them, and determines if a
 * runaway loop has occurred that warrants terminating the stream.
 */
export function filterStreamChunk(
  delta: string,
  state: StreamClampingState,
): { cleaned: string; shouldTerminate: boolean; reason?: 'special_token_loop' | 'repetitive_phrase_loop' } {
  if (state.terminated) {
    return { cleaned: '', shouldTerminate: true };
  }

  if (!delta || typeof delta !== 'string') {
    return { cleaned: '', shouldTerminate: false };
  }

  state.chunkCount++;

  // 1. Detect special token count in this delta
  const filterResult = filterSpecialTokens(delta);
  if (filterResult.hasSpecialTokens) {
    state.recentSpecialCount += filterResult.specialCount;
  } else {
    // Decay special token count when normal text arrives
    state.recentSpecialCount = Math.max(0, state.recentSpecialCount - 1);
  }

  // If 3+ special tokens arrive in close proximity, it is a runaway tokenizer breakdown
  if (state.recentSpecialCount >= 3) {
    state.terminated = true;
    return {
      cleaned: filterResult.cleaned,
      shouldTerminate: true,
      reason: 'special_token_loop',
    };
  }

  // 2. Track rolling buffer to detect runaway repetitive phrase loops (e.g. repeated sentence / syntax fragment)
  state.recentBuffer += filterResult.cleaned;
  if (state.recentBuffer.length > 500) {
    state.recentBuffer = state.recentBuffer.slice(-500);
  }

  // Look for short phrase repetition: e.g. a phrase of length 8-40 repeating 5+ times in recent buffer
  if (state.recentBuffer.length >= 80) {
    const buf = state.recentBuffer;
    for (let len = 8; len <= 40; len++) {
      const candidate = buf.slice(-len);
      // Count how many consecutive times candidate appears at the tail
      let repetitions = 0;
      let pos = buf.length;
      while (pos >= len && buf.slice(pos - len, pos) === candidate) {
        repetitions++;
        pos -= len;
      }
      if (repetitions >= 5) {
        state.terminated = true;
        return {
          cleaned: filterResult.cleaned,
          shouldTerminate: true,
          reason: 'repetitive_phrase_loop',
        };
      }
    }
  }

  return {
    cleaned: filterResult.cleaned,
    shouldTerminate: false,
  };
}

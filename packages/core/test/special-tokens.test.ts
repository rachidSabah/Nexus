import { describe, it, expect } from 'vitest';
import {
  filterSpecialTokens,
  filterStreamChunk,
  newStreamClampingState,
} from '../src/application/special-tokens.js';

describe('SpecialTokenFilter & Stream Clamping', () => {
  it('filters out special tokens from static text', () => {
    const raw = 'Now, let us find useApp.getState()<unk><unk><|im_end|>';
    const res = filterSpecialTokens(raw);
    expect(res.hasSpecialTokens).toBe(true);
    expect(res.cleaned).toBe('Now, let us find useApp.getState()');
  });

  it('detects runaway special token loops and signals termination', () => {
    const state = newStreamClampingState();
    
    const c1 = filterStreamChunk('Checking source files... ', state);
    expect(c1.shouldTerminate).toBe(false);
    expect(c1.cleaned).toBe('Checking source files... ');
    expect(c1.shouldTerminate).toBe(false);

    const c2 = filterStreamChunk('<unk><unk><unk>', state);
    expect(c2.shouldTerminate).toBe(true);
    expect(c2.reason).toBe('special_token_loop');
  });

  it('detects runaway repetitive phrase loops', () => {
    const state = newStreamClampingState();
    const phrase = 'Let me try a different syntax. ';
    
    let terminated = false;
    for (let i = 0; i < 6; i++) {
      const res = filterStreamChunk(phrase, state);
      if (res.shouldTerminate) {
        terminated = true;
        break;
      }
    }
    expect(terminated).toBe(true);
  });
});

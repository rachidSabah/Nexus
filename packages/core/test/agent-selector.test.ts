import { describe, it, expect } from 'vitest';
import { AgentSelector } from '../src/application/agent-selector.js';

describe('AgentSelector', () => {
  it('selects runnable coding agent for coding task', () => {
    const selector = new AgentSelector();
    const candidates = [
      { id: 'claude-code', name: 'Claude Code', runnable: true, liveVerified: true, found: true },
      { id: 'opencode', name: 'OpenCode', runnable: false, liveVerified: false, found: false },
    ];

    const result = selector.selectAgent(candidates, { category: 'CODING' });
    expect(result.selectedAgent).toBe('claude-code');
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

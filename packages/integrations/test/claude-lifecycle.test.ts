import { describe, it, expect } from 'vitest';
import { ClaudeCodeIntegration } from '../src/adapters/claude-code.js';
import { createIntegrationRegistry } from '../src/registry.js';
import { DEFAULT_CAPABILITIES } from '../src/contract.js';

const ctx = {
  gatewayUrl: 'http://127.0.0.1:8787',
  apiKey: 'nexus',
  defaultModel: 'nexus/auto',
};

describe('ClaudeCodeIntegration lifecycle', () => {
  it('provides a launch spec pointing at Nexus (no FCC/20128)', async () => {
    const adapter = new ClaudeCodeIntegration();
    const spec = await adapter.getLaunchSpec(ctx);
    expect(spec).not.toBeNull();
    expect(spec!.interactive).toBe(true);
    expect(spec!.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8787');
    expect(spec!.env.ANTHROPIC_AUTH_TOKEN).toBe('nexus');
    expect(spec!.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBe('1');
    // Security: must never reference the removed Free Claude Code proxy.
    expect(spec!.display).not.toContain('20128');
    expect(JSON.stringify(spec)).not.toContain('fcc');
    expect(JSON.stringify(spec)).not.toContain('localhost:20128');
  });

  it('advertises start/stop/restart support via capabilities()', async () => {
    const adapter = new ClaudeCodeIntegration();
    const caps = await adapter.capabilities(ctx);
    expect(caps.supportsStart).toBe(true);
    expect(caps.supportsStop).toBe(true);
    expect(caps.supportsRestart).toBe(true);
    expect(caps.interactive).toBe(true);
    expect(caps.supportsGatewayBinding).toBe(true);
  });

  it('is registered in the integration registry under claude-code', () => {
    const registry = createIntegrationRegistry();
    expect(registry.get('claude-code')).toBeInstanceOf(ClaudeCodeIntegration);
  });

  it('base default capabilities advertise NO lifecycle when no launch spec', async () => {
    const registry = createIntegrationRegistry();
    for (const adapter of registry.values()) {
      if (adapter.id === 'claude-code') continue; // claude-code has a real spec
      const caps = await adapter.capabilities(ctx);
      // Adapters without a getLaunchSpec override must NOT advertise start/stop/restart.
      if (caps.supportsStart) {
        const spec = await adapter.getLaunchSpec(ctx);
        expect(spec).not.toBeNull();
      }
      expect(caps.interactive).toBe(false);
    }
    expect(DEFAULT_CAPABILITIES.supportsStart).toBe(false);
  });
});

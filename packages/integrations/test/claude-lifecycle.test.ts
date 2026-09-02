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
      // The safety invariant: an adapter must NOT advertise start/stop/restart
      // unless it actually provides a launch spec (i.e. it can really be launched).
      if (caps.supportsStart || caps.supportsStop || caps.supportsRestart) {
        const spec = await adapter.getLaunchSpec(ctx);
        expect(spec, `${adapter.id} advertises lifecycle but has no launch spec`).not.toBeNull();
      }
    }
    // The shared default never advertises lifecycle.
    expect(DEFAULT_CAPABILITIES.supportsStart).toBe(false);
    expect(DEFAULT_CAPABILITIES.supportsStop).toBe(false);
    expect(DEFAULT_CAPABILITIES.supportsRestart).toBe(false);
  });

  it('DeepSeek Harness provides web launch spec and supports full start/runtime/stop lifecycle', async () => {
    const { DeepSeekHarnessIntegration } = await import('../src/adapters/deepseek-harness.js');
    const { integrationProcessManager } = await import('../src/process-manager.js');

    const adapter = new DeepSeekHarnessIntegration();
    const caps = await adapter.capabilities(ctx);
    expect(caps.supportsStart).toBe(true);
    expect(caps.supportsStop).toBe(true);
    expect(caps.supportsRestart).toBe(true);
    expect(caps.interactive).toBe(false);

    const spec = await adapter.getLaunchSpec(ctx);
    expect(spec).not.toBeNull();
    expect(spec!.args).toContain('web');
    expect(spec!.args).toContain('--port');
    expect(spec!.args).toContain('3080');
    expect(spec!.args).toContain('--no-open');
    expect(spec!.webUrl).toBe('http://127.0.0.1:3080');

    // Live process test
    const startRes = await adapter.start(ctx);
    expect(startRes.ok).toBe(true);
    expect(startRes.message).toContain('started DeepSeek Harness');

    const state = await adapter.runtime(ctx);
    expect(state.running).toBe(true);
    expect(typeof state.pid).toBe('number');
    expect(state.pid).toBeGreaterThan(0);

    const stopRes = await adapter.stop(ctx);
    expect(stopRes.ok).toBe(true);

    const stateAfterStop = await adapter.runtime(ctx);
    expect(stateAfterStop.running).toBe(false);
  }, 20000);
});

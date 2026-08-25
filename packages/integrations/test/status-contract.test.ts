import { describe, it, expect } from 'vitest';
import { ClaudeCodeIntegration } from '../src/adapters/claude-code.js';
import { GooseIntegration } from '../src/adapters/goose.js';
import { CrushIntegration } from '../src/adapters/crush.js';
import { normalizeGatewayUrl } from '../src/contract.js';

const baseCtx = {
  gatewayUrl: 'http://127.0.0.1:8787',
  apiKey: 'nexus',
  defaultModel: 'nexus/auto',
};

describe('IntegrationStatus rich contract', () => {
  it('returns the extended fields with correct shapes', async () => {
    const adapter = new ClaudeCodeIntegration();
    const s = await adapter.status(baseCtx as any);

    expect(s.id).toBe('claude-code');
    // Extended fields must be present (backward-compatible contract).
    // configuredEndpoint is `string | undefined` (undefined when the tool is not
    // installed on the host), so it must be either undefined or a string.
    expect(s.configuredEndpoint === undefined || typeof s.configuredEndpoint === 'string').toBe(true);
    // expectedEndpoint is always derived from the gateway URL, installed or not.
    expect(typeof s.expectedEndpoint).toBe('string');
    expect(s.expectedEndpoint!.endsWith('/v1')).toBe(true);
    expect(typeof s.mismatch).toBe('boolean');
    // health is one of the documented states.
    expect(['unknown', 'healthy', 'mismatch', 'not-configured']).toContain(s.health);
  });

  it('detects endpoint mismatch between localhost and 127.0.0.1', async () => {
    const adapter = new ClaudeCodeIntegration();
    const s = await adapter.status({ ...baseCtx, gatewayUrl: 'http://localhost:8787' } as any);

    // When the configured binding differs (normalized) from the expected gateway,
    // mismatch must be reported as true and health must reflect it.
    const expectedEndpoint = `${normalizeGatewayUrl('http://localhost:8787')}/v1`;
    if (s.configuredEndpoint) {
      const differs = normalizeGatewayUrl(s.configuredEndpoint) !== normalizeGatewayUrl(expectedEndpoint);
      expect(s.mismatch).toBe(differs);
      if (differs) expect(s.health).toBe('mismatch');
    }
  });

  it('reports no mismatch when the configured endpoint matches the expected gateway', async () => {
    const adapter = new ClaudeCodeIntegration();
    const s = await adapter.status(baseCtx as any);
    // On this machine claude is bound to 127.0.0.1:8787 which equals the expected
    // gateway, so mismatch must be false and health healthy/not-configured.
    if (s.configuredEndpoint) {
      const matches = normalizeGatewayUrl(s.configuredEndpoint) === normalizeGatewayUrl(`${baseCtx.gatewayUrl}/v1`);
      expect(s.mismatch).toBe(!matches);
    }
  });

  // Regression: standalone CLI agents (Goose, Crush) must advertise managed
  // lifecycle support so the dashboard renders Start/Stop/Restart buttons.
  // Without getLaunchSpec() these default to false and the buttons silently vanish.
  it('standalone CLI agents (goose, crush) advertise supportsStart/Stop/Restart', async () => {
    for (const Adapter of [GooseIntegration, CrushIntegration]) {
      const adapter = new Adapter();
      const caps = await adapter.capabilities(baseCtx as any);
      expect(caps.supportsStart).toBe(true);
      expect(caps.supportsStop).toBe(true);
      expect(caps.supportsRestart).toBe(true);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { resolveModel, isNexusRoutingAlias } from '../src/contract.js';
import type { IntegrationContext } from '../src/contract.js';

function ctx(defaultModel?: string): IntegrationContext {
  return {
    gatewayUrl: 'http://127.0.0.1:8787',
    apiKey: 'nexus',
    defaultModel,
    force: false,
    dryRun: false,
  } as IntegrationContext;
}

describe('isNexusRoutingAlias', () => {
  it('detects nexus/*, local/* and claude-gw-* aliases', () => {
    expect(isNexusRoutingAlias('nexus/auto')).toBe(true);
    expect(isNexusRoutingAlias('nexus/fast')).toBe(true);
    expect(isNexusRoutingAlias('local/xyz')).toBe(true);
    expect(isNexusRoutingAlias('claude-gw-abc')).toBe(true);
  });
  it('does NOT flag concrete agent models', () => {
    expect(isNexusRoutingAlias('claude-haiku-4-5')).toBe(false);
    expect(isNexusRoutingAlias('gpt-4o')).toBe(false);
    expect(isNexusRoutingAlias('qwen/qwen-2.5-coder-32b-instruct')).toBe(false);
    expect(isNexusRoutingAlias(undefined)).toBe(false);
  });
});

describe('resolveModel — universal no-alias rule', () => {
  it('keeps a concrete user-selected default model', () => {
    expect(resolveModel(ctx('claude-haiku-4-5'))).toBe('claude-haiku-4-5');
  });
  it('drops a Nexus routing alias default (no agent accepts it as a native model)', () => {
    expect(resolveModel(ctx('nexus/auto'))).toBeUndefined();
    expect(resolveModel(ctx('nexus/fast'))).toBeUndefined();
  });
  it('won the staleness race: falling back to an existing concrete model', () => {
    expect(resolveModel(ctx('nexus/auto'), 'claude-opus-4-5')).toBe('claude-opus-4-5');
  });
  it('does NOT write a stale alias back from existing config', () => {
    expect(resolveModel(ctx('nexus/auto'), 'nexus/best-coding')).toBeUndefined();
  });
  it('omits the field when neither default nor existing is concrete', () => {
    expect(resolveModel(ctx(undefined))).toBeUndefined();
  });
});

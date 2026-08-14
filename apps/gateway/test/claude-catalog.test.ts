import { describe, it, expect } from 'vitest';
import type { ModelDescriptor } from '@anx/core';
import {
  CLAUDE_GW_PREFIX,
  sanitizeFragment,
  claudeGwAlias,
  isClaudeGwAlias,
  projectClaudeCatalog,
  resolveClaudeGwAlias,
  claudeCatalogDebug,
  type ClaudeProjectionEntry,
} from '../src/claude-catalog.js';
import { ModelAliasRegistry } from '../src/model-aliases.js';

/** Builds a minimal descriptor. */
function model(id: string, providerId = 'opencode-zen', extra: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return { id, providerId, ...extra };
}

describe('claudeGwAlias (deterministic, reversible mapping)', () => {
  it('builds a claude-* id Claude Code will display', () => {
    expect(claudeGwAlias('opencode-zen', 'deepseek-v4-flash-free')).toBe(
      'claude-gw-opencode-zen-deepseek-v4-flash-free',
    );
    expect(claudeGwAlias('openrouter', 'qwen/qwen3-coder')).toBe('claude-gw-openrouter-qwen-qwen3-coder');
  });

  it('is deterministic (same input -> same alias)', () => {
    expect(claudeGwAlias('a', 'b-c')).toBe(claudeGwAlias('a', 'b-c'));
  });

  it('sanitizes fragments (lowercase, runs -> single dash)', () => {
    expect(sanitizeFragment('DeepSeek-V4 Pro')).toBe('deepseek-v4-pro');
    expect(sanitizeFragment('a!!b')).toBe('a-b');
    expect(sanitizeFragment('---')).toBe('m'); // empty fallback
  });

  it('isClaudeGwAlias rejects natives and prefixes-only', () => {
    expect(isClaudeGwAlias('claude-gw-opencode-zen-x')).toBe(true);
    expect(isClaudeGwAlias('claude-opus-4-8')).toBe(false);
    expect(isClaudeGwAlias('claude-gw-')).toBe(false);
    expect(isClaudeGwAlias('gemini-3.6-flash')).toBe(false);
  });
});

describe('projectClaudeCatalog (dynamic projection, §18/§21)', () => {
  const catalog = [
    model('claude-opus-4-8', 'anthropic'),            // already accepted -> native
    model('deepseek-v4-flash-free', 'opencode-zen'),  // -> alias + native
    model('gemini-3.6-flash', 'google'),              // -> alias + native
    model('gpt-5', 'openai'),                         // -> alias + native
  ];

  it('emits natives for accepted ids + aliases for everything else', () => {
    const out = projectClaudeCatalog(catalog);
    const ids = out.map((e) => e.id);
    expect(ids).toContain('claude-opus-4-8');
    expect(ids).toContain('claude-gw-opencode-zen-deepseek-v4-flash-free');
    expect(ids).toContain('claude-gw-google-gemini-3-6-flash');
    expect(ids).toContain('claude-gw-openai-gpt-5');
    // natives still present for OpenAI-compatible clients
    expect(ids).toContain('deepseek-v4-flash-free');
    expect(ids).toContain('gemini-3.6-flash');
    expect(ids).toContain('gpt-5');
  });

  it('aliases carry nativeId + metadata for the debug view', () => {
    const out = projectClaudeCatalog([model('x-free', 'p1', { pricing: { isFree: true } })]);
    const alias = out.find((e): e is ClaudeProjectionEntry & { nativeId: string } => e.nativeId === 'x-free');
    expect(alias?.id).toBe('claude-gw-p1-x-free');
    expect(alias?.pricing?.isFree).toBe(true);
  });

  it('excludes stale models (availability, §16)', () => {
    const out = projectClaudeCatalog([model('gone', 'p1', { stale: true as never }), model('ok', 'p1')]);
    expect(out.map((e) => e.id)).not.toContain('gone');
    expect(out.map((e) => e.id)).toContain('ok');
  });

  it('excludes routing aliases (auto, auto-*)', () => {
    const out = projectClaudeCatalog([model('auto', 'routing'), model('auto-opencode-zen', 'routing'), model('real', 'p1')]);
    expect(out.map((e) => e.id)).not.toContain('auto');
    expect(out.map((e) => e.id)).not.toContain('auto-opencode-zen');
    expect(out.map((e) => e.id)).toContain('real');
  });

  it('scales to 500 models with no artificial cap (§21)', () => {
    const big = Array.from({ length: 500 }, (_, i) => model(`provider-model-${i}`, `prov-${i % 7}`));
    const out = projectClaudeCatalog(big);
    // 500 aliases + 500 natives
    expect(out.length).toBe(1000);
    expect(out.filter((e) => e.nativeId !== undefined).length).toBe(500);
  });
});

describe('resolveClaudeGwAlias (routing reversal, §17)', () => {
  it('reverses alias -> native id + provider', () => {
    const models = [model('deepseek-v4-flash-free', 'opencode-zen'), model('qwen3-coder', 'openrouter')];
    expect(resolveClaudeGwAlias('claude-gw-opencode-zen-deepseek-v4-flash-free', models)).toEqual({
      modelId: 'deepseek-v4-flash-free',
      providerId: 'opencode-zen',
    });
  });

  it('returns undefined for native ids / unknown aliases', () => {
    const models = [model('deepseek-v4-flash-free', 'opencode-zen')];
    expect(resolveClaudeGwAlias('deepseek-v4-flash-free', models)).toBeUndefined();
    expect(resolveClaudeGwAlias('claude-gw-unknown-unknown', models)).toBeUndefined();
  });

  it('model removed from registry stops resolving (real-time invalidation, §15)', () => {
    const models = [model('deepseek-v4-flash-free', 'opencode-zen')];
    const alias = 'claude-gw-opencode-zen-deepseek-v4-flash-free';
    expect(resolveClaudeGwAlias(alias, models)).toBeDefined();
    // Provider disabled -> model dropped -> alias no longer resolves.
    expect(resolveClaudeGwAlias(alias, [])).toBeUndefined();
  });
});

describe('ModelAliasRegistry integration (§17: selected model controls routing)', () => {
  function makeRegistry(models: ModelDescriptor[]) {
    // Minimal ModelRegistry-compatible stub used by ModelAliasRegistry.
    return { list: () => models } as never;
  }

  it('claude-gw alias resolves to the native model — NOT family-rewritten', () => {
    const models = [model('deepseek-v4-flash-free', 'opencode-zen')];
    const aliases = new ModelAliasRegistry(makeRegistry(models), undefined, {});
    const res = aliases.resolveIfAlias('claude-gw-opencode-zen-deepseek-v4-flash-free');
    expect(res.model).toBe('deepseek-v4-flash-free');
    expect(res.resolution?.providerId).toBe('opencode-zen');
    expect(res.resolution?.reason).toContain('gateway projection');
  });

  it('claude-gw alias for a removed model falls through to family handling', () => {
    const aliases = new ModelAliasRegistry(makeRegistry([]), undefined, { default: 'deepseek-v4-flash-free' });
    // Not resolvable -> no crash, falls through (returns model unchanged since
    // no candidates exist to rewrite to either).
    const res = aliases.resolveIfAlias('claude-gw-gone-provider-gone-model');
    expect(typeof res.model).toBe('string');
  });

  it('native claude-* ids are still family-rewritten (existing behavior preserved)', () => {
    const free = model('deepseek-v4-flash-free', 'opencode-zen', {
      pricing: { isFree: true },
      capabilities: { toolCalling: true },
    });
    const aliases = new ModelAliasRegistry(makeRegistry([free]), undefined, {});
    // No explicit target -> best free tool-calling model wins (existing behavior).
    const res = aliases.resolveIfAlias('claude-opus-4-8');
    expect(res.model).toBe('deepseek-v4-flash-free');
  });
});

describe('claudeCatalogDebug (§25/§26)', () => {
  it('reports counts and filter reasons, never silent', () => {
    const models = [
      model('claude-opus-4-8', 'anthropic'),
      model('deepseek-v4-flash-free', 'opencode-zen'),
      model('auto', 'routing'),
      model('vanished', 'p1', { stale: true as never }),
    ];
    const d = claudeCatalogDebug(models);
    expect(d.agent).toBe('claude-code');
    expect(d.sourceRegistryCount).toBe(4);
    expect(d.compatibleCount).toBe(2);
    expect(d.filteredCount).toBe(2);
    expect(d.filters.some((f) => f.includes('stale'))).toBe(true);
    expect(d.filters.some((f) => f.includes('routing alias'))).toBe(true);
    expect(d.generatedAt).toBeTruthy();
  });
});

describe('CLAUDE_GW_PREFIX sanity', () => {
  it('prefix produces ids Claude Code displays (claude-* family)', () => {
    expect(CLAUDE_GW_PREFIX.startsWith('claude-')).toBe(true);
  });
});

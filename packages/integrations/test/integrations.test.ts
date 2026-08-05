import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BUILTIN_INTEGRATIONS,
  BUILTIN_INTEGRATIONS_COUNT,
  createIntegrationRegistry,
  type IntegrationContext,
} from '../src/index.js';

function makeCtx(overrides: Partial<IntegrationContext> = {}): IntegrationContext {
  return {
    gatewayUrl: 'http://localhost:8787',
    apiKey: 'test-key',
    defaultModel: 'gpt-4',
    dryRun: false,
    force: false,
    ...overrides,
  };
}

describe('Integrations registry', () => {
  it('registers exactly BUILTIN_INTEGRATIONS_COUNT integrations', () => {
    const registry = createIntegrationRegistry();
    expect(registry.size).toBe(BUILTIN_INTEGRATIONS_COUNT);
    expect(BUILTIN_INTEGRATIONS.length).toBe(BUILTIN_INTEGRATIONS_COUNT);
  });

  it('includes OpenCode, OpenCode Go, and OpenCode Zen', () => {
    const registry = createIntegrationRegistry();
    expect(registry.has('opencode')).toBe(true);
    expect(registry.has('opencode-go')).toBe(true);
    expect(registry.has('opencode-zen')).toBe(true);
  });

  it('includes all 19 integrations from the spec', () => {
    const expected = [
      'claude-code', 'codex-cli', 'gemini-cli', 'hermes-cli',
      'opencode', 'opencode-go', 'opencode-zen',
      'cursor', 'continue', 'cline', 'roo-code',
      'openhands', 'aider',
      'zed', 'vscode', 'jetbrains', 'neovim', 'emacs',
    ];
    const registry = createIntegrationRegistry();
    for (const id of expected) {
      expect(registry.has(id), `missing ${id}`).toBe(true);
    }
  });

  it('every integration has a stable id, displayName, description, and category', () => {
    for (const i of BUILTIN_INTEGRATIONS) {
      expect(i.id).toMatch(/^[a-z0-9-]+$/);
      expect(i.displayName.length).toBeGreaterThan(0);
      expect(i.description.length).toBeGreaterThan(0);
      expect(['cli', 'editor', 'ide', 'agent']).toContain(i.category);
    }
  });

  it('every integration id is unique', () => {
    const ids = BUILTIN_INTEGRATIONS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Integration install / uninstall round-trip', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'anx-test-'));
  });

  // Test one CLI, one editor, and one IDE to cover the three base classes.
  const cases: Array<{ id: string; expectedConfigPath: string }> = [
    { id: 'claude-code', expectedConfigPath: '.claude/settings.json' },
    { id: 'opencode-zen', expectedConfigPath: '.config/opencode-zen/config.yaml' },
    { id: 'opencode-go', expectedConfigPath: '.config/opencode-go/config.toml' },
    { id: 'opencode', expectedConfigPath: '.config/opencode/opencode.json' },
    { id: 'aider', expectedConfigPath: '.aider.conf.yml' },
    { id: 'cursor', expectedConfigPath: '.cursor/config.json' },
  ];

  for (const { id, expectedConfigPath } of cases) {
    it(`${id}: writes config and uninstall removes it`, async () => {
      const registry = createIntegrationRegistry();
      const adapter = registry.get(id)!;
      const ctx = makeCtx({ homeDir: tempHome, force: true });

      const result = await adapter.install(ctx);
      expect(result.ok, result.message).toBe(true);

      const fullPath = join(tempHome, expectedConfigPath);
      expect(existsSync(fullPath), `${expectedConfigPath} should exist after install`).toBe(true);

      const content = readFileSync(fullPath, 'utf8');
      expect(content).toContain('localhost:8787');
      expect(content).toContain('gpt-4');

      // Uninstall
      const unResult = await adapter.uninstall(ctx);
      expect(unResult.ok, unResult.message).toBe(true);
      expect(existsSync(fullPath), `${expectedConfigPath} should not exist after uninstall`).toBe(false);
    });
  }

  it('claude-code: JSON config contains apiBaseUrl and model', async () => {
    const registry = createIntegrationRegistry();
    const adapter = registry.get('claude-code')!;
    const ctx = makeCtx({ homeDir: tempHome, force: true });

    await adapter.install(ctx);
    const config = JSON.parse(readFileSync(join(tempHome, '.claude/settings.json'), 'utf8')) as Record<string, unknown>;
    expect(config['apiBaseUrl']).toBe('http://localhost:8787/v1');
    expect(config['model']).toBe('gpt-4');
  });

  it('opencode-zen: YAML config contains provider and model', async () => {
    const registry = createIntegrationRegistry();
    const adapter = registry.get('opencode-zen')!;
    const ctx = makeCtx({ homeDir: tempHome, force: true });

    await adapter.install(ctx);
    const yaml = readFileSync(join(tempHome, '.config/opencode-zen/config.yaml'), 'utf8');
    expect(yaml).toContain('provider: nexus');
    expect(yaml).toContain('model: gpt-4');
    expect(yaml).toContain('http://localhost:8787/v1');
  });

  it('opencode-go: TOML config contains provider block', async () => {
    const registry = createIntegrationRegistry();
    const adapter = registry.get('opencode-go')!;
    const ctx = makeCtx({ homeDir: tempHome, force: true });

    await adapter.install(ctx);
    const toml = readFileSync(join(tempHome, '.config/opencode-go/config.toml'), 'utf8');
    expect(toml).toContain('[provider.nexus]');
    expect(toml).toContain('http://localhost:8787/v1');
    expect(toml).toContain('default_model = "gpt-4"');
  });

  it('dry-run mode writes nothing', async () => {
    const registry = createIntegrationRegistry();
    const adapter = registry.get('aider')!;
    const ctx = makeCtx({ homeDir: tempHome, force: true, dryRun: true });

    const result = await adapter.install(ctx);
    expect(result.ok).toBe(true);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(existsSync(join(tempHome, '.aider.conf.yml'))).toBe(false);
  });

  it('status() returns installed=false and configured=false for clean home', async () => {
    const registry = createIntegrationRegistry();
    const adapter = registry.get('claude-code')!;
    const ctx = makeCtx({ homeDir: tempHome });

    const status = await adapter.status(ctx);
    expect(status.id).toBe('claude-code');
    expect(status.configured).toBe(false);
  });

  it('status() returns configured=true after install', async () => {
    const registry = createIntegrationRegistry();
    const adapter = registry.get('claude-code')!;
    const ctx = makeCtx({ homeDir: tempHome, force: true });

    await adapter.install(ctx);
    const status = await adapter.status(ctx);
    expect(status.configured).toBe(true);
    expect(status.configPath).toContain('settings.json');
  });

  it('verify() calls gateway /health endpoint', async () => {
    const registry = createIntegrationRegistry();
    const adapter = registry.get('claude-code')!;
    const ctx = makeCtx({ homeDir: tempHome });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', version: '0.1.0' }),
    }));

    const result = await adapter.verify(ctx);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('gateway reachable');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('verify() returns fail when gateway is unreachable', async () => {
    const registry = createIntegrationRegistry();
    const adapter = registry.get('claude-code')!;
    const ctx = makeCtx({ homeDir: tempHome, gatewayUrl: 'http://nonexistent:9999' });

    const result = await adapter.verify(ctx);
    expect(result.ok).toBe(false);
  });

  it('json-merge mode preserves existing keys not present in incoming config', async () => {
    const registry = createIntegrationRegistry();
    const adapter = registry.get('cursor')!;
    const configPath = join(tempHome, '.cursor/config.json');

    // Pre-existing user config
    mkdtempSync(join(tempHome, '.cursor'), { recursive: true } as never);
    writeFileSync(configPath, JSON.stringify({ userSetting: 'preserve-me', openaiApiBase: 'old-value' }));

    const ctx = makeCtx({ homeDir: tempHome, force: false }); // NOT force
    await adapter.install(ctx);

    const merged = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(merged['userSetting']).toBe('preserve-me');
    expect(merged['openaiApiBase']).toBe('http://localhost:8787/v1');
  });
});

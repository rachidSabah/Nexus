import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BaseIntegration, jsonString, home } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';

/**
 * Claude Code — Anthropic's official CLI for agentic coding.
 *
 * Configures `~/.claude/settings.json` with the gateway URL. Claude Code
 * reads `apiBaseUrl` and `ANTHROPIC_*` env from this file.
 *
 * Lifecycle: the adapter can also *launch* Claude Code against the gateway
 * (interactive TTY window), independent of the old Free Claude Code / fcc-server
 * installation. It targets `http://127.0.0.1:8787` (configurable via ctx) and
 * never references `localhost:20128` or any FCC component.
 *
 * Source: https://docs.anthropic.com/en/docs/claude-code
 */

/**
 * Returns true when `model` is a Nexus routing policy / virtual alias rather
 * than a concrete Claude-native model id. These resolve dynamically at the
 * gateway (Model Fabric), but Claude Code's client-side model picker rejects
 * them as the persisted default — so we must never leave them pinned as the
 * `model` field in `settings.json`.
 */
function isNexusRoutingAlias(model: string | undefined): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  return m.startsWith('nexus/') || m.startsWith('local/') || m.startsWith('claude-gw-');
}

/**
 * Resolve the model that should be persisted for Claude Code.
 *
 * - A concrete user-selected model (`claude-haiku-4-5`, etc.) is always kept.
 * - A Nexus routing alias requested by Nexus (`nexus/auto`, `local/*`,
 *   `claude-gw-*`) is NOT written — the gateway resolves it at request time.
 *   If the file currently pins a stale alias (left by an older adapter), it is
 *   dropped so Claude Code stops warning on startup.
 * - When the user explicitly rebinds with a concrete model, that wins.
 */
function resolvePersistedModel(ctx: IntegrationContext): string | undefined {
  if (ctx.defaultModel && !isNexusRoutingAlias(ctx.defaultModel)) {
    return ctx.defaultModel; // user explicitly chose a concrete model
  }
  const existingPath = join(home(ctx), '.claude/settings.json');
  let existingModel: unknown;
  try {
    if (existsSync(existingPath)) {
      const parsed = JSON.parse(readFileSync(existingPath, 'utf8')) as Record<string, unknown>;
      existingModel = parsed.model;
    }
  } catch {
    // ignore unreadable/malformed existing config
  }
  if (typeof existingModel === 'string' && !isNexusRoutingAlias(existingModel)) {
    return existingModel; // preserve the user's concrete selection
  }
  return undefined; // drop stale alias / none
}

export class ClaudeCodeIntegration extends BaseIntegration {
  readonly id = 'claude-code';
  readonly displayName = 'Claude Code';
  readonly description = "Anthropic's official agentic coding CLI";
  readonly category = 'cli' as const;
  readonly homepage = 'https://docs.anthropic.com/en/docs/claude-code';

  protected detectBinaries(): string[] {
    return ['claude'];
  }

  protected configFiles() {
    return [
      {
        path: '.claude/settings.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) => {
          const model = resolvePersistedModel(ctx);
          return jsonString({
            env: {
              ANTHROPIC_BASE_URL: ctx.gatewayUrl,
              // Single, deterministic auth path: ANTHROPIC_AUTH_TOKEN only.
              // `apiKeyHelper` is intentionally set to `undefined` so the
              // merge deletes any stale copy left by an older adapter — having
              // both set triggers Claude Code's
              // "Both ANTHROPIC_AUTH_TOKEN and apiKeyHelper set" conflict.
              ANTHROPIC_AUTH_TOKEN: ctx.apiKey || 'nexus',
              CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
              CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
              DISABLE_TELEMETRY: '1',
              DISABLE_AUTOUPDATER: '1',
              DISABLE_ERROR_REPORTING: '1',
              DISABLE_FEEDBACK_COMMAND: '1',
            },
            apiBaseUrl: `${ctx.gatewayUrl}/v1`,
            // `null` => json-merge explicitly deletes stale apiKeyHelper
            apiKeyHelper: null,
            // Persisted model: concrete user selection only. If null/undefined,
            // json-merge explicitly deletes any stale routing alias (e.g. `nexus/auto`)
            model: model ?? null,
          });
        },
      },
      {
        path: '.claude/settings.local.json',
        merge: 'skip' as const,
        content: () =>
          jsonString({
            permissions: { allow: [], deny: [] },
          }),
      },
    ];
  }

  /**
   * Launch spec for managed start. Resolves the real `claude` executable and
   * passes the Nexus gateway env on the command line so it binds to Nexus
   * regardless of persisted settings. Interactive TTY window (Windows hidden).
   */
  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('claude');
    const concreteModel =
      ctx.defaultModel && !isNexusRoutingAlias(ctx.defaultModel) ? ctx.defaultModel : undefined;
    return {
      executable: exe,
      args: [],
      interactive: true,
      env: {
        ANTHROPIC_BASE_URL: ctx.gatewayUrl,
        ANTHROPIC_AUTH_TOKEN: ctx.apiKey || 'nexus',
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
        // Only inject a default model when it is concrete; never a routing alias.
        ...(concreteModel ? { ANTHROPIC_MODEL: concreteModel } : {}),
      },
      display: `claude → ${ctx.gatewayUrl}`,
    };
  }
}

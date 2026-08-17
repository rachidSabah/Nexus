import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';

/**
 * Claude Code — Anthropic's official CLI for agentic coding.
 *
 * Configures `~/.claude/settings.json` with the gateway URL. Claude Code
 * reads `apiBaseUrl` and `apiKeyHelper` from this file.
 *
 * Lifecycle: the adapter can also *launch* Claude Code against the gateway
 * (interactive TTY window), independent of the old Free Claude Code / fcc-server
 * installation. It targets `http://127.0.0.1:8787` (configurable via ctx) and
 * never references `localhost:20128` or any FCC component.
 *
 * Source: https://docs.anthropic.com/en/docs/claude-code
 */
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
        content: (ctx: IntegrationContext) =>
          jsonString({
            env: {
              ANTHROPIC_BASE_URL: ctx.gatewayUrl,
              ANTHROPIC_AUTH_TOKEN: ctx.apiKey || 'nexus',
              CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
              DISABLE_TELEMETRY: '1',
              DISABLE_AUTOUPDATER: '1',
              DISABLE_ERROR_REPORTING: '1',
              DISABLE_FEEDBACK_COMMAND: '1',
            },
            apiBaseUrl: `${ctx.gatewayUrl}/v1`,
            apiKeyHelper: ctx.apiKey
              ? `echo '${ctx.apiKey}'`
              : 'echo "no-key-required"',
            model: ctx.defaultModel,
          }),
      },
      {
        path: '.claude/settings.local.json',
        merge: 'skip' as const,
        content: () =>
          jsonString({
            // Per-user overrides — left intentionally minimal.
            permissions: { allow: [], deny: [] },
          }),
      },
    ];
  }

  /**
   * Launch spec for managed start. Resolves the real `claude` executable and
   * passes the Nexus gateway env on the command line so it binds to Nexus
   * regardless of persisted settings. Interactive TTY window (Windows `cmd /k`).
   */
  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('claude');
    return {
      executable: exe,
      args: [],
      interactive: true,
      env: {
        ANTHROPIC_BASE_URL: ctx.gatewayUrl,
        ANTHROPIC_AUTH_TOKEN: ctx.apiKey || 'nexus',
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
        ANTHROPIC_MODEL: ctx.defaultModel,
      },
      display: `claude → ${ctx.gatewayUrl}`,
    };
  }
}

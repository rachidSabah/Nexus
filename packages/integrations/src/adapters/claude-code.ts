import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';

/**
 * Claude Code — Anthropic's official CLI for agentic coding.
 *
 * Configures `~/.claude/settings.json` with the gateway URL. Claude Code
 * reads `apiBaseUrl` and `apiKeyHelper` from this file.
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
}

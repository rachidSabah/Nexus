import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * Codex CLI — OpenAI's coding agent CLI.
 *
 * Codex uses an OpenAI-compatible config at `~/.codex/config.json` (or
 * `~/.codex/config.toml`). We write the JSON variant for portability.
 *
 * Source: https://github.com/openai/codex
 */
export class CodexCliIntegration extends BaseIntegration {
  readonly id = 'codex-cli';
  readonly displayName = 'Codex CLI';
  readonly description = "OpenAI's coding agent CLI";
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/openai/codex';

  protected detectBinaries(): string[] {
    return ['codex'];
  }

  protected configFiles(ctx: IntegrationContext) {
    const endpoint = `${ctx.gatewayUrl}/v1`;
    const targetModel = resolveModel(ctx);
    const envKey = process.platform === 'win32' ? 'USERPROFILE' : 'USER';

    return [
      {
        path: '.codex/config.toml',
        merge: 'overwrite' as const,
        content: () =>
          [
            `model = "${targetModel ?? 'gateway-routed'}"`,
            `model_provider = "nexus"`,
            '',
            '[model_providers.nexus]',
            `name = "nexus"`,
            `base_url = "${endpoint}"`,
            `wire_specification = "custom"`,
            `env_key = "${envKey}"`,
          ].join('\n') + '\n',
      },
      {
        path: '.codex/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            model: resolveModel(ctx),
            model_provider: 'openai',
            providers: {
              openai: {
                base_url: `${ctx.gatewayUrl}/v1`,
                api_key: ctx.apiKey ?? 'no-key-required',
              },
            },
          }),
      },
    ];
  }

  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('codex');
    return {
      executable: exe,
      args: [],
      interactive: true,
      env: {
        OPENAI_BASE_URL: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_KEY: ctx.apiKey || 'nexus',
        CODEX_MODEL: resolveModel(ctx) ?? 'gateway-routed',
      },
      display: `codex → ${ctx.gatewayUrl}`,
    };
  }
}


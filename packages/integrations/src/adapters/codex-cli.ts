import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';

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
    const targetModel = ctx.defaultModel || 'liquid/lfm-2.5-2.6b:free';
    const envKey = process.platform === 'win32' ? 'USERPROFILE' : 'USER';

    return [
      {
        path: '.codex/config.toml',
        merge: 'overwrite' as const,
        content: () =>
          [
            `model = "${targetModel}"`,
            `model_provider = "nexus"`,
            ``,
            `[model_providers.nexus]`,
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
            model: ctx.defaultModel || 'nexus/fast',
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
}

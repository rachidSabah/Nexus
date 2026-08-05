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

  protected configFiles() {
    return [
      {
        path: '.codex/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            model: ctx.defaultModel,
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

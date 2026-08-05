import { BaseIntegration } from '../base.js';
import type { IntegrationContext } from '../contract.js';

/**
 * Gemini CLI — Google's official CLI for Gemini models.
 *
 * Gemini CLI reads its config from `~/.gemini/settings.json`. We set the
 * `selectedModel`, and rely on the gateway's Google adapter to translate
 * requests. The CLI's `apiKey` env var is overridden to point at the
 * gateway via an env file.
 *
 * Source: https://github.com/google-gemini/gemini-cli
 */
export class GeminiCliIntegration extends BaseIntegration {
  readonly id = 'gemini-cli';
  readonly displayName = 'Gemini CLI';
  readonly description = "Google's official Gemini CLI";
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/google-gemini/gemini-cli';

  protected detectBinaries(): string[] {
    return ['gemini'];
  }

  protected configFiles() {
    return [
      {
        path: '.gemini/settings.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          JSON.stringify(
            {
              selectedModel: ctx.defaultModel,
              // The gateway is OpenAI-compatible, so we point Gemini CLI at it
              // via the OpenAI-compat extension mechanism.
              extensions: [
                {
                  name: 'openai-compat',
                  baseUrl: `${ctx.gatewayUrl}/v1`,
                  apiKey: ctx.apiKey ?? 'no-key-required',
                  model: ctx.defaultModel,
                },
              ],
            },
            null,
            2,
          ) + '\n',
      },
      {
        path: '.gemini/.env',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            `# Added by Agent Nexus Gateway — anx integrations install ${this.id}`,
            `GEMINI_API_KEY=${ctx.apiKey ?? 'no-key-required'}`,
            `OPENAI_API_BASE=${ctx.gatewayUrl}/v1`,
            `OPENAI_API_KEY=${ctx.apiKey ?? 'no-key-required'}`,
            '',
          ].join('\n'),
      },
    ];
  }
}

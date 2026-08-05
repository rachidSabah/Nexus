import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';

/**
 * Hermes CLI — a multi-provider AI CLI. Hermes reads its config from
 * `~/.hermes/config.json`. We register the gateway as a custom provider
 * and set it as the default.
 *
 * Source: https://github.com/NousResearch/hermes-cli
 */
export class HermesCliIntegration extends BaseIntegration {
  readonly id = 'hermes-cli';
  readonly displayName = 'Hermes CLI';
  readonly description = 'Nous Research Hermes multi-provider CLI';
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/NousResearch/hermes-cli';

  protected detectBinaries(): string[] {
    return ['hermes'];
  }

  protected configFiles() {
    return [
      {
        path: '.hermes/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            default_provider: 'nexus',
            default_model: ctx.defaultModel,
            providers: {
              nexus: {
                type: 'openai',
                base_url: `${ctx.gatewayUrl}/v1`,
                api_key: ctx.apiKey ?? 'no-key-required',
                models: [ctx.defaultModel],
              },
            },
          }),
      },
    ];
  }
}

import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';

/**
 * Continue — open-source AI code assistant (VS Code + JetBrains extension).
 *
 * Continue reads `~/.continue/config.json` (or `config.yaml` in v0.9+).
 * We register the gateway as a model provider and set it as the default.
 *
 * Source: https://www.continue.dev
 */
export class ContinueIntegration extends BaseIntegration {
  readonly id = 'continue';
  readonly displayName = 'Continue';
  readonly description = 'Open-source AI code assistant (VS Code + JetBrains)';
  readonly category = 'editor' as const;
  readonly homepage = 'https://www.continue.dev';

  protected detectPaths(): string[] {
    return ['.continue'];
  }

  protected configFiles() {
    return [
      {
        path: '.continue/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            models: [
              {
                title: 'Agent Nexus',
                provider: 'openai',
                model: ctx.defaultModel,
                apiBase: `${ctx.gatewayUrl}/v1`,
                apiKey: ctx.apiKey ?? 'no-key-required',
              },
            ],
            // Mark it as the default tab model.
            tabAutocompleteModel: {
              title: 'Agent Nexus',
              provider: 'openai',
              model: ctx.defaultModel,
              apiBase: `${ctx.gatewayUrl}/v1`,
              apiKey: ctx.apiKey ?? 'no-key-required',
            },
          }),
      },
    ];
  }
}

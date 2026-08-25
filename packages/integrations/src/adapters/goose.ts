import { BaseIntegration } from '../base.js';
import type { IntegrationContext } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * Goose — Block's open-source AI agent CLI.
 *
 * Goose reads its configuration from `~/.config/goose/config.yaml`.
 * It supports an OpenAI-compatible provider via the `openai` provider type
 * and respects `OPENAI_API_BASE` / `OPENAI_API_KEY` environment variables.
 *
 * Source: https://github.com/block/goose
 */
export class GooseIntegration extends BaseIntegration {
  readonly id = 'goose';
  readonly displayName = 'Goose';
  readonly description = "Block's open-source AI agent CLI";
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/block/goose';

  protected detectBinaries(): string[] {
    return ['goose'];
  }

  protected detectPaths(): string[] {
    return ['.config/goose'];
  }

  protected configFiles() {
    return [
      {
        path: '.config/goose/config.yaml',
        merge: 'skip' as const,
        content: (ctx: IntegrationContext) =>
          [
            '# Written by Agent Nexus Gateway — anx integrations install goose',
            'provider: openai',
            `api_base_url: "${ctx.gatewayUrl}/v1"`,
            `api_key: "${ctx.apiKey ?? 'nexus'}"`,
            `model: "${resolveModel(ctx)}"`,
          ].join('\n'),
      },
    ];
  }
}

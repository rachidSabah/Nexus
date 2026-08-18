import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * Zed — high-performance editor with first-class AI support.
 *
 * Zed reads `~/.config/zed/settings.json` (Linux) or
 * `~/Library/Application Support/Zed/settings.json` (macOS). The
 * `language_models.openai` block lets you override the API base.
 *
 * Source: https://zed.dev
 */
export class ZedIntegration extends BaseIntegration {
  readonly id = 'zed';
  readonly displayName = 'Zed';
  readonly description = 'High-performance editor with first-class AI support';
  readonly category = 'editor' as const;
  readonly homepage = 'https://zed.dev';

  protected detectPaths(): string[] {
    return ['.config/zed', 'Library/Application Support/Zed'];
  }

  protected configFiles() {
    return [
      {
        path: this.isMac() ? 'Library/Application Support/Zed/settings.json' : '.config/zed/settings.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            language_models: {
              openai: {
                api_url: `${ctx.gatewayUrl}/v1`,
                available_models: [
                  {
                    name: resolveModel(ctx),
                    display_name: resolveModel(ctx),
                    max_tokens: 32768,
                  },
                ],
              },
            },
            assistant: {
              default_model: resolveModel(ctx),
            },
          }),
      },
    ];
  }

  private isMac(): boolean {
    return process.platform === 'darwin';
  }
}

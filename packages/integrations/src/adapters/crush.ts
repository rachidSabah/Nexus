import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * Crush — CLI coding agent by Charmbracelet (Rust).
 *
 * Crush respects the standard OpenAI-compatible environment variables:
 *   OPENAI_API_BASE and OPENAI_API_KEY.
 * It also reads `~/.config/crush/config.json` if present.
 *
 * Source: https://github.com/charmbracelet/crush
 */
export class CrushIntegration extends BaseIntegration {
  readonly id = 'crush';
  readonly displayName = 'Crush';
  readonly description = 'CLI coding agent (Rust) by Charmbracelet';
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/charmbracelet/crush';

  protected detectBinaries(): string[] {
    return ['crush'];
  }

  protected detectPaths(): string[] {
    return ['.config/crush'];
  }

  protected configFiles() {
    return [
      {
        path: '.config/crush/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            _comment: 'Written by Agent Nexus Gateway — anx integrations install crush',
            openai_api_base: `${ctx.gatewayUrl}/v1`,
            openai_api_key: ctx.apiKey ?? 'nexus',
            model: resolveModel(ctx),
          }),
      },
    ];
  }
}

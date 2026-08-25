import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';
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

  // Crush is a standalone interactive CLI — it can be launched and tracked by
  // PID like Aider/Hermes, so the dashboard Start/Stop/Restart buttons appear.
  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('crush');
    return {
      executable: exe,
      args: [],
      interactive: true,
      env: {
        OPENAI_API_BASE: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_KEY: ctx.apiKey ?? 'nexus',
      },
      display: `crush → ${ctx.gatewayUrl}`,
    };
  }
}

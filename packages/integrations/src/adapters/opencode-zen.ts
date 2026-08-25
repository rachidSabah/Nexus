import { BaseIntegration } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * OpenCode Zen — cloud-optimized variant of OpenCode.
 */
export class OpenCodeZenIntegration extends BaseIntegration {
  readonly id = 'opencode-zen';
  readonly displayName = 'OpenCode Zen';
  readonly description = 'Cloud-optimized AI coding agent (opencode-zen)';
  readonly category = 'cli' as const;
  readonly homepage = 'https://opencode.ai/zen';

  protected detectBinaries(): string[] {
    return ['opencode-zen', 'zen-code'];
  }

  protected detectPaths(): string[] {
    return ['.config/opencode-zen'];
  }

  protected configFiles() {
    return [
      {
        path: '.config/opencode-zen/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          JSON.stringify(
            {
              provider: {
                nexus: {
                  baseURL: `${ctx.gatewayUrl}/v1`,
                  apiKey: ctx.apiKey ?? 'no-key-required',
                },
              },
              model: `nexus/${resolveModel(ctx) ?? 'auto'}`,
            },
            null,
            2,
          ) + '\n',
      },
    ];
  }

  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('opencode-zen');
    return {
      executable: exe,
      args: [],
      interactive: true,
      env: {
        OPENAI_BASE_URL: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_KEY: ctx.apiKey ?? 'nexus',
      },
      display: `opencode-zen → ${ctx.gatewayUrl}`,
    };
  }
}

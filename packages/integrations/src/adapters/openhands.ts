import { BaseIntegration } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * OpenHands — AI software developer agent (formerly OpenDevin).
 *
 * Configures ~/.openhands/config.toml or ~/.openhands/.env with the Nexus Gateway URL.
 * Supports OpenAI-compatible LLM routing.
 */
export class OpenHandsIntegration extends BaseIntegration {
  readonly id = 'openhands';
  readonly displayName = 'OpenHands';
  readonly description = 'Autonomous AI software developer agent';
  readonly category = 'agent' as const;
  readonly homepage = 'https://github.com/All-Hands-AI/OpenHands';

  protected detectBinaries(): string[] {
    return ['openhands'];
  }

  protected detectPaths(): string[] {
    return ['.openhands', '.config/openhands'];
  }

  protected configFiles(ctx: IntegrationContext) {
    const endpoint = `${ctx.gatewayUrl}/v1`;
    const targetModel = resolveModel(ctx) ?? 'nexus/best-coding';

    return [
      {
        path: '.openhands/config.toml',
        merge: 'overwrite' as const,
        content: () =>
          [
            '# Written by Agent Nexus Gateway — anx integrations install openhands',
            '[llm]',
            `model = "${targetModel}"`,
            `base_url = "${endpoint}"`,
            `api_key = "${ctx.apiKey ?? 'no-key-required'}"`,
            'custom_llm_provider = "openai"',
            '',
          ].join('\n'),
      },
    ];
  }

  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('openhands');
    return {
      executable: exe,
      args: [],
      interactive: true,
      env: {
        OPENAI_BASE_URL: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_KEY: ctx.apiKey ?? 'nexus',
      },
      display: `openhands → ${ctx.gatewayUrl}`,
    };
  }
}

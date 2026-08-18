import { BaseIntegration } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * OpenHands — open-source AI software engineer (formerly OpenDevin).
 *
 * OpenHands reads `~/.openhands/config.toml` (preferred) or env vars. We
 * write both: a TOML config and a `.env` shim that the runtime sources.
 *
 * Source: https://github.com/All-Hands-AI/OpenHands
 */
export class OpenHandsIntegration extends BaseIntegration {
  readonly id = 'openhands';
  readonly displayName = 'OpenHands';
  readonly description = 'Open-source AI software engineer (formerly OpenDevin)';
  readonly category = 'agent' as const;
  readonly homepage = 'https://github.com/All-Hands-AI/OpenHands';

  protected detectBinaries(): string[] {
    return ['openhands', 'opendevin'];
  }

  protected detectPaths(): string[] {
    return ['.openhands'];
  }

  protected configFiles() {
    return [
      {
        path: '.openhands/config.toml',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            '# Written by Agent Nexus Gateway — anx integrations install openhands',
            '',
            '[llm]',
            `model = "${resolveModel(ctx) ?? 'gateway-routed'}"`,
            `base_url = "${ctx.gatewayUrl}/v1"`,
            `api_key = "${ctx.apiKey ?? 'no-key-required'}"`,
            'stream = true',
            '',
            '[agent]',
            'name = "CodeActAgent"',
            '',
          ].join('\n'),
      },
      {
        path: '.openhands/.env',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            '# Added by Agent Nexus Gateway',
            `OPENAI_API_BASE=${ctx.gatewayUrl}/v1`,
            `OPENAI_API_KEY=${ctx.apiKey ?? 'no-key-required'}`,
            `LLM_MODEL=${resolveModel(ctx) ?? 'gateway-routed'}`,
            `LLM_BASE_URL=${ctx.gatewayUrl}/v1`,
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
        OPENAI_API_BASE: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_KEY: ctx.apiKey ?? 'nexus',
        LLM_BASE_URL: `${ctx.gatewayUrl}/v1`,
      },
      display: `openhands → ${ctx.gatewayUrl}`,
    };
  }
}

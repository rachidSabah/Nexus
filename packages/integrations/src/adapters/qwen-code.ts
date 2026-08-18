import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * Qwen Code — Alibaba's coding agent CLI and tools.
 *
 * Configures `~/.qwen/settings.json` with the gateway URL.
 * Also supports OpenAI-compatible mode via standard environment variables and config.
 */
export class QwenCodeIntegration extends BaseIntegration {
  readonly id = 'qwen-code';
  readonly displayName = 'Qwen Code';
  readonly description = "Alibaba's Qwen coding agent CLI";
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/QwenLM/Qwen';

  protected detectBinaries(): string[] {
    return ['qwen', 'qwen-code'];
  }

  protected detectPaths(): string[] {
    return ['.qwen', '.config/qwen'];
  }

  protected configFiles(ctx: IntegrationContext) {
    const endpoint = `${ctx.gatewayUrl}/v1`;
    const targetModel = resolveModel(ctx) ?? 'qwen/qwen-2.5-coder-32b-instruct';

    return [
      {
        path: '.qwen/settings.json',
        merge: 'json-merge' as const,
        content: () =>
          jsonString({
            apiBaseUrl: endpoint,
            baseUrl: endpoint,
            apiKey: ctx.apiKey ?? 'nexus',
            model: targetModel,
            env: {
              OPENAI_BASE_URL: endpoint,
              OPENAI_API_KEY: ctx.apiKey ?? 'nexus',
              QWEN_MODEL: targetModel,
            },
          }),
      },
      {
        path: '.qwen/.env',
        merge: 'overwrite' as const,
        content: () =>
          [
            `# Added by Agent Nexus Gateway — anx agents configure ${this.id}`,
            `OPENAI_BASE_URL=${endpoint}`,
            `OPENAI_API_KEY=${ctx.apiKey ?? 'nexus'}`,
            `QWEN_MODEL=${targetModel}`,
            '',
          ].join('\n'),
      },
    ];
  }

  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('qwen');
    const targetModel = resolveModel(ctx) ?? 'qwen/qwen-2.5-coder-32b-instruct';
    return {
      executable: exe,
      args: [],
      interactive: true,
      env: {
        OPENAI_BASE_URL: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_KEY: ctx.apiKey || 'nexus',
        QWEN_MODEL: targetModel,
      },
      display: `qwen → ${ctx.gatewayUrl}`,
    };
  }
}

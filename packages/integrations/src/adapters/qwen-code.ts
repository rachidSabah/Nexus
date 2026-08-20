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
    // Resolve a CONCRETE model id — never a Nexus routing alias
    // (nexus/*, local/*, claude-gw-*). Those resolve at the gateway and are
    // rejected by Qwen Code as a persisted model value. If no concrete
    // selection exists, fall back to a real Qwen-native id (NOT an alias).
    const targetModel = resolveModel(ctx) ?? 'qwen/qwen-2.5-coder-32b-instruct';

    return [
      {
        path: '.qwen/settings.json',
        merge: 'json-merge' as const,
        // Qwen Code v0.21.x reads the model id + base URL from the nested
        // `model` object (`model.name` + `model.baseUrl`). Writing to the
        // top-level `baseUrl` only (the old behaviour) left `model.baseUrl`
        // empty, so Qwen fell back to api.openai.com — which is why its
        // /model picker showed only the default upstream model and why a
        // stale `claude-gw-*` alias persisted and 400'd. We now write the
        // gateway URL into BOTH the nested `model.baseUrl` AND the
        // top-level `baseUrl`/`apiBaseUrl` for maximum compatibility, and
        // clear any previously-persisted claude-gw alias.
        content: () =>
          jsonString({
            baseUrl: endpoint,
            apiBaseUrl: endpoint,
            apiKey: ctx.apiKey ?? 'nexus',
            model: {
              name: targetModel,
              baseUrl: endpoint,
            },
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

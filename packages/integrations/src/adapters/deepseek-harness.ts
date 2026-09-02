import { BaseIntegration } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';

/**
 * DeepSeek Harness (`dsh`) — DeepSeek AI's plugin-based agent harness.
 *
 * Real upstream facts (github.com/deepseek-ai/deepseek-harness):
 *   - Install: `npm install -g @deepseek-ai/dsh` (or `npx @deepseek-ai/dsh web`)
 *   - Run:     `dsh web`  → serves a Web UI at http://127.0.0.1:3080
 *   - It is a plugin harness / web UI, NOT an OpenAI-compatible CLI that
 *     consumes OPENAI_BASE_URL the way Codex does. We still point its gateway
 *     env for operator convenience, but model binding through the Nexus
 *     OpenAI proxy is best-effort, not guaranteed. Start/Stop/Restart are
 *     fully supported (real `dsh web` process + PID).
 */
export class DeepSeekHarnessIntegration extends BaseIntegration {
  readonly id = 'deepseek-harness';
  readonly displayName = 'DeepSeek Harness';
  readonly description = "DeepSeek's plugin-based agent harness (dsh) — serves a web UI";
  readonly category = 'agent' as const;
  readonly homepage = 'https://github.com/deepseek-ai/deepseek-harness';

  protected detectBinaries(): string[] {
    return ['dsh'];
  }

  protected detectPaths(): string[] {
    return ['.dsh', '.deepseek/harness'];
  }

  protected configFiles() {
    return [
      {
        path: '.dsh/.credentials.yaml',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          `version: 1\nrefs:\n  DEEPSEEK_API_KEY: "${ctx.apiKey ?? 'nexus'}"\n`,
      },
      {
        path: '.dsh/settings.yaml',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          `llm-deepseek:\n  baseURL: "${ctx.gatewayUrl}/v1"\n  apiKeyEnv: DEEPSEEK_API_KEY\nui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n`,
      },
      {
        path: '.deepseek/harness/config.json',
        merge: 'skip' as const,
        content: (ctx: IntegrationContext) =>
          JSON.stringify(
            {
              _comment: 'Written by Agent Nexus Gateway — anx integrations install deepseek-harness',
              gatewayUrl: `${ctx.gatewayUrl}/v1`,
              openaiApiBase: `${ctx.gatewayUrl}/v1`,
              openaiApiKey: ctx.apiKey ?? 'nexus',
              deepseekBaseUrl: `${ctx.gatewayUrl}/v1`,
              deepseekApiKey: ctx.apiKey ?? 'nexus',
            },
            null,
            2,
          ),
      },
    ];
  }

  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('dsh');
    if (!exe) return null;
    return {
      executable: exe,
      args: ['web', '--port', '3080', '--no-open'],
      interactive: false,
      env: {
        DEEPSEEK_BASE_URL: `${ctx.gatewayUrl}/v1`,
        DEEPSEEK_API_KEY: ctx.apiKey ?? 'nexus',
        DEEPSEEK_SEARCH_BASE_URL: `${ctx.gatewayUrl}/v1`,
        DEEPSEEK_PUBLIC_BASE_URL: `${ctx.gatewayUrl}/v1`,
        OPENAI_BASE_URL: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_BASE: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_KEY: ctx.apiKey ?? 'nexus',
        DSH_WEB_PORT: '3080',
      },
      display: `dsh web → http://127.0.0.1:3080 (gateway ${ctx.gatewayUrl})`,
      // Real web UI endpoint, exactly what `dsh web` prints and serves (see the
      // DeepSeek Harness README/Web-UI guide). The browser opens this URL
      // directly — a clean top-level navigation, identical to the user opening
      // it by hand, so the SPA renders correctly.
      webUrl: 'http://127.0.0.1:3080',
    };
  }
}

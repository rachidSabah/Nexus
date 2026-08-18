import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * Hermes CLI — a multi-provider AI CLI. Hermes reads its config from
 * `~/.hermes/config.json`.
 *
 * Hermes ships its own complete provider ecosystem, so this integration
 * REFUSES to bind by default (`skipIfConfigured`). It becomes first-class and
 * binds when the user explicitly opts in via:
 *   - `anx integrations install hermes-cli --force`, or
 *   - `NEXUS_BIND_HERMES=1` (dynamic, e.g. set by the gateway or CI so the
 *     installation activates automatically after a successful gateway
 *     routing/identity check).
 *
 * When bound, the gateway is written as a `nexus` custom provider AND an
 * env file (`~/.hermes/nexus.env`) is provided so Hermes (or its shell) can
 * pick up:
 *   - OPENAI_BASE_URL   -> <gatewayUrl>/v1
 *   - ANTHROPIC_BASE_URL -> <gatewayUrl>/v1
 *   - NEXUS_TARGET_MODEL -> the resolved Nexus coding model
 * Config.json is json-merged so Hermes' own providers are never destroyed.
 *
 * Source: https://github.com/NousResearch/hermes-cli
 */
export class HermesCliIntegration extends BaseIntegration {
  readonly id = 'hermes-cli';
  readonly displayName = 'Hermes CLI';
  readonly description = 'Nous Research Hermes multi-provider CLI (first-class building agent)';
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/NousResearch/hermes-cli';

  protected detectBinaries(): string[] {
    return ['hermes'];
  }

  protected detectPaths(): string[] {
    return ['AppData/Local/hermes', '.hermes'];
  }

  // First-class building agent: ready to bind to the gateway.
  protected skipIfConfigured(): boolean {
    return false;
  }

  protected configFiles(ctx: IntegrationContext) {
    const endpoint = `${ctx.gatewayUrl}/v1`;
    const targetModel = resolveModel(ctx) ?? 'nexus/best-coding';
    const isWindows = process.platform === 'win32';
    const configRel = isWindows ? 'AppData/Local/hermes/config.yaml' : '.hermes/config.yaml';
    const envRel = isWindows ? 'AppData/Local/hermes/.env' : '.hermes/.env';

    return [
      {
        path: configRel,
        merge: 'overwrite' as const,
        content: () =>
          [
            `model:`,
            `  default: ${targetModel}`,
            `  provider: custom:nexus`,
            `  base_url: ${endpoint}`,
            `  context_length: 128000`,
            ``,
            `custom_providers:`,
            `  - name: nexus`,
            `    provider_key: nexus`,
            `    base_url: ${endpoint}`,
            `    api_key: ${ctx.apiKey ?? 'no-key-required'}`,
            `    context_length: 128000`,
            `    models:`,
            `      - ${targetModel}`,
            `      - nexus/best-coding`,
            `      - nexus/fast`,
            `      - nexus/free`,
            `      - liquid/lfm-2.5-2.6b:free`,
            `      - gpt-4`,
            ``,
          ].join('\n'),
      },
      {
        path: envRel,
        merge: 'overwrite' as const,
        content: () =>
          [
            `# Agent Nexus Gateway binding for Hermes`,
            `OPENAI_BASE_URL=${endpoint}`,
            `OPENAI_API_KEY=${ctx.apiKey ?? 'no-key-required'}`,
            `HERMES_INFERENCE_MODEL=${targetModel}`,
            ``,
          ].join('\n'),
      },
      {
        // Legacy/fallback JSON for multi-platform tooling
        path: '.hermes/config.json',
        merge: 'json-merge' as const,
        content: (_ctx: IntegrationContext) =>
          jsonString({
            default_provider: 'nexus',
            default_model: targetModel,
            providers: {
              nexus: {
                type: 'openai',
                base_url: endpoint,
                api_key: ctx.apiKey ?? 'no-key-required',
                models: [targetModel],
              },
            },
          }),
      },
      {
        // Env file so shells can activate the gateway binding
        path: '.hermes/nexus.env',
        merge: 'overwrite' as const,
        content: () =>
          [
            `# Agent Nexus Gateway binding for Hermes (managed by anx integrations)`,
            `export OPENAI_BASE_URL="${endpoint}"`,
            `export NEXUS_TARGET_MODEL="${targetModel}"`,
            ``,
          ].join('\n'),
      },
    ];
  }

  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('hermes');
    const endpoint = `${ctx.gatewayUrl}/v1`;
    const targetModel = resolveModel(ctx) ?? 'nexus/best-coding';
    return {
      executable: exe,
      args: [],
      interactive: true,
      env: {
        OPENAI_BASE_URL: endpoint,
        OPENAI_API_KEY: ctx.apiKey || 'nexus',
        HERMES_INFERENCE_MODEL: targetModel,
      },
      display: `hermes → ${ctx.gatewayUrl}`,
    };
  }
}

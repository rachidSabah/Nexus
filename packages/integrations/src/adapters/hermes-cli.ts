import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';

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

  // Refuse by default, but bind automatically when the host signals
  // NEXUS_BIND_HERMES=1 (dynamic activation after identity checks pass).
  protected skipIfConfigured(): boolean {
    return !process.env['NEXUS_BIND_HERMES'];
  }

  protected configFiles(ctx: IntegrationContext) {
    const endpoint = `${ctx.gatewayUrl}/v1`;
    const targetModel = ctx.defaultModel || 'nexus/best-coding';
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
            `  base_url: ${endpoint}`,
            `  default: ${targetModel}`,
            `  provider: custom:nexus`,
            `providers:`,
            `  nexus:`,
            `    name: nexus`,
            `    base_url: ${endpoint}`,
            `    api_key: ${ctx.apiKey ?? 'no-key-required'}`,
            `    models:`,
            `      ${targetModel}:`,
            `        context_length: 128000`,
            `        features:`,
            `          - text`,
            `          - tools`,
            `      nexus/best-coding:`,
            `        context_length: 128000`,
            `        features:`,
            `          - text`,
            `          - tools`,
            `      nexus/fast:`,
            `        context_length: 128000`,
            `        features:`,
            `          - text`,
            `          - tools`,
            `      nexus/free:`,
            `        context_length: 128000`,
            `        features:`,
            `          - text`,
            `          - tools`,
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
            `export ANTHROPIC_BASE_URL="${endpoint}"`,
            `export NEXUS_TARGET_MODEL="${targetModel}"`,
            ``,
          ].join('\n'),
      },
    ];
  }
}

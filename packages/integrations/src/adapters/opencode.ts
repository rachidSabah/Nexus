import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';

/**
 * OpenCode — terminal-based AI coding agent (TypeScript / Node).
 *
 * OpenCode reads `~/.config/opencode/opencode.json` (XDG) or
 * `~/.opencode/config.json` (legacy). It supports custom providers via the
 * `provider` block; we register the gateway under the id `nexus` and set
 * it as the default.
 *
 * Source: https://github.com/sst/opencode
 */
export class OpenCodeIntegration extends BaseIntegration {
  readonly id = 'opencode';
  readonly displayName = 'OpenCode';
  readonly description = 'Terminal-based AI coding agent (TypeScript)';
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/sst/opencode';

  protected detectBinaries(): string[] {
    return ['opencode'];
  }

  protected detectPaths(): string[] {
    return ['.opencode', '.config/opencode'];
  }

  protected configFiles() {
    return [
      {
        path: '.config/opencode/opencode.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            $schema: 'https://opencode.ai/config.json',
            provider: {
              nexus: {
                npm: '@ai-sdk/openai-compatible',
                name: 'Agent Nexus Gateway',
                options: {
                  baseURL: `${ctx.gatewayUrl}/v1`,
                  apiKey: ctx.apiKey ?? 'no-key-required',
                },
                models: {
                  [ctx.defaultModel]: { name: ctx.defaultModel },
                },
              },
            },
            model: `nexus/${ctx.defaultModel}`,
          }),
      },
    ];
  }
}

/**
 * OpenCode Go — Go-based fork / reimplementation of OpenCode.
 *
 * Uses a TOML config at `~/.config/opencode-go/config.toml`. We write the
 * gateway as a custom OpenAI-compatible provider.
 *
 * Source: https://github.com/opencode-ai/opencode (Go port)
 */
export class OpenCodeGoIntegration extends BaseIntegration {
  readonly id = 'opencode-go';
  readonly displayName = 'OpenCode Go';
  readonly description = 'Go-based AI coding agent (opencode-go)';
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/opencode-ai/opencode';

  protected detectBinaries(): string[] {
    return ['opencode-go', 'ocode'];
  }

  protected detectPaths(): string[] {
    return ['.config/opencode-go'];
  }

  protected configFiles() {
    return [
      {
        path: '.config/opencode-go/config.toml',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            '# Written by Agent Nexus Gateway — anx integrations install opencode-go',
            '',
            '[provider.nexus]',
            `type = "openai"`,
            `base_url = "${ctx.gatewayUrl}/v1"`,
            `api_key = "${ctx.apiKey ?? 'no-key-required'}"`,
            `default_model = "${ctx.defaultModel}"`,
            '',
            '[default]',
            'provider = "nexus"',
            `model = "${ctx.defaultModel}"`,
            '',
          ].join('\n'),
      },
    ];
  }
}

/**
 * OpenCode Zen — minimalist / distraction-free variant of OpenCode.
 *
 * OpenCode Zen uses a single YAML config at `~/.config/opencode-zen/config.yaml`
 * with a flat key/value structure. We register the gateway as the sole
 * provider and disable Zen's auto-discovery.
 *
 * Source: https://github.com/opencode-zen/opencode-zen
 */
export class OpenCodeZenIntegration extends BaseIntegration {
  readonly id = 'opencode-zen';
  readonly displayName = 'OpenCode Zen';
  readonly description = 'Minimalist AI coding agent (opencode-zen)';
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/opencode-zen/opencode-zen';

  protected detectBinaries(): string[] {
    return ['opencode-zen', 'ocode-zen', 'zen'];
  }

  protected detectPaths(): string[] {
    return ['.config/opencode-zen'];
  }

  protected configFiles() {
    return [
      {
        path: '.config/opencode-zen/config.yaml',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            '# Written by Agent Nexus Gateway — anx integrations install opencode-zen',
            '',
            'provider: nexus',
            `model: ${ctx.defaultModel}`,
            'auto_discovery: false',
            '',
            'providers:',
            '  nexus:',
            `    base_url: "${ctx.gatewayUrl}/v1"`,
            `    api_key: "${ctx.apiKey ?? 'no-key-required'}"`,
            '    type: openai-compatible',
            `    default_model: ${ctx.defaultModel}`,
            '',
            '# Zen-specific settings',
            'ui:',
            '  minimal: true',
            '  show_token_count: true',
            '  show_cost: true',
            '',
          ].join('\n'),
      },
      {
        path: '.config/opencode-zen/.env',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            '# Added by Agent Nexus Gateway',
            `OPENAI_API_BASE=${ctx.gatewayUrl}/v1`,
            `OPENAI_API_KEY=${ctx.apiKey ?? 'no-key-required'}`,
            `OPENCODE_ZEN_PROVIDER=nexus`,
            '',
          ].join('\n'),
      },
    ];
  }
}

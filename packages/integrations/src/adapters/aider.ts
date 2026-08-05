import { BaseIntegration } from '../base.js';
import type { IntegrationContext } from '../contract.js';

/**
 * Aider — AI pair programming in the terminal.
 *
 * Aider reads its config from `~/.aider.conf.yml` (YAML) or env vars. We
 * set OPENAI_API_BASE / OPENAI_API_KEY via the YAML file so Aider uses the
 * gateway as its OpenAI endpoint.
 *
 * Source: https://github.com/Aider-AI/aider
 */
export class AiderIntegration extends BaseIntegration {
  readonly id = 'aider';
  readonly displayName = 'Aider';
  readonly description = 'AI pair programming in the terminal';
  readonly category = 'cli' as const;
  readonly homepage = 'https://github.com/Aider-AI/aider';

  protected detectBinaries(): string[] {
    return ['aider'];
  }

  protected detectPaths(): string[] {
    return ['.aider.conf.yml'];
  }

  protected configFiles() {
    return [
      {
        path: '.aider.conf.yml',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            '# Written by Agent Nexus Gateway — anx integrations install aider',
            `openai-api-base: ${ctx.gatewayUrl}/v1`,
            `openai-api-key: ${ctx.apiKey ?? 'no-key-required'}`,
            `model: ${ctx.defaultModel}`,
            'auto-commits: false',
            'pretty: true',
            'stream: true',
            '',
          ].join('\n'),
      },
    ];
  }
}

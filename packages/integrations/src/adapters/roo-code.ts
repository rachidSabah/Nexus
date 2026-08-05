import type { IntegrationContext } from '../contract.js';
import { BaseIntegration, jsonString } from '../base.js';

/**
 * Roo Code — VS Code extension, a fork of Cline with multi-mode support.
 *
 * Same config layout as Cline, plus a `roo-cline.*` namespace in VS Code
 * settings.
 *
 * Source: https://github.com/RooCodeInc/Roo-Code
 */
export class RooCodeIntegration extends BaseIntegration {
  readonly id = 'roo-code';
  readonly displayName = 'Roo Code';
  readonly description = 'Multi-mode AI coding agent (Roo-Code VS Code extension)';
  readonly category = 'editor' as const;
  readonly homepage = 'https://github.com/RooCodeInc/Roo-Code';

  protected detectPaths(): string[] {
    return ['.vscode/extensions/rooveterinaryinc.roo-cline-*', '.roo-code'];
  }

  protected configFiles() {
    return [
      {
        path: '.roo-code/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            apiProvider: 'openai',
            openAiBaseUrl: `${ctx.gatewayUrl}/v1`,
            openAiApiKey: ctx.apiKey ?? 'no-key-required',
            openAiModelId: ctx.defaultModel,
            modes: {
              architect: { model: ctx.defaultModel },
              code: { model: ctx.defaultModel },
              ask: { model: ctx.defaultModel },
              debug: { model: ctx.defaultModel },
            },
          }),
      },
    ];
  }
}

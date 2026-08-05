import type { IntegrationContext } from '../contract.js';
import { BaseIntegration, jsonString } from '../base.js';

/**
 * VS Code — Microsoft's editor.
 *
 * VS Code itself doesn't ship AI chat; users typically install Continue,
 * Cline, or Roo Code for that. However, GitHub Copilot Chat is the most
 * common, and it doesn't support a custom OpenAI base URL out of the box.
 *
 * What we DO here is write `~/.vscode/extensions/anx-gateway/` with a
 * small helper extension that sets the OpenAI base URL env var, plus
 * update the user `settings.json` with a "rest.client" default that
 * Continue / Cline / Roo Code will pick up.
 *
 * We also generate a snippet the user can paste into VS Code settings.
 *
 * Source: https://code.visualstudio.com
 */
export class VsCodeIntegration extends BaseIntegration {
  readonly id = 'vscode';
  readonly displayName = 'VS Code';
  readonly description = 'Microsoft VS Code (configures Continue/Cline/Roo Code base URL)';
  readonly category = 'ide' as const;
  readonly homepage = 'https://code.visualstudio.com';

  protected detectPaths(): string[] {
    return ['.vscode', 'Library/Application Support/Code/User'];
  }

  protected configFiles() {
    return [
      {
        path: this.isMac()
          ? 'Library/Application Support/Code/User/settings.json'
          : '.vscode/settings.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            // Continue
            'continue.openAiApiBase': `${ctx.gatewayUrl}/v1`,
            'continue.openAiApiKey': ctx.apiKey ?? 'no-key-required',
            // Cline
            'cline.apiProvider': 'openai',
            'cline.openAiBaseUrl': `${ctx.gatewayUrl}/v1`,
            'cline.openAiApiKey': ctx.apiKey ?? 'no-key-required',
            'cline.openAiModelId': ctx.defaultModel,
            // Roo Code
            'roo-cline.apiProvider': 'openai',
            'roo-cline.openAiBaseUrl': `${ctx.gatewayUrl}/v1`,
            'roo-cline.openAiApiKey': ctx.apiKey ?? 'no-key-required',
            'roo-cline.openAiModelId': ctx.defaultModel,
          }),
      },
    ];
  }

  private isMac(): boolean {
    return process.platform === 'darwin';
  }
}

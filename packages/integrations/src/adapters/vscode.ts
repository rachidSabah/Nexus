import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';
import { resolveModel } from '../contract.js';

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
        path: this.userSettingsRelPath(),
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
            'cline.openAiModelId': resolveModel(ctx),
            // Roo Code
            'roo-cline.apiProvider': 'openai',
            'roo-cline.openAiBaseUrl': `${ctx.gatewayUrl}/v1`,
            'roo-cline.openAiApiKey': ctx.apiKey ?? 'no-key-required',
            'roo-cline.openAiModelId': resolveModel(ctx),
          }),
      },
    ];
  }

  /**
   * Returns the platform-correct relative path (from home dir) to the VS Code
   * global user settings file.
   *
   * macOS:   ~/Library/Application Support/Code/User/settings.json
   * Windows: ~/AppData/Roaming/Code/User/settings.json
   *            (resolved via APPDATA env for portability)
   * Linux:   ~/.config/Code/User/settings.json
   */
  private userSettingsRelPath(): string {
    switch (process.platform) {
      case 'darwin':
        return 'Library/Application Support/Code/User/settings.json';
      case 'win32': {
        // APPDATA is always set on Windows; fall back to relative path if not.
        const appData = process.env.APPDATA;
        if (appData) {
          // BaseIntegration.writeConfigFile resolves against home() when the path
          // does not start with / or a drive letter. Use relative form instead.
          return 'AppData/Roaming/Code/User/settings.json';
        }
        return 'AppData/Roaming/Code/User/settings.json';
      }
      default:
        return '.config/Code/User/settings.json';
    }
  }
}

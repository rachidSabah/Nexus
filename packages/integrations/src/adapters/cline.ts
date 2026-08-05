import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';

/**
 * Cline — autonomous AI coding agent for VS Code (formerly Claude Dev).
 *
 * Cline stores settings in VS Code's user settings under the `cline.*`
 * namespace. We write a standalone MCP-style config at
 * `~/.cline/config.json` that Cline reads on startup if present, plus
 * emit a snippet the user can paste into VS Code settings.
 *
 * Source: https://github.com/cline/cline
 */
export class ClineIntegration extends BaseIntegration {
  readonly id = 'cline';
  readonly displayName = 'Cline';
  readonly description = 'Autonomous AI coding agent for VS Code';
  readonly category = 'editor' as const;
  readonly homepage = 'https://github.com/cline/cline';

  protected detectPaths(): string[] {
    return ['.vscode/extensions/saoudrizwan.claude-dev-*', '.cline'];
  }

  protected configFiles() {
    return [
      {
        path: '.cline/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            apiProvider: 'openai',
            openAiBaseUrl: `${ctx.gatewayUrl}/v1`,
            openAiApiKey: ctx.apiKey ?? 'no-key-required',
            openAiModelId: ctx.defaultModel,
          }),
      },
      {
        path: '.cline/vscode-snippet.json',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            'cline.apiProvider': 'openai',
            'cline.openAiBaseUrl': `${ctx.gatewayUrl}/v1`,
            'cline.openAiApiKey': ctx.apiKey ?? 'no-key-required',
            'cline.openAiModelId': ctx.defaultModel,
            'cline.autoApproval.enabled': true,
            'cline.allowedCommands': ['npm test', 'npm run build', 'git status'],
          }),
      },
    ];
  }
}

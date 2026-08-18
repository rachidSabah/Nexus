import { BaseIntegration, jsonString } from '../base.js';
import type { IntegrationContext } from '../contract.js';
import { resolveModel } from '../contract.js';

/**
 * Cursor — AI-first code editor (VS Code fork).
 *
 * Cursor reads `~/.cursor/config.json` (global) and `.cursor/config.json`
 * (per-project). We write the global config to set the OpenAI base URL.
 *
 * Source: https://cursor.sh
 */
export class CursorIntegration extends BaseIntegration {
  readonly id = 'cursor';
  readonly displayName = 'Cursor';
  readonly description = 'AI-first code editor (VS Code fork)';
  readonly category = 'editor' as const;
  readonly homepage = 'https://cursor.sh';

  protected detectPaths(): string[] {
    return ['.cursor'];
  }

  protected configFiles() {
    return [
      {
        path: '.cursor/config.json',
        merge: 'json-merge' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            openaiApiBase: `${ctx.gatewayUrl}/v1`,
            openaiApiKey: ctx.apiKey ?? 'no-key-required',
            defaultModel: resolveModel(ctx),
          }),
      },
    ];
  }
}

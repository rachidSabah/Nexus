import type { IntegrationContext } from '../contract.js';
import { BaseIntegration, jsonString } from '../base.js';

/**
 * JetBrains IDEs — IntelliJ, PyCharm, WebStorm, GoLand, etc.
 *
 * JetBrains has its own AI Assistant (paid) but also supports third-party
 * plugins (Continue, CodeGPT). We write a per-project
 * `.idea/ai-assistant.xml` override plus a JetBrains CodeGPT plugin
 * config at `~/.config/JetBrains/<product>/options/codegpt.xml`.
 *
 * Because JetBrains doesn't have a single global config path, we generate
 * a snippet and write it to `~/.anx/integrations/jetbrains-snippet.xml`
 * with instructions to paste into the IDE's "Custom AI Server" setting.
 *
 * Source: https://www.jetbrains.com/ai/
 */
export class JetBrainsIntegration extends BaseIntegration {
  readonly id = 'jetbrains';
  readonly displayName = 'JetBrains IDEs';
  readonly description = 'IntelliJ / PyCharm / WebStorm / GoLand / Rider / PhpStorm / CLion';
  readonly category = 'ide' as const;
  readonly homepage = 'https://www.jetbrains.com';

  protected detectPaths(): string[] {
    return ['.IntelliJIdea', '.PyCharm', '.WebStorm', '.GoLand', '.config/JetBrains'];
  }

  protected configFiles() {
    return [
      {
        path: '.anx/integrations/jetbrains-snippet.xml',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          [
            '<!-- Paste into: Settings → Tools → AI Assistant → Custom Server -->',
            '<!-- Or: Settings → Tools → CodeGPT → Provider: OpenAI → Custom Base URL -->',
            '',
            '<application>',
            '  <component name="AiAssistantSettings">',
            `    <option name="serverUrl" value="${ctx.gatewayUrl}/v1" />`,
            `    <option name="apiKey" value="${ctx.apiKey ?? 'no-key-required'}" />`,
            `    <option name="model" value="${ctx.defaultModel}" />`,
            '    <option name="streaming" value="true" />',
            '  </component>',
            '</application>',
            '',
          ].join('\n'),
      },
      {
        path: '.anx/integrations/jetbrains-codegpt.json',
        merge: 'overwrite' as const,
        content: (ctx: IntegrationContext) =>
          jsonString({
            provider: 'OpenAI',
            baseUrl: `${ctx.gatewayUrl}/v1`,
            apiKey: ctx.apiKey ?? 'no-key-required',
            model: ctx.defaultModel,
            temperature: 0.7,
            stream: true,
          }),
      },
    ];
  }
}

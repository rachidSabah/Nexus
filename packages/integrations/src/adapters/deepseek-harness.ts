import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BaseIntegration } from '../base.js';
import type { IntegrationContext, LaunchSpec } from '../contract.js';
import { home } from '../contract.js';

export interface HarnessModelDescriptor {
  id: string;
  name?: string;
  description?: string;
  contextWindow?: number;
  inputModalities?: readonly ('text' | 'image')[];
}

/**
 * Built-in virtual routing models always available on Nexus.
 */
export const NEXUS_CORE_MODELS: readonly HarnessModelDescriptor[] = [
  { id: 'nexus/auto', name: 'Nexus Auto (Intelligent Routing)', description: 'Balanced automatic routing across healthy models' },
  { id: 'nexus/best-coding', name: 'Nexus Best Coding (Tool Calling)', description: 'Highest quality capable coding model with tool calling' },
  { id: 'nexus/free', name: 'Nexus Free ($0 Tier)', description: 'Cheapest healthy zero-cost model' },
  { id: 'nexus/reasoning', name: 'Nexus Reasoning (Thinking)', description: 'Advanced reasoning / thinking model' },
  { id: 'nexus/fast', name: 'Nexus Fast (Low Latency)', description: 'Lowest latency streaming model' },
  { id: 'nexus/best', name: 'Nexus Best (Max Capability)', description: 'Highest capability and largest context model' },
];

/**
 * Resolves live models from context or directly from Nexus /v1/models endpoint.
 */
export async function resolveHarnessModels(ctx: IntegrationContext): Promise<HarnessModelDescriptor[]> {
  const result: HarnessModelDescriptor[] = [...NEXUS_CORE_MODELS];
  const seen = new Set<string>(result.map((m) => m.id));

  // If models were provided in context, use them
  if (ctx.models && ctx.models.length > 0) {
    for (const m of ctx.models) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        result.push(m);
      }
    }
    return result;
  }

  // Otherwise, attempt a live fetch from Nexus /v1/models
  try {
    const base = ctx.gatewayUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/v1/models`, {
      headers: {
        Accept: 'application/json',
        ...(ctx.apiKey ? { Authorization: `Bearer ${ctx.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(1500),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{
          id: string;
          owned_by?: string;
          context_window?: number;
          capabilities?: Record<string, unknown>;
          description?: string;
        }>;
      };

      if (Array.isArray(data?.data)) {
        for (const item of data.data) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            result.push({
              id: item.id,
              name: item.owned_by ? `${item.id} (${item.owned_by})` : item.id,
              description: item.description,
              contextWindow: item.context_window,
              inputModalities: item.capabilities?.vision ? ['text', 'image'] : ['text'],
            });
          }
        }
      }
    }
  } catch {
    // Non-fatal if gateway is starting or temporarily unreachable during install
  }

  return result;
}

/**
 * Generates the .dsh/settings.yaml content for DeepSeek Harness with live Nexus models.
 */
export async function generateHarnessSettingsYaml(ctx: IntegrationContext): Promise<string> {
  const models = await resolveHarnessModels(ctx);
  const modelsYaml = models
    .map((m) => {
      const lines = [`    - id: "${m.id}"`];
      if (m.name) lines.push(`      name: "${m.name.replace(/"/g, '\\"')}"`);
      if (m.description) lines.push(`      description: "${m.description.replace(/"/g, '\\"')}"`);
      if (m.contextWindow) lines.push(`      contextWindow: ${m.contextWindow}`);
      if (m.inputModalities && m.inputModalities.length > 0) {
        lines.push(`      inputModalities: [${m.inputModalities.join(', ')}]`);
      }
      return lines.join('\n');
    })
    .join('\n');

  const defaultModel = ctx.defaultModel ?? 'nexus/auto';
  return `llm-deepseek:\n  baseURL: "${ctx.gatewayUrl}/v1"\n  apiKeyEnv: DEEPSEEK_API_KEY\n  models:\n${modelsYaml}\nui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\nagent-default-model:\n  provider: deepseek-official\n  model: "${defaultModel}"\n`;
}

/**
 * DeepSeek Harness (`dsh`) — DeepSeek AI's plugin-based agent harness.
 *
 * Real upstream facts (github.com/deepseek-ai/deepseek-harness):
 *   - Install: `npm install -g @deepseek-ai/dsh` (or `npx @deepseek-ai/dsh web`)
 *   - Run:     `dsh web`  → serves a Web UI at http://127.0.0.1:3080
 *   - Consumes Nexus Model Fabric dynamically via `.dsh/settings.yaml` under `llm-deepseek.models`
 *   - Start/Stop/Restart and Web Preview are fully supported.
 */
export class DeepSeekHarnessIntegration extends BaseIntegration {
  readonly id = 'deepseek-harness';
  readonly displayName = 'DeepSeek Harness';
  readonly description = "DeepSeek's plugin-based agent harness (dsh) — serves a web UI with live Nexus Model Fabric";
  readonly category = 'agent' as const;
  readonly homepage = 'https://github.com/deepseek-ai/deepseek-harness';

  protected detectBinaries(): string[] {
    return ['dsh'];
  }

  protected detectPaths(): string[] {
    return ['.dsh', '.deepseek/harness'];
  }

  protected configFiles(ctx: IntegrationContext) {
    return [
      {
        path: '.dsh/.credentials.yaml',
        merge: 'overwrite' as const,
        content: () =>
          `version: 1\nrefs:\n  DEEPSEEK_API_KEY: "${ctx.apiKey ?? 'nexus'}"\n`,
      },
      {
        path: '.dsh/settings.yaml',
        merge: 'overwrite' as const,
        content: () => generateHarnessSettingsYaml(ctx),
      },
      {
        path: '.deepseek/harness/config.json',
        merge: 'skip' as const,
        content: () =>
          JSON.stringify(
            {
              _comment: 'Written by Agent Nexus Gateway — anx integrations install deepseek-harness',
              gatewayUrl: `${ctx.gatewayUrl}/v1`,
              openaiApiBase: `${ctx.gatewayUrl}/v1`,
              openaiApiKey: ctx.apiKey ?? 'nexus',
              deepseekBaseUrl: `${ctx.gatewayUrl}/v1`,
              deepseekApiKey: ctx.apiKey ?? 'nexus',
            },
            null,
            2,
          ),
      },
    ];
  }

  /**
   * Re-synchronizes .dsh/settings.yaml with the latest live models before process start.
   */
  private async syncSettings(ctx: IntegrationContext): Promise<void> {
    try {
      const dshDir = join(home(ctx), '.dsh');
      if (!existsSync(dshDir)) {
        await mkdir(dshDir, { recursive: true });
      }
      const credsPath = join(dshDir, '.credentials.yaml');
      const settingsPath = join(dshDir, 'settings.yaml');
      await writeFile(credsPath, `version: 1\nrefs:\n  DEEPSEEK_API_KEY: "${ctx.apiKey ?? 'nexus'}"\n`, 'utf8');
      const settingsContent = await generateHarnessSettingsYaml(ctx);
      await writeFile(settingsPath, settingsContent, 'utf8');
    } catch {
      // Non-fatal: best-effort pre-sync
    }
  }

  async getLaunchSpec(ctx: IntegrationContext): Promise<LaunchSpec | null> {
    const exe = await this.resolveExecutable('dsh');
    if (!exe) return null;

    // Refresh model catalog into settings.yaml before launching dsh web
    await this.syncSettings(ctx);

    return {
      executable: exe,
      args: ['web', '--port', '3080', '--no-open'],
      interactive: false,
      env: {
        DEEPSEEK_BASE_URL: `${ctx.gatewayUrl}/v1`,
        DEEPSEEK_API_KEY: ctx.apiKey ?? 'nexus',
        DEEPSEEK_SEARCH_BASE_URL: `${ctx.gatewayUrl}/v1`,
        DEEPSEEK_PUBLIC_BASE_URL: `${ctx.gatewayUrl}/v1`,
        OPENAI_BASE_URL: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_BASE: `${ctx.gatewayUrl}/v1`,
        OPENAI_API_KEY: ctx.apiKey ?? 'nexus',
        DSH_WEB_PORT: '3080',
      },
      display: `dsh web → http://127.0.0.1:3080 (gateway ${ctx.gatewayUrl})`,
      webUrl: 'http://127.0.0.1:3080',
    };
  }
}

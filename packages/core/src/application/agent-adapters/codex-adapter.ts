/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CodexAdapter — Local Agent Bridge adapter for OpenAI Codex CLI.
 *
 * Configures Codex CLI to route requests through the Nexus OpenAI compatibility
 * endpoint via OPENAI_BASE_URL.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { join } from 'node:path';

import type { LocalAgentCapabilities, LocalAgentExecutionRequest, LocalAgent } from '../../domain/local-agent.js';

import { BaseAgentAdapter } from './base-agent-adapter.js';

export class CodexAdapter extends BaseAgentAdapter {
  readonly id = 'codex-cli';
  readonly name = 'OpenAI Codex CLI';
  readonly type = 'codex';
  readonly defaultBinaries = ['codex', 'codex.exe'];
  readonly wellKnownPaths = [
    join('AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    join('AppData', 'Local', 'codex', 'bin', 'codex.exe'),
    join('.local', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/usr/bin/codex',
  ];
  readonly configLocations = ['.codex/config.toml', '.codex/config.json'];

  getCapabilities(): LocalAgentCapabilities {
    return {
      prompt: true,
      streaming: true,
      workspace: true,
      nonInteractive: true,
      modelSelection: true,
      environmentConfig: true,
      tools: true,
      customFlags: ['exec', '-p', '--model', '--quiet'],
    };
  }

  override prepareEnvironment(
    agent: LocalAgent,
    opts: {
      gatewayUrl: string;
      modelPolicy?: string;
      targetModel?: string;
      customEnv?: Record<string, string>;
    },
  ): Record<string, string> {
    const env = super.prepareEnvironment(agent, opts);
    const cleanBase = opts.gatewayUrl.endsWith('/v1') ? opts.gatewayUrl : `${opts.gatewayUrl}/v1`;
    env['OPENAI_BASE_URL'] = cleanBase;
    env['OPENAI_API_KEY'] = 'nexus-bridge-token';
    if (opts.targetModel || opts.modelPolicy) {
      env['OPENAI_MODEL'] = opts.targetModel ?? opts.modelPolicy ?? 'nexus/best-coding';
    }
    return env;
  }

  buildCommand(
    request: LocalAgentExecutionRequest,
    opts: { gatewayUrl: string; selectedModel?: string },
  ): { command: string; args: readonly string[] } {
    const exe = this.cachedExecutable || 'codex';
    const args: string[] = ['exec', request.prompt];

    if (opts.selectedModel || request.modelPolicy) {
      args.push('--model', opts.selectedModel ?? request.modelPolicy ?? 'nexus/best-coding');
    }

    return { command: exe, args };
  }
}

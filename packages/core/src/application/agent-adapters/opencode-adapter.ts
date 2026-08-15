/**
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenCodeAdapter — Local Agent Bridge adapter for OpenCode.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { join } from 'node:path';

import type { LocalAgentCapabilities, LocalAgentExecutionRequest, LocalAgent } from '../../domain/local-agent.js';

import { BaseAgentAdapter } from './base-agent-adapter.js';

export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly id = 'opencode';
  readonly name = 'OpenCode';
  readonly type = 'opencode';
  readonly defaultBinaries = ['opencode', 'opencode.exe'];
  readonly wellKnownPaths = [
    join('AppData', 'Local', 'Programs', 'opencode', 'opencode.exe'),
    join('AppData', 'Roaming', 'npm', 'opencode.cmd'),
    join('.local', 'bin', 'opencode'),
    '/usr/local/bin/opencode',
    '/usr/bin/opencode',
  ];
  readonly configLocations = ['.config/opencode/opencode.json', '.opencode/config.json'];

  getCapabilities(): LocalAgentCapabilities {
    return {
      prompt: true,
      streaming: true,
      workspace: true,
      nonInteractive: true,
      modelSelection: true,
      environmentConfig: true,
      tools: true,
      customFlags: ['run', '-p', '--model'],
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
    env['OPENCODE_BASE_URL'] = cleanBase;
    if (opts.targetModel || opts.modelPolicy) {
      env['OPENCODE_MODEL'] = opts.targetModel ?? opts.modelPolicy ?? 'nexus/best-coding';
    }
    return env;
  }

  buildCommand(
    request: LocalAgentExecutionRequest,
    opts: { gatewayUrl: string; selectedModel?: string },
  ): { command: string; args: readonly string[] } {
    const exe = this.cachedExecutable || 'opencode';
    const args: string[] = ['run', request.prompt];

    if (opts.selectedModel || request.modelPolicy) {
      args.push('--model', opts.selectedModel ?? request.modelPolicy ?? 'nexus/best-coding');
    }

    return { command: exe, args };
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HermesAdapter — Local Agent Bridge adapter for Hermes CLI.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { join } from 'node:path';

import type { LocalAgentCapabilities, LocalAgentExecutionRequest, LocalAgent } from '../../domain/local-agent.js';

import { BaseAgentAdapter } from './base-agent-adapter.js';

export class HermesAdapter extends BaseAgentAdapter {
  readonly id = 'hermes-cli';
  readonly name = 'Hermes CLI';
  readonly type = 'hermes';
  readonly defaultBinaries = ['hermes', 'hermes.exe'];
  readonly wellKnownPaths = [
    join('AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
    join('AppData', 'Local', 'hermes', 'bin', 'hermes.exe'),
    join('.local', 'bin', 'hermes'),
    '/usr/local/bin/hermes',
    '/usr/bin/hermes',
  ];
  readonly configLocations = ['AppData/Local/hermes/config.yaml', '.hermes/config.yaml', '.hermes/config.json'];

  getCapabilities(): LocalAgentCapabilities {
    return {
      prompt: true,
      streaming: true,
      workspace: true,
      nonInteractive: true,
      modelSelection: true,
      environmentConfig: true,
      tools: true,
      customFlags: ['chat', '--prompt', '--non-interactive', '--model'],
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
    env['HERMES_BASE_URL'] = cleanBase;
    if (opts.targetModel || opts.modelPolicy) {
      env['HERMES_MODEL'] = opts.targetModel ?? opts.modelPolicy ?? 'nexus/best-coding';
    }
    return env;
  }

  buildCommand(
    request: LocalAgentExecutionRequest,
    opts: { gatewayUrl: string; selectedModel?: string },
  ): { command: string; args: readonly string[] } {
    const exe = this.cachedExecutable || 'hermes';
    const args: string[] = ['chat', '--prompt', request.prompt, '--non-interactive'];

    if (opts.selectedModel || request.modelPolicy) {
      args.push('--model', opts.selectedModel ?? request.modelPolicy ?? 'nexus/best-coding');
    }

    return { command: exe, args };
  }
}

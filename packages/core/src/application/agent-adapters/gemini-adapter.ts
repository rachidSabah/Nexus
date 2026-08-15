/**
 * ─────────────────────────────────────────────────────────────────────────────
 * GeminiAdapter — Local Agent Bridge adapter for Gemini CLI.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { join } from 'node:path';

import type { LocalAgentCapabilities, LocalAgentExecutionRequest, LocalAgent } from '../../domain/local-agent.js';

import { BaseAgentAdapter } from './base-agent-adapter.js';

export class GeminiAdapter extends BaseAgentAdapter {
  readonly id = 'gemini-cli';
  readonly name = 'Gemini CLI';
  readonly type = 'gemini';
  readonly defaultBinaries = ['gemini', 'gemini.exe', 'gemini-cli'];
  readonly wellKnownPaths = [
    join('AppData', 'Roaming', 'npm', 'gemini.cmd'),
    join('AppData', 'Local', 'Programs', 'gemini', 'gemini.exe'),
    join('.local', 'bin', 'gemini'),
    '/usr/local/bin/gemini',
    '/usr/bin/gemini',
  ];
  readonly configLocations = ['.gemini/settings.json'];

  getCapabilities(): LocalAgentCapabilities {
    return {
      prompt: true,
      streaming: true,
      workspace: true,
      nonInteractive: true,
      modelSelection: true,
      environmentConfig: true,
      tools: true,
      customFlags: ['--prompt', '--model', '--quiet'],
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
    env['GEMINI_API_BASE'] = cleanBase;
    env['GEMINI_API_KEY'] = 'nexus-bridge-token';
    if (opts.targetModel || opts.modelPolicy) {
      env['GEMINI_MODEL'] = opts.targetModel ?? opts.modelPolicy ?? 'nexus/best-coding';
    }
    return env;
  }

  buildCommand(
    request: LocalAgentExecutionRequest,
    opts: { gatewayUrl: string; selectedModel?: string },
  ): { command: string; args: readonly string[] } {
    const exe = this.cachedExecutable || 'gemini';
    const args: string[] = [request.prompt];

    if (opts.selectedModel || request.modelPolicy) {
      args.push('--model', opts.selectedModel ?? request.modelPolicy ?? 'nexus/best-coding');
    }

    return { command: exe, args };
  }
}

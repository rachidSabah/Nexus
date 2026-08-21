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
      customFlags: ['-z', '-m', '--in', '--yolo'],
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
    // Hermes one-shot mode: `hermes -z "PROMPT" [-m MODEL]`. The CLI has no
    // `chat --prompt` / `--non-interactive` flags (v0.20+ argparse rejects
    // them), and gateway routing happens via env vars (OPENAI_BASE_URL /
    // HERMES_BASE_URL), not CLI flags.
    const args: string[] = ['-z', request.prompt];

    const model = opts.selectedModel ?? request.modelPolicy;
    if (model) {
      args.push('-m', model);
    }

    if (request.workspace) {
      args.push('--in', request.workspace);
    }

    return { command: exe, args };
  }
}

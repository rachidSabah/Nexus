/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AgyAdapter — Local Agent Bridge adapter for AGY Autonomous Application Builder.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { join } from 'node:path';

import type { LocalAgentCapabilities, LocalAgentExecutionRequest, LocalAgent } from '../../domain/local-agent.js';

import { BaseAgentAdapter } from './base-agent-adapter.js';

export class AgyAdapter extends BaseAgentAdapter {
  readonly id = 'agy';
  readonly name = 'AGY Builder Agent';
  readonly type = 'agy';
  readonly defaultBinaries = ['agy', 'agy.exe'];
  readonly wellKnownPaths = [
    join('AppData', 'Local', 'agy', 'bin', 'agy.exe'),
    join('.local', 'bin', 'agy'),
    join('.agy', 'bin', 'agy.exe'),
    '/usr/local/bin/agy',
    '/usr/bin/agy',
  ];
  readonly configLocations = ['.agy/config.json'];

  getCapabilities(): LocalAgentCapabilities {
    return {
      prompt: true,
      streaming: true,
      workspace: true,
      nonInteractive: true,
      modelSelection: true,
      environmentConfig: true,
      buildRuntime: true,
      tools: true,
      customFlags: ['--print', '--workspace', '--model', '--policy'],
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
    env['NEXUS_GATEWAY_URL'] = opts.gatewayUrl;
    env['NEXUS_TARGET_MODEL'] = opts.targetModel ?? opts.modelPolicy ?? 'nexus/best-coding';
    env['AGY_NON_INTERACTIVE'] = '1';
    return env;
  }

  buildCommand(
    request: LocalAgentExecutionRequest,
    opts: { gatewayUrl: string; selectedModel?: string },
  ): { command: string; args: readonly string[] } {
    const exe = this.cachedExecutable || 'agy';
    const args: string[] = ['--print', request.prompt];

    if (request.workspace) {
      args.push('--workspace', request.workspace);
    }
    if (opts.selectedModel || request.modelPolicy) {
      args.push('--model', opts.selectedModel ?? request.modelPolicy ?? 'nexus/best-coding');
    }

    return { command: exe, args };
  }
}

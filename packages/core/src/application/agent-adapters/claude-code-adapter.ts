/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ClaudeCodeAdapter — Local Agent Bridge adapter for Claude Code CLI.
 *
 * Configures Claude Code to route all inference through the Nexus Gateway
 * via ANTHROPIC_BASE_URL. Supports non-interactive `-p` prompt execution.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { join } from 'node:path';

import type { LocalAgentCapabilities, LocalAgentExecutionRequest, LocalAgent } from '../../domain/local-agent.js';

import { BaseAgentAdapter } from './base-agent-adapter.js';

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';
  readonly type = 'claude-code';
  readonly defaultBinaries = ['claude', 'claude.exe'];
  readonly wellKnownPaths = [
    join('.local', 'bin', 'claude.exe'),
    join('.local', 'bin', 'claude'),
    join('AppData', 'Roaming', 'npm', 'claude.cmd'),
    join('AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ];
  readonly configLocations = ['.claude/settings.json', '.claude/settings.local.json'];

  getCapabilities(): LocalAgentCapabilities {
    return {
      prompt: true,
      streaming: true,
      workspace: true,
      nonInteractive: true,
      modelSelection: true,
      environmentConfig: true,
      tools: true,
      customFlags: ['-p', '--print', '--model', '--verbose'],
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
    // Point Claude Code to Nexus Gateway Anthropic messages proxy endpoint
    env['ANTHROPIC_BASE_URL'] = opts.gatewayUrl;
    env['ANTHROPIC_API_KEY'] = 'nexus-bridge-token';
    if (opts.targetModel || opts.modelPolicy) {
      env['ANTHROPIC_MODEL'] = opts.targetModel ?? opts.modelPolicy ?? 'nexus/best-coding';
    }
    return env;
  }

  buildCommand(
    request: LocalAgentExecutionRequest,
    opts: { gatewayUrl: string; selectedModel?: string },
  ): { command: string; args: readonly string[] } {
    const exe = this.cachedExecutable || 'claude';
    const args: string[] = ['-p', request.prompt];

    if (opts.selectedModel || request.modelPolicy) {
      args.push('--model', opts.selectedModel ?? request.modelPolicy ?? 'nexus/best-coding');
    }

    return { command: exe, args };
  }
}

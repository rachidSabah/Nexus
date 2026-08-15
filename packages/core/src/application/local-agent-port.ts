/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LocalAgent Port & Adapter Interfaces — Phase 27 Local Agent Bridge
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  LocalAgent,
  LocalAgentCapabilities,
  LocalAgentExecutionRequest,
  LocalAgentExecutionResult,
  LocalAgentHealth,
  LocalAgentStreamEvent,
} from '../domain/local-agent.js';

export interface LocalAgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: string;

  /** Resolves executable path if installed. */
  findExecutable(): Promise<string | undefined>;

  /** Probe and discover if this agent is installed locally on this host. */
  discover(opts?: { nexusPort?: number; gatewayUrl?: string }): Promise<LocalAgent>;

  /** Query and parse agent version string from CLI executable if possible. */
  getVersion(executablePath?: string): Promise<string | undefined>;

  /** Perform multi-stage health check (Installed -> Executable -> Configurable -> Ready). */
  healthCheck(agent: LocalAgent, gatewayUrl: string): Promise<LocalAgentHealth>;

  /** Verify that local configuration points cleanly to Nexus gateway. */
  validateConfiguration(agent: LocalAgent): Promise<boolean>;

  /** Prepare safe environment variables for subprocess execution. */
  prepareEnvironment(
    agent: LocalAgent,
    opts: {
      gatewayUrl: string;
      modelPolicy?: string;
      targetModel?: string;
      customEnv?: Record<string, string>;
    },
  ): Record<string, string>;

  /** Execute a prompt non-interactively or with streaming. */
  execute(
    request: LocalAgentExecutionRequest,
    opts: {
      gatewayUrl: string;
      selectedModel?: string;
      selectedProvider?: string;
      onEvent?: (event: LocalAgentStreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<LocalAgentExecutionResult>;

  /** Return static capabilities of this adapter. */
  getCapabilities(): LocalAgentCapabilities;
}

export interface LocalAgentRegistryPort {
  list(): readonly LocalAgent[];
  get(agentId: string): LocalAgent | undefined;
  registerAdapter(adapter: LocalAgentAdapter): void;
  discoverAll(opts?: { gatewayUrl?: string }): Promise<readonly LocalAgent[]>;
  healthCheck(agentId: string, gatewayUrl: string): Promise<LocalAgentHealth>;
  healthCheckAll(gatewayUrl: string): Promise<Record<string, LocalAgentHealth>>;
}

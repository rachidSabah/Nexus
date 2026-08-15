/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LocalAgent Domain Types — Phase 27 Local Agent Bridge
 *
 * Defines the contract for discovering, health-checking, launching, monitoring,
 * and communicating with local coding agents (Claude Code, Codex, Hermes,
 * OpenCode, AGY, Gemini CLI, etc.).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type LocalAgentState =
  | 'DISCOVERING'
  | 'AVAILABLE'
  | 'READY'
  | 'BUSY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'ERROR'
  | 'DISABLED';

export type LocalAgentHealthLevel =
  | 'INSTALLED'
  | 'EXECUTABLE'
  | 'CONFIGURABLE'
  | 'READY'
  | 'FAILED';

export interface LocalAgentCapabilities {
  readonly prompt: boolean;
  readonly streaming: boolean;
  readonly workspace: boolean;
  readonly nonInteractive: boolean;
  readonly modelSelection: boolean;
  readonly environmentConfig: boolean;
  readonly buildRuntime?: boolean;
  readonly tools?: boolean;
  readonly customFlags?: readonly string[];
}

export interface LocalAgentHealth {
  readonly level: LocalAgentHealthLevel;
  readonly executableFound: boolean;
  readonly executablePath?: string;
  readonly versionFound?: string;
  readonly configValid: boolean;
  readonly gatewayReachable: boolean;
  readonly executionVerified: boolean;
  readonly lastChecked: number;
  readonly details?: string;
  readonly failureReason?: string;
}

export interface LocalAgent {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly executable?: string;
  readonly version?: string;
  readonly status: LocalAgentState;
  readonly health: LocalAgentHealth;
  readonly capabilities: LocalAgentCapabilities;
  readonly workspaceSupport: boolean;
  readonly streamingSupport: boolean;
  readonly supportsNonInteractive: boolean;
  readonly supportsEnvironmentConfiguration: boolean;
  readonly supportsModelConfiguration: boolean;
  readonly platform: string;
  readonly detectedVia: 'path' | 'well-known' | 'npm-global' | 'config-file' | 'not-found';
  readonly lastSeen?: number;
  readonly lastHealthCheck?: number;
  readonly currentTaskId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface LocalAgentExecutionRequest {
  readonly agentId: string;
  readonly prompt: string;
  readonly workspace?: string;
  readonly modelPolicy?: string;
  readonly timeoutMs?: number;
  readonly streaming?: boolean;
  readonly env?: Record<string, string>;
  readonly metadata?: Record<string, unknown>;
}

export interface LocalAgentExecutionResult {
  readonly executionId: string;
  readonly agentId: string;
  readonly status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'CANCELLED';
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly selectedModel?: string;
  readonly selectedProvider?: string;
  readonly outputEventsCount: number;
}

export type LocalAgentStreamEventType =
  | 'agent.started'
  | 'agent.output'
  | 'agent.tool_call'
  | 'agent.progress'
  | 'agent.warning'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.cancelled';

export interface LocalAgentStreamEvent {
  readonly executionId: string;
  readonly agentId: string;
  readonly type: LocalAgentStreamEventType;
  readonly timestamp: number;
  readonly chunk?: string;
  readonly stream?: 'stdout' | 'stderr';
  readonly payload?: Record<string, unknown>;
}

export interface LocalAgentDiagnosticChain {
  readonly agentId: string;
  readonly agentName: string;
  readonly steps: {
    readonly executable: { ok: boolean; path?: string; message?: string };
    readonly configuration: { ok: boolean; location?: string; message?: string };
    readonly nexusGateway: { ok: boolean; url: string; message?: string };
    readonly modelRouting: { ok: boolean; selectedPolicy?: string; message?: string };
    readonly providerAuth: { ok: boolean; providerId?: string; message?: string };
    readonly modelDiscovery: { ok: boolean; modelsCount: number; message?: string };
    readonly liveExecution: { ok: boolean; latencyMs?: number; message?: string };
  };
  readonly overallStatus: 'READY' | 'DEGRADED' | 'FAILED' | 'NOT_INSTALLED';
  readonly failureStage?: string;
  readonly failureMessage?: string;
  readonly verifiedAt: number;
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LocalAgentBridge — Phase 27 Local Agent Bridge & Runtime Connector.
 *
 * Provides universal runtime discovery, health monitoring, execution orchestration,
 * process tree management, streaming event forwarding, and gateway model binding
 * for all local agentic coding CLI tools.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type {
  LocalAgent,
  LocalAgentDiagnosticChain,
  LocalAgentExecutionRequest,
  LocalAgentExecutionResult,
  LocalAgentHealth,
  LocalAgentStreamEvent,
} from '../domain/local-agent.js';

import { AgyAdapter } from './agent-adapters/agy-adapter.js';
import { ClaudeCodeAdapter } from './agent-adapters/claude-code-adapter.js';
import { CodexAdapter } from './agent-adapters/codex-adapter.js';
import { GeminiAdapter } from './agent-adapters/gemini-adapter.js';
import { HermesAdapter } from './agent-adapters/hermes-adapter.js';
import { OpenCodeAdapter } from './agent-adapters/opencode-adapter.js';
import type { LocalAgentAdapter, LocalAgentRegistryPort } from './local-agent-port.js';
import type { ModelRegistry } from './model-registry.js';
import type { EventBusPort, RoutingEnginePort } from './ports.js';

export interface LocalAgentBridgeMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  timedOutExecutions: number;
  cancelledExecutions: number;
  averageLatencyMs: number;
  activeExecutions: number;
  lastExecutionAt?: number;
}

export interface LocalAgentBridgeOptions {
  readonly gatewayUrl?: string;
  readonly defaultTimeoutMs?: number;
  readonly routing?: RoutingEnginePort;
  readonly modelRegistry?: ModelRegistry;
  readonly events?: EventBusPort;
}

export class LocalAgentBridge implements LocalAgentRegistryPort {
  private readonly adapters = new Map<string, LocalAgentAdapter>();
  private readonly agents = new Map<string, LocalAgent>();
  private readonly activeSignals = new Map<string, AbortController>();
  private readonly executionHistory: LocalAgentExecutionResult[] = [];
  private readonly gatewayUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly routing?: RoutingEnginePort;
  private readonly modelRegistry?: ModelRegistry;
  private readonly events?: EventBusPort;

  private metrics: LocalAgentBridgeMetrics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    timedOutExecutions: 0,
    cancelledExecutions: 0,
    averageLatencyMs: 0,
    activeExecutions: 0,
  };

  constructor(options: LocalAgentBridgeOptions = {}) {
    this.gatewayUrl = options.gatewayUrl ?? 'http://127.0.0.1:8787';
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
    this.routing = options.routing;
    this.modelRegistry = options.modelRegistry;
    this.events = options.events;

    // Register 6 core default adapters
    this.registerAdapter(new ClaudeCodeAdapter());
    this.registerAdapter(new CodexAdapter());
    this.registerAdapter(new HermesAdapter());
    this.registerAdapter(new OpenCodeAdapter());
    this.registerAdapter(new AgyAdapter());
    this.registerAdapter(new GeminiAdapter());
  }

  registerAdapter(adapter: LocalAgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(agentId: string): LocalAgentAdapter | undefined {
    return this.adapters.get(agentId);
  }

  list(): readonly LocalAgent[] {
    return Array.from(this.agents.values());
  }

  get(agentId: string): LocalAgent | undefined {
    return this.agents.get(agentId);
  }

  /** Run parallel discovery across all registered adapters. */
  async discoverAll(opts: { gatewayUrl?: string } = {}): Promise<readonly LocalAgent[]> {
    const gw = opts.gatewayUrl ?? this.gatewayUrl;
    const discovered: LocalAgent[] = [];

    const tasks = Array.from(this.adapters.values()).map(async (adapter) => {
      try {
        const agent = await adapter.discover({ gatewayUrl: gw });
        this.agents.set(agent.id, agent);
        discovered.push(agent);
      } catch (err) {
        const fallback: LocalAgent = {
          id: adapter.id,
          name: adapter.name,
          type: adapter.type,
          status: 'ERROR',
          health: {
            level: 'FAILED',
            executableFound: false,
            configValid: false,
            gatewayReachable: false,
            executionVerified: false,
            lastChecked: Date.now(),
            failureReason: (err as Error).message,
          },
          capabilities: adapter.getCapabilities(),
          workspaceSupport: true,
          streamingSupport: true,
          supportsNonInteractive: true,
          supportsEnvironmentConfiguration: true,
          supportsModelConfiguration: true,
          platform: process.platform,
          detectedVia: 'not-found',
        };
        this.agents.set(adapter.id, fallback);
        discovered.push(fallback);
      }
    });

    await Promise.all(tasks);
    return discovered;
  }

  /** Perform live multi-stage health check on a specific agent. */
  async healthCheck(agentId: string, gatewayUrl: string = this.gatewayUrl): Promise<LocalAgentHealth> {
    const adapter = this.adapters.get(agentId);
    let agent = this.agents.get(agentId);

    if (!adapter) {
      throw new Error(`Unknown agent adapter '${agentId}'`);
    }

    if (!agent) {
      agent = await adapter.discover({ gatewayUrl });
      this.agents.set(agentId, agent);
    }

    const health = await adapter.healthCheck(agent, gatewayUrl);
    const updated: LocalAgent = {
      ...agent,
      health,
      status: health.level === 'READY' ? 'READY' : health.executableFound ? 'AVAILABLE' : 'UNAVAILABLE',
      lastHealthCheck: Date.now(),
    };
    this.agents.set(agentId, updated);
    return health;
  }

  async healthCheckAll(gatewayUrl: string = this.gatewayUrl): Promise<Record<string, LocalAgentHealth>> {
    const results: Record<string, LocalAgentHealth> = {};
    for (const id of this.adapters.keys()) {
      results[id] = await this.healthCheck(id, gatewayUrl);
    }
    return results;
  }

  /** Generate detailed diagnostic chain for Mission Control inspection. */
  async getDiagnosticChain(agentId: string, modelPolicy: string = 'nexus/best-coding'): Promise<LocalAgentDiagnosticChain> {
    const adapter = this.adapters.get(agentId);
    if (!adapter) {
      throw new Error(`Unknown agent '${agentId}'`);
    }

    const agent = this.agents.get(agentId) ?? (await adapter.discover({ gatewayUrl: this.gatewayUrl }));
    const exe = await adapter.findExecutable();
    const configValid = await adapter.validateConfiguration(agent);

    let gwOk = false;
    try {
      const res = await fetch(`${this.gatewayUrl}/health`, { signal: AbortSignal.timeout(1500) });
      gwOk = res.ok;
    } catch {
      gwOk = false;
    }

    // Routing & Provider verification
    let routingOk = false;
    let selectedModel = modelPolicy;
    let selectedProvider = 'nexus';
    if (this.routing) {
      try {
        const decision = await this.routing.resolve({ model: modelPolicy });
        routingOk = true;
        selectedModel = decision.endpoint.id;
        selectedProvider = decision.endpoint.providerId;
      } catch {
        routingOk = false;
      }
    } else {
      routingOk = true;
    }

    const models = this.modelRegistry?.list() ?? [];
    const modelsCount = models.length;
    const modelDiscoveryOk = modelsCount > 0;

    let overallStatus: LocalAgentDiagnosticChain['overallStatus'] = 'FAILED';
    let failureStage: string | undefined = undefined;
    let failureMessage: string | undefined = undefined;

    if (!exe) {
      overallStatus = 'NOT_INSTALLED';
      failureStage = 'EXECUTABLE';
      failureMessage = `Agent executable not found in PATH or standard directories`;
    } else if (!configValid) {
      overallStatus = 'DEGRADED';
      failureStage = 'CONFIGURATION';
      failureMessage = `Configuration is missing or not bound to Nexus`;
    } else if (!gwOk) {
      overallStatus = 'FAILED';
      failureStage = 'NEXUS_GATEWAY';
      failureMessage = `Nexus Gateway unreachable at ${this.gatewayUrl}`;
    } else if (!routingOk) {
      overallStatus = 'DEGRADED';
      failureStage = 'ROUTING';
      failureMessage = `No active healthy endpoint found for policy '${modelPolicy}'`;
    } else {
      overallStatus = 'READY';
    }

    return {
      agentId,
      agentName: adapter.name,
      steps: {
        executable: { ok: !!exe, path: exe, message: exe ? 'Executable located and verified' : 'Executable not found' },
        configuration: { ok: configValid, message: configValid ? 'Configuration verified' : 'Configuration missing' },
        nexusGateway: { ok: gwOk, url: this.gatewayUrl, message: gwOk ? 'Connected to Nexus Gateway' : 'Gateway unreachable' },
        modelRouting: { ok: routingOk, selectedPolicy: selectedModel, message: routingOk ? `Resolved to ${selectedModel}` : 'Routing failed' },
        providerAuth: { ok: true, providerId: selectedProvider, message: `Routed to provider: ${selectedProvider}` },
        modelDiscovery: { ok: modelDiscoveryOk, modelsCount, message: `${modelsCount} dynamic models active` },
        liveExecution: { ok: overallStatus === 'READY', message: overallStatus === 'READY' ? 'Agent ready for execution' : 'Execution deferred' },
      },
      overallStatus,
      failureStage,
      failureMessage,
      verifiedAt: Date.now(),
    };
  }

  /** Execute a prompt on a local agent with model policy routing. */
  async execute(
    request: LocalAgentExecutionRequest,
    opts: {
      gatewayUrl?: string;
      onEvent?: (event: LocalAgentStreamEvent) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<LocalAgentExecutionResult> {
    const adapter = this.adapters.get(request.agentId);
    if (!adapter) {
      throw new Error(`No adapter registered for agent '${request.agentId}'`);
    }

    if (request.workspace) {
      if (!isAbsolute(request.workspace) || request.workspace.includes('..')) {
        throw new Error(`Workspace path must be an absolute path without traversal: '${request.workspace}'`);
      }
    }

    const gwUrl = opts.gatewayUrl ?? this.gatewayUrl;
    const policy = request.modelPolicy ?? 'nexus/best-coding';
    let selectedModel = policy;
    let selectedProvider = 'nexus';

    if (this.routing) {
      try {
        const decision = await this.routing.resolve({ model: policy });
        // The decision carries the ENDPOINT (e.g. `auto-opencode-go`), not a
        // model id. Passing an endpoint id to a coding agent as `--model`
        // makes the agent CLI reject it ("invalid model selection") — the
        // agents receive the gateway policy alias here and the gateway itself
        // resolves it to the concrete model via env-var base-URL routing.
        selectedProvider = decision.endpoint.providerId;
      } catch {
        // use default policy alias
      }
    }

    const controller = new AbortController();
    const executionId = `exec-${randomUUID().substring(0, 8)}`;
    this.activeSignals.set(executionId, controller);

    if (opts.signal) {
      opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    this.metrics.totalExecutions++;
    this.metrics.activeExecutions++;

    // Mark agent BUSY
    const existing = this.agents.get(request.agentId);
    if (existing) {
      this.agents.set(request.agentId, { ...existing, status: 'BUSY', currentTaskId: executionId });
    }

    try {
      const result = await adapter.execute(
        { ...request, timeoutMs: request.timeoutMs ?? this.defaultTimeoutMs },
        {
          gatewayUrl: gwUrl,
          selectedModel,
          selectedProvider,
          onEvent: opts.onEvent,
          signal: controller.signal,
        },
      );

      this.metrics.activeExecutions = Math.max(0, this.metrics.activeExecutions - 1);
      this.metrics.lastExecutionAt = Date.now();

      if (result.status === 'SUCCESS') {
        this.metrics.successfulExecutions++;
      } else if (result.status === 'CANCELLED') {
        this.metrics.cancelledExecutions++;
      } else if (result.status === 'TIMEOUT') {
        this.metrics.timedOutExecutions++;
      } else {
        this.metrics.failedExecutions++;
      }

      // Update rolling average latency
      const prevTotal = this.metrics.successfulExecutions + this.metrics.failedExecutions;
      this.metrics.averageLatencyMs = Math.round(
        (this.metrics.averageLatencyMs * (prevTotal - 1) + result.durationMs) / Math.max(1, prevTotal),
      );

      this.executionHistory.unshift(result);
      if (this.executionHistory.length > 50) this.executionHistory.pop();

      // Emit event
      void this.events?.publish({
        type: 'agent.executed' as any,
        occurredAt: new Date(),
        payload: {
          executionId: result.executionId,
          agentId: result.agentId,
          status: result.status,
          durationMs: result.durationMs,
          selectedModel,
        },
      });

      return result;
    } finally {
      this.activeSignals.delete(executionId);
      if (existing) {
        this.agents.set(request.agentId, {
          ...existing,
          status: existing.health.level === 'READY' ? 'READY' : 'AVAILABLE',
          currentTaskId: undefined,
        });
      }
    }
  }

  cancelExecution(executionId: string): boolean {
    const controller = this.activeSignals.get(executionId);
    if (!controller) return false;
    controller.abort();
    this.activeSignals.delete(executionId);
    return true;
  }

  getMetrics(): LocalAgentBridgeMetrics {
    return { ...this.metrics };
  }

  getExecutionHistory(agentId?: string): readonly LocalAgentExecutionResult[] {
    if (!agentId) return this.executionHistory;
    return this.executionHistory.filter((e) => e.agentId === agentId);
  }
}

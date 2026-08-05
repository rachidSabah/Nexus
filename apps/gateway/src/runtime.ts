import { randomUUID } from 'node:crypto';

import { AgentRegistry as A2AAgentRegistry, A2ACoordinator, TeamManager } from '@anx/a2a';
import { AgentRegistry, registerBuiltinAgents } from '@anx/agents';
import {
  ChatCompletionUseCase,
  DefaultCostCalculator,
  DefaultFailover,
  InMemoryAuditLog,
  InMemoryEventBus,
  RoutingEngine,
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type EmbeddingRequest,
  type ProviderEndpoint,
  type RoutingDecision,
} from '@anx/core';
import { McpClient } from '@anx/mcp-client';
import { McpServer } from '@anx/mcp-server';
import { DefaultMemory, InMemoryVectorStore, FakeEmbeddingsProvider } from '@anx/memory';
import { DefaultNetworkService, preferIpv4 } from '@anx/networking';
import { InProcessTelemetry, StructuredLogger, wireEventsToTelemetry } from '@anx/observability';
import { PluginRuntime } from '@anx/plugins';
import { createDefaultAdapters } from '@anx/providers';
import { AgentRuntime, type TaskExecutor } from '@anx/runtime';
import { EncryptedCredentialVault, RbacService, BUILTIN_ROLES, JwtService, hashApiKey } from '@anx/security';
import { createPlanner } from '@anx/task-router';
import { ToolRuntime, registerBuiltinToolDefinitions } from '@anx/tools';
import { WorkflowEngine, InMemoryWorkflowRepository, WORKFLOW_TEMPLATES } from '@anx/workflow';

import { ConfigLoader, type GatewayConfig } from './config.js';
import { registerDefaultEndpoints } from './endpoints.js';
import { HttpServer } from './server.js';

/**
 * The gateway runtime. Composes all packages and wires up the Fastify HTTP
 * server. This is the entrypoint used by both `bin.ts` and by tests.
 */
export class GatewayRuntime {
  readonly config!: GatewayConfig;
  readonly events!: InMemoryEventBus;
  readonly telemetry!: InProcessTelemetry;
  readonly logger!: StructuredLogger;
  readonly routing!: RoutingEngine;
  readonly audit!: InMemoryAuditLog;
  readonly vault!: EncryptedCredentialVault;
  readonly rbac!: RbacService;
  readonly jwt!: JwtService;
  readonly plugins!: PluginRuntime;
  readonly network!: DefaultNetworkService;
  readonly mcpServer!: McpServer;
  readonly mcpClient!: McpClient;
  readonly a2aRegistry!: A2AAgentRegistry;
  readonly a2a!: A2ACoordinator;
  readonly adapters!: ReturnType<typeof createDefaultAdapters>;
  readonly chatUseCase!: ChatCompletionUseCase;
  readonly server!: HttpServer;
  // Phase 4
  readonly agents!: AgentRegistry;
  readonly runtime!: AgentRuntime;
  readonly workflows!: WorkflowEngine;
  readonly memory!: DefaultMemory;
  readonly tools!: ToolRuntime;
  readonly planner!: ReturnType<typeof createPlanner>;
  readonly teams!: TeamManager;

  private constructor(opts: {
    config: GatewayConfig;
    events: InMemoryEventBus;
    telemetry: InProcessTelemetry;
    logger: StructuredLogger;
    routing: RoutingEngine;
    audit: InMemoryAuditLog;
    vault: EncryptedCredentialVault;
    rbac: RbacService;
    jwt: JwtService;
    plugins: PluginRuntime;
    network: DefaultNetworkService;
    mcpServer: McpServer;
    mcpClient: McpClient;
    a2aRegistry: A2AAgentRegistry;
    a2a: A2ACoordinator;
    adapters: ReturnType<typeof createDefaultAdapters>;
    chatUseCase: ChatCompletionUseCase;
    server: HttpServer;
    agents: AgentRegistry;
    runtime: AgentRuntime;
    workflows: WorkflowEngine;
    memory: DefaultMemory;
    tools: ToolRuntime;
    planner: ReturnType<typeof createPlanner>;
    teams: TeamManager;
  }) {
    Object.assign(this, opts);
  }

  static async create(configPath?: string): Promise<GatewayRuntime> {
    preferIpv4();
    const config = await ConfigLoader.load(configPath);

    const events = new InMemoryEventBus();
    const telemetry = new InProcessTelemetry();
    const logger = new StructuredLogger();
    wireEventsToTelemetry(events, telemetry, logger);

    const routing = new RoutingEngine(events, {
      failureThreshold: config.routing.failureThreshold,
      failureWindowMs: config.routing.failureWindowMs,
      cooldownMs: config.routing.cooldownMs,
    });
    const audit = new InMemoryAuditLog();
    const vault = new EncryptedCredentialVault(
      config.security.vaultKey ?? randomUUID().toString(),
      config.security.vaultPath,
    );
    await vault.restore();

    const rbac = new RbacService();
    for (const role of Object.values(BUILTIN_ROLES)) rbac.registerRole(role);
    for (const p of config.security.principals ?? []) {
      rbac.registerPrincipal({ ...p, apiKeyHash: p.apiKey ? hashApiKey(p.apiKey) : undefined });
    }

    const jwt = new JwtService(config.security.jwtSecret ?? randomUUID().toString());

    const plugins = new PluginRuntime(events);
    const network = new DefaultNetworkService({
      proxies: config.network.proxies,
      doh: config.network.doh,
    });

    const adapters = createDefaultAdapters();
    await registerDefaultEndpoints(routing, config, vault);

    const chatUseCase = new ChatCompletionUseCase(
      routing,
      new DefaultFailover(),
      adapters,
      events,
      new DefaultCostCalculator(),
      config.routing.maxFailovers,
    );

    // ─── Phase 4: Agents / Runtime / Workflow / Memory / Tools / Planner / Teams ──
    const agents = new AgentRegistry(events);
    await registerBuiltinAgents(agents);

    // Wire the agent runtime to use the gateway's chat use case as executor
    const executor: TaskExecutor = {
      async execute(request, sink, signal) {
        return chatUseCase.execute(request, sink as never, signal);
      },
    };
    const runtime = new AgentRuntime(agents, executor, events, {
      timeoutMs: 120_000,
      maxRetries: 2,
    });

    const workflowRepo = new InMemoryWorkflowRepository();
    const workflows = new WorkflowEngine(workflowRepo, runtime, events);
    // Register built-in workflow templates
    for (const template of Object.values(WORKFLOW_TEMPLATES)) {
      await workflows.create(template as never);
    }

    const memory = new DefaultMemory(
      new InMemoryVectorStore(),
      new FakeEmbeddingsProvider(), // production: GatewayEmbeddingsProvider
      events,
    );

    const tools = new ToolRuntime(events);
    registerBuiltinToolDefinitions(tools);

    const planner = createPlanner(agents);

    const a2aRegistry = new A2AAgentRegistry();
    const a2a = new A2ACoordinator(a2aRegistry);
    const teams = new TeamManager(events);

    const mcpServer = new McpServer({
      name: 'agent-nexus-gateway',
      version: '0.4.0',
      tools: [
        {
          name: 'list_providers',
          description: 'List all configured provider endpoints and their health',
          inputSchema: { type: 'object', properties: {} },
          invoke: async () => routing.listEndpoints().map((e) => ({
            id: e.id,
            providerId: e.providerId,
            health: e.health,
            model: e.tags[0] ?? 'unknown',
          })),
        },
        {
          name: 'chat',
          description: 'Send a chat completion request through the gateway',
          inputSchema: {
            type: 'object',
            properties: { model: { type: 'string' }, message: { type: 'string' } },
            required: ['model', 'message'],
          },
          invoke: async (args) => {
            const r = await chatUseCase.execute({
              model: args['model'] as string,
              messages: [{ role: 'user', content: args['message'] as string }],
            });
            return r.choices[0]?.message.content;
          },
        },
        {
          name: 'list_agents',
          description: 'List all registered AI agents and their capabilities',
          inputSchema: { type: 'object', properties: {} },
          invoke: async () => agents.list().map((a) => ({
            id: a.id, name: a.name, status: a.status, capabilities: a.capabilities,
          })),
        },
        {
          name: 'plan_task',
          description: 'Generate an execution plan for a complex request',
          inputSchema: {
            type: 'object',
            properties: { request: { type: 'string' } },
            required: ['request'],
          },
          invoke: async (args) => planner.plan(args['request'] as string),
        },
        {
          name: 'list_workflows',
          description: 'List all registered workflow definitions',
          inputSchema: { type: 'object', properties: {} },
          invoke: async () => workflows.list(),
        },
      ],
    });

    const mcpClient = new McpClient(config.mcp.servers ?? []);

    const server = new HttpServer({
      config,
      routing,
      chatUseCase,
      adapters,
      events,
      telemetry,
      audit,
      rbac,
      jwt,
      vault,
      mcpServer,
      a2a,
      plugins,
      network,
      // Phase 4
      agents,
      runtime,
      workflows,
      memory,
      tools,
      planner,
      teams,
    });

    return new GatewayRuntime({
      config,
      events,
      telemetry,
      logger,
      routing,
      audit,
      vault,
      rbac,
      jwt,
      plugins,
      network,
      mcpServer,
      mcpClient,
      a2aRegistry,
      a2a,
      adapters,
      chatUseCase,
      server,
      agents,
      runtime,
      workflows,
      memory,
      tools,
      planner,
      teams,
    });
  }

  async start(): Promise<void> {
    await this.mcpClient.connect();
    await this.server.listen(this.config.server.port, this.config.server.host);
    this.logger.info('gateway started', {
      port: this.config.server.port,
      host: this.config.server.host,
      endpoints: this.routing.listEndpoints().length,
      agents: this.agents.list().length,
      workflows: (await this.workflows.list()).length,
    });
  }

  async stop(): Promise<void> {
    await this.mcpClient.disconnect();
    await this.server.close();
    this.logger.info('gateway stopped');
  }
}

// Re-export for callers
export type { ChatCompletionRequest, ChatCompletionChunk, EmbeddingRequest, ProviderEndpoint, RoutingDecision };

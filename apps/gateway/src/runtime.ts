import { randomUUID } from 'node:crypto';

import { ExtensionMarketplace } from '@agent-nexus/marketplace';
import { AIServiceMesh } from '@agent-nexus/service-mesh';
import { AgentRegistry as A2AAgentRegistry, A2ACoordinator, TeamManager } from '@anx/a2a';
import { AgentRegistry, registerBuiltinAgents } from '@anx/agents';
import {
  ChatCompletionUseCase,
  DefaultCostCalculator,
  DefaultFailover,
  InMemoryAuditLog,
  InMemoryCache,
  InMemoryEventBus,
  KeyRegistry,
  ModelRegistry,
  RequestTracer,
  RoutingEngine,
  type CachePort,
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type EmbeddingRequest,
  type PrivacyConfig,
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
import { AgentDetector } from './agent-detector.js';
import { registerDefaultEndpoints } from './endpoints.js';
import { ModelAliasRegistry } from './model-aliases.js';
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
  readonly marketplace!: ExtensionMarketplace;
  readonly mesh!: AIServiceMesh;
  readonly cache!: CachePort;
  readonly keyRegistry!: KeyRegistry;
  readonly modelRegistry!: ModelRegistry;
  readonly aliasRegistry!: ModelAliasRegistry;
  readonly tracer!: RequestTracer;
  readonly privacy!: PrivacyConfig;
  readonly agentDetector!: AgentDetector;

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
    marketplace: ExtensionMarketplace;
    mesh: AIServiceMesh;
    cache: CachePort;
    keyRegistry: KeyRegistry;
    modelRegistry: ModelRegistry;
    aliasRegistry: ModelAliasRegistry;
    tracer: RequestTracer;
    privacy: PrivacyConfig;
    agentDetector: AgentDetector;
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
    const vaultKey = config.security.vaultKey ?? process.env['AGENT_NEXUS_VAULT_KEY'];
    if (!vaultKey) {
      // Refuse to silently fall back to a random key if persistent storage is
      // configured — that would make previously-stored credentials permanently
      // undecryptable. Generate an ephemeral key only when the vault is in-memory.
      if (config.security.vaultPath) {
        throw new Error(
          'AGENT_NEXUS_VAULT_KEY is required when security.vaultPath is set. ' +
            'Either set the env var, remove vaultPath from config, or set vaultPath to undefined for in-memory only.',
        );
      }
      logger.warn(
        'AGENT_NEXUS_VAULT_KEY not set — using an ephemeral in-memory vault key. ' +
          'Stored credentials will be lost on restart. Set the env var (or security.vaultKey in config) for production.',
      );
    }
    const vault = new EncryptedCredentialVault(
      vaultKey ?? randomUUID().toString(),
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

    // In-memory cache for prompt + semantic cache hits. The embed function
    // uses the gateway's own /v1/embeddings endpoint via GatewayEmbeddingsProvider
    // when a real embeddings provider is available; for now we use the
    // FakeEmbeddingsProvider (deterministic 8-dim hash) so the semantic cache
    // works out of the box for development.
    const cache = new InMemoryCache({
      semanticThreshold: 0.92,
      maxEntries: 10_000,
    });
    const memoryEmbedder = new FakeEmbeddingsProvider();
    const embedFn = (text: string) => memoryEmbedder.embed(text);

    // Multi-API-key registry — allows N keys per provider with intelligent
    // rotation (round-robin / least-used / lru / latency / health / adaptive).
    // Plaintexts are stored in the encrypted vault; the registry only holds
    // metadata + health stats.
    const keyRegistry = new KeyRegistry(vault, {
      cooldownMs: 60_000,
      defaultStrategy: 'adaptive',
    });

    // Dynamic model discovery registry — calls each provider's /models
    // endpoint on startup and hourly thereafter. Classifies free models
    // automatically (no hard-coded list). Master prompt #5 + #6.
    const modelRegistry = new ModelRegistry(routing, adapters, {
      refreshIntervalMs: 60 * 60 * 1000,
      discoveryTimeoutMs: 15_000,
    });

    // Smart model aliasing — `local/free`, `local/coding`, `local/best`,
    // `local/auto`, etc. resolve dynamically to the best currently-available
    // model based on the ModelRegistry's discovered data. Master prompt #19 + #20.
    const aliasRegistry = new ModelAliasRegistry(modelRegistry);

    // Request tracer — records full request traces for inspection via
    // /v1/traces/:id. Master prompt #30.
    const tracer = new RequestTracer({ maxTraces: 1000 });

    // Privacy configuration — default to 'redacted' mode (no prompt/response
    // content in logs). Master prompt #31.
    const privacy: PrivacyConfig = {
      level: (process.env['ANX_PRIVACY_LEVEL'] as 'off' | 'redacted' | 'strict') ?? 'redacted',
      maxContentChars: 0,
      redactAuthHeaders: true,
      skipCachePersistence: process.env['ANX_PRIVACY_LEVEL'] === 'strict',
    };

    // Coding-agent auto-detector — scans PATH, npm globals, and config
    // files at startup to discover what coding agents are installed.
    // Master prompt #9.
    const agentDetector = new AgentDetector();

    const chatUseCase = new ChatCompletionUseCase(
      routing,
      new DefaultFailover(),
      adapters,
      events,
      new DefaultCostCalculator(),
      config.routing.maxFailovers,
      {
        cache,
        plugins,
        embed: embedFn,
        semanticThreshold: 0.92,
        cacheTtlMs: 5 * 60 * 1000,
        skipCacheForStreaming: true,
        keyRegistry,
        keyRotationStrategy: 'adaptive',
        privacy,
        tracer,
      },
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

    const marketplace = new ExtensionMarketplace(config.server.versionLabel ?? '0.4.0', {
      signatureVerification: config.security.vaultKey !== undefined,
    });

    // Service mesh — used for cross-gateway / cross-provider traffic shaping
    // (load balancing, circuit breaker, canary/blue-green splits). Auto-registers
    // all current routing endpoints as providers so the mesh can be queried
    // alongside the routing engine.
    const mesh = new AIServiceMesh();

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
      marketplace,
      mesh,
      cache,
      keyRegistry,
      modelRegistry,
      aliasRegistry,
      tracer,
      privacy,
      agentDetector,
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
      marketplace,
      mesh,
      cache,
      keyRegistry,
      modelRegistry,
      aliasRegistry,
      tracer,
      privacy,
      agentDetector,
    });
  }

  async start(): Promise<void> {
    await this.mcpClient.connect();
    await this.modelRegistry.start();
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
    this.modelRegistry.stop();
    await this.mcpClient.disconnect();
    await this.server.close();
    this.logger.info('gateway stopped');
  }
}

// Re-export for callers
export type { ChatCompletionRequest, ChatCompletionChunk, EmbeddingRequest, ProviderEndpoint, RoutingDecision };

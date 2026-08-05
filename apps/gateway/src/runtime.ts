import { randomUUID } from 'node:crypto';

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
import { createDefaultAdapters } from '@anx/providers';
import { PluginRuntime } from '@anx/plugins';
import { EncryptedCredentialVault, RbacService, BUILTIN_ROLES, JwtService, hashApiKey } from '@anx/security';
import { InProcessTelemetry, StructuredLogger, wireEventsToTelemetry } from '@anx/observability';
import { DefaultNetworkService, preferIpv4 } from '@anx/networking';
import { McpServer } from '@anx/mcp-server';
import { McpClient } from '@anx/mcp-client';
import { AgentRegistry, A2ACoordinator } from '@anx/a2a';

import { HttpServer } from './server.js';
import { ConfigLoader, type GatewayConfig } from './config.js';
import { registerDefaultEndpoints } from './endpoints.js';

/**
 * The gateway runtime. Composes all packages and wires up the Fastify HTTP
 * server. This is the entrypoint used by both `bin.ts` and by tests.
 */
export class GatewayRuntime {
  readonly config: GatewayConfig;
  readonly events: InMemoryEventBus;
  readonly telemetry: InProcessTelemetry;
  readonly logger: StructuredLogger;
  readonly routing: RoutingEngine;
  readonly audit: InMemoryAuditLog;
  readonly vault: EncryptedCredentialVault;
  readonly rbac: RbacService;
  readonly jwt: JwtService;
  readonly plugins: PluginRuntime;
  readonly network: DefaultNetworkService;
  readonly mcpServer: McpServer;
  readonly mcpClient: McpClient;
  readonly a2aRegistry: AgentRegistry;
  readonly a2a: A2ACoordinator;
  readonly adapters: ReturnType<typeof createDefaultAdapters>;
  readonly chatUseCase: ChatCompletionUseCase;
  readonly server: HttpServer;

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
    a2aRegistry: AgentRegistry;
    a2a: A2ACoordinator;
    adapters: ReturnType<typeof createDefaultAdapters>;
    chatUseCase: ChatCompletionUseCase;
    server: HttpServer;
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

    const mcpServer = new McpServer({
      name: 'agent-nexus-gateway',
      version: '0.1.0',
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
            properties: {
              model: { type: 'string' },
              message: { type: 'string' },
            },
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
      ],
    });

    const mcpClient = new McpClient(config.mcp.servers ?? []);
    const a2aRegistry = new AgentRegistry();
    const a2a = new A2ACoordinator(a2aRegistry);

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
    });
  }

  async start(): Promise<void> {
    await this.mcpClient.connect();
    await this.server.listen(this.config.server.port, this.config.server.host);
    this.logger.info('gateway started', {
      port: this.config.server.port,
      host: this.config.server.host,
      endpoints: this.routing.listEndpoints().length,
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

import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import { randomUUID } from 'node:crypto';

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  EmbeddingRequest,
  EventBusPort,
  ProviderAdapter,
  RoutingEnginePort,
} from '@anx/core';
import { ChatCompletionUseCase } from '@anx/core';
import type { InMemoryAuditLog } from '@anx/core';
import { BUILTIN_INTEGRATIONS, type IntegrationContext } from '@anx/integrations';
import type { InProcessTelemetry } from '@anx/observability';
import type { RbacService, JwtService, EncryptedCredentialVault } from '@anx/security';
import type { DefaultNetworkService } from '@anx/networking';
import type { McpServer } from '@anx/mcp-server';
import type { A2ACoordinator } from '@anx/a2a';
import type { PluginRuntime } from '@anx/plugins';
import type { GatewayConfig } from './config.js';

/**
 * HTTP server. Exposes:
 *   GET  /health
 *   GET  /v1/models
 *   GET  /v1/providers
 *   POST /v1/chat/completions
 *   POST /v1/embeddings
 *   GET  /metrics
 *   POST /v1/mcp             (MCP JSON-RPC over HTTP)
 *   WS   /ws                 (real-time dashboard feed)
 *   POST /v1/a2a/message     (A2A message ingestion)
 */
export interface HttpServerDeps {
  readonly config: GatewayConfig;
  readonly routing: RoutingEnginePort;
  readonly chatUseCase: ChatCompletionUseCase;
  readonly adapters: Map<string, ProviderAdapter>;
  readonly events: EventBusPort;
  readonly telemetry: InProcessTelemetry;
  readonly audit: InMemoryAuditLog;
  readonly rbac: RbacService;
  readonly jwt: JwtService;
  readonly vault: EncryptedCredentialVault;
  readonly mcpServer: McpServer;
  readonly a2a: A2ACoordinator;
  readonly plugins: PluginRuntime;
  readonly network: DefaultNetworkService;
}

export class HttpServer {
  private readonly fastify;

  constructor(private readonly deps: HttpServerDeps) {
    this.fastify = Fastify({ logger: false });
  }

  async listen(port: number, host: string): Promise<void> {
    await this.fastify.register(fastifyCors, {
      origin: this.deps.config.server.cors.origin as never,
      credentials: this.deps.config.server.cors.credentials,
    });
    await this.fastify.register(fastifyWebsocket);

    this.registerRoutes();

    await this.fastify.listen({ port, host });
  }

  async close(): Promise<void> {
    await this.fastify.close();
  }

  private registerRoutes(): void {
    // ── Health ─────────────────────────────────────────────────────────
    this.fastify.get('/health', async () => {
      const endpoints = this.deps.routing.listEndpoints();
      const healthy = endpoints.filter((e) => e.health === 'healthy').length;
      return {
        status: healthy > 0 ? 'ok' : 'degraded',
        version: '0.1.0',
        endpoints: { total: endpoints.length, healthy, degraded: endpoints.filter((e) => e.health === 'degraded').length, open: endpoints.filter((e) => e.health === 'circuit_open').length },
        uptime: process.uptime(),
      };
    });

    // ── Models (OpenAI-compatible) ─────────────────────────────────────
    this.fastify.get('/v1/models', async () => {
      const models = new Map<string, { id: string; object: 'model'; owned_by: string }>();
      for (const e of this.deps.routing.listEndpoints()) {
        const adapter = this.deps.adapters.get(e.providerId);
        const alias = e.tags[0] ?? e.providerId;
        if (!models.has(alias)) {
          models.set(alias, { id: alias, object: 'model', owned_by: e.providerId });
        }
        // Also expose the endpoint id as a model alias
        if (adapter) {
          models.set(e.id, { id: e.id, object: 'model', owned_by: e.providerId });
        }
      }
      return { object: 'list', data: Array.from(models.values()) };
    });

    // ── Providers (gateway-specific) ───────────────────────────────────
    this.fastify.get('/v1/providers', async () => {
      return this.deps.routing.listEndpoints().map((e) => ({
        id: e.id,
        providerId: e.providerId,
        displayName: e.displayName,
        health: e.health,
        priority: e.priority,
        weight: e.weight,
        region: e.region,
        tags: e.tags,
        capabilities: e.capabilities,
        pricing: e.pricing,
        updatedAt: e.updatedAt,
      }));
    });

    // ── Chat Completions (OpenAI-compatible, streaming + non-streaming)
    this.fastify.post('/v1/chat/completions', async (request, reply) => {
      const body = request.body as ChatCompletionRequest;
      if (!body?.model || !body?.messages) {
        return reply.code(400).send({ error: { message: 'model and messages are required', type: 'invalid_request_error' } });
      }

      // Optional auth: if Authorization header present, validate.
      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      await this.deps.audit.append({
        principal: principal ?? 'anonymous',
        action: 'gateway:chat',
        resource: body.model,
        result: 'allow',
        metadata: { streaming: Boolean(body.stream) },
      });

      if (body.stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders?.();

        const sink = {
          write: async (chunk: ChatCompletionChunk) => {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          },
          error: async (error: Error) => {
            reply.raw.write(`data: ${JSON.stringify({ error: { message: error.message } })}\n\n`);
            reply.raw.end();
          },
          end: async () => {
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
          },
        };

        try {
          await this.deps.chatUseCase.execute(body, sink, request.raw.signal ?? new AbortController().signal);
        } catch (err) {
          if (!reply.raw.headersSent) {
            reply.code(500).send({ error: { message: (err as Error).message } });
          } else {
            reply.raw.write(`data: ${JSON.stringify({ error: { message: (err as Error).message } })}\n\n`);
            reply.raw.end();
          }
        }
        return reply;
      }

      try {
        const response = await this.deps.chatUseCase.execute(body, undefined, request.raw.signal ?? new AbortController().signal);
        return response;
      } catch (err) {
        const code = (err as { code?: string }).code;
        const status = code === 'NO_ELIGIBLE_PROVIDER' || code === 'ALL_PROVIDERS_EXHAUSTED' ? 503 : 500;
        return reply.code(status).send({ error: { message: (err as Error).message, code } });
      }
    });

    // ── Embeddings ─────────────────────────────────────────────────────
    this.fastify.post('/v1/embeddings', async (request, reply) => {
      const body = request.body as EmbeddingRequest;
      if (!body?.model || !body?.input) {
        return reply.code(400).send({ error: { message: 'model and input are required' } });
      }
      // Resolve adapter for model
      const endpoints = this.deps.routing.listEndpoints();
      const endpoint = endpoints.find((e) => e.tags.includes(body.model) || e.id === body.model || e.providerId === body.model);
      if (!endpoint) {
        return reply.code(404).send({ error: { message: `No provider for model ${body.model}` } });
      }
      const adapter = this.deps.adapters.get(endpoint.providerId);
      if (!adapter?.embed) {
        return reply.code(501).send({ error: { message: `Provider ${endpoint.providerId} does not support embeddings` } });
      }
      try {
        const response = await adapter.embed(endpoint, body, request.raw.signal ?? new AbortController().signal);
        return response;
      } catch (err) {
        return reply.code(500).send({ error: { message: (err as Error).message } });
      }
    });

    // ── Prometheus metrics ─────────────────────────────────────────────
    this.fastify.get('/metrics', async (_req, reply) => {
      reply.header('Content-Type', 'text/plain; version=0.0.4');
      return this.deps.telemetry.prometheus();
    });

    // ── MCP (JSON-RPC over HTTP) ───────────────────────────────────────
    this.fastify.post('/v1/mcp', async (request, reply) => {
      const result = await this.deps.mcpServer.handleRequest(request.body);
      return reply.send(result);
    });

    // ── A2A message ingestion ──────────────────────────────────────────
    this.fastify.post('/v1/a2a/message', async (request, reply) => {
      const msg = request.body as { from: string; to: string; payload: unknown };
      if (!msg?.from || !msg?.to) {
        return reply.code(400).send({ error: { message: 'from and to are required' } });
      }
      // Emit as event for the coordinator to pick up.
      const result = await this.deps.a2a.request(msg.from, msg.to, msg.payload).catch((err) => {
        return { error: err.message };
      });
      return reply.send({ result });
    });

    // ── Network diagnostics ────────────────────────────────────────────
    this.fastify.get('/v1/network/diagnostics', async () => {
      return this.deps.network.diagnose();
    });

    // ── Integrations list ──────────────────────────────────────────────
    this.fastify.get('/v1/integrations', async (request) => {
      const q = request.query as { gatewayUrl?: string; apiKey?: string; defaultModel?: string };
      const ctx: IntegrationContext = {
        gatewayUrl: q.gatewayUrl ?? `http://${request.headers['host'] ?? 'localhost:8787'}`,
        apiKey: q.apiKey,
        defaultModel: q.defaultModel ?? 'gpt-4',
      };
      const results = [];
      for (const adapter of BUILTIN_INTEGRATIONS) {
        const status = await adapter.status(ctx);
        results.push({
          ...status,
          description: adapter.description,
          category: adapter.category,
          homepage: adapter.homepage,
        });
      }
      return { count: results.length, integrations: results };
    });

    // ── Audit log query ────────────────────────────────────────────────
    this.fastify.get('/v1/audit', async (request) => {
      const q = request.query as { principal?: string; action?: string; since?: string; limit?: number };
      return this.deps.audit.query({
        principal: q.principal,
        action: q.action,
        since: q.since ? new Date(q.since) : undefined,
        limit: q.limit,
      });
    });

    // ── WebSocket: real-time dashboard feed ────────────────────────────
    this.fastify.get('/ws', { websocket: true }, (socket) => {
      const unsub = this.deps.events.subscribe(
        [
          'request.received',
          'route.resolved',
          'provider.request.started',
          'provider.request.succeeded',
          'provider.request.failed',
          'failover.triggered',
          'health.changed',
          'circuit_breaker.tripped',
          'cache.hit',
          'cache.miss',
          'budget.threshold',
        ],
        (event) => {
          socket.send(JSON.stringify(event));
        },
      );
      socket.on('close', unsub);
      socket.on('error', unsub);
    });

    // ── Root: gateway info ─────────────────────────────────────────────
    this.fastify.get('/', async () => ({
      name: 'Agent Nexus Gateway',
      version: '0.1.0',
      description: 'The most advanced local AI Gateway',
      docs: '/docs',
      health: '/health',
      metrics: '/metrics',
      openapi: '/v1/openapi.json',
    }));
  }

  private async authenticate(authHeader?: string): Promise<string | undefined> {
    if (!authHeader) return undefined;
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      // Try JWT first
      const payload = this.deps.jwt.verify(token);
      if (payload?.['sub']) return payload['sub'] as string;
      // Otherwise treat as raw API key — find matching principal via hash.
      // For brevity, just return 'anonymous' here.
      return 'anonymous';
    }
    return undefined;
  }
}

export { randomUUID };

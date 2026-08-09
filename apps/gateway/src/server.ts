/* eslint-disable import/order */
import { randomUUID } from 'node:crypto';

import type { ExtensionMarketplace } from '@agent-nexus/marketplace';
import type { AIServiceMesh } from '@agent-nexus/service-mesh';
import type { A2ACoordinator, AgentRegistry as A2AAgentRegistry, TeamManager } from '@anx/a2a';
import type { AgentRegistry } from '@anx/agents';
import { ChatCompletionUseCase } from '@anx/core';
import type {
  BudgetManager,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ContextWindowManager,
  CostPredictor,
  EmbeddingRequest,
  EventBusPort,
  ModelRegistry,
  PrivacyConfig,
  ProactiveRateLimitTracker,
  PromptCompressor,
  ProviderAdapter,
  ProviderEndpoint,
  RequestTracer,
  RoutingEnginePort,
  TaskClassifier,
  CachePort,
  KeyRegistry,
} from '@anx/core';
import type { InMemoryAuditLog } from '@anx/core';
import { BUILTIN_INTEGRATIONS, type IntegrationContext } from '@anx/integrations';
import type { McpServer } from '@anx/mcp-server';
import type { DefaultMemory } from '@anx/memory';
import type { DefaultNetworkService } from '@anx/networking';
import type { InProcessTelemetry } from '@anx/observability';
import type { PluginRuntime } from '@anx/plugins';
import type { AgentRuntime } from '@anx/runtime';
import type { RbacService, JwtService, EncryptedCredentialVault } from '@anx/security';
import { hashApiKey } from '@anx/security';
import type { ExecutionPlanner } from '@anx/task-router';
import type { ToolRuntime } from '@anx/tools';
import type { WorkflowEngine } from '@anx/workflow';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';

import { AgentDetector } from './agent-detector.js';
import {
  newStreamState,
  translateAnthropicRequest,
  translateChunkToAnthropicEvents,
  translateToAnthropicResponse,
  type AnthropicRequest,
} from './anthropic-compat.js';
import { ModelAliasRegistry, type AliasRankingStrategy } from './model-aliases.js';
import { GATEWAY_VERSION } from './version.js';
import type { GatewayConfig } from './config.js';

/**
 * HTTP server. Exposes Phase 1-4 endpoints.
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
  readonly a2aRegistry: A2AAgentRegistry;
  readonly plugins: PluginRuntime;
  readonly network: DefaultNetworkService;
  // Phase 4
  readonly agents: AgentRegistry;
  readonly runtime: AgentRuntime;
  readonly workflows: WorkflowEngine;
  readonly memory: DefaultMemory;
  readonly tools: ToolRuntime;
  readonly planner: ExecutionPlanner;
  readonly teams: TeamManager;
  readonly marketplace: ExtensionMarketplace;
  readonly mesh: AIServiceMesh;
  readonly cache: CachePort;
  readonly keyRegistry: KeyRegistry;
  readonly modelRegistry: ModelRegistry;
  readonly aliasRegistry: ModelAliasRegistry;
  readonly tracer: RequestTracer;
  readonly privacy: PrivacyConfig;
  readonly agentDetector: AgentDetector;
  // Phase 5: advanced optimization features
  readonly budgetManager: BudgetManager;
  readonly promptCompressor: PromptCompressor;
  readonly rateLimitTracker: ProactiveRateLimitTracker;
  readonly taskClassifier: TaskClassifier;
  readonly contextWindowManager: ContextWindowManager;
  readonly costPredictor: CostPredictor;
}

export class HttpServer {
  private readonly fastify;

  constructor(private readonly deps: HttpServerDeps) {
    this.fastify = Fastify({ logger: false });
  }

  private reply404(msg: string): { error: { message: string; code: string } } {
    return { error: { message: msg, code: 'NOT_FOUND' } };
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
        version: GATEWAY_VERSION,
        endpoints: { total: endpoints.length, healthy, degraded: endpoints.filter((e) => e.health === 'degraded').length, open: endpoints.filter((e) => e.health === 'circuit_open').length },
        uptime: process.uptime(),
      };
    });

    // ── Models (OpenAI-compatible, enriched with discovered metadata) ───
    // Returns the union of:
    //   - Endpoints registered in the routing engine (static config)
    //   - Models dynamically discovered by the ModelRegistry (background
    //     refresh from each provider's GET /models endpoint)
    // When a discovered model has pricing/capabilities, those are included
    // so the dashboard can show "free" badges and capability icons.
    this.fastify.get('/v1/models', async (request) => {
      const q = request.query as { free?: string; capability?: string };
      const models = new Map<string, { id: string; object: 'model'; owned_by: string; pricing?: unknown; capabilities?: unknown; context_window?: number }>();

      // Static endpoint-derived models.
      for (const e of this.deps.routing.listEndpoints()) {
        const alias = e.tags[0] ?? e.providerId;
        if (!models.has(alias)) {
          models.set(alias, { id: alias, object: 'model', owned_by: e.providerId });
        }
        if (this.deps.adapters.get(e.providerId)) {
          models.set(e.id, { id: e.id, object: 'model', owned_by: e.providerId });
        }
      }

      // Dynamically discovered models (from ModelRegistry).
      let discovered = this.deps.modelRegistry.list();
      if (q.free === 'true') {
        discovered = this.deps.modelRegistry.listFree();
      } else if (q.capability) {
        discovered = this.deps.modelRegistry.listByCapability(q.capability as never);
      }
      for (const m of discovered) {
        if (m.stale) continue;
        models.set(m.id, {
          id: m.id,
          object: 'model',
          owned_by: m.providerId,
          pricing: m.pricing,
          capabilities: m.capabilities,
          context_window: m.contextWindow,
        });
      }

      return { object: 'list', data: Array.from(models.values()) };
    });

    // ── Dynamic model discovery (master prompt #5, #6) ──────────────────
    // GET /v1/models/discover  — list all discovered models with metadata
    // GET /v1/models/free     — list only free-tier models
    // GET /v1/models/stats    — discovery stats (total, free, stale, byProvider)
    // POST /v1/models/refresh — trigger an immediate refresh
    this.fastify.get('/v1/models/discover', async () => {
      return { models: this.deps.modelRegistry.list() };
    });

    this.fastify.get('/v1/models/free', async () => {
      return { models: this.deps.modelRegistry.listFree() };
    });

    this.fastify.get('/v1/models/stats', async () => {
      return this.deps.modelRegistry.stats();
    });

    this.fastify.post('/v1/models/refresh', async () => {
      // Don't await — refresh can take 15+ seconds if providers are slow.
      // Return immediately so the dashboard can poll /stats for completion.
      void this.deps.modelRegistry.refresh();
      return { ok: true, message: 'refresh started — poll /v1/models/stats for completion' };
    });

    // ── Smart model aliasing (master prompt #19, #20) ──────────────────
    // Virtual model routes: local/free, local/coding, local/best, etc.
    // resolve dynamically to the best currently-available model.
    this.fastify.get('/v1/aliases', async () => {
      return { aliases: this.deps.aliasRegistry.list() };
    });

    this.fastify.post('/v1/aliases', async (request, reply) => {
      const body = request.body as {
        alias: string;
        description?: string;
        filter: { capability?: string; freeOnly?: boolean; minContextWindow?: number; providers?: string[] };
        ranking: AliasRankingStrategy;
      };
      if (!body?.alias || !body?.filter || !body?.ranking) {
        return reply.code(400).send({ error: { message: 'alias, filter, and ranking are required' } });
      }
      try {
        this.deps.aliasRegistry.register({
          alias: body.alias,
          description: body.description ?? 'User-defined alias',
          filter: body.filter as never,
          ranking: body.ranking,
          builtin: false,
        });
        return reply.code(201).send({ ok: true });
      } catch (err) {
        return reply.code(409).send({ error: { message: (err as Error).message } });
      }
    });

    this.fastify.delete('/v1/aliases/:alias', async (request) => {
      const { alias } = request.params as { alias: string };
      const ok = this.deps.aliasRegistry.unregister(alias);
      return { ok };
    });

    // Resolve an alias without sending a request (for testing / dashboard).
    this.fastify.get('/v1/aliases/:alias/resolve', async (request, reply) => {
      const { alias } = request.params as { alias: string };
      const resolution = this.deps.aliasRegistry.resolve(alias);
      if (!resolution) {
        return reply.code(404).send({ error: { message: `Alias '${alias}' not found or no candidates match` } });
      }
      return resolution;
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

    // ── Auth: JWT issuance ─────────────────────────────────────────────
    // Exchange an API key (or valid existing JWT) for a short-lived JWT.
    // Callers then use the JWT for subsequent requests.
    this.fastify.post('/v1/auth/login', async (request, reply) => {
      const body = request.body as { apiKey?: string; principal?: string; ttlSeconds?: number } | null;
      // Resolve principal from either apiKey (preferred) or explicit principalId.
      let principalId: string | undefined;
      if (body?.apiKey) {
        principalId = this.resolvePrincipalByApiKey(body.apiKey);
      } else if (body?.principal) {
        principalId = body.principal;
      }
      if (!principalId) {
        return reply.code(401).send({ error: { message: 'Invalid credentials', code: 'AUTHENTICATION_ERROR' } });
      }
      const token = this.deps.jwt.issue({ sub: principalId }, body?.ttlSeconds ?? 3600);
      await this.deps.audit.append({
        principal: principalId,
        action: 'auth:login',
        resource: 'jwt',
        result: 'allow',
      });
      return reply.send({ token, principal: principalId, expiresIn: body?.ttlSeconds ?? 3600 });
    });

    // ── Chat Completions (OpenAI-compatible, streaming + non-streaming)
    this.fastify.post('/v1/chat/completions', async (request, reply) => {
      const body = request.body as ChatCompletionRequest;
      if (!body?.model || !body?.messages) {
        return reply.code(400).send({ error: { message: 'model and messages are required', type: 'invalid_request_error' } });
      }

      // ─── Smart model aliasing (master prompt #19, #20) ──────────────
      // If the requested model is a registered alias (e.g. `local/free`,
      // `local/coding`, `local/best`), resolve it to the best currently-
      // available concrete model based on the ModelRegistry's data.
      // The resolution happens BEFORE routing, so the routing engine sees
      // a real model id.
      const aliasResolution = this.deps.aliasRegistry.resolveIfAlias(body.model);
      const effectiveBody = aliasResolution.resolution
        ? { ...body, model: aliasResolution.model }
        : body;

      // AuthN + AuthZ. If security principals are configured, require gateway:chat.
      // If no principals are configured at all (open gateway), allow anonymous.
      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      const authz = this.requirePermission(principal, 'gateway:chat', body.model, reply);
      if (authz === 'deny') return reply;

      await this.deps.audit.append({
        principal: principal ?? 'anonymous',
        action: 'gateway:chat',
        resource: body.model,
        result: 'allow',
        metadata: {
          streaming: Boolean(body.stream),
          resolvedModel: aliasResolution.resolution?.modelId,
          aliasReason: aliasResolution.resolution?.reason,
        },
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
          await this.deps.chatUseCase.execute(effectiveBody, sink, new AbortController().signal);
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
        const response = await this.deps.chatUseCase.execute(effectiveBody, undefined, new AbortController().signal);
        return response;
      } catch (err) {
        const code = (err as { code?: string }).code;
        const status = code === 'NO_ELIGIBLE_PROVIDER' || code === 'ALL_PROVIDERS_EXHAUSTED' ? 503 : 500;
        return reply.code(status).send({ error: { message: (err as Error).message, code } });
      }
    });

    // ── Anthropic-compatible Messages API (POST /v1/messages) ──────────
    // Lets Claude Code (and other Anthropic-protocol agents) talk to the
    // gateway natively — set ANTHROPIC_BASE_URL=http://127.0.0.1:8787 and
    // ANTHROPIC_AUTH_TOKEN=<anything> and it just works.
    this.fastify.post('/v1/messages', async (request, reply) => {
      const anthropicReq = request.body as AnthropicRequest;
      if (!anthropicReq?.model || !anthropicReq?.messages || !anthropicReq?.max_tokens) {
        return reply.code(400).send({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'model, messages, and max_tokens are required' },
        });
      }

      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      const authz = this.requirePermission(principal, 'gateway:chat', anthropicReq.model, reply);
      if (authz === 'deny') return reply;

      // Translate Anthropic → internal OpenAI-compatible request.
      const internalReq = translateAnthropicRequest(anthropicReq);

      // Smart model aliasing — resolve local/free, local/coding, etc.
      const aliasResolution = this.deps.aliasRegistry.resolveIfAlias(internalReq.model);
      const effectiveReq = aliasResolution.resolution
        ? { ...internalReq, model: aliasResolution.model }
        : internalReq;

      // Streaming path: emit Anthropic-format SSE events.
      if (anthropicReq.stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders?.();

        const state = newStreamState(anthropicReq.model);
        const sink = {
          write: async (chunk: ChatCompletionChunk) => {
            for (const evt of translateChunkToAnthropicEvents(chunk, state)) {
              reply.raw.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
            }
          },
          error: async (error: Error) => {
            const errEvt = {
              type: 'error',
              error: { type: 'api_error', message: error.message },
            };
            reply.raw.write(`event: error\ndata: ${JSON.stringify(errEvt)}\n\n`);
            reply.raw.end();
          },
          end: async () => {
            reply.raw.end();
          },
        };

        try {
          await this.deps.chatUseCase.execute(effectiveReq, sink, new AbortController().signal);
        } catch (err) {
          if (!reply.raw.headersSent) {
            reply.code(500).send({
              type: 'error',
              error: { type: 'api_error', message: (err as Error).message },
            });
          } else {
            const errEvt = {
              type: 'error',
              error: { type: 'api_error', message: (err as Error).message },
            };
            reply.raw.write(`event: error\ndata: ${JSON.stringify(errEvt)}\n\n`);
            reply.raw.end();
          }
        }
        return reply;
      }

      // Non-streaming path: translate response back to Anthropic format.
      try {
        const response = await this.deps.chatUseCase.execute(effectiveReq, undefined, new AbortController().signal);
        return translateToAnthropicResponse(response, anthropicReq.model);
      } catch (err) {
        const code = (err as { code?: string }).code;
        const status = code === 'NO_ELIGIBLE_PROVIDER' || code === 'ALL_PROVIDERS_EXHAUSTED' ? 503 : 500;
        return reply.code(status).send({
          type: 'error',
          error: { type: 'api_error', message: (err as Error).message },
        });
      }
    });

    // ── Embeddings ─────────────────────────────────────────────────────
    this.fastify.post('/v1/embeddings', async (request, reply) => {
      const body = request.body as EmbeddingRequest;
      if (!body?.model || !body?.input) {
        return reply.code(400).send({ error: { message: 'model and input are required' } });
      }
      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      const authz = this.requirePermission(principal, 'gateway:embed', body.model, reply);
      if (authz === 'deny') return reply;
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
        const response = await adapter.embed(endpoint, body, new AbortController().signal);
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

    // ── Plugin management ──────────────────────────────────────────────
    this.fastify.get('/v1/plugins', async () => {
      return this.deps.plugins.list();
    });

    this.fastify.post('/v1/plugins/load', async (request, reply) => {
      const body = request.body as { id: string; source: 'inline' | 'module' | 'npm'; path?: string; config?: Record<string, unknown>; factory?: () => unknown };
      if (!body?.id || !body?.source) {
        return reply.code(400).send({ error: { message: 'id and source are required' } });
      }
      try {
        await this.deps.plugins.load({
          id: body.id,
          source: body.source,
          path: body.path,
          config: body.config,
          factory: body.factory as never,
        } as never);
        return reply.code(201).send({ ok: true });
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    this.fastify.post('/v1/plugins/:id/unload', async (request) => {
      const { id } = request.params as { id: string };
      await this.deps.plugins.unload(id);
      return { ok: true };
    });

    // ── Cache stats ────────────────────────────────────────────────────
    this.fastify.get('/v1/cache/stats', async () => {
      return this.deps.cache.stats();
    });

    // ── Request tracing (master prompt #30) ────────────────────────────
    // Every request gets a trace ID. Traces record the full routing decision:
    // requested model, resolved model (if alias), routing decision, per-attempt
    // details (endpoint, key, latency, status, error), cache hit/miss, TTFT,
    // tokens used, cost. Inspectable via /v1/traces/:id.
    this.fastify.get('/v1/traces', async (request) => {
      const q = request.query as { limit?: number; status?: string; model?: string };
      return {
        traces: this.deps.tracer.list({
          limit: q.limit ? Number(q.limit) : 100,
          status: q.status,
          model: q.model,
        }),
      };
    });

    this.fastify.get('/v1/traces/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const trace = this.deps.tracer.get(id);
      if (!trace) return reply.code(404).send(this.reply404('trace not found'));
      return trace;
    });

    this.fastify.get('/v1/traces/stats', async () => {
      return this.deps.tracer.stats();
    });

    // ── Unified adaptive router metrics (master prompt #13) ─────────────
    // Aggregates metrics across all dimensions: per-key, per-provider,
    // per-model, per-trace. Gives the adaptive router and the dashboard
    // a single endpoint to consult for routing decisions.
    this.fastify.get('/v1/metrics', async () => {
      const traces = this.deps.tracer.stats();
      const cache = this.deps.cache.stats();
      const models = this.deps.modelRegistry.stats();
      const endpoints = this.deps.routing.listEndpoints();
      const keys = this.deps.keyRegistry.listAll();

      // Per-provider breakdown.
      const byProvider: Record<string, {
        endpointCount: number;
        healthy: number;
        degraded: number;
        open: number;
        keys: number;
        activeKeys: number;
        cooldownKeys: number;
        invalidKeys: number;
        totalRequests: number;
        totalTokens: number;
        totalErrors: number;
        rateLimitedCount: number;
        avgLatencyMs: number;
      }> = {};

      for (const ep of endpoints) {
        const pid = ep.providerId;
        if (!byProvider[pid]) {
          byProvider[pid] = {
            endpointCount: 0, healthy: 0, degraded: 0, open: 0,
            keys: 0, activeKeys: 0, cooldownKeys: 0, invalidKeys: 0,
            totalRequests: 0, totalTokens: 0, totalErrors: 0, rateLimitedCount: 0,
            avgLatencyMs: 0,
          };
        }
        byProvider[pid].endpointCount++;
        if (ep.health === 'healthy') byProvider[pid].healthy++;
        else if (ep.health === 'degraded') byProvider[pid].degraded++;
        else if (ep.health === 'circuit_open') byProvider[pid].open++;
      }

      // Aggregate per-key metrics into per-provider.
      const allLatencies: number[] = [];
      let totalAllRequests = 0;
      let totalAllTokens = 0;
      let totalAllErrors = 0;
      let totalAllRateLimited = 0;

      for (const k of keys) {
        const pid = k.providerId;
        if (!byProvider[pid]) {
          byProvider[pid] = {
            endpointCount: 0, healthy: 0, degraded: 0, open: 0,
            keys: 0, activeKeys: 0, cooldownKeys: 0, invalidKeys: 0,
            totalRequests: 0, totalTokens: 0, totalErrors: 0, rateLimitedCount: 0,
            avgLatencyMs: 0,
          };
        }
        byProvider[pid].keys++;
        if (k.status === 'active') byProvider[pid].activeKeys++;
        else if (k.status === 'cooldown') byProvider[pid].cooldownKeys++;
        else if (k.status === 'invalid') byProvider[pid].invalidKeys++;
        byProvider[pid].totalRequests += k.requests;
        byProvider[pid].totalTokens += k.tokens;
        byProvider[pid].totalErrors += k.errors;
        byProvider[pid].rateLimitedCount += k.rateLimitedCount;
        if (k.latencyMs > 0) {
          allLatencies.push(k.latencyMs);
          totalAllRequests += k.requests;
          totalAllTokens += k.tokens;
          totalAllErrors += k.errors;
          totalAllRateLimited += k.rateLimitedCount;
        }
      }

      // Compute avg latency per provider.
      for (const pid of Object.keys(byProvider)) {
        const providerKeys = keys.filter((k) => k.providerId === pid && k.latencyMs > 0);
        if (providerKeys.length > 0) {
          byProvider[pid]!.avgLatencyMs = Math.round(
            providerKeys.reduce((s, k) => s + k.latencyMs, 0) / providerKeys.length,
          );
        }
      }

      // Overall success rate.
      const successRate = traces.totalTraces > 0
        ? (traces.successCount + traces.cachedCount) / traces.totalTraces
        : 1.0;

      // Tokens/sec (approximate — based on last 1000 traces' total tokens
      // divided by their total latency in seconds).
      const recentTraces = this.deps.tracer.list({ limit: 1000 });
      let totalTokens = 0;
      let totalLatencySec = 0;
      for (const t of recentTraces) {
        if (t.tokensUsed) {
          totalTokens += t.tokensUsed.total;
        }
        totalLatencySec += t.totalLatencyMs / 1000;
      }
      const tokensPerSec = totalLatencySec > 0 ? Math.round(totalTokens / totalLatencySec) : 0;

      return {
        // Aggregate trace metrics.
        requests: {
          total: traces.totalTraces,
          success: traces.successCount,
          failed: traces.failedCount,
          cached: traces.cachedCount,
          successRate: Math.round(successRate * 1000) / 10, // percentage with 1 decimal
          fallbackRate: Math.round(traces.fallbackRate * 1000) / 10,
        },
        // Latency metrics (from traces).
        latency: {
          avgMs: traces.avgLatencyMs,
          avgTtftMs: traces.avgTtftMs,
        },
        // Throughput.
        throughput: {
          tokensPerSec,
          totalTokens: totalAllTokens,
          totalRequests: totalAllRequests,
        },
        // Cache.
        cache: {
          hits: cache.hits,
          misses: cache.misses,
          size: cache.size,
          hitRate: Math.round(cache.hitRate * 1000) / 10,
        },
        // Model discovery.
        models: {
          total: models.totalModels,
          free: models.freeModels,
          stale: models.staleModels,
          byProvider: models.byProvider,
          lastRefreshAt: models.lastRefreshAt,
          refreshing: models.refreshing,
          errors: models.errors,
        },
        // Per-key aggregate.
        keys: {
          total: keys.length,
          active: keys.filter((k) => k.status === 'active').length,
          cooldown: keys.filter((k) => k.status === 'cooldown').length,
          invalid: keys.filter((k) => k.status === 'invalid').length,
          totalRequests: totalAllRequests,
          totalTokens: totalAllTokens,
          totalErrors: totalAllErrors,
          rateLimitedCount: totalAllRateLimited,
          errorRate: totalAllRequests > 0
            ? Math.round((totalAllErrors / totalAllRequests) * 1000) / 10
            : 0,
          rateLimitRate: totalAllRequests > 0
            ? Math.round((totalAllRateLimited / totalAllRequests) * 1000) / 10
            : 0,
        },
        // Per-provider breakdown.
        byProvider,
        // System.
        system: {
          uptime: process.uptime(),
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          nodeVersion: process.version,
          platform: process.platform,
        },
      };
    });

    // ── Privacy mode (master prompt #31) ───────────────────────────────
    // Returns the current privacy configuration. The level can be changed
    // at runtime via POST /v1/privacy (no restart required).
    this.fastify.get('/v1/privacy', async () => {
      return this.deps.privacy;
    });

    this.fastify.post('/v1/privacy', async (request) => {
      const body = request.body as { level?: 'off' | 'redacted' | 'strict'; maxContentChars?: number };
      if (body.level) {
        (this.deps.privacy as { level: 'off' | 'redacted' | 'strict' }).level = body.level;
        if (body.level === 'strict') {
          (this.deps.privacy as { skipCachePersistence: boolean }).skipCachePersistence = true;
        }
      }
      if (body.maxContentChars !== undefined) {
        (this.deps.privacy as { maxContentChars: number }).maxContentChars = body.maxContentChars;
      }
      return { ok: true, privacy: this.deps.privacy };
    });

    // ── Coding-agent auto-detection (master prompt #9) ─────────────────
    // Scans PATH, npm globals, and config files to detect installed coding
    // agents (Claude Code, Codex, Gemini CLI, etc.).
    this.fastify.get('/v1/agents/detect', async () => {
      const detected = await this.deps.agentDetector.detectAll();
      return {
        platform: process.platform,
        arch: process.arch,
        agents: detected,
        foundCount: detected.filter((a) => a.found).length,
        totalCount: detected.length,
      };
    });

    this.fastify.get('/v1/agents/detect/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const agent = await this.deps.agentDetector.detectById(id);
      if (!agent) return reply.code(404).send(this.reply404('agent id not recognized'));
      return agent;
    });

    // ── Budget manager (master prompt: Budget-Aware Routing) ────────────
    // GET /v1/budget        — current budget snapshot (spent, remaining,
    //                          percent used, current mode, period bounds).
    // POST /v1/budget       — update budget config at runtime. Accepts a
    //                          subset of BudgetConfig: enable (alias for
    //                          `enabled`), limitUsd, period. The mode is
    //                          recomputed on the next request.
    this.fastify.get('/v1/budget', async () => {
      return this.deps.budgetManager.getSnapshot();
    });

    this.fastify.post('/v1/budget', async (request) => {
      const body = request.body as {
        enable?: boolean;
        limitUsd?: number;
        period?: 'daily' | 'weekly' | 'monthly';
      };
      const updates: { enabled?: boolean; limitUsd?: number; period?: 'daily' | 'weekly' | 'monthly' } = {};
      if (body.enable !== undefined) updates.enabled = body.enable;
      if (body.limitUsd !== undefined) {
        if (typeof body.limitUsd !== 'number' || !isFinite(body.limitUsd) || body.limitUsd < 0) {
          return { ok: false, error: 'limitUsd must be a non-negative number' };
        }
        updates.limitUsd = body.limitUsd;
      }
      if (body.period !== undefined) {
        if (body.period !== 'daily' && body.period !== 'weekly' && body.period !== 'monthly') {
          return { ok: false, error: `period must be one of: daily, weekly, monthly (got '${body.period}')` };
        }
        updates.period = body.period;
      }
      this.deps.budgetManager.updateConfig(updates);
      return { ok: true, budget: this.deps.budgetManager.getSnapshot() };
    });

    // ── Prompt compression (master prompt: Prompt Compression) ──────────
    // GET /v1/compression   — compression stats (tokens saved, requests,
    //                          avg per request) + current config (enabled
    //                          flag — the only config field exposed via
    //                          PromptCompressor.getStats()).
    // POST /v1/compression  — update config. Accepts `enable` (boolean) and
    //                          `strategies` (a map of strategy-name → bool
    //                          toggling each individual strategy).
    this.fastify.get('/v1/compression', async () => {
      const stats = this.deps.promptCompressor.getStats();
      return {
        stats,
        config: { enabled: stats.enabled },
      };
    });

    this.fastify.post('/v1/compression', async (request) => {
      const body = request.body as {
        enable?: boolean;
        strategies?: {
          stopWordRemoval?: boolean;
          schemaCompression?: boolean;
          systemPromptDedup?: boolean;
          summarizeThreshold?: number;
        };
      };
      const updates: {
        enabled?: boolean;
        stopWordRemoval?: boolean;
        schemaCompression?: boolean;
        systemPromptDedup?: boolean;
        summarizeThreshold?: number;
      } = {};
      if (body.enable !== undefined) updates.enabled = body.enable;
      if (body.strategies) {
        if (body.strategies.stopWordRemoval !== undefined) updates.stopWordRemoval = body.strategies.stopWordRemoval;
        if (body.strategies.schemaCompression !== undefined) updates.schemaCompression = body.strategies.schemaCompression;
        if (body.strategies.systemPromptDedup !== undefined) updates.systemPromptDedup = body.strategies.systemPromptDedup;
        if (body.strategies.summarizeThreshold !== undefined) {
          if (typeof body.strategies.summarizeThreshold !== 'number' || body.strategies.summarizeThreshold < 0) {
            return { ok: false, error: 'strategies.summarizeThreshold must be a non-negative number' };
          }
          updates.summarizeThreshold = body.strategies.summarizeThreshold;
        }
      }
      this.deps.promptCompressor.updateConfig(updates);
      return { ok: true, stats: this.deps.promptCompressor.getStats() };
    });

    // ── Proactive rate-limit tracking ──────────────────────────────────
    // GET /v1/rate-limits  — returns all tracked rate-limit info keyed by
    //                          key id. Entries expire after 5 minutes.
    this.fastify.get('/v1/rate-limits', async () => {
      const limits = this.deps.rateLimitTracker.getAll();
      return {
        limits,
        count: Object.keys(limits).length,
      };
    });

    // ── Task classification ────────────────────────────────────────────
    // POST /v1/task-classify — classifies a chat completion request body
    //                          (model + messages + optional tools) and
    //                          returns the task type, confidence, signals,
    //                          complexity, and recommended model tier.
    this.fastify.post('/v1/task-classify', async (request, reply) => {
      const body = request.body as { model?: string; messages?: unknown; tools?: unknown[] };
      if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return reply.code(400).send({ error: { message: 'messages (non-empty array) is required' } });
      }
      const classification = this.deps.taskClassifier.classify({
        model: body.model ?? 'unknown',
        messages: body.messages as never,
        tools: body.tools as never,
      } as never);
      // Attach the capability requirements the routing engine would consult
      // for this task type — useful for the dashboard's model picker.
      return {
        ...classification,
        capabilityRequirements: this.deps.taskClassifier.getCapabilityRequirements(classification.type),
      };
    });

    // ── Context window manager ─────────────────────────────────────────
    // GET /v1/context-manager   — current context window config.
    // POST /v1/context-manager  — update config (blockOversized,
    //                              maxMessagesWhenTrimming, summarizeTrimmed).
    this.fastify.get('/v1/context-manager', async () => {
      return this.deps.contextWindowManager.getConfig();
    });

    this.fastify.post('/v1/context-manager', async (request) => {
      const body = request.body as {
        blockOversized?: boolean;
        maxMessagesWhenTrimming?: number;
        summarizeTrimmed?: boolean;
      };
      const updates: {
        blockOversized?: boolean;
        maxMessagesWhenTrimming?: number;
        summarizeTrimmed?: boolean;
      } = {};
      if (body.blockOversized !== undefined) updates.blockOversized = body.blockOversized;
      if (body.maxMessagesWhenTrimming !== undefined) {
        if (typeof body.maxMessagesWhenTrimming !== 'number' || body.maxMessagesWhenTrimming < 1) {
          return { ok: false, error: 'maxMessagesWhenTrimming must be a positive number' };
        }
        updates.maxMessagesWhenTrimming = body.maxMessagesWhenTrimming;
      }
      if (body.summarizeTrimmed !== undefined) updates.summarizeTrimmed = body.summarizeTrimmed;
      this.deps.contextWindowManager.updateConfig(updates);
      return { ok: true, config: this.deps.contextWindowManager.getConfig() };
    });

    // ── Cost predictor ─────────────────────────────────────────────────
    // GET /v1/cost-predictor — current cost predictor config (per-request
    //                          threshold, auto-switch flag, capability
    //                          matching flag).
    this.fastify.get('/v1/cost-predictor', async () => {
      return this.deps.costPredictor.getConfig();
    });

    // ── Multi-agent orchestration (master prompt #7) ──────────────────
    // POST /v1/orchestrate — decompose a task into subtasks, execute
    // each via the A2A coordinator, and critique the results.
    this.fastify.post('/v1/orchestrate', async (request, reply) => {
      const body = request.body as { task: string; context?: Record<string, unknown> };
      if (!body?.task) {
        return reply.code(400).send({ error: { message: 'task is required' } });
      }
      try {
        const { Orchestrator } = await import('@anx/a2a');
        const orchestrator = new Orchestrator(
          this.deps.a2aRegistry,
          this.deps.a2a,
        );
        const result = await orchestrator.orchestrate(body.task, body.context);
        return result;
      } catch (err) {
        return reply.code(500).send({ error: { message: (err as Error).message } });
      }
    });

    // ── RAG pipeline (master prompt #8) ──────────────────────────────
    // POST /v1/rag/ingest — chunk + embed + store a document
    // POST /v1/rag/retrieve — retrieve relevant chunks for a query
    this.fastify.post('/v1/rag/ingest', async (request, reply) => {
      const body = request.body as { text: string; namespace: string; source: string };
      if (!body?.text || !body?.namespace) {
        return reply.code(400).send({ error: { message: 'text and namespace are required' } });
      }
      try {
        const { RagPipeline, InMemoryVectorStore } = await import('@anx/memory');
        const rag = new RagPipeline(new InMemoryVectorStore(), null as never);
        const result = await rag.ingest(body.text, body.namespace, body.source ?? 'unknown');
        return result;
      } catch (err) {
        return reply.code(500).send({ error: { message: (err as Error).message } });
      }
    });

    this.fastify.post('/v1/rag/retrieve', async (request, reply) => {
      const body = request.body as { query: string; namespace: string };
      if (!body?.query || !body?.namespace) {
        return reply.code(400).send({ error: { message: 'query and namespace are required' } });
      }
      try {
        const { RagPipeline, InMemoryVectorStore } = await import('@anx/memory');
        const rag = new RagPipeline(new InMemoryVectorStore(), null as never);
        const result = await rag.retrieve(body.query, body.namespace);
        return result;
      } catch (err) {
        return reply.code(500).send({ error: { message: (err as Error).message } });
      }
    });

    // ── API compatibility tester (master prompt #49) ───────────────────
    // Tests a specific provider/model/key combination by issuing a tiny
    // chat completion. Returns a real report with latency, streaming
    // support, tool-calling support, and error details.
    this.fastify.post('/v1/test', async (request, reply) => {
      const body = request.body as {
        providerId: string;
        model: string;
        keyId?: string;
        tests?: ('auth' | 'chat' | 'streaming' | 'tools' | 'json')[];
      };
      if (!body?.providerId || !body?.model) {
        return reply.code(400).send({ error: { message: 'providerId and model are required' } });
      }

      const endpoint = this.deps.routing.listEndpoints().find((e) => e.providerId === body.providerId);
      if (!endpoint) {
        return reply.code(404).send({ error: { message: `No endpoint for provider '${body.providerId}'` } });
      }
      const adapter = this.deps.adapters.get(body.providerId);
      if (!adapter) {
        return reply.code(404).send({ error: { message: `No adapter for provider '${body.providerId}'` } });
      }

      // Resolve the API key.
      let apiKey: string | undefined;
      if (body.keyId) {
        apiKey = await this.deps.keyRegistry.getPlaintext(body.keyId);
        if (!apiKey) {
          return reply.code(404).send({ error: { message: `Key '${body.keyId}' not found in vault` } });
        }
      } else {
        // Try env-var fallback (adapter's getApiKey will handle this).
        apiKey = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
      }

      const testEndpoint = { ...endpoint, apiKey: apiKey ?? '' } as never;
      const tests = body.tests ?? ['auth', 'chat', 'streaming', 'tools', 'json'];
      const results: Record<string, { ok: boolean; latencyMs?: number; error?: string; detail?: unknown }> = {};

      for (const test of tests) {
        if (test === 'auth') {
          // Auth test = health check.
          const start = Date.now();
          try {
            const ok = await adapter.healthCheck(testEndpoint, AbortSignal.timeout(10_000) as never);
            results['auth'] = { ok, latencyMs: Date.now() - start };
          } catch (err) {
            results['auth'] = { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
          }
        } else if (test === 'chat') {
          const start = Date.now();
          try {
            const r = await adapter.chatCompletion(testEndpoint, {
              model: body.model,
              messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
              maxTokens: 5,
            } as never, AbortSignal.timeout(15_000) as never);
            results['chat'] = {
              ok: true,
              latencyMs: Date.now() - start,
              detail: { model: r.model, usage: r.usage },
            };
          } catch (err) {
            results['chat'] = { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
          }
        } else if (test === 'streaming') {
          const start = Date.now();
          try {
            let chunkCount = 0;
            let firstChunkMs = 0;
            for await (const _chunk of adapter.streamChatCompletion(testEndpoint, {
              model: body.model,
              messages: [{ role: 'user', content: 'Say "ok"' }],
              maxTokens: 5,
              stream: true,
            } as never, AbortSignal.timeout(15_000) as never)) {
              if (chunkCount === 0) firstChunkMs = Date.now() - start;
              chunkCount++;
              if (chunkCount > 50) break; // safety limit
            }
            results['streaming'] = {
              ok: chunkCount > 0,
              latencyMs: Date.now() - start,
              detail: { chunks: chunkCount, ttftMs: firstChunkMs },
            };
          } catch (err) {
            results['streaming'] = { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
          }
        } else if (test === 'tools') {
          const start = Date.now();
          try {
            const r = await adapter.chatCompletion(testEndpoint, {
              model: body.model,
              messages: [{ role: 'user', content: 'What is 2+2?' }],
              maxTokens: 50,
              tools: [{
                type: 'function',
                function: {
                  name: 'calculate',
                  description: 'Perform a calculation',
                  parameters: {
                    type: 'object',
                    properties: { expression: { type: 'string' } },
                    required: ['expression'],
                  },
                },
              }],
              toolChoice: 'auto',
            } as never, AbortSignal.timeout(15_000) as never);
            const hasToolCalls = !!(r.choices[0]?.message as { tool_calls?: unknown[] })?.tool_calls?.length;
            results['tools'] = {
              ok: true,
              latencyMs: Date.now() - start,
              detail: { invokedTools: hasToolCalls },
            };
          } catch (err) {
            results['tools'] = { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
          }
        } else if (test === 'json') {
          const start = Date.now();
          try {
            const r = await adapter.chatCompletion(testEndpoint, {
              model: body.model,
              messages: [{ role: 'user', content: 'Return JSON: {"ok": true}' }],
              maxTokens: 50,
              responseFormat: { type: 'json_object' },
            } as never, AbortSignal.timeout(15_000) as never);
            results['json'] = {
              ok: true,
              latencyMs: Date.now() - start,
              detail: { content: r.choices[0]?.message.content?.slice(0, 100) },
            };
          } catch (err) {
            results['json'] = { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
          }
        }
      }

      return {
        providerId: body.providerId,
        model: body.model,
        keyId: body.keyId ?? 'env-default',
        tests: results,
        summary: {
          passed: Object.values(results).filter((r) => r.ok).length,
          failed: Object.values(results).filter((r) => !r.ok).length,
          total: Object.keys(results).length,
        },
      };
    });

    // ── API key management (multi-key per provider) ───────────────────
    // List all keys, optionally filtered by provider.
    this.fastify.get('/v1/keys', async (request) => {
      const q = request.query as { provider?: string };
      const keys = q.provider
        ? this.deps.keyRegistry.listByProvider(q.provider)
        : this.deps.keyRegistry.listAll();
      // Never expose plaintext — only metadata + lastFour.
      return keys.map((k) => ({
        id: k.id,
        providerId: k.providerId,
        label: k.label,
        lastFour: k.lastFour,
        status: k.status,
        requests: k.requests,
        tokens: k.tokens,
        errors: k.errors,
        rateLimitedCount: k.rateLimitedCount,
        latencyMs: Math.round(k.latencyMs),
        lastSuccessAt: k.lastSuccessAt || null,
        lastFailureAt: k.lastFailureAt || null,
        lastFailureReason: k.lastFailureReason ?? null,
        cooldownUntil: k.cooldownUntil || null,
        registeredAt: k.registeredAt,
      }));
    });

    // Register a new API key for a provider.
    this.fastify.post('/v1/keys', async (request, reply) => {
      const body = request.body as { id?: string; providerId: string; plaintext: string; label?: string };
      if (!body?.providerId || !body?.plaintext) {
        return reply.code(400).send({ error: { message: 'providerId and plaintext are required' } });
      }
      const id = body.id ?? `${body.providerId}-key-${Date.now().toString(36)}`;
      try {
        const desc = await this.deps.keyRegistry.register({
          id,
          providerId: body.providerId,
          plaintext: body.plaintext,
          label: body.label,
        });
        // Return descriptor WITHOUT plaintext.
        return reply.code(201).send({
          id: desc.id,
          providerId: desc.providerId,
          label: desc.label,
          lastFour: desc.lastFour,
          status: desc.status,
          registeredAt: desc.registeredAt,
        });
      } catch (err) {
        return reply.code(409).send({ error: { message: (err as Error).message } });
      }
    });

    // Delete a key.
    this.fastify.delete('/v1/keys/:id', async (request) => {
      const { id } = request.params as { id: string };
      const ok = await this.deps.keyRegistry.unregister(id);
      return { ok };
    });

    // Force-reset a key's cooldown / invalid state.
    this.fastify.post('/v1/keys/:id/reset', async (request) => {
      const { id } = request.params as { id: string };
      const ok = this.deps.keyRegistry.reset(id);
      return { ok };
    });

    // Test a key by issuing a tiny chat completion against the provider.
    // Returns { ok, latencyMs, model, error? }.
    this.fastify.post('/v1/keys/:id/test', async (request, reply) => {
      const { id } = request.params as { id: string };
      const desc = this.deps.keyRegistry.get(id);
      if (!desc) return reply.code(404).send(this.reply404('key not found'));
      const plaintext = await this.deps.keyRegistry.getPlaintext(id);
      if (!plaintext) return reply.code(500).send({ error: { message: 'plaintext missing from vault' } });

      // Find an endpoint for this provider to test against.
      const endpoint = this.deps.routing.listEndpoints().find((e) => e.providerId === desc.providerId);
      if (!endpoint) {
        return reply.code(404).send({ error: { message: `No endpoint registered for provider '${desc.providerId}'` } });
      }
      const adapter = this.deps.adapters.get(desc.providerId);
      if (!adapter) {
        return reply.code(404).send({ error: { message: `No adapter for provider '${desc.providerId}'` } });
      }

      const testEndpoint = { ...endpoint, apiKey: plaintext } as never;
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const r = await adapter.chatCompletion(testEndpoint, {
            model: 'test',
            messages: [{ role: 'user', content: 'ping' }],
            maxTokens: 1,
          } as never, controller.signal);
          const latencyMs = Date.now() - start;
          this.deps.keyRegistry.recordSuccess(id, latencyMs, r.usage?.totalTokens ?? 0);
          return { ok: true, latencyMs, model: r.model };
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        const status = (err as { status?: number }).status ?? (err as { code?: string }).code ?? 'error';
        this.deps.keyRegistry.recordFailure(id, status, false);
        return reply.code(200).send({ ok: false, latencyMs: Date.now() - start, error: (err as Error).message, status });
      }
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

    // ── Marketplace (extension catalog + install) ──────────────────────
    this.fastify.get('/v1/marketplace/search', async (request) => {
      const q = request.query as {
        type?: 'plugin' | 'agent' | 'tool' | 'template';
        category?: string;
        author?: string;
        verified?: string;
        status?: string;
        keywords?: string;
      };
      const keywords = q.keywords ? q.keywords.split(',').map((k) => k.trim()).filter(Boolean) : undefined;
      const result = await this.deps.marketplace.search({
        type: q.type as never,
        category: q.category,
        author: q.author,
        verified: q.verified === 'true' ? true : q.verified === 'false' ? false : undefined,
        status: q.status as never,
        keywords,
      });
      return result;
    });

    this.fastify.get('/v1/marketplace/extensions/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const ext = await this.deps.marketplace.getExtension(id);
      if (!ext) return reply.code(404).send(this.reply404('extension not found'));
      return ext;
    });

    this.fastify.post('/v1/marketplace/extensions', async (request, reply) => {
      const body = request.body as { extension?: never };
      if (!body?.extension) return reply.code(400).send({ error: { message: 'extension is required' } });
      this.deps.marketplace.addAvailableExtension(body.extension);
      return reply.code(201).send({ ok: true });
    });

    this.fastify.post('/v1/marketplace/extensions/:id/install', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { version?: string; enableAfterInstall?: boolean; skipSignatureVerification?: boolean }) ?? {};
      try {
        const ok = await this.deps.marketplace.install(id, {
          version: body.version,
          enableAfterInstall: body.enableAfterInstall,
          skipSignatureVerification: body.skipSignatureVerification,
        });
        return reply.code(ok ? 201 : 409).send({ ok });
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    this.fastify.post('/v1/marketplace/extensions/:id/update', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { autoUpdate?: boolean; backupCurrent?: boolean }) ?? {};
      try {
        const ok = await this.deps.marketplace.update(id, {
          autoUpdate: body.autoUpdate,
          backupCurrent: body.backupCurrent,
        });
        return reply.send({ ok });
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    this.fastify.delete('/v1/marketplace/extensions/:id', async (request) => {
      const { id } = request.params as { id: string };
      await this.deps.marketplace.remove(id);
      return { ok: true };
    });

    this.fastify.get('/v1/marketplace/installed', async () => {
      return this.deps.marketplace.getInstalledExtensions();
    });

    this.fastify.get('/v1/marketplace/stats', async () => {
      return this.deps.marketplace.getStats();
    });

    // ── Service mesh (gateway-side management of mesh services) ─────────
    // Auto-register all current routing endpoints as mesh providers so the
    // mesh has something to load-balance over. This is a one-way sync from
    // routing engine → mesh; the mesh is queried independently for cross-
    // gateway traffic shaping (canary, blue-green, circuit breaker state).
    this.syncMeshFromRouting();

    this.fastify.get('/v1/mesh/services', async () => {
      return this.deps.mesh.getRegistrySnapshot();
    });

    this.fastify.get('/v1/mesh/stats', async () => {
      return this.deps.mesh.getServiceCount();
    });

    this.fastify.get('/v1/mesh/config', async () => {
      return this.deps.mesh.getConfig();
    });

    this.fastify.post('/v1/mesh/canary', async (request) => {
      const body = request.body as { percentage: number; canaryTag?: string };
      this.deps.mesh.enableCanary(body.percentage);
      return { ok: true, percentage: body.percentage };
    });

    this.fastify.delete('/v1/mesh/canary', async () => {
      this.deps.mesh.disableCanary();
      return { ok: true };
    });

    this.fastify.post('/v1/mesh/blue-green', async (request) => {
      const body = request.body as { version: 'blue' | 'green' };
      this.deps.mesh.switchBlueGreen(body.version);
      return { ok: true, active: body.version };
    });

    this.fastify.post('/v1/mesh/traffic-policy', async (request) => {
      const body = request.body as Record<string, unknown>;
      this.deps.mesh.updateTrafficPolicy(body as never);
      return { ok: true };
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

    // ─── Phase 4: Agents ───────────────────────────────────────────────
    this.fastify.get('/v1/agents', async () => {
      return this.deps.agents.list();
    });

    this.fastify.get('/v1/agents/stats', async () => {
      return this.deps.agents.stats();
    });

    this.fastify.get('/v1/agents/:id', async (request) => {
      const { id } = request.params as { id: string };
      const agent = this.deps.agents.get(id);
      if (!agent) return this.reply404('agent not found');
      return agent;
    });

    this.fastify.post('/v1/agents', async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const def = await this.deps.agents.register({
        id: body['id'] as string,
        name: body['name'] as string,
        description: body['description'] as string,
        capabilities: (body['capabilities'] as string[]) ?? [],
        tools: (body['tools'] as string[]) ?? [],
        models: (body['models'] as string[]) ?? [],
        permissions: (body['permissions'] as string[]) ?? [],
        endpoint: body['endpoint'] as string | undefined,
        tags: body['tags'] as string[] | undefined,
        concurrencyLimit: body['concurrencyLimit'] as number | undefined,
        costMultiplier: body['costMultiplier'] as number | undefined,
      });
      return reply.code(201).send(def);
    });

    this.fastify.delete('/v1/agents/:id', async (request) => {
      const { id } = request.params as { id: string };
      await this.deps.agents.unregister(id);
      return { ok: true };
    });

    // ─── Phase 4: Agent Tasks ──────────────────────────────────────────
    this.fastify.post('/v1/agents/:id/tasks', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { model: string; messages: unknown[]; systemPrompt?: string; streaming?: boolean };
      const task = {
        id: randomUUID(),
        agentId: id,
        model: body.model,
        messages: body.messages as never,
        systemPrompt: body.systemPrompt,
        streaming: body.streaming,
      };
      const result = await this.deps.runtime.executeTask(task);
      return reply.code(result.success ? 200 : 500).send(result);
    });

    // ─── Phase 4: Workflows ────────────────────────────────────────────
    this.fastify.get('/v1/workflows', async () => {
      return this.deps.workflows.list();
    });

    this.fastify.post('/v1/workflows', async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const def = await this.deps.workflows.create({
        id: body['id'] as string | undefined,
        name: body['name'] as string,
        description: body['description'] as string,
        steps: body['steps'] as never,
        inputs: body['inputs'] as never,
        outputs: body['outputs'] as never,
        tags: body['tags'] as string[] | undefined,
      });
      return reply.code(201).send(def);
    });

    this.fastify.get('/v1/workflows/:id', async (request) => {
      const { id } = request.params as { id: string };
      const def = await this.deps.workflows.get(id);
      if (!def) return this.reply404('workflow not found');
      return def;
    });

    this.fastify.post('/v1/workflows/:id/execute', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { inputs?: Record<string, unknown> }) ?? {};
      const executionId = await this.deps.workflows.start(id, body.inputs ?? {});
      return reply.code(202).send({ executionId });
    });

    this.fastify.get('/v1/workflows/:id/executions', async (request) => {
      const { id } = request.params as { id: string };
      return this.deps.workflows.listExecutions(id);
    });

    this.fastify.get('/v1/workflows/:id/executions/:executionId', async (request) => {
      const { executionId } = request.params as { executionId: string };
      return this.deps.workflows.getExecution(executionId);
    });

    this.fastify.post('/v1/workflows/:id/executions/:executionId/pause', async (request) => {
      const { executionId } = request.params as { executionId: string };
      return { ok: await this.deps.workflows.pause(executionId) };
    });

    this.fastify.post('/v1/workflows/:id/executions/:executionId/resume', async (request) => {
      const { executionId } = request.params as { executionId: string };
      return { ok: await this.deps.workflows.resume(executionId) };
    });

    this.fastify.post('/v1/workflows/:id/executions/:executionId/cancel', async (request) => {
      const { executionId } = request.params as { executionId: string };
      return { ok: await this.deps.workflows.cancel(executionId) };
    });

    this.fastify.post('/v1/workflows/:id/executions/:executionId/replay', async (request) => {
      const { executionId } = request.params as { executionId: string };
      const newId = await this.deps.workflows.replay(executionId);
      return { executionId: newId };
    });

    // ─── Phase 4: Task Router (planner) ────────────────────────────────
    this.fastify.post('/v1/plan', async (request) => {
      const body = request.body as { request: string; preferCostEffective?: boolean; preferHighQuality?: boolean };
      const planner = this.deps.planner;
      const plan = planner.plan(body.request, {
        preferCostEffective: body.preferCostEffective,
        preferHighQuality: body.preferHighQuality,
      });
      return plan;
    });

    // ─── Phase 4: Memory ───────────────────────────────────────────────
    this.fastify.post('/v1/memory/:namespace/store', async (request) => {
      const { namespace } = request.params as { namespace: string };
      const body = request.body as { data: string; scope: 'short' | 'long'; contentType?: string; metadata?: Record<string, unknown>; ttlMs?: number };
      const record = await this.deps.memory.store(body.data, {
        namespace,
        scope: body.scope,
        contentType: body.contentType,
        metadata: body.metadata,
        ttlMs: body.ttlMs,
      });
      return record;
    });

    this.fastify.post('/v1/memory/:namespace/search', async (request) => {
      const { namespace } = request.params as { namespace: string };
      const body = request.body as { query: string; scope?: 'short' | 'long'; limit?: number; threshold?: number };
      const results = await this.deps.memory.search(body.query, {
        namespace,
        scope: body.scope,
        limit: body.limit,
        threshold: body.threshold,
      });
      return { results };
    });

    this.fastify.get('/v1/memory/:namespace/list', async (request) => {
      const { namespace } = request.params as { namespace: string };
      const q = request.query as { scope?: 'short' | 'long'; limit?: number };
      const records = await this.deps.memory.list(namespace, { scope: q.scope, limit: q.limit });
      return { count: records.length, records };
    });

    this.fastify.delete('/v1/memory/:id', async (request) => {
      const { id } = request.params as { id: string };
      return { ok: await this.deps.memory.delete(id) };
    });

    // ─── Phase 4: Tools ────────────────────────────────────────────────
    this.fastify.get('/v1/tools', async () => {
      return this.deps.tools.list();
    });

    this.fastify.post('/v1/tools/:name/execute', async (request) => {
      const { name } = request.params as { name: string };
      const body = request.body as { input: Record<string, unknown>; agentId: string; taskId: string; sessionId?: string };
      const result = await this.deps.tools.execute(name, body.input, {
        agentId: body.agentId,
        taskId: body.taskId,
        sessionId: body.sessionId,
      });
      return result;
    });

    this.fastify.get('/v1/tools/log', async (request) => {
      const q = request.query as { agentId?: string; toolName?: string; limit?: number };
      return this.deps.tools.getExecutionLog(q);
    });

    // ─── Phase 4: Teams ────────────────────────────────────────────────
    this.fastify.get('/v1/teams', async () => {
      return this.deps.teams.listTeams();
    });

    this.fastify.post('/v1/teams', async (request, reply) => {
      const body = request.body as { name: string; description: string; members: Array<{ agentId: string; role: string; votingPower: number }> };
      const team = this.deps.teams.formTeam(body.name, body.description, body.members as never);
      return reply.code(201).send(team);
    });

    this.fastify.get('/v1/proposals', async () => {
      const teams = this.deps.teams.listTeams();
      const allProposals: unknown[] = [];
      for (const t of teams) {
        for (const p of this.deps.teams.listProposals(t.id)) {
          allProposals.push({ ...p, votes: Object.fromEntries(p.votes) });
        }
      }
      return allProposals;
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
          // Phase 4 events
          'agent.created',
          'agent.started',
          'agent.completed',
          'agent.failed',
          'agent.status.changed',
          'workflow.started',
          'workflow.step.started',
          'workflow.step.completed',
          'workflow.completed',
          'workflow.paused',
          'workflow.resumed',
          'memory.created',
          'memory.retrieved',
          'tool.executed',
          'team.formed',
          'team.vote',
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
      version: GATEWAY_VERSION,
      description: 'The most advanced local AI Gateway',
      docs: '/docs',
      health: '/health',
      metrics: '/metrics',
      openapi: '/v1/openapi.json',
    }));
  }

  /**
   * Resolves the principal id from an Authorization header.
   *
   * - Bearer <jwt>  → verify JWT, return sub claim
   * - Bearer <api-key> → SHA-256 hash and match against registered principals'
   *   apiKeyHash. Returns undefined if no match.
   * - Missing header → undefined (caller decides whether that's allowed).
   *
   * Previously this returned the literal string 'anonymous' for any non-JWT
   * bearer token, which silently bypassed RBAC. It now resolves real
   * principals and returns undefined when no principal matches.
   */
  /**
   * Syncs endpoints from the routing engine into the service mesh's
   * provider registry. Called once at server startup so the mesh has
   * something to load-balance over. The mesh is consulted independently of
   * the routing engine — useful when an operator wants to apply canary or
   * blue-green splits across cross-gateway traffic without touching the
   * routing engine's strategy.
   */
  private syncMeshFromRouting(): void {
    for (const e of this.deps.routing.listEndpoints()) {
      // The mesh's ProviderInstance has address+port (parsed from baseUrl)
      // plus provider-specific capability flags mirrored from the routing
      // endpoint's capabilities object.
      let address = 'localhost';
      let port = 443;
      try {
        const u = new URL(e.baseUrl || 'http://localhost:8787');
        address = u.hostname;
        port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
      } catch {
        // keep defaults
      }
      this.deps.mesh.registerProvider({
        id: e.id,
        name: e.displayName,
        address,
        port,
        status: e.health === 'healthy' ? 'healthy' : e.health === 'degraded' ? 'degraded' : 'unhealthy',
        tags: [...e.tags],
        weight: e.weight,
        lastHeartbeat: Date.now(),
        providerType: e.providerId,
        models: [...e.tags],
        streaming: e.capabilities.streaming,
        embeddings: e.capabilities.embeddings,
        vision: e.capabilities.vision,
        toolCalling: e.capabilities.toolCalling,
        metadata: { priority: String(e.priority), region: e.region ?? '' },
      });
    }
  }

  private async authenticate(authHeader?: string): Promise<string | undefined> {
    if (!authHeader) return undefined;
    if (!authHeader.startsWith('Bearer ')) return undefined;
    const token = authHeader.slice(7);
    // Try JWT first
    const payload = this.deps.jwt.verify(token);
    if (payload?.['sub']) return payload['sub'] as string;
    // Otherwise treat as a raw API key — look up by hash.
    return this.resolvePrincipalByApiKey(token);
  }

  /**
   * Returns the principal id whose stored apiKeyHash matches the SHA-256
   * of `apiKey`, or undefined if no principal matches.
   */
  private resolvePrincipalByApiKey(apiKey: string): string | undefined {
    const hash = hashApiKey(apiKey);
    for (const principal of this.deps.rbac.listPrincipals()) {
      if (principal.apiKeyHash && principal.apiKeyHash === hash) {
        return principal.id;
      }
    }
    return undefined;
  }

  /**
   * Enforces RBAC. Returns 'allow' or 'deny'. On 'deny', writes a 403 response
   * to `reply` and appends an audit-log entry. If no principals with a usable
   * API key or JWT are configured (open install), the route is allowed with
   * an anonymous principal — this preserves the zero-config developer
   * experience.
   */
  private requirePermission(
    principal: string | undefined,
    action: string,
    resource: string,
    reply: { code: (c: number) => { send: (b: unknown) => void } },
  ): 'allow' | 'deny' {
    // Only count principals that actually have an apiKeyHash — a principal
    // registered without an apiKey (e.g. the default admin principal when
    // ANX_ADMIN_API_KEY isn't set) can't authenticate, so it shouldn't trigger
    // enforcement against unauthenticated requests.
    const enforceablePrincipals = this.deps.rbac.listPrincipals().filter((p) => p.apiKeyHash);
    if (enforceablePrincipals.length === 0) {
      // Open install — no usable credentials configured. Allow anonymous access.
      return 'allow';
    }
    if (!principal) {
      void this.deps.audit.append({
        principal: 'anonymous',
        action,
        resource,
        result: 'deny',
        reason: 'missing or invalid credentials',
      });
      reply.code(401).send({ error: { message: 'Authentication required', code: 'AUTHENTICATION_ERROR' } });
      return 'deny';
    }
    if (!this.deps.rbac.authorize(principal, action, resource)) {
      void this.deps.audit.append({
        principal,
        action,
        resource,
        result: 'deny',
        reason: 'insufficient permissions',
      });
      reply.code(403).send({ error: { message: `Principal '${principal}' lacks permission '${action}'`, code: 'AUTHORIZATION_ERROR' } });
      return 'deny';
    }
    return 'allow';
  }
}

export { randomUUID };

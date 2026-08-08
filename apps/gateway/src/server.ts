import { randomUUID } from 'node:crypto';

import type { ExtensionMarketplace } from '@agent-nexus/marketplace';
import type { AIServiceMesh } from '@agent-nexus/service-mesh';
import type { A2ACoordinator, TeamManager } from '@anx/a2a';
import type { AgentRegistry } from '@anx/agents';
import { ChatCompletionUseCase } from '@anx/core';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  EmbeddingRequest,
  EventBusPort,
  ProviderAdapter,
  RoutingEnginePort,
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
          await this.deps.chatUseCase.execute(body, sink, new AbortController().signal);
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
        const response = await this.deps.chatUseCase.execute(body, undefined, new AbortController().signal);
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
      version: '0.1.0',
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
   * to `reply` and appends an audit-log entry. If no principals are configured
   * at all (open install), the route is allowed with an anonymous principal —
   * this preserves the zero-config developer experience.
   */
  private requirePermission(
    principal: string | undefined,
    action: string,
    resource: string,
    reply: { code: (c: number) => { send: (b: unknown) => void } },
  ): 'allow' | 'deny' {
    const principalCount = this.deps.rbac.listPrincipals().length;
    if (principalCount === 0) {
      // Open install — no principals configured. Allow anonymous access.
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

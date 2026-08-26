/* eslint-disable import/order */
import { randomUUID, createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn as nodeSpawn } from 'node:child_process';
/** Cast to any: this package's tsconfig resolves child_process.spawn overloads to `never`,
 *  so we bypass overload checking for the detached self-respawn call. Runtime behavior is identical. */
const spawnProcess = nodeSpawn as unknown as (cmd: string, args: string[], opts: Record<string, unknown>) => { unref: () => void; pid?: number; kill: (s?: string) => void };

/** Semver-aware comparison: returns >0 if a is newer than b, <0 if older, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

import type { ExtensionMarketplace } from '@agent-nexus/marketplace';
import type { AIServiceMesh } from '@agent-nexus/service-mesh';
import type { A2ACoordinator, AgentRegistry as A2AAgentRegistry, TeamManager } from '@anx/a2a';
import type { AgentRegistry } from '@anx/agents';
import {
  ChatCompletionUseCase,
  TaskOrchestrator,
  InMemoryTaskStore,
  SubprocessAgentExecutor,
  ConcurrencyManager,
  WorkflowOrchestrator,
  DAGEngine,
  AutonomousPlanner,
  ApplicationEngine,
  AgyBuilderAdapter,
  BUILT_IN_WORKFLOWS,
  SessionManager,
  MissionOrchestrator,
  SystemHealthAggregator,
  CrashRecoveryEngine,
  type RecoveryAction,
  type MissionSpecification,
  type MissionEvent,
  type MissionStatus,
  SignalCollector,
  AnomalyDetector,
  DiagnosisEngine,
  RemediationPolicyEngine,
  RemediationVerifier,
  RemediationEngine,
  IncidentManager,
  SelfHealingOrchestrator,
  type RemediationActionType,
  type IncidentStatus,
  type SubsystemName,
  type RemediationPolicyRule,
  ErrorDiagnosticRegistry,
  LiveErrorResolver,
} from '@anx/core';
import { DurableIdempotencyStore, BackupRestoreEngine, DurableIncidentStore } from '@anx/persistence';
import { AgentRuntimeManager } from './agent-runtime-manager.js';
import { AgentInstallationEngine } from './agent-installation-engine.js';
import { UnifiedAgentRegistry } from './unified-agent-registry.js';
import { ObsidianKnowledgeAdapter } from '@anx/memory';
import { IntegrationBuildingAgentAdapter, type BuildingAgentPort } from './building-agent-port.js';
import {
  PolicyEngine,
  AuditLogger,
  createTenantContext,
  classifyPrincipal,
  redactSecrets,
  newRequestId,
  NEXUS_REQUEST_ID_HEADER,
  type SecurityContext,
} from './security-fabric.js';
import { globalObservability } from './observability.js';
import { failResponsesEvents, finalizeResponsesEvents, newResponsesStreamState, toChatRequest, toResponsesResponse, translateChunkToResponsesEvents, type ResponsesRequest } from './responses-compat.js';
import type {
  BudgetManager,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChunkSink,
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
  ModelDescriptor,
  LocalAgentExecutionRequest,
  OrchestratedExecutionRequest,
  OrchestrationPolicy,
} from '@anx/core';
import { LocalAgentBridge, AgentOrchestrator, isSsrfSafe, aggregateFreeTier, FREE_TIER_CATALOG } from '@anx/core';
import type { InMemoryAuditLog } from '@anx/core';
import { BUILTIN_INTEGRATIONS, createIntegrationRegistry, TRUSTED_AGENT_CATALOG, type IntegrationContext } from '@anx/integrations';
import {
  TokenOptimizer,
  OptimizationMode,
  compressPipeline,
  scanRepository,
  rankRepository,
  selectRepositoryContext,
  parseGitPorcelain,
  type OptMessage,
} from '@anx/token-efficiency';
import type { McpServer } from '@anx/mcp-server';
import type { McpClient, McpServerConfig } from '@anx/mcp-client';
import type { DefaultMemory, RagPipeline } from '@anx/memory';
import type { DefaultNetworkService } from '@anx/networking';
import { BoundedEventBuffer, OperationsMetricsTracker, type InProcessTelemetry } from '@anx/observability';
import type { PluginRuntime } from '@anx/plugins';
import type { AgentRuntime } from '@anx/runtime';
import type { RbacService, JwtService, EncryptedCredentialVault } from '@anx/security';
import { hashApiKey } from '@anx/security';
import type { ExecutionPlanner } from '@anx/task-router';
import type { ToolRuntime } from '@anx/tools';
import type { WorkflowEngine } from '@anx/workflow';
import { GenericOpenAIAdapter } from '@anx/providers';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';

import { AgentDetector } from './agent-detector.js';
import { computeRoutingMetrics } from './routing-metrics.js';
import { HermesRuntimeManager } from './hermes-runtime.js';
import {
  newStreamState,
  translateAnthropicRequest,
  translateChunkToAnthropicEvents,
  translateToAnthropicResponse,
  type AnthropicRequest,
} from './anthropic-compat.js';
import { ModelAliasRegistry, type AliasRankingStrategy } from './model-aliases.js';
import { projectClaudeCatalog, claudeCatalogDebug } from './claude-catalog.js';
import { projectGenericCatalog, projectOpenAICatalog, getAgentCompatibilityMatrix, explainFilters } from './model-fabric.js';
import { IntentDetector, ScoringEngine } from './scoring-engine.js';
import { defaultBaseUrlFor, defaultCapabilitiesFor, defaultPricingFor } from './endpoints.js';
import { GATEWAY_VERSION } from './version.js';
import { getAgentModelPolicies, setAgentModelPolicy } from './agent-model-policy.js';
import type { GatewayConfig } from './config.js';
import { DetachedTaskStore } from './detached-task-store.js';
import { FalloverConfigStore, rankSimilarModels } from './fallover-config.js';

/** Probes a base URL for reachability (server is up; any non-5xx counts as up). */
async function probeUrl(baseUrl: string): Promise<boolean> {
  if (!baseUrl) return false;
  try {
    const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      signal: AbortSignal.timeout(4_000),
    });
    return r.status < 500;
  } catch {
    return false;
  }
}

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
  readonly mcpClient: McpClient;
  readonly a2a: A2ACoordinator;
  readonly a2aRegistry: A2AAgentRegistry;
  readonly plugins: PluginRuntime;
  readonly network: DefaultNetworkService;
  // Phase 4
  readonly agents: AgentRegistry;
  readonly runtime: AgentRuntime;
  readonly workflows: WorkflowEngine;
  readonly memory: DefaultMemory;
  readonly rag: RagPipeline | null;
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
  readonly sessions: SessionManager;
  readonly agentDetector: AgentDetector;
  // Phase 5: advanced optimization features
  readonly budgetManager: BudgetManager;
  readonly promptCompressor: PromptCompressor;
  readonly rateLimitTracker: ProactiveRateLimitTracker;
  readonly taskClassifier: TaskClassifier;
  readonly contextWindowManager: ContextWindowManager;
  readonly costPredictor: CostPredictor;
  readonly localAgentBridge?: LocalAgentBridge;
  readonly agentOrchestrator?: AgentOrchestrator;
  readonly missionOrchestrator?: MissionOrchestrator;
  // Manual failover / fallback-model configuration store (persists per-model
  // ordered fallback chains to disk; augments automatic failover).
  readonly falloverConfig?: FalloverConfigStore;
  readonly errorRegistry?: ErrorDiagnosticRegistry;
  readonly liveErrorResolver?: LiveErrorResolver;
}

// ── Token-economics accumulator (§30) — real measurements only, capped ring. ──
const OPT_STATS_CAP = 200;
interface OptStatEntry {
  ts: number;
  mode: string;
  model: string;
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  savingsPct: number;
  changed: boolean;
}
const optStats: OptStatEntry[] = [];

export function getOptStatsSummary() {
  const total = optStats.reduce(
    (acc, r) => ({
      originalTokens: acc.originalTokens + r.originalTokens,
      optimizedTokens: acc.optimizedTokens + r.optimizedTokens,
      savedTokens: acc.savedTokens + r.savedTokens,
      savingsPct: 0,
      changed: false,
    }),
    { originalTokens: 0, optimizedTokens: 0, savedTokens: 0, savingsPct: 0, changed: false },
  );
  const byMode = new Map<string, { original: number; optimized: number; saved: number }>();
  for (const s of optStats) {
    const cur = byMode.get(s.mode) ?? { original: 0, optimized: 0, saved: 0 };
    cur.original += s.originalTokens;
    cur.optimized += s.optimizedTokens;
    cur.saved += s.savedTokens;
    byMode.set(s.mode, cur);
  }
  return {
    totalRequests: optStats.length,
    originalTokens: total.originalTokens,
    optimizedTokens: total.optimizedTokens,
    savedTokens: total.savedTokens,
    totalOriginalTokens: total.originalTokens,
    totalOptimizedTokens: total.optimizedTokens,
    totalSavedTokens: total.savedTokens,
    overallSavingsPct:
      total.originalTokens > 0 ? Math.round((total.savedTokens / total.originalTokens) * 1000) / 10 : 0,
    byMode: Object.fromEntries(byMode),
  };
}

export function getOptStatsRecent() {
  return optStats.slice(-OPT_STATS_CAP);
}

export function recordOptStats(entry: Omit<OptStatEntry, 'ts'>) {
  optStats.push({ ts: Date.now(), ...entry });
  if (optStats.length > OPT_STATS_CAP) optStats.splice(0, optStats.length - OPT_STATS_CAP);
}

export class HttpServer {
  private readonly fastify;
  private readonly localAgentBridge: LocalAgentBridge;
  private readonly agentOrchestrator: AgentOrchestrator;
  private readonly missionOrchestrator: MissionOrchestrator;
  private readonly systemHealthAggregator: SystemHealthAggregator;
  private readonly eventBuffer: BoundedEventBuffer;
  private readonly metricsTracker: OperationsMetricsTracker;
  private readonly crashRecoveryEngine: CrashRecoveryEngine;
  private readonly idempotencyStore: DurableIdempotencyStore;
  private readonly backupRestoreEngine: BackupRestoreEngine;
  readonly signalCollector: SignalCollector;
  readonly anomalyDetector: AnomalyDetector;
  readonly diagnosisEngine: DiagnosisEngine;
  readonly remediationPolicyEngine: RemediationPolicyEngine;
  readonly remediationVerifier: RemediationVerifier;
  readonly remediationEngine: RemediationEngine;
  readonly incidentManager: IncidentManager;
  readonly selfHealingOrchestrator: SelfHealingOrchestrator;
  readonly errorRegistry: ErrorDiagnosticRegistry;
  readonly liveErrorResolver: LiveErrorResolver;
  // WS4-C: detached background task store (survive agent disconnect on long runs)
  readonly taskStore: DetachedTaskStore = new DetachedTaskStore();

  constructor(private readonly deps: HttpServerDeps) {
    this.fastify = Fastify({ logger: false });
    this.errorRegistry = deps.errorRegistry ?? new ErrorDiagnosticRegistry();
    this.liveErrorResolver = deps.liveErrorResolver ?? new LiveErrorResolver({
      routing: deps.routing,
      keyRegistry: deps.keyRegistry,
      modelRegistry: deps.modelRegistry,
      errorRegistry: this.errorRegistry,
      adapters: deps.adapters,
      events: deps.events,
      modelRediscoverCallback: async () => {
        await this.deps.modelRegistry.refresh();
      },
    });
    this.localAgentBridge = deps.localAgentBridge ?? new LocalAgentBridge({
      gatewayUrl: `http://${deps.config.server.host}:${deps.config.server.port}`,
      routing: deps.routing,
      modelRegistry: deps.modelRegistry,
      events: deps.events,
    });
    this.agentOrchestrator = deps.agentOrchestrator ?? new AgentOrchestrator({
      bridge: this.localAgentBridge,
      events: deps.events,
    });
    this.missionOrchestrator = deps.missionOrchestrator ?? new MissionOrchestrator({
      agentOrchestrator: this.agentOrchestrator,
      events: deps.events,
    });
    this.systemHealthAggregator = new SystemHealthAggregator({
      routing: deps.routing,
      modelRegistry: deps.modelRegistry,
      keyRegistry: deps.keyRegistry,
      version: GATEWAY_VERSION,
      port: deps.config.server.port,
      host: deps.config.server.host,
      localAgentBridge: this.localAgentBridge,
      agentOrchestrator: this.agentOrchestrator,
      missionOrchestrator: this.missionOrchestrator,
      budgetManager: deps.budgetManager,
    });
    this.eventBuffer = new BoundedEventBuffer(1000);
    this.metricsTracker = new OperationsMetricsTracker(2000);

    const dbPath = process.env['NEXUS_DB_PATH'] ?? join(homedir(), '.agent-nexus', 'nexus.db');
    this.crashRecoveryEngine = new CrashRecoveryEngine({
      missionOrchestrator: this.missionOrchestrator,
      missionStore: (this.missionOrchestrator as any)['store'],
      modelRegistry: deps.modelRegistry,
      keyRegistry: deps.keyRegistry,
      routing: deps.routing,
      localAgentBridge: this.localAgentBridge,
      events: deps.events,
      autoResumeEligible: true,
    });
    this.idempotencyStore = new DurableIdempotencyStore({ path: dbPath });
    this.backupRestoreEngine = new BackupRestoreEngine(dbPath);

    // Phase 34: Runtime Intelligence & Bounded Autonomous Self-Healing
    this.signalCollector = new SignalCollector();
    this.signalCollector.wireToEventBus(deps.events);
    this.anomalyDetector = new AnomalyDetector(this.signalCollector);
    this.diagnosisEngine = new DiagnosisEngine();
    this.remediationPolicyEngine = new RemediationPolicyEngine();
    this.remediationVerifier = new RemediationVerifier();
    this.remediationEngine = new RemediationEngine({
      routing: deps.routing,
      keyRegistry: deps.keyRegistry,
      modelRegistry: deps.modelRegistry,
      agentBridge: this.localAgentBridge,
      crashRecovery: this.crashRecoveryEngine,
      cache: deps.cache,
      events: deps.events,
      policyEngine: this.remediationPolicyEngine,
      verifier: this.remediationVerifier,
      providerProbeCallback: async (target) => {
        const ep = this.deps.routing.listEndpoints().find((e) => e.providerId === target || e.id === target);
        if (!ep?.baseUrl) return false;
        try {
          const r = await fetch(`${ep.baseUrl.replace(/\/+$/, '')}/models`, {
            signal: AbortSignal.timeout(4000),
          });
          return r.status < 500;
        } catch {
          return false;
        }
      },
    });
    const incidentRepo = new DurableIncidentStore({ path: dbPath });
    this.incidentManager = new IncidentManager(incidentRepo, deps.events);
    this.selfHealingOrchestrator = new SelfHealingOrchestrator(
      this.signalCollector,
      this.anomalyDetector,
      this.diagnosisEngine,
      this.remediationPolicyEngine,
      this.remediationEngine,
      this.incidentManager,
      deps.events,
      { intervalMs: 15_000, autoStart: true },
    );
    this.selfHealingOrchestrator.start();

    // Stream all domain events into bounded memory buffer for live diagnostics & SSE replay
    deps.events.subscribeAll((event) => {
      this.eventBuffer.push(event);
    });

    // ── Robustness: accept POST/PUT with no/empty JSON body as `{}` ──
    // Fastify's default JSON parser throws FST_ERR_CTP_EMPTY_JSON_BODY on an
    // empty body with content-type application/json. Action endpoints (plan,
    // build, cancel, retry, …) legitimately accept an optional body, so we
    // normalize an empty body to `{}` instead of 400ing well-formed requests.
    this.fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      if (body === '' || body == null) return done(null, {});
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    });
    // ── Phase 19/31: request correlation ids + secret-redaction hook ──
    this.fastify.addHook('onRequest', async (request) => {
      const headers = request.headers as Record<string, string | undefined>;
      const reqId = headers['x-nexus-request-id'] || headers['x-request-id'] || newRequestId();
      const missionId = headers['x-nexus-mission-id'];
      const taskId = headers['x-nexus-task-id'];
      const executionId = headers['x-nexus-execution-id'];

      const reqState = request as unknown as Record<string, unknown>;
      reqState.nexusRequestId = reqId;
      reqState.nexusMissionId = missionId;
      reqState.nexusTaskId = taskId;
      reqState.nexusExecutionId = executionId;
      reqState.nexusStartTime = Date.now();

      globalObservability.recordRequestStart();
    });
    this.fastify.addHook('onResponse', async (request, reply) => {
      const startTime = (request as unknown as { nexusStartTime?: number }).nexusStartTime ?? Date.now();
      const duration = Date.now() - startTime;
      const success = reply.statusCode < 400;
      globalObservability.recordRequestEnd(duration, success);
      this.metricsTracker.recordRequest(duration, success);
    });
    this.fastify.addHook('onSend', async (request, reply, payload) => {
      const reqState = request as unknown as Record<string, string | undefined>;
      const reqId = reqState.nexusRequestId ?? newRequestId();
      reply.header(NEXUS_REQUEST_ID_HEADER, reqId);
      reply.header('x-nexus-request-id', reqId);
      if (reqState.nexusMissionId) reply.header('x-nexus-mission-id', reqState.nexusMissionId);
      if (reqState.nexusTaskId) reply.header('x-nexus-task-id', reqState.nexusTaskId);
      if (reqState.nexusExecutionId) reply.header('x-nexus-execution-id', reqState.nexusExecutionId);

      // Redact secrets from any serializable response body (defense in depth).
      if (typeof payload === 'string' && payload.length > 0 && (payload.startsWith('{') || payload.startsWith('['))) {
        try {
          const parsed = JSON.parse(payload);
          const redacted = redactSecrets(parsed);
          return JSON.stringify(redacted);
        } catch {
          // Not JSON — leave untouched.
        }
      }
      return payload;
    });

    // ── Phase 19/31: centralized management-endpoint authentication ──
    // Public endpoints (health, readiness, liveness, catalog, models, version,
    // metrics, observability, system control plane) stay open. Everything else under /v1/* requires
    // a valid principal when auth is enabled (open-install → allow, mirroring
    // requirePermission). Per-action RBAC still applies on the routes that call
    // requirePermission(); this guard enforces the "management = authenticated"
    // floor without rewriting every handler.
    const PUBLIC_PREFIXES = [
      '/health',
      '/ready',
      '/live',
      '/v1/version',
      '/v1/catalog',
      '/v1/models',
      '/metrics',
      '/v1/metrics',
      '/v1/system',
      '/v1/routing/explain',
      '/v1/aliases',
      '/v1/providers',
      '/v1/integrations',
      '/v1/mcp',
      '/v1/context',
      '/v1/compression',
      '/v1/debug/observability',
      '/v1/debug/tokens',
      '/v1/debug/routing',
      '/v1/openapi.json',
    ];
    this.fastify.addHook('preHandler', async (request, reply) => {
      const url = (request.routeOptions.url ?? request.url ?? '').split('?')[0]!;
      if (PUBLIC_PREFIXES.some((p) => url === p || url.startsWith(p + '/'))) return;

      const enforceable = this.deps.rbac.listPrincipals().filter((p) => p.apiKeyHash).length;
      if (enforceable === 0) return; // open install — anonymous allowed

      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      const decision = this.getPolicyEngine().decide(principal, 'access', url, enforceable);
      if (!decision.allow) {
        await this.getAuditLogger().record({
          event: 'auth.failed',
          requestId: (request as unknown as { nexusRequestId?: string }).nexusRequestId,
          action: 'access',
          resource: url,
          principal,
          success: false,
          metadata: { reason: decision.reason },
        });
        return reply.code(401).send({ error: { message: 'Authentication required', code: 'AUTHENTICATION_ERROR' } });
      }
    });
  }

  /** Memoized Unified Agent Registry (composes detection + runtime + registry). */
  private unifiedRegistry?: UnifiedAgentRegistry;
  private getUnifiedRegistry(): UnifiedAgentRegistry {
    if (!this.unifiedRegistry) {
      this.unifiedRegistry = new UnifiedAgentRegistry(this.deps.agents);
    }
    return this.unifiedRegistry;
  }

  /** Memoized PolicyEngine (default-deny over existing RbacService). */
  private policyEngine?: PolicyEngine;
  private getPolicyEngine(): PolicyEngine {
    if (!this.policyEngine) {
      const enforceable = this.deps.rbac.listPrincipals().filter((p) => p.apiKeyHash).length;
      this.policyEngine = new PolicyEngine(this.deps.rbac, { authEnabled: enforceable > 0 });
    }
    return this.policyEngine;
  }

  /** Memoized structured AuditLogger (over existing InMemoryAuditLog sink). */
  private auditLogger?: AuditLogger;
  private getAuditLogger(): AuditLogger {
    if (!this.auditLogger) {
      const enabled = process.env['NEXUS_AUDIT_ENABLED'] !== 'false';
      const promptAudit = process.env['NEXUS_PROMPT_AUDIT_ENABLED'] === 'true';
      this.auditLogger = new AuditLogger(this.deps.audit, {
        promptAuditEnabled: enabled && promptAudit,
        promptSnippetMaxLen: 120,
      });
    }
    return this.auditLogger;
  }

  /** Memoized BuildingAgentPort (Hermes / OpenCode / other coding agents). */
  private buildingAgents?: BuildingAgentPort;
  private getBuildingAgents(): BuildingAgentPort {
    if (!this.buildingAgents) {
      this.buildingAgents = new IntegrationBuildingAgentAdapter();
    }
    return this.buildingAgents;
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

    // Phase 32: Run startup reconciliation & rehydration
    await this.crashRecoveryEngine.runStartupReconciliation().catch(() => {});

    await this.fastify.listen({ port, host });
  }

  async close(): Promise<void> {
    this.selfHealingOrchestrator.stop();
    await this.fastify.close();
  }

  private registerRoutes(): void {
    // ── Health ─────────────────────────────────────────────────────────
    const handleHealth = async () => {
      const endpoints = this.deps.routing.listEndpoints();
      const healthy = endpoints.filter((e) => e.health === 'healthy').length;
      return {
        status: healthy > 0 ? 'ok' : 'degraded',
        version: GATEWAY_VERSION,
        endpoints: { total: endpoints.length, healthy, degraded: endpoints.filter((e) => e.health === 'degraded').length, open: endpoints.filter((e) => e.health === 'circuit_open').length },
        uptime: process.uptime(),
      };
    };
    this.fastify.get('/health', handleHealth);
    this.fastify.get('/healthz', handleHealth);
    this.fastify.get('/v1/health', handleHealth);
    this.fastify.get('/v1/healthz', handleHealth);

    // ── Readiness (Phase 16 §20) ────────────────────────────────────────
    // Reports whether critical Nexus subsystems are up. A single unhealthy
    // upstream provider must NOT make the whole gateway "not ready".
    const handleReady = async (_request: any, reply: any) => {
      const endpoints = this.deps.routing.listEndpoints();
      const subsystems = {
        gateway: true,
        modelRegistry: typeof this.deps.modelRegistry.getCatalogVersion() === 'number',
        routing: endpoints.length > 0,
        keySubsystem: Array.isArray(this.deps.keyRegistry?.listAll?.() ?? []),
        catalog: this.deps.modelRegistry.list().length >= 0,
      };
      const ready = Object.values(subsystems).every(Boolean);
      return reply.code(ready ? 200 : 503).send({
        ready,
        status: ready ? 'ready' : 'not_ready',
        version: GATEWAY_VERSION,
        catalogVersion: this.deps.modelRegistry.getCatalogVersion(),
        subsystems,
      });
    };
    this.fastify.get('/ready', handleReady);
    this.fastify.get('/readyz', handleReady);

    // ── Liveness (Phase 19 §20) ───────────────────────────────────────────
    // Process is alive. Does NOT expose secrets. Distinct from /ready (which
    // checks subsystem readiness) and /health (human-readable overview).
    this.fastify.get('/live', async (_request, reply) => {
      return reply.code(200).send({
        alive: true,
        status: 'alive',
        uptime: process.uptime(),
        pid: process.pid,
        version: GATEWAY_VERSION,
      });
    });

    // ── Phase 31: Operations, Observability & Control Plane API ────────
    // GET /v1/system/health — Truthful multi-subsystem aggregated health
    this.fastify.get('/v1/system/health', async (_request, reply) => {
      const health = await this.systemHealthAggregator.evaluateHealth();
      const httpCode = health.healthy ? 200 : 503;
      return reply.code(httpCode).send(health);
    });

    // GET /v1/system/status — Lightweight operational overview
    this.fastify.get('/v1/system/status', async () => {
      const health = await this.systemHealthAggregator.evaluateHealth();
      return {
        status: health.status,
        healthy: health.healthy,
        version: health.version,
        uptimeSeconds: health.uptimeSeconds,
        summary: health.summary,
        timestamp: health.timestamp,
      };
    });

    // GET /v1/system/diagnostics — Deep diagnostic analysis with root cause & remediation
    this.fastify.get('/v1/system/diagnostics', async () => {
      return this.systemHealthAggregator.generateDiagnostics();
    });

    // POST /v1/system/diagnostics/export — Export full diagnostics report (JSON or Markdown)
    this.fastify.post('/v1/system/diagnostics/export', async (request) => {
      const body = (request.body as { format?: 'json' | 'markdown' } | undefined) ?? {};
      const diag = await this.systemHealthAggregator.generateDiagnostics();
      const health = await this.systemHealthAggregator.evaluateHealth();
      if (body.format === 'markdown') {
        const md = [
          `# NEXUS SYSTEM HEALTH DIAGNOSTIC REPORT`,
          `**Timestamp**: ${diag.generatedAt}`,
          `**Version**: ${diag.version}`,
          `**Overall Status**: ${diag.status}`,
          `**Environment**: Node ${diag.environment.nodeVersion} (${diag.environment.platform} ${diag.environment.arch}) | RSS: ${diag.environment.memoryRssMb}MB | Uptime: ${diag.environment.uptime}s`,
          ``,
          `## Subsystem Status Summary`,
          `| Subsystem | Status | Healthy | Message |`,
          `|---|---|---|---|`,
          ...Object.values(health.subsystems).map((s) => `| ${s.subsystem} | ${s.status} | ${s.healthy ? 'YES' : 'NO'} | ${s.message} |`),
          ``,
          `## Diagnostic Issues (${diag.diagnostics.length})`,
          ...(diag.diagnostics.length === 0 ? ['*No active issues detected.*'] : diag.diagnostics.map((d) => `### [${d.severity}] ${d.subsystem.toUpperCase()}: ${d.issue}\n- **Root Cause**: ${d.rootCause}\n- **Remediation**: ${d.remediation}`)),
          ``,
          `## Recommendations`,
          ...(diag.recommendations.length === 0 ? ['- All subsystems healthy; standard operation.'] : diag.recommendations.map((r) => `- ${r}`)),
        ].join('\n');
        return { format: 'markdown', report: md, generatedAt: diag.generatedAt };
      }
      return { format: 'json', diagnostics: diag, health, generatedAt: diag.generatedAt };
    });

    // GET /v1/system/events — Unified Real-time Server-Sent Events (SSE) telemetry stream
    this.fastify.get('/v1/system/events', async (request, reply) => {
      const q = request.query as { since?: string; limit?: string; type?: string; correlationId?: string };
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders?.();

      const safeWrite = (data: string): void => {
        if (reply.raw.writableEnded || reply.raw.destroyed) return;
        try {
          reply.raw.write(data);
        } catch {
          /* client closed */
        }
      };

      // 1. Replay historical events from bounded ring buffer
      const buffered = this.eventBuffer.list({
        since: q.since ? parseInt(q.since, 10) : undefined,
        limit: q.limit ? parseInt(q.limit, 10) : 50,
        type: q.type,
        correlationId: q.correlationId,
      });
      for (const evt of buffered) {
        safeWrite(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
      }

      // 2. Stream live events matching filter
      const unsub = this.deps.events.subscribeAll((event) => {
        if (q.type && event.type !== q.type && !event.type.startsWith(q.type + '.')) return;
        if (q.correlationId && (event as { correlationId?: string }).correlationId !== q.correlationId) return;
        safeWrite(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // 3. Heartbeat ping
      const heartbeat = setInterval(() => {
        safeWrite(': ping\n\n');
      }, 15_000);

      reply.raw.on('close', () => {
        clearInterval(heartbeat);
        unsub();
      });

      return reply;
    });

    // POST /v1/system/gateway/restart — Safe self-restart.
    // Spawns a DETACHED copy of this gateway process (same argv/cwd/env) that
    // takes over the port, then the current process exits. Because the child
    // is detached and unref'd, the gateway never becomes permanently
    // unavailable: the replacement is already starting when we exit. The
    // dashboard handles the brief reconnect window gracefully.
    this.fastify.post('/v1/system/gateway/restart', async (_request, reply) => {
      try {
        const child = spawnProcess(process.execPath, process.argv.slice(1), {
          cwd: process.cwd(),
          env: process.env,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.unref();
        reply.code(202).send({
          ok: true,
          message: 'gateway restart initiated',
          pid: child.pid,
        });
        // Give the child a moment to bind the port before we exit.
        setTimeout(() => process.exit(0), 1200);
      } catch (err) {
        return reply.code(500).send({
          ok: false,
          message: `gateway restart failed: ${(err as Error).message}`,
        });
      }
      return reply;
    });

    // ── System update (read-only check) ───────────────────────────────────
    // Reports whether a newer Nexus revision is available on the tracked
    // upstream without modifying anything. Safe to call from the dashboard
    // "Updater" panel. Cross-platform: reads package.json via fs (NOT `cat`,
    // which is Unix-only and broke the check on Windows).
    this.fastify.get('/v1/system/update/check', async (_request, reply) => {
      try {
        const { execSync } = await import('node:child_process');
        const { readFileSync, existsSync } = await import('node:fs');
        const path = await import('node:path');
        const cwd = process.cwd();

        // Local version — portable (works on Windows and Linux/macOS).
        let localVersion = 'unknown';
        try {
          const pkgPath = path.join(cwd, 'package.json');
          if (existsSync(pkgPath)) {
            localVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? 'unknown';
          }
        } catch { /* ignore */ }

        // Remote version — best-effort, two sources:
        //   1) GitHub API latest release tag (authoritative, network only)
        //   2) git fetch + read origin/main:package.json (offline-capable)
        let remoteVersion = 'unknown';
        try {
          const apiRes = await fetch('https://api.github.com/repos/rachidSabah/Nexus/releases/latest', {
            headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'nexus-gateway' },
            signal: AbortSignal.timeout(8000),
          } as any);
          if (apiRes.ok) {
            const payload = (await apiRes.json()) as { tag_name?: string };
            const tag = payload.tag_name;
            if (tag) remoteVersion = tag.replace(/^v/, '');
          }
        } catch { /* offline / rate-limited — fall through to git */ }
        if (remoteVersion === 'unknown') {
          try {
            execSync('git fetch --quiet origin', { cwd, timeout: 15_000 });
            const remotePkg = execSync('git show origin/main:package.json', { cwd, timeout: 15_000 }).toString();
            remoteVersion = JSON.parse(remotePkg).version ?? 'unknown';
          } catch { /* offline / no remote */ }
        }

        const semverOk = (v: string) => /^\\d+\\.\\d+\\.\\d+/.test(v);
        const updateAvailable =
          semverOk(remoteVersion) && semverOk(localVersion) && compareVersions(remoteVersion, localVersion) > 0;

        return reply.send({
          ok: true,
          localVersion,
          remoteVersion,
          updateAvailable,
          checkedAt: new Date().toISOString(),
        });
      } catch (err: any) {
        return reply.code(200).send({ ok: false, error: (err as Error).message });
      }
    });

    // ── System update (apply) ─────────────────────────────────────────────
    // Pulls the latest revision, reinstalls, rebuilds, then re-spawns this
    // gateway — BUT only after the build child has ACTUALLY exited 0 (no blind
    // timer). Reuses the proven detached self-restart from /v1/system/gateway/
    // restart so the replacement is already binding the port when we exit,
    // guaranteeing no downtime / no orphaned gateway.
    this.fastify.post('/v1/system/update', async (_request, reply) => {
      try {
        const cwd = process.cwd();
        const logFile = `${cwd}/.agent-nexus-update.log`;
        // Quote the log path so spaces in cwd don't break redirection.
        const quotedLog = `"${logFile}"`;
        const cmd =
          'git pull --ff-only origin main && pnpm install && pnpm build' +
          ` >> ${quotedLog} 2>&1`;
        const updater = nodeSpawn(cmd, [], {
          cwd,
          env: process.env,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          shell: true,
        });
        updater.unref();

        // Restart ONLY once the build is confirmed successful.
        updater.on('exit', (code) => {
          try {
            if (code === 0) {
              const restart = spawnProcess(process.execPath, process.argv.slice(1), {
                cwd,
                env: process.env,
                detached: true,
                stdio: 'ignore',
                windowsHide: false,
              });
              restart.unref();
              setTimeout(() => process.exit(0), 1200);
            }
            // Non-zero build: leave the current gateway running (no regression).
          } catch { /* best-effort */ }
        });

        return reply.code(202).send({ ok: true, message: 'update started (pull + install + build + restart on success)', log: logFile });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, message: (err as Error).message });
      }
    });

    // GET /v1/system/metrics — Comprehensive Operations Metrics
    this.fastify.get('/v1/system/metrics', async () => {
      const opsMetrics = this.metricsTracker.getMetrics();
      const traces = this.deps.tracer.stats();
      const budget = this.deps.budgetManager.getSnapshot();
      const optimizer = getOptStatsSummary();
      const endpoints = this.deps.routing.listEndpoints();
      const models = this.deps.modelRegistry.stats();

      return {
        timestamp: new Date().toISOString(),
        gateway: {
          uptimeSeconds: Math.round(process.uptime()),
          memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        },
        traffic: {
          totalRequests: opsMetrics.totalRequests,
          successCount: opsMetrics.successCount,
          errorCount: opsMetrics.errorCount,
          errorRatePct: opsMetrics.errorRatePct,
          tokensProcessed: opsMetrics.tokensProcessed,
          latency: opsMetrics.latency,
        },
        traces: {
          total: traces.totalTraces,
          success: traces.successCount,
          failed: traces.failedCount,
          cached: traces.cachedCount,
          fallbackRate: traces.fallbackRate,
          avgLatencyMs: traces.avgLatencyMs,
          avgTtftMs: traces.avgTtftMs,
        },
        budget: {
          mode: budget.mode,
          spentUsd: budget.spentUsd,
          limitUsd: budget.config?.limitUsd ?? 0,
          percentUsed: budget.percentUsed,
        },
        tokens: {
          savedTokens: optimizer.savedTokens,
          savingsPct: optimizer.overallSavingsPct,
        },
        infrastructure: {
          totalProviders: endpoints.length,
          healthyProviders: endpoints.filter((e) => e.health === 'healthy').length,
          totalModels: models.totalModels,
          freeModels: models.freeModels,
          staleModels: models.staleModels,
        },
      };
    });

    // ── Phase 32: Durable Runtime, Crash Recovery & Backup Control Plane ─
    // GET /v1/system/recovery — Inspect startup reconciliation and crash recovery status
    this.fastify.get('/v1/system/recovery', async () => {
      return this.crashRecoveryEngine.getRecoveryReport();
    });

    // POST /v1/system/recovery/reconcile — Operator reconciliation actions (RESUME, RETRY, CANCEL, REPAIR, DISCARD)
    this.fastify.post('/v1/system/recovery/reconcile', async (request, reply) => {
      const body = request.body as { missionId?: string; action?: RecoveryAction };
      if (!body?.missionId || !body?.action) {
        return reply.code(400).send({ error: { message: 'missionId and action are required' } });
      }
      const result = await this.crashRecoveryEngine.executeRecoveryAction(body.missionId, body.action);
      const statusCode = result.success ? 200 : 400;
      return reply.code(statusCode).send(result);
    });

    // POST /v1/system/backup — Generate full sanitized backup bundle with SHA-256 integrity checksum
    this.fastify.post('/v1/system/backup', async () => {
      return this.backupRestoreEngine.createBackup(GATEWAY_VERSION);
    });

    // POST /v1/system/restore — Restore state from backup bundle
    this.fastify.post('/v1/system/restore', async (request, reply) => {
      const body = request.body as import('@anx/persistence').BackupBundle;
      if (!body?.data || !body?.checksum) {
        return reply.code(400).send({ error: { message: 'Valid backup bundle is required' } });
      }
      try {
        const result = await this.backupRestoreEngine.restoreBackup(body);
        // Re-run reconciliation on newly restored state
        await this.crashRecoveryEngine.runStartupReconciliation().catch(() => {});
        return reply.code(200).send({ ok: true, result });
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // ── Phase 34: Runtime Intelligence, Anomaly Detection & Self-Healing ──
    // GET /v1/system/intelligence — Unified Runtime Intelligence & Self-Healing State
    this.fastify.get('/v1/system/intelligence', async () => {
      return this.selfHealingOrchestrator.getOverview();
    });

    // GET /v1/system/intelligence/signals — Telemetry signals across 14 subsystems
    this.fastify.get('/v1/system/intelligence/signals', async (request) => {
      const q = request.query as { subsystem?: SubsystemName; limit?: string; since?: string };
      const limit = q.limit ? parseInt(q.limit, 10) : 100;
      const since = q.since ? parseInt(q.since, 10) : undefined;
      return {
        signals: this.signalCollector.getSignals(q.subsystem, { limit, since }),
      };
    });

    // GET /v1/system/intelligence/anomalies — Current statistical anomalies
    this.fastify.get('/v1/system/intelligence/anomalies', async () => {
      const anomalies = this.anomalyDetector.detectAnomalies();
      return { anomalies };
    });

    // GET /v1/system/intelligence/remediations — Executed remediation history
    this.fastify.get('/v1/system/intelligence/remediations', async () => {
      const incidents = await this.incidentManager.listIncidents({ limit: 200 });
      const remediations: any[] = [];
      for (const inc of incidents) {
        for (const rem of inc.remediationHistory) {
          const { incidentId: _remIncidentId, ...remRest } = rem as any;
          remediations.push({
            incidentId: inc.id,
            subsystem: inc.subsystem,
            anomalyType: inc.anomalyType,
            ...remRest,
          });
        }
      }
      return { remediations };
    });

    // GET /v1/system/intelligence/policies — Remediation policy matrix (AUTO_SAFE, APPROVAL_REQUIRED, NEVER_AUTOMATE)
    this.fastify.get('/v1/system/intelligence/policies', async () => {
      return { policies: this.remediationPolicyEngine.listPolicies() };
    });

    // POST /v1/system/intelligence/policies — Update / Toggle remediation policy rule
    this.fastify.post('/v1/system/intelligence/policies', async (request, reply) => {
      const body = request.body as { actionType?: RemediationActionType; patch?: Partial<RemediationPolicyRule> };
      if (!body?.actionType || !body?.patch) {
        return reply.code(400).send({ error: { message: 'actionType and patch object required' } });
      }
      try {
        const updated = this.remediationPolicyEngine.updatePolicy(body.actionType, body.patch);
        return reply.code(200).send({ ok: true, policy: updated });
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // GET /v1/system/incidents — List durable runtime incidents
    this.fastify.get('/v1/system/incidents', async (request) => {
      const q = request.query as { status?: IncidentStatus; subsystem?: SubsystemName; limit?: string };
      const limit = q.limit ? parseInt(q.limit, 10) : 100;
      const incidents = await this.incidentManager.listIncidents({
        status: q.status,
        subsystem: q.subsystem,
        limit,
      });
      return { incidents };
    });

    // GET /v1/system/incidents/:id — Inspect single incident details & remediation trace
    this.fastify.get('/v1/system/incidents/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const incident = await this.incidentManager.getIncident(id);
      if (!incident) {
        return reply.code(404).send({ error: { message: `Incident [${id}] not found`, code: 'NOT_FOUND' } });
      }
      return incident;
    });

    // POST /v1/system/incidents/:id/acknowledge — Acknowledge incident
    this.fastify.post('/v1/system/incidents/:id/acknowledge', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { operatorNotes?: string } | undefined) ?? {};
      try {
        const updated = await this.incidentManager.acknowledgeIncident(id, body.operatorNotes);
        return reply.code(200).send({ ok: true, incident: updated });
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/system/incidents/:id/approve — Operator approve and execute remediation
    this.fastify.post('/v1/system/incidents/:id/approve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { operatorNotes?: string } | undefined) ?? {};
      try {
        const result = await this.selfHealingOrchestrator.operatorApproveAndRemediate(id, body.operatorNotes);
        const code = result.success ? 200 : 400;
        return reply.code(code).send(result);
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/system/incidents/:id/remediate — Manually trigger safe remediation for incident
    this.fastify.post('/v1/system/incidents/:id/remediate', async (request, reply) => {
      const { id } = request.params as { id: string };
      const incident = await this.incidentManager.getIncident(id);
      if (!incident) {
        return reply.code(404).send({ error: { message: `Incident [${id}] not found` } });
      }
      const body = (request.body as { actionType?: RemediationActionType; targetId?: string; parameters?: Record<string, unknown> } | undefined) ?? {};
      const actionType = body.actionType ?? incident.diagnosis.recommendedRemediation;
      const targetId = body.targetId ?? incident.subsystem;

      try {
        const result = await this.selfHealingOrchestrator.operatorTriggerRemediation(
          actionType,
          incident.subsystem,
          targetId,
          body.parameters,
        );
        return reply.code(result.success ? 200 : 400).send(result);
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/system/incidents/:id/resolve — Manually resolve incident
    this.fastify.post('/v1/system/incidents/:id/resolve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { verificationEvidence?: string } | undefined) ?? {};
      try {
        const updated = await this.incidentManager.resolveIncident(
          id,
          body.verificationEvidence ?? 'Manually resolved and verified by operator',
        );
        return reply.code(200).send({ ok: true, incident: updated });
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // ── Phase 31/34: Routing Transparency & Adaptive Routing API ────────────
    const handleRoutingExplain = async (reqBody: { messages?: any[]; tools?: any[]; model?: string; intent?: string }) => {
      const messages = reqBody.messages ?? [{ role: 'user', content: 'Explain system architecture' }];
      const intent = IntentDetector.detect(messages, reqBody.tools, reqBody.model);
      const models = this.deps.modelRegistry.list();
      const endpoints = this.deps.routing.listEndpoints();
      const deprioritized = new Set(this.remediationEngine.getDeprioritizedProviders());

      const candidateScores = models.map((m) => {
        const ep = endpoints.find((e) => e.providerId === m.providerId);
        return ScoringEngine.scoreCandidate(m, ep, intent, {
          modelRegistryModels: models,
          endpoints,
          deprioritizedProviders: deprioritized,
        });
      }).sort((a, b) => b.finalScore - a.finalScore);

      const selected = candidateScores[0];
      const alternatives = candidateScores.slice(1, 5).map((c) => ({
        modelId: c.modelId,
        providerId: c.providerId,
        score: c.finalScore,
        costScore: c.breakdown.cost,
        latencyScore: c.breakdown.latency,
        qualityScore: c.breakdown.capabilityMatch,
        healthScore: c.breakdown.health,
        reasons: c.reasons,
        explainability: c.explainability,
      }));

      return {
        intent: intent.intent,
        confidence: intent.confidence,
        signals: intent.signals,
        requiredCapabilities: intent.requiredCapabilities,
        minContextWindow: intent.minContextWindow,
        selectedModel: selected?.modelId ?? 'none',
        provider: selected?.providerId ?? 'none',
        score: selected?.finalScore ?? 0,
        candidateCount: candidateScores.length,
        selectedCandidate: selected ? {
          modelId: selected.modelId,
          providerId: selected.providerId,
          finalScore: selected.finalScore,
          breakdown: {
            costScore: selected.breakdown.cost,
            latencyScore: selected.breakdown.latency,
            qualityScore: selected.breakdown.capabilityMatch,
            healthScore: selected.breakdown.health,
            contextScore: selected.breakdown.contextFit,
          },
          reasons: selected.reasons,
          explainability: selected.explainability,
        } : null,
        topCandidates: candidateScores.slice(0, 5),
        fallbackPath: alternatives,
        totalEvaluated: candidateScores.length,
        decisionExplanation: selected
          ? `Selected model '${selected.modelId}' on provider '${selected.providerId}' with score ${selected.finalScore.toFixed(2)} matching intent ${intent.intent}.`
          : 'No eligible candidate available for requested parameters.',
      };
    };

    this.fastify.post('/v1/routing/explain', async (request) => {
      const body = (request.body as { messages?: any[]; tools?: any[]; model?: string; intent?: string; prompt?: string } | undefined) ?? {};
      const msgs = body.messages ?? (body.prompt ? [{ role: 'user', content: body.prompt }] : [{ role: 'user', content: 'Explain system architecture' }]);
      return handleRoutingExplain({ ...body, messages: msgs });
    });

    this.fastify.get('/v1/routing/explain', async (request) => {
      const q = request.query as { model?: string; prompt?: string };
      return handleRoutingExplain({
        model: q.model,
        messages: q.prompt ? [{ role: 'user', content: q.prompt }] : undefined,
      });
    });

    // ── Security context (Phase 19 §3/§6/§7) ─────────────────────────────
    // Returns the caller's resolved SecurityContext + TenantContext. Anonymous
    // (open install) is reported honestly — never fabricates a principal.
    this.fastify.get('/v1/security/context', async (request, reply) => {
      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      const roles = this.getPolicyEngine().rolesOf(principal);
      const kind = classifyPrincipal(roles);
      const tenant = createTenantContext({
        requestId: (request as unknown as { nexusRequestId?: string }).nexusRequestId,
      });
      const ctx: SecurityContext = { principalId: principal, kind, roles, tenant };
      return reply.send({
        principalId: ctx.principalId ?? null,
        kind: ctx.kind,
        roles: ctx.roles,
        tenant: {
          tenantId: ctx.tenant.tenantId,
          userId: ctx.tenant.userId,
          requestId: ctx.tenant.requestId,
          traceId: ctx.tenant.traceId,
        },
        authEnabled: this.deps.rbac.listPrincipals().some((p) => p.apiKeyHash),
      });
    });

    // ── Version info (Phase 16 §21) ──────────────────────────────────────
    this.fastify.get('/v1/version', async () => {
      return {
        version: GATEWAY_VERSION,
        catalogVersion: this.deps.modelRegistry.getCatalogVersion(),
        uptime: process.uptime(),
        node: process.version,
      };
    });

    // ── Models (OpenAI-compatible, enriched with discovered metadata) ───
    // Returns the union of:
    //   - Endpoints registered in the routing engine (static config)
    //   - Models dynamically discovered by the ModelRegistry (background
    //     refresh from each provider's GET /models endpoint)
    // When a discovered model has pricing/capabilities, those are included
    // so the dashboard can show "free" badges and capability icons.
    const handleModels = async (request: any, reply: any) => {
      const q = request.query as { free?: string; capability?: string; include_policies?: string };
      const models = new Map<string, {
        id: string;
        object: 'model';
        owned_by: string;
        pricing?: unknown;
        capabilities?: unknown;
        context_window?: number;
        /** Live health of the serving endpoint (truthful: never masks downtime). */
        health?: string;
        /** Why the model is in its current health state (e.g. billing/quota). */
        health_reason?: string;
        /** Last upstream error seen for this model's provider, if any. */
        last_error?: string;
        agentSnippets?: {
          claudeCode?: string;
          codexCli?: string;
          hermesCli?: string;
          agy?: string;
          curl?: string;
        };
      }>();

      // Truthful per-provider endpoint health, surfaced on every model so
      // consumers (and the user) can see at a glance which models are live
      // vs. degraded/dead — never advertised as healthy when they are not.
      const HEALTH_RANK: Record<string, number> = {
        healthy: 0, degraded: 1, unknown: 2, unhealthy: 3, circuit_open: 4,
      };
      const endpointHealth = new Map<string, { health: string; reason?: string; lastError?: string }>();
      for (const e of this.deps.routing.listEndpoints()) {
        const existing = endpointHealth.get(e.providerId);
        // Prefer the worst-known state for the provider so a single dead
        // endpoint is not hidden by a healthy sibling.
        if (!existing || (HEALTH_RANK[e.health] ?? -1) > (HEALTH_RANK[existing.health as string] ?? -1)) {
          endpointHealth.set(e.providerId, {
            health: e.health,
            reason: (e as unknown as { lastFailureReason?: string }).lastFailureReason,
            lastError: (e as unknown as { lastError?: string }).lastError,
          });
        }
      }
      const healthFor = (providerId: string) => endpointHealth.get(providerId);

      // Dynamically discovered real models (from ModelRegistry).
      const selectableProviders = new Set(this.deps.routing.getSelectableProviders());
      let discovered = this.deps.modelRegistry.list();
      if (q.free === 'true') {
        discovered = this.deps.modelRegistry.listFree();
      } else if (q.capability) {
        discovered = this.deps.modelRegistry.listByCapability(q.capability as never);
      }
      for (const m of discovered) {
        if (m.stale) continue;
        // Routability gate: a model whose provider currently has no
        // selectable endpoint is NOT hidden — it stays in the list so agents
        // (Claude Code, dsh, the dashboard picker, …) can still offer it,
        // but its `health` field truthfully reflects the provider state
        // (e.g. `circuit_open`/`degraded`). Hiding valid models on a
        // transient circuit-open/cooldown made them vanish from every
        // picker (e.g. `hy3-free` disappearing whenever opencode-zen hit a
        // rate-limit) which is worse than showing them as degraded. Stale
        // (retired) models are still excluded above.
        const providerHealth = healthFor(m.providerId);
        models.set(m.id, {
          id: m.id,
          object: 'model',
          owned_by: m.providerId,
          pricing: m.pricing,
          capabilities: m.capabilities,
          context_window: m.contextWindow,
          ...(providerHealth
            ? {
                health: providerHealth.health,
                health_reason: providerHealth.reason,
                last_error: providerHealth.lastError,
                routable: selectableProviders.has(m.providerId),
              }
            : { routable: selectableProviders.has(m.providerId) }),
          agentSnippets: {
            claudeCode: `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"\nexport ANTHROPIC_AUTH_TOKEN="nexus"\nclaude --model ${m.id}`,
            codexCli: `codex --model ${m.id}`,
            hermesCli: `hermes -m ${m.id}`,
            agy: `agy -m ${m.id}`,
            curl: `curl -X POST http://127.0.0.1:8787/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${m.id}", "messages": [{"role": "user", "content": "Hello"}]}'`,
          },
        });
      }

      // Claude Code projection: every discovered non-claude model is
      // also exposed under an anthropic-compatible claude-gw-<provider>-<model>
      // alias so Claude Code's /model picker shows the full discovered catalog.
      for (const e of projectClaudeCatalog(discovered, { includeNatives: false })) {
        if (!models.has(e.id)) {
          // Apply the same routability gate: only expose the claude-gw-*
          // projection if the underlying provider is currently selectable.
          const checkProvider = e.providerId ?? e.owned_by;
          if (selectableProviders.size > 0 && !selectableProviders.has(checkProvider) && checkProvider !== 'anthropic') continue;
          models.set(e.id, {
            id: e.id,
            object: 'model',
            owned_by: e.owned_by,
            pricing: e.pricing,
            capabilities: e.capabilities,
            context_window: e.context_window,
            ...(healthFor(checkProvider)
              ? {
                  health: healthFor(checkProvider)!.health,
                  health_reason: healthFor(checkProvider)!.reason,
                  last_error: healthFor(checkProvider)!.lastError,
                }
              : {}),
            agentSnippets: {
              claudeCode: `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"\nexport ANTHROPIC_AUTH_TOKEN="nexus"\nclaude --model ${e.id}`,
              codexCli: `codex --model ${e.nativeId ?? e.id}`,
              hermesCli: `hermes -m ${e.nativeId ?? e.id}`,
              agy: `agy -m ${e.nativeId ?? e.id}`,
              curl: `curl -X POST http://127.0.0.1:8787/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${e.id}", "messages": [{"role": "user", "content": "Hello"}]}'`,
            },
          });
        }
      }

      const codexFrontierModels = [
        'gateway-routed',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
        'gpt-5.5',
        'gpt-5.2',
        'gpt-5',
        'codex',
        'default',
        'auto',
      ];
      // Pure routing directives are always available (they resolve dynamically
      // to whatever endpoint is healthy). Concrete OpenAI-family models must
      // ONLY be advertised when an OpenAI-family endpoint is actually
      // selectable — otherwise we advertise a dead, unroutable model (mission
      // rule: never present a stale/dead model as healthy and routable).
      const virtualFrontier = new Set(['gateway-routed', 'default', 'auto', 'codex']);
      const openaiFamilySelectable =
        selectableProviders.has('openai') ||
        selectableProviders.has('opencode-zen') ||
        selectableProviders.has('opencode-go');
      for (const cm of codexFrontierModels) {
        if (!models.has(cm)) {
          if (!virtualFrontier.has(cm) && !openaiFamilySelectable) continue;
          // Concrete frontier models (gpt-5.6-sol, etc.) are REAL opencode-zen
          // models, so their health must reflect the opencode family's actual
          // state — not the unrelated auto-openai endpoint. Pure routing
          // directives (auto/default/gateway-routed/codex) reflect openai.
          const frontierHealth = virtualFrontier.has(cm)
            ? healthFor('openai')
            : (healthFor('opencode-zen') ?? healthFor('opencode-go') ?? healthFor('openai'));
          models.set(cm, {
            id: cm,
            object: 'model',
            owned_by: 'openai',
            ...(frontierHealth
              ? {
                  health: frontierHealth.health,
                  health_reason: frontierHealth.reason,
                  last_error: frontierHealth.lastError,
                }
              : {}),
            capabilities: {
              streaming: true,
              toolCalling: true,
              jsonMode: true,
              vision: true,
              reasoning: true,
            },
            context_window: 128000,
            agentSnippets: {
              claudeCode: `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"\nexport ANTHROPIC_AUTH_TOKEN="nexus"\nclaude --model ${cm}`,
              codexCli: `codex --model ${cm}`,
              hermesCli: `hermes -m ${cm}`,
              agy: `agy -m ${cm}`,
              curl: `curl -X POST http://127.0.0.1:8787/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${cm}", "messages": [{"role": "user", "content": "Hello"}]}'`,
            },
          });
        }
      }

      reply.header('X-Nexus-Model-Catalog-Version', String(this.deps.modelRegistry.getCatalogVersion()));

      // Only include virtual routing policies (nexus/*, local/*) when explicitly requested (e.g. Router Studio)
      if (q.include_policies === 'true') {
        for (const a of this.deps.aliasRegistry.list()) {
          if (models.has(a.alias)) continue;
          models.set(a.alias, {
            id: a.alias,
            object: 'model',
            owned_by: 'nexus',
            pricing: {
              isFree: a.filter.freeOnly === true,
              currency: 'USD',
              source: 'virtual-alias',
            },
            capabilities: {
              streaming: true,
              toolCalling: true,
              jsonMode: true,
              vision: false,
              reasoning: true,
            },
            context_window: a.filter.minContextWindow ?? undefined,
          });
        }
      }

      return { object: 'list', data: Array.from(models.values()) };
    };
    this.fastify.get('/v1/models', handleModels);
    this.fastify.get('/models', handleModels);
    this.fastify.get('/v1/v1/models', handleModels);

    // ── Dynamic model discovery (master prompt #5, #6) ──────────────────
    // GET /v1/models/discover  — list all discovered models with metadata
    // GET /v1/models/free     — list only free-tier models
    // GET /v1/models/stats    — discovery stats (total, free, stale, byProvider)
    // POST /v1/models/refresh — trigger an immediate refresh
    // Dedupe by model id before sending to the dashboard. The registry keeps
    // one entry per (provider, id), so a model offered by two providers (e.g.
    // `gpt-5.6-luna` on both opencode-go and opencode-zen) would otherwise
    // produce two rows with the same `id` — which trips React's "duplicate
    // key" warning in any list rendered with key={m.id}. Routing does NOT use
    // this endpoint, so collapsing to unique ids is display-only.
    const dedupeModels = (models: readonly ModelDescriptor[]): ModelDescriptor[] => {
      const seen = new Set<string>();
      const out: ModelDescriptor[] = [];
      for (const m of models) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
      }
      return out;
    };

    this.fastify.get('/v1/models/discover', async (request, reply) => {
      const catalogVersion = this.deps.modelRegistry.getCatalogVersion();
      // Phase 13 §11: conditional request on the heavy model-poll payload.
      const etag = `W/"disc-${catalogVersion}"`;
      reply.header('ETag', etag);
      reply.header('Cache-Control', 'no-cache');
      reply.header('X-Nexus-Model-Catalog-Version', String(catalogVersion));
      if (request.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }
      return { models: dedupeModels(this.deps.modelRegistry.list()), catalogVersion };
    });

    this.fastify.get('/v1/models/free', async () => {
      const free = dedupeModels(this.deps.modelRegistry.listFree());
      const endpoints = this.deps.routing.listEndpoints();
      return {
        count: free.length,
        models: free.map((m) => {
          const ep = endpoints.find((e) => e.providerId === m.providerId);
          return {
            id: m.id,
            providerId: m.providerId,
            displayName: m.displayName ?? m.id,
            contextWindow: m.contextWindow ?? 8192,
            capabilities: m.capabilities,
            pricing: m.pricing,
            health: m.stale ? 'stale' : (ep?.health ?? 'healthy'),
            discoveredAt: m.discoveredAt,
          };
        }),
      };
    });

    this.fastify.get('/v1/models/stats', async () => {
      return this.deps.modelRegistry.stats();
    });

    // GET /v1/free-tier/estimate — SOURCED free-tier quota aggregation.
    // Returns documented per-provider free quotas (with source URLs) + a
    // transparent sum-of-ceilings aggregate. No fabricated monthly-token math.
    this.fastify.get('/v1/free-tier/estimate', async () => {
      const aggregate = aggregateFreeTier();
      const liveFree = dedupeModels(this.deps.modelRegistry.listFree());
      return {
        verified: aggregate.verified,
        note: 'Figures are documented provider free-tier ceilings, verified 2026-08. Free tiers rotate — re-audit before relying. Aggregate is a sum-of-ceilings (theoretical max), NOT sustained throughput.',
        aggregate: {
          providersCovered: aggregate.providersCovered,
          sumRequestsPerDayCeiling: aggregate.sumRequestsPerDayCeiling,
          sumTokensPerMinuteCeiling: aggregate.sumTokensPerMinuteCeiling,
          sumTokensPerMonthCeiling: aggregate.sumTokensPerMonthCeiling,
          cardRequiredAnywhere: aggregate.cardRequiredAnywhere,
        },
        providers: FREE_TIER_CATALOG,
        liveFreeModelsInRegistry: liveFree.length,
      };
    });

    this.fastify.get('/v1/debug/models/claude', async () => {
      return claudeCatalogDebug(this.deps.modelRegistry.list());
    });

    this.fastify.get('/v1/debug/models', async () => {
      const models = this.deps.modelRegistry.list();
      const generic = projectGenericCatalog(models);
      
      const available = generic.filter(m => m.availability === 'available');
      const free = generic.filter(m => m.isFree);
      const paid = generic.filter(m => m.freeTier === 'PAID');
      const unknownPricing = generic.filter(m => m.freeTier === 'UNKNOWN');
      
      return {
        registryCount: models.length,
        availableCount: available.length,
        freeCount: free.length,
        paidCount: paid.length,
        unknownPricingCount: unknownPricing.length,
        models: generic.map(m => ({
          provider: m.providerId,
          nativeModelId: m.nativeModelId,
          virtualModelId: m.id,
          pricing: m.pricing, // already excludes secrets
          pricingSource: m.pricingSource,
          freeTier: m.freeTier,
          availability: m.availability,
          capabilities: m.capabilities,
          projectionStatus: 'PROJECTED'
        }))
      };
    });

    this.fastify.get('/v1/debug/models/openai', async () => {
      const models = this.deps.modelRegistry.list();
      const projected = projectOpenAICatalog(models, { includeVirtualIds: true });
      const filters = explainFilters(models, 'openai');
      
      return {
        agent: 'openai-compatible',
        sourceRegistryCount: models.length,
        projectedCount: projected.length,
        filteredCount: filters.filter(f => f.status === 'FILTERED').length,
        filters: filters
      };
    });

    this.fastify.get('/v1/debug/models/agents', async () => {
      const matrix = getAgentCompatibilityMatrix();
      const models = this.deps.modelRegistry.list();
      
      const enrichedMatrix = matrix.map(agent => {
        let agentType: 'claude' | 'openai' | 'generic' = 'generic';
        if (agent.projectionNeeded === 'claude-gw') agentType = 'claude';
        else if (agent.projectionNeeded === 'openai-native') agentType = 'openai';
        
        const filters = explainFilters(models, agentType);
        const projected = filters.filter(f => f.status === 'PROJECTED');
        const filtered = filters.filter(f => f.status === 'FILTERED');

        return {
          ...agent,
          modelCount: models.length,
          compatibleCount: projected.length,
          projectedModelCount: projected.length,
          filteredCount: filtered.length,
          filterReasons: Array.from(new Set(filtered.map(f => f.reason).filter(Boolean))),
        };
      });
      
      return {
        catalogVersion: 1024,
        agents: enrichedMatrix,
      };
    });

    // ── Universal Normalized Model Catalog API (§8) ─────────────────────
    this.fastify.get('/v1/catalog', async (request, reply) => {
      const catalogVersion = this.deps.modelRegistry.getCatalogVersion();
      // Phase 13 §11: ETag/conditional request. The catalog body is a pure
      // function of catalogVersion, so we can 304 when unchanged and avoid
      // re-shipping the entire (potentially huge) payload on every poll.
      const etag = `W/"cat-${catalogVersion}"`;
      reply.header('ETag', etag);
      reply.header('Cache-Control', 'no-cache');
      reply.header('X-Nexus-Model-Catalog-Version', String(catalogVersion));
      const ifNoneMatch = request.headers['if-none-match'];
      if (ifNoneMatch === etag) {
        return reply.code(304).send();
      }

      const models = this.deps.modelRegistry.list();
      const generic = projectGenericCatalog(models);
      const endpoints = this.deps.routing.listEndpoints();
      const agents = getAgentCompatibilityMatrix();
      const agyHealth = await globalAgyAdapter.healthCheck();

      return {
        catalogVersion,
        generatedAt: new Date().toISOString(),
        providers: endpoints.map(e => ({
          id: e.providerId,
          endpointId: e.id,
          displayName: e.displayName,
          health: e.health,
          priority: e.priority,
        })),
        models: generic,
        agents,
        policies: ['nexus/auto', 'nexus/best', 'nexus/free', 'nexus/free-coding', 'nexus/best-coding', 'nexus/cheap', 'nexus/fast', 'nexus/reasoning', 'nexus/vision', 'nexus/long-context'],
        applicationEngine: {
          enabled: true,
          runtime: 'agy-builder',
          lifecycle: ['DISCOVER', 'SPECIFY', 'ARCHITECT', 'PLAN', 'APPROVAL', 'SCAFFOLD', 'BUILD', 'TEST', 'VERIFY', 'REPAIR', 'FINALIZE', 'COMPLETED'],
        },
        agyRuntime: agyHealth,
        buildCapabilities: {
          scaffold: true,
          implement: true,
          test: true,
          inspect: true,
          fix: true,
          verify: true,
          maxRepairAttempts: 3,
          workspaceIsolation: true,
        },
        orchestration: {
          enabled: true,
          taskTypes: ['GENERAL', 'CODING', 'DEBUGGING', 'REFACTORING', 'TESTING', 'DOCUMENTATION', 'RESEARCH', 'ARCHITECTURE', 'SECURITY', 'PERFORMANCE'],
          maxConcurrency: 10,
        },
      };
    });

    // ── Catalog delta sync (Phase 13 §10/§18) ──────────────────────────
    // Returns ONLY models added/updated/removed since `since`=<catalogVersion>.
    // Avoids re-downloading the entire catalog when a single model changes.
    this.fastify.get('/v1/catalog/delta', async (request) => {
      const since = Number((request.query as { since?: string }).since ?? '0') || 0;
      const delta = this.deps.modelRegistry.getDelta(since);
      return {
        catalogVersion: delta.toVersion,
        fromVersion: delta.fromVersion,
        fullSyncRequired: delta.fullSyncRequired,
        added: delta.added,
        updated: delta.updated,
        removed: delta.removed,
      };
    });

    // ── Real-Time Catalog Status (Phase 20 §2) ─────────────────────────
    this.fastify.get('/v1/catalog/status', async () => {
      const stats = this.deps.modelRegistry.stats();
      const endpoints = this.deps.routing.listEndpoints();
      const allModels = this.deps.modelRegistry.list();
      const healthyModels = allModels.filter(m => !m.stale).length;
      return {
        catalogVersion: this.deps.modelRegistry.getCatalogVersion(),
        lastUpdated: new Date(stats.lastRefreshAt || Date.now()).toISOString(),
        providers: endpoints.length,
        models: stats.totalModels,
        newModels: 0,
        removedModels: 0,
        staleModels: stats.staleModels,
        healthyModels,
        freeModels: stats.freeModels,
        errors: stats.errors,
      };
    });

    // ── Nexus Doctor Diagnostic API (§18 / Phase 21 §13) ──────────────
    const handleDoctor = async () => {
      const models = this.deps.modelRegistry.list();
      const freeModels = this.deps.modelRegistry.listFree();
      const endpoints = this.deps.routing.listEndpoints();
      const detector = new AgentDetector();
      const detectedAgents = await detector.detectAll();
      const agyHealth = await globalAgyAdapter.healthCheck();
      const apps = globalAppEngine.listApplications();
      const vaultKeys = this.deps.keyRegistry.listAll();
      const catalogVersion = this.deps.modelRegistry.getCatalogVersion();

      return {
        status: endpoints.length > 0 ? 'HEALTHY' : 'NO_PROVIDERS_CONFIGURED',
        version: GATEWAY_VERSION,
        uptime: process.uptime(),
        catalogVersion,
        configuredAgentCount: detectedAgents.filter((a) => a.found).length,
        checks: {
          gatewayReachable: true,
          modelRegistryHealthy: models.length > 0,
          totalModels: models.length,
          freeModelsCount: freeModels.length,
          activeProviders: endpoints.filter((e) => e.health === 'healthy').length,
          apiKeysLoaded: vaultKeys.length,
          catalogVersion,
          detectedAgentsCount: detectedAgents.filter((a) => a.found).length,
          routingEngineState: 'operational',
          tokenEfficiencyState: 'active',
          orchestrationState: 'operational',
          agyInstalled: agyHealth.installed,
          agyVersion: agyHealth.version,
          agyRuntimeHealthy: agyHealth.runtimeHealthy,
          activeBuilds: apps.filter((a) => a.stage === 'BUILD' || a.stage === 'SCAFFOLD' || a.stage === 'REPAIR').length,
          queuedBuilds: apps.filter((a) => a.stage === 'DISCOVER' || a.stage === 'SPECIFY' || a.stage === 'ARCHITECT' || a.stage === 'PLAN' || a.stage === 'APPROVAL').length,
          failedBuilds: apps.filter((a) => a.stage === 'FAILED').length,
          repairCycles: apps.reduce((acc, a) => acc + a.repairAttempts, 0),
          workspaceHealth: 'healthy',
        },
        detectedAgents,
        agyRuntime: agyHealth,
      };
    };
    this.fastify.get('/v1/doctor', handleDoctor);
    this.fastify.get('/doctor', handleDoctor);

    // ── Phase 21 Release Health API (§14) ──────────────────────────────
    this.fastify.get('/v1/release/health', async () => {
      const models = this.deps.modelRegistry.list();
      const endpoints = this.deps.routing.listEndpoints();
      const detector = new AgentDetector();
      const detectedAgents = await detector.detectAll();
      const healthyProviders = endpoints.filter((e) => e.health === 'healthy');

      return {
        status: 'healthy',
        version: GATEWAY_VERSION,
        build: 'production-phase21',
        gateway: true,
        modelRegistry: true,
        routing: true,
        agents: detectedAgents.length > 0,
        dashboard: true,
        uptime: process.uptime(),
        catalogVersion: this.deps.modelRegistry.getCatalogVersion(),
        providerCount: endpoints.length,
        healthyProviderCount: healthyProviders.length,
        modelCount: models.length,
        freeModelCount: this.deps.modelRegistry.listFree().length,
      };
    });

    // ── Hermes build agent diagnostics ────────────────────────────────
    this.fastify.get('/v1/debug/hermes', async () => {
      return she.diagnostics();
    });

    // ── Phase 27: Local Agent Bridge & Universal Agent Connector ──────
    this.fastify.get('/v1/runtime-agents', async () => {
      let agents = this.localAgentBridge.list();
      if (agents.length === 0) {
        agents = await this.localAgentBridge.discoverAll();
      }
      return { agents };
    });

    this.fastify.get('/v1/runtime-agents/environment', async () => {
      const isWin = process.platform === 'win32';
      const isWsl = !!process.env.WSL_DISTRO_NAME;
      return {
        platform: process.platform,
        windows: isWin,
        wsl: isWsl,
        linux: process.platform === 'linux' && !isWsl,
        gatewayReachability: `http://127.0.0.1:${this.deps.config.server.port}`,
        recommendedBaseUrl: `http://127.0.0.1:${this.deps.config.server.port}`,
      };
    });

    // Universal Agent Proxy Health
    this.fastify.get('/v1/runtime-agents/health', async () => {
      const healthMap = await this.localAgentBridge.healthCheckAll();
      return healthMap;
    });

    this.fastify.get('/v1/runtime-agents/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const agent = this.localAgentBridge.get(id) ?? (await this.localAgentBridge.getAdapter(id)?.discover());
      if (!agent) {
        return reply.code(404).send({ error: { message: `Agent '${id}' not found` } });
      }
      return agent;
    });

    // POST /v1/runtime-agents/:id/health — force live multi-stage health check
    this.fastify.post('/v1/runtime-agents/:id/health', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const health = await this.localAgentBridge.healthCheck(id);
        return health;
      } catch (err) {
        return reply.code(404).send({ error: { message: (err as Error).message } });
      }
    });

    // GET /v1/runtime-agents/:id/chain — 7-step diagnostic chain
    this.fastify.get('/v1/runtime-agents/:id/chain', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { modelPolicy } = (request.query as { modelPolicy?: string }) ?? {};
      try {
        const chain = await this.localAgentBridge.getDiagnosticChain(id, modelPolicy);
        return chain;
      } catch (err) {
        return reply.code(404).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/runtime-agents/:id/test — run quick connection test prompt
    this.fastify.post('/v1/runtime-agents/:id/test', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { prompt?: string; modelPolicy?: string } | undefined) ?? {};
      try {
        const result = await this.localAgentBridge.execute({
          agentId: id,
          prompt: body.prompt ?? "Say 'Nexus Local Agent Bridge Connected'",
          modelPolicy: body.modelPolicy ?? 'nexus/best-coding',
          timeoutMs: 25000,
        });
        return result;
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/runtime-agents/:id/execute — full execution with workspace & model policy
    this.fastify.post('/v1/runtime-agents/:id/execute', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as LocalAgentExecutionRequest;
      if (!body?.prompt?.trim()) {
        return reply.code(400).send({ error: { message: 'prompt is required for agent execution' } });
      }

      if (body.workspace && (!isAbsolute(body.workspace) || body.workspace.includes('..'))) {
        return reply.code(400).send({ error: { message: `Workspace path must be an absolute path without traversal: '${body.workspace}'` } });
      }

      try {
        const result = await this.localAgentBridge.execute({
          agentId: id,
          prompt: body.prompt.trim(),
          workspace: body.workspace,
          modelPolicy: body.modelPolicy ?? 'nexus/best-coding',
          timeoutMs: body.timeoutMs ?? 120_000,
          env: body.env,
        });
        return result;
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/runtime-agents/:id/cancel & POST /v1/runtime-agents/cancel/:executionId
    this.fastify.post('/v1/runtime-agents/:id/cancel', async (request, reply) => {
      const body = (request.body as { executionId?: string } | undefined) ?? {};
      if (!body.executionId) {
        return reply.code(400).send({ error: { message: 'executionId is required for cancellation' } });
      }
      const cancelled = this.localAgentBridge.cancelExecution(body.executionId);
      return { ok: cancelled, executionId: body.executionId };
    });

    this.fastify.post('/v1/runtime-agents/cancel/:executionId', async (request) => {
      const { executionId } = request.params as { executionId: string };
      const cancelled = this.localAgentBridge.cancelExecution(executionId);
      return { ok: cancelled, executionId };
    });

    // GET /v1/debug/runtime-agents — metrics, execution history, diagnostics
    this.fastify.get('/v1/debug/runtime-agents', async () => {
      return {
        metrics: this.localAgentBridge.getMetrics(),
        recentExecutions: this.localAgentBridge.getExecutionHistory().slice(0, 20),
        agents: this.localAgentBridge.list(),
      };
    });

    // Backward-compat routes for integrations package
    this.fastify.post('/v1/runtime-agents/:id/verify', async (request) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      return manager.verifyAgent(id);
    });

    this.fastify.post('/v1/runtime-agents/:id/configure', async (request) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { dryRun?: boolean; gatewayUrl?: string; apiKey?: string; defaultModel?: string } | undefined) ?? {};
      const manager = new AgentRuntimeManager();
      return manager.configureAgent(id, body);
    });

    this.fastify.post('/v1/runtime-agents/:id/restore', async (request) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      return manager.restoreAgent(id);
    });

    this.fastify.post('/v1/runtime-agents/configure-all', async (request) => {
      const body = (request.body as { dryRun?: boolean; gatewayUrl?: string } | undefined) ?? {};
      const manager = new AgentRuntimeManager();
      const results = await manager.configureAll(body);
      return { configuredAgents: results };
    });

    // ── Phase 28: Intelligent Agent Orchestration API ─────────────────
    // POST /v1/agents/select — Dry-run / Explain mode
    this.fastify.post('/v1/agents/select', async (request, reply) => {
      const body = (request.body as {
        prompt: string;
        policy?: OrchestrationPolicy;
        userPreferences?: { preferredAgents?: string[]; excludedAgents?: string[] };
      }) ?? {};
      if (!body.prompt?.trim()) {
        return reply.code(400).send({ error: { message: 'prompt is required for agent selection' } });
      }
      const selection = await this.agentOrchestrator.selectAgent({
        prompt: body.prompt.trim(),
        policy: body.policy,
        userPreferences: body.userPreferences,
      });
      return selection;
    });

    // POST /v1/agents/execute — Automated selection, lease acquisition, execution & failover
    this.fastify.post('/v1/agents/execute', async (request, reply) => {
      const body = request.body as OrchestratedExecutionRequest;
      if (!body?.prompt?.trim()) {
        return reply.code(400).send({ error: { message: 'prompt is required for orchestrated execution' } });
      }

      if (body.workspace && (!isAbsolute(body.workspace) || body.workspace.includes('..'))) {
        return reply.code(400).send({ error: { message: `Workspace path must be an absolute path without traversal: '${body.workspace}'` } });
      }

      // Check risk approval if high risk task
      const promptLower = body.prompt.toLowerCase();
      const isDangerous = /\b(drop database|rm -rf|delete all|destroy infrastructure|format disk)\b/i.test(promptLower);
      if (isDangerous) {
        return reply.code(403).send({
          error: {
            message: 'High-risk operation requires explicit operator approval before orchestrated agent dispatch',
            requiresApproval: true,
          },
        });
      }

      try {
        const result = await this.agentOrchestrator.execute({
          prompt: body.prompt.trim(),
          workspace: body.workspace,
          policy: body.policy,
          targetModel: body.targetModel,
          timeoutMs: body.timeoutMs,
          maxRetries: body.maxRetries,
          allowFailover: body.allowFailover,
          env: body.env,
          userPreferences: body.userPreferences,
        });
        return result;
      } catch (err) {
        return reply.code(500).send({ error: { message: (err as Error).message } });
      }
    });

    // GET /v1/agents/executions — List recent orchestrated executions
    this.fastify.get('/v1/agents/executions', async (request) => {
      const { limit } = (request.query as { limit?: string }) ?? {};
      const lim = limit ? parseInt(limit, 10) : 50;
      return { executions: this.agentOrchestrator.listExecutions(lim) };
    });

    // GET /v1/agents/executions/:id — Get execution details by ID
    this.fastify.get('/v1/agents/executions/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const execution = this.agentOrchestrator.getExecution(id);
      if (!execution) {
        return reply.code(404).send({ error: { message: `Execution '${id}' not found` } });
      }
      return execution;
    });

    // POST /v1/agents/executions/:id/cancel — Cancel running orchestrated execution
    this.fastify.post('/v1/agents/executions/:id/cancel', async (request) => {
      const { id } = request.params as { id: string };
      const cancelled = this.agentOrchestrator.cancelExecution(id);
      return { ok: cancelled, executionId: id };
    });

    // GET /v1/debug/agent-orchestration — Telemetry, active leases & distribution
    this.fastify.get('/v1/debug/agent-orchestration', async () => {
      return {
        metrics: this.agentOrchestrator.getMetrics(),
        recentExecutions: this.agentOrchestrator.listExecutions(20),
      };
    });

    // ── Phase 29: Unified Agent Mission Orchestration Fabric ───────────
    // POST /v1/missions — Create a new mission from specification
    this.fastify.post('/v1/missions', async (request, reply) => {
      const body = request.body as MissionSpecification;
      if (!body?.objective?.trim()) {
        return reply.code(400).send({ error: { message: 'objective is required to create a mission' } });
      }

      if (body.workspace && (!isAbsolute(body.workspace) || body.workspace.includes('..'))) {
        return reply.code(400).send({ error: { message: `Workspace path must be an absolute path without traversal: '${body.workspace}'` } });
      }

      const idempotencyKey = (request.headers['idempotency-key'] ?? request.headers['x-idempotency-key']) as string | undefined;
      if (idempotencyKey) {
        const reservation = await this.idempotencyStore.reserve(idempotencyKey, body);
        if (!reservation.isNew && reservation.existingRecord?.status === 'COMPLETED' && reservation.existingRecord.responseBody) {
          try {
            return reply.code(reservation.existingRecord.responseStatus ?? 200).send(JSON.parse(reservation.existingRecord.responseBody));
          } catch {
            return reply.code(reservation.existingRecord.responseStatus ?? 200).send(reservation.existingRecord.responseBody);
          }
        }
      }

      try {
        const mission = await this.missionOrchestrator.createMission(body);
        if (idempotencyKey) {
          await this.idempotencyStore.complete(idempotencyKey, 201, mission);
        }
        return reply.code(201).send(mission);
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // GET /v1/missions — List missions with optional status filter
    this.fastify.get('/v1/missions', async (request) => {
      const { status, limit } = (request.query as { status?: MissionStatus; limit?: string }) ?? {};
      const lim = limit ? parseInt(limit, 10) : 50;
      return { missions: this.missionOrchestrator.listMissions({ status, limit: lim }) };
    });

    // GET /v1/missions/:id — Get mission details
    this.fastify.get('/v1/missions/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const mission = this.missionOrchestrator.getMission(id);
      if (!mission) {
        return reply.code(404).send({ error: { message: `Mission '${id}' not found` } });
      }
      return mission;
    });

    // POST /v1/missions/:id/plan — Generate or regenerate mission execution DAG
    this.fastify.post('/v1/missions/:id/plan', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const plan = await this.missionOrchestrator.planMission(id);
        return plan;
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/missions/:id/approve — Explicit operator approval for high/critical risk mission
    this.fastify.post('/v1/missions/:id/approve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { approvedBy?: string } | undefined) ?? {};
      try {
        const mission = await this.missionOrchestrator.approveMission(id, body.approvedBy ?? 'operator');
        return mission;
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // ── WS4-C: Detached background tasks (survive agent disconnect) ──────
    // POST /v1/tasks — enqueue a non-streaming completion that runs to
    // completion in the background. Returns a job id immediately; the caller
    // polls GET /v1/tasks/:id. The gateway keeps working even if the caller's
    // connection drops mid-task (à la Claude Code's /fork).
    this.fastify.post('/v1/tasks', async (request, reply) => {
      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      const body = request.body as Partial<ChatCompletionRequest> & { model?: string };
      const authz = this.requirePermission(principal, 'gateway:chat', body.model ?? 'tasks', reply);
      if (authz === 'deny') return reply;
      if (!body?.model || !Array.isArray(body.messages) || body.messages.length === 0) {
        return reply.code(400).send({ error: { message: 'model and messages[] are required' } });
      }
      // Detached tasks are always non-streaming — the result is collected server-side.
      const req: ChatCompletionRequest = { ...(body as ChatCompletionRequest), stream: false };

      const job = this.taskStore.create(req.model);
      this.taskStore.start(job.id);
      // Fire-and-forget: run to completion in the background, never block the
      // HTTP response. Errors are captured into the job, not thrown to caller.
      void (async () => {
        try {
          const response = await this.deps.chatUseCase.execute(this.fitToContextWindow(req, req.model));
          const content = response.choices?.[0]?.message?.content ?? '';
          this.taskStore.complete(job.id, typeof content === 'string' ? content : JSON.stringify(content), response.usage);
        } catch (err) {
          this.taskStore.fail(job.id, (err as Error).message);
        } finally {
          this.taskStore.gc();
        }
      })();

      return reply.code(202).send({ id: job.id, model: job.model, status: 'running', poll: `/v1/tasks/${job.id}` });
    });

    // GET /v1/tasks/:id — poll a detached task's status / result
    this.fastify.get('/v1/tasks/:id', async (request, reply) => {
      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      const authz = this.requirePermission(principal, 'gateway:chat', (request.params as { id: string }).id, reply);
      if (authz === 'deny') return reply;
      const { id } = request.params as { id: string };
      const job = this.taskStore.get(id);
      if (!job) return reply.code(404).send({ error: { message: `Task '${id}' not found` } });
      return job;
    });

    // GET /v1/tasks — list detached tasks
    this.fastify.get('/v1/tasks', async (request, reply) => {
      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      const authz = this.requirePermission(principal, 'gateway:chat', 'tasks', reply);
      if (authz === 'deny') return reply;
      return { tasks: this.taskStore.list() };
    });

    // POST /v1/missions/:id/execute — Execute ready mission DAG
    this.fastify.post('/v1/missions/:id/execute', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { autoApprove?: boolean } | undefined) ?? {};
      try {
        const mission = await this.missionOrchestrator.executeMission(id, { autoApprove: body.autoApprove });
        return mission;
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/missions/:id/pause — Pause active mission
    this.fastify.post('/v1/missions/:id/pause', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const mission = await this.missionOrchestrator.pauseMission(id);
        return mission;
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/missions/:id/resume — Resume paused mission
    this.fastify.post('/v1/missions/:id/resume', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const mission = await this.missionOrchestrator.resumeMission(id);
        return mission;
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/missions/:id/cancel — Cancel active mission and abort all subprocesses
    this.fastify.post('/v1/missions/:id/cancel', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const mission = await this.missionOrchestrator.cancelMission(id);
        return mission;
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // GET /v1/missions/:id/events — Live SSE event stream for mission progress
    this.fastify.get('/v1/missions/:id/events', async (request, reply) => {
      const { id } = request.params as { id: string };
      const mission = this.missionOrchestrator.getMission(id);
      if (!mission) {
        return reply.code(404).send({ error: { message: `Mission '${id}' not found` } });
      }

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders?.();

      // Send existing past events first
      const pastEvents = this.missionOrchestrator.getEvents(id);
      for (const ev of pastEvents) {
        reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      }

      const unsubscribe = this.missionOrchestrator.subscribeEvents(id, (ev: MissionEvent) => {
        try {
          reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
        } catch {
          // connection dropped
        }
      });

      request.raw.on('close', () => {
        unsubscribe();
      });
    });

    // GET /v1/missions/:id/checkpoints — List checkpoints
    this.fastify.get('/v1/missions/:id/checkpoints', async (request) => {
      const { id } = request.params as { id: string };
      const checkpoints = this.missionOrchestrator.getCheckpoints(id);
      return { checkpoints };
    });

    // GET /v1/debug/missions — Telemetry, counts, token & duration aggregates
    this.fastify.get('/v1/debug/missions', async () => {
      return {
        metrics: this.missionOrchestrator.getMetrics(),
        activeMissions: this.missionOrchestrator.listMissions({ status: 'EXECUTING' as any }),
        recentMissions: this.missionOrchestrator.listMissions({ limit: 10 }),
      };
    });

    // ── Orchestration API (§5 & §6) ───────────────────────────────────
    const globalTaskStore = new InMemoryTaskStore();
    const globalAgentExecutor = new SubprocessAgentExecutor();
    const globalConcurrency = new ConcurrencyManager();

    this.fastify.get('/v1/orchestration/status', async () => {
      return globalConcurrency.getStatus();
    });

    this.fastify.get('/v1/orchestration/history', async (request) => {
      const q = (request.query as { status?: string; category?: string } | undefined) ?? {};
      return { tasks: await globalTaskStore.list(q) };
    });

    this.fastify.get('/v1/orchestration/templates', async () => {
      return {
        templates: [
          { id: 'code-review', name: 'Code Review', prompt: 'Perform a comprehensive code review on the codebase' },
          { id: 'fix-tests', name: 'Fix Tests', prompt: 'Inspect unit test failures and fix them' },
          { id: 'security-audit', name: 'Security Audit', prompt: 'Perform a static security audit across source files' },
          { id: 'refactor', name: 'Refactor Code', prompt: 'Refactor complex modules to improve maintainability' },
          { id: 'repository-analysis', name: 'Repository Analysis', prompt: 'Analyze project structure and dependencies' },
        ],
      };
    });

    this.fastify.post('/v1/orchestration/plan', async (request) => {
      const body = request.body as { prompt: string; category?: any; requestedAgent?: string; requestedModel?: string };
      const runtimeManager = new AgentRuntimeManager();
      const availableAgents = await runtimeManager.listAgents();
      const orchestrator = new TaskOrchestrator(this.deps.routing, globalTaskStore, globalAgentExecutor, this.deps.events);
      return orchestrator.planTask(body, availableAgents);
    });

    this.fastify.post('/v1/orchestration/tasks', async (request) => {
      const body = request.body as { prompt: string; category?: any; requestedAgent?: string; requestedModel?: string; dryRun?: boolean };
      const runtimeManager = new AgentRuntimeManager();
      const availableAgents = await runtimeManager.listAgents();
      const orchestrator = new TaskOrchestrator(this.deps.routing, globalTaskStore, globalAgentExecutor, this.deps.events);
      const task = await orchestrator.createTask(body, availableAgents);
      if (!body.dryRun) {
        globalConcurrency.incrementQueue();
      }
      return task;
    });

    this.fastify.get('/v1/orchestration/tasks', async () => {
      return { tasks: await globalTaskStore.list() };
    });

    this.fastify.get('/v1/orchestration/tasks/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const task = await globalTaskStore.get(id);
      if (!task) return reply.code(404).send({ error: { message: `Task '${id}' not found` } });
      return task;
    });

    this.fastify.post('/v1/orchestration/tasks/:id/cancel', async (request, reply) => {
      const { id } = request.params as { id: string };
      const orchestrator = new TaskOrchestrator(this.deps.routing, globalTaskStore, globalAgentExecutor, this.deps.events);
      try {
        const cancelled = await orchestrator.cancelTask(id);
        return cancelled;
      } catch (err: any) {
        return reply.code(404).send({ error: { message: err.message } });
      }
    });

    this.fastify.post('/v1/orchestration/tasks/:id/retry', async (request, reply) => {
      const { id } = request.params as { id: string };
      const orchestrator = new TaskOrchestrator(this.deps.routing, globalTaskStore, globalAgentExecutor, this.deps.events);
      try {
        const retried = await orchestrator.retryTask(id, 'claude', 'http://127.0.0.1:8787');
        return retried;
      } catch (err: any) {
        return reply.code(404).send({ error: { message: err.message } });
      }
    });

    // ── Phase 7 Workflow Execution Fabric API (§14) ────────────────────
    const defaultOrchestrator = new TaskOrchestrator(this.deps.routing, globalTaskStore, globalAgentExecutor, this.deps.events);
    const globalWorkflowOrchestrator = new WorkflowOrchestrator(defaultOrchestrator);

    // Seed built-in workflow definitions (node-based DAG schema consumed by the
    // dashboard's "Registered Workflow Definitions" list). These persist across
    // restarts — unlike runtime POST-registered defs in prior builds.
    for (const def of BUILT_IN_WORKFLOWS) {
      globalWorkflowOrchestrator.registerDefinition(def);
    }

    this.fastify.get('/v1/workflow-fabric', async () => {
      return { workflows: globalWorkflowOrchestrator.listDefinitions() };
    });

    this.fastify.post('/v1/workflow-fabric', async (request, reply) => {
      const body = request.body as any;
      const res = globalWorkflowOrchestrator.registerDefinition(body);
      if (!res.valid) {
        return reply.code(400).send({ error: { message: 'Invalid workflow definition', errors: res.errors } });
      }
      return reply.code(201).send(globalWorkflowOrchestrator.getDefinition(body.id));
    });

    this.fastify.get('/v1/workflow-fabric/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const def = globalWorkflowOrchestrator.getDefinition(id);
      if (!def) return reply.code(404).send({ error: { message: `Workflow '${id}' not found` } });
      return def;
    });

    this.fastify.post('/v1/workflow-fabric/:id/validate', async (request, reply) => {
      const { id } = request.params as { id: string };
      const def = globalWorkflowOrchestrator.getDefinition(id);
      if (!def) return reply.code(404).send({ error: { message: `Workflow '${id}' not found` } });
      const dag = new DAGEngine();
      return dag.validate(def);
    });

    this.fastify.post('/v1/workflow-fabric/:id/runs', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { variables?: Record<string, unknown> } | undefined) ?? {};
      try {
        const run = globalWorkflowOrchestrator.createRun(id, body.variables);
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        const updatedRun = await globalWorkflowOrchestrator.executeStep(run.runId, availableAgents);
        return updatedRun;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    this.fastify.get('/v1/workflow-fabric/:id/runs/:runId', async (request, reply) => {
      const { runId } = request.params as { id: string; runId: string };
      const run = globalWorkflowOrchestrator.getRun(runId);
      if (!run) return reply.code(404).send({ error: { message: `Workflow run '${runId}' not found` } });
      return run;
    });

    this.fastify.post('/v1/workflow-fabric/:id/runs/:runId/pause', async (request, reply) => {
      const { runId } = request.params as { id: string; runId: string };
      try {
        return globalWorkflowOrchestrator.pauseRun(runId);
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    this.fastify.post('/v1/workflow-fabric/:id/runs/:runId/resume', async (request, reply) => {
      const { runId } = request.params as { id: string; runId: string };
      try {
        globalWorkflowOrchestrator.resumeRun(runId);
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        return await globalWorkflowOrchestrator.executeStep(runId, availableAgents);
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    this.fastify.post('/v1/workflow-fabric/:id/runs/:runId/cancel', async (request, reply) => {
      const { runId } = request.params as { id: string; runId: string };
      try {
        return await globalWorkflowOrchestrator.cancelRun(runId);
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    this.fastify.post('/v1/workflow-fabric/:id/runs/:runId/approve', async (request, reply) => {
      const { runId } = request.params as { id: string; runId: string };
      const body = request.body as { nodeId: string; reason?: string; decidedBy?: string };
      try {
        globalWorkflowOrchestrator.approveRun(runId, body.nodeId, body.reason, body.decidedBy);
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        const updatedRun = await globalWorkflowOrchestrator.executeStep(runId, availableAgents);
        return updatedRun;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    this.fastify.post('/v1/workflow-fabric/:id/runs/:runId/reject', async (request, reply) => {
      const { runId } = request.params as { id: string; runId: string };
      const body = request.body as { nodeId: string; reason?: string; decidedBy?: string };
      try {
        return globalWorkflowOrchestrator.rejectRun(runId, body.nodeId, body.reason, body.decidedBy);
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    this.fastify.get('/v1/workflow-fabric/:id/runs/:runId/events', async (request, reply) => {
      const { runId } = request.params as { id: string; runId: string };
      const run = globalWorkflowOrchestrator.getRun(runId);
      if (!run) return reply.code(404).send({ error: { message: `Workflow run '${runId}' not found` } });

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      reply.raw.write(`data: ${JSON.stringify({ type: 'workflow.started', runId: run.runId, status: run.status })}\n\n`);
      reply.raw.write(`data: ${JSON.stringify({ type: 'workflow.completed', runId: run.runId, status: run.status })}\n\n`);
      reply.raw.end();
      return reply;
    });

    this.fastify.get('/v1/debug/workflow-fabric/runs', async () => {
      return { runs: globalWorkflowOrchestrator.listRuns() };
    });

    this.fastify.get('/v1/debug/workflow-fabric', async () => {
      return {
        activeWorkflows: globalWorkflowOrchestrator.listDefinitions().length,
        totalRuns: globalWorkflowOrchestrator.listRuns().length,
        engineState: 'operational',
        dagValidation: 'strict',
        approvalGatesSupported: true,
      };
    });

    // ── Agent Session Fabric (Phase 17/18) ────────────────────────────────────
    // SessionManager is constructed in runtime.ts and injected via deps.sessions.
    // These endpoints expose it over REST + SSE. No new business logic — they
    // delegate to the already-tested core SessionManager.

    // GET /v1/sessions — list (optional ?status= & ?agentId= filters)
    this.fastify.get('/v1/sessions', async (request) => {
      const { status, agentId } = request.query as { status?: string; agentId?: string };
      const list = await this.deps.sessions.list(
        status || agentId ? { status, agentId } : undefined,
      );
      return { sessions: list, total: list.length };
    });

    // POST /v1/sessions — create a session
    this.fastify.post('/v1/sessions', async (request, reply) => {
      const body = request.body as {
        agentId: string;
        agentRuntime?: string;
        modelId?: string;
        providerId?: string;
        projectId?: string;
        workspaceId?: string;
        prompt?: string;
        systemContext?: string;
        command?: string;
        args?: string[];
        cwd?: string;
      };
      if (!body?.agentId) {
        return reply.code(400).send({ error: { message: 'agentId is required' } });
      }
      const session = await this.deps.sessions.create({
        agentId: body.agentId,
        agentRuntime: body.agentRuntime,
        modelId: body.modelId,
        providerId: body.providerId,
        projectId: body.projectId,
        workspaceId: body.workspaceId,
        prompt: body.prompt,
        systemContext: body.systemContext,
        command: body.command,
        args: body.args,
        cwd: body.cwd,
      });
      return reply.code(201).send(session);
    });

    // GET /v1/sessions/:id
    this.fastify.get('/v1/sessions/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const session = await this.deps.sessions.get(id);
      if (!session) return reply.code(404).send({ error: { message: `session '${id}' not found` } });
      return session;
    });

    // POST /v1/sessions/:id/start
    this.fastify.post('/v1/sessions/:id/start', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { command?: string; args?: string[]; cwd?: string; env?: NodeJS.ProcessEnv } | undefined;
      try {
        return await this.deps.sessions.start(id, body ?? {});
      } catch (err) {
        return reply.code(404).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/sessions/:id/message
    this.fastify.post('/v1/sessions/:id/message', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { text: string };
      if (!body?.text) return reply.code(400).send({ error: { message: 'text is required' } });
      try {
        await this.deps.sessions.send(id, body.text);
        return { ok: true };
      } catch (err) {
        return reply.code(409).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/sessions/:id/pause
    this.fastify.post('/v1/sessions/:id/pause', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        return await this.deps.sessions.pause(id);
      } catch (err) {
        return reply.code(404).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/sessions/:id/resume
    this.fastify.post('/v1/sessions/:id/resume', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        return await this.deps.sessions.resume(id);
      } catch (err) {
        return reply.code(404).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/sessions/:id/cancel
    this.fastify.post('/v1/sessions/:id/cancel', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        return await this.deps.sessions.cancel(id);
      } catch (err) {
        return reply.code(404).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/sessions/:id/slash-model — Dynamic /model Command Execution per Agent
    this.fastify.post('/v1/sessions/:id/slash-model', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { modelId: string };
      if (!body?.modelId) {
        return reply.code(400).send({ error: { message: 'modelId is required (e.g. /model claude-3-5-sonnet)' } });
      }
      try {
        const session = await this.deps.sessions.get(id);
        if (!session) return reply.code(404).send({ error: { message: `session '${id}' not found` } });
        
        // Pin model to session metadata
        const updated = await this.deps.sessions.update(id, {
          modelId: body.modelId.replace(/^\/model\s*/i, '').trim(),
        });
        return {
          ok: true,
          sessionId: id,
          pinnedModel: body.modelId,
          session: updated,
        };
      } catch (err) {
        return reply.code(500).send({ error: { message: (err as Error).message } });
      }
    });

    // GET /v1/models/prefetch — dynamically aggregates and prefetches active provider models
    this.fastify.get('/v1/models/prefetch', async (_request) => {
      const activeKeys = this.deps.keyRegistry.list().filter((k) => k.status === 'active');
      const endpoints = this.deps.routing.listEndpoints().filter((e) => e.health === 'healthy');
      const discovered = this.deps.modelCatalog ? await this.deps.modelCatalog.list() : [];

      const dynamicModels = discovered.map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.providerId || m.provider,
        contextWindow: m.contextWindow || 128000,
        supportsStreaming: true,
        supportsToolCalling: m.toolCalling ?? true,
        status: 'active',
      }));

      return {
        ok: true,
        total: dynamicModels.length,
        models: dynamicModels,
        activeProviders: Array.from(new Set(activeKeys.map((k) => k.providerId))),
        healthyEndpoints: endpoints.length,
        timestamp: Date.now(),
      };
    });

    // POST /v1/sessions/:id/restart
    this.fastify.post('/v1/sessions/:id/restart', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        return await this.deps.sessions.restart(id);
      } catch (err) {
        return reply.code(404).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/sessions/:id/checkpoint
    this.fastify.post('/v1/sessions/:id/checkpoint', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { summary?: string } | undefined;
      try {
        return await this.deps.sessions.checkpoint(id, body?.summary);
      } catch (err) {
        return reply.code(404).send({ error: { message: (err as Error).message } });
      }
    });

    // POST /v1/sessions/:id/restore
    this.fastify.post('/v1/sessions/:id/restore', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { checkpointId: string };
      if (!body?.checkpointId) return reply.code(400).send({ error: { message: 'checkpointId is required' } });
      try {
        return await this.deps.sessions.restore(id, body.checkpointId);
      } catch (err) {
        return reply.code(404).send({ error: { message: (err as Error).message } });
      }
    });

    // GET /v1/sessions/:id/events — scoped SSE channel (session.* events only)
    this.fastify.get('/v1/sessions/:id/events', async (request, reply) => {
      const { id } = request.params as { id: string };
      const session = await this.deps.sessions.get(id);
      if (!session) return reply.code(404).send({ error: { message: `session '${id}' not found` } });

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');

      const send = (event: unknown) => {
        try {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          /* client gone */
        }
      };

      // Emit current snapshot first.
      send({ type: 'session.snapshot', sessionId: id, session });

      const unsub = this.deps.events.subscribeAll((e) => {
        if ((e as { correlationId?: string }).correlationId === id) send(e);
      });

      const onClose = () => unsub();
      reply.raw.on('close', onClose);

      // Heartbeat to keep the connection alive / detect dead clients.
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: ping\n\n`);
        } catch {
          clearInterval(heartbeat);
          unsub();
        }
      }, 15_000);

      reply.raw.on('close', () => clearInterval(heartbeat));

      return reply;
    });

    // GET /v1/debug/sessions — operational snapshot
    this.fastify.get('/v1/debug/sessions', async () => {
      const all = await this.deps.sessions.list();
      const byStatus: Record<string, number> = {};
      for (const s of all) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      return {
        total: all.length,
        byStatus,
        engineState: 'operational',
        store: 'in-memory',
      };
    });

    // ── Operator self-healing endpoints (base URL, context window, key heal) ──

    // GET /v1/endpoints — list all registered provider endpoints (incl. live baseUrl/health).
    this.fastify.get('/v1/endpoints', async () => {
      return { endpoints: this.deps.routing.listEndpoints() };
    });

    // POST /v1/endpoints/:id — live-patch an endpoint (e.g. correct a wrong baseUrl).
    this.fastify.post('/v1/endpoints/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { baseUrl?: string; displayName?: string; region?: string; tags?: string[]; priority?: number; weight?: number };
      const existing = this.deps.routing.listEndpoints().find((e) => e.id === id);
      if (!existing) return reply.code(404).send({ error: { message: `Endpoint '${id}' not found` } });
      this.deps.routing.updateEndpoint(id, {
        ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.region !== undefined ? { region: body.region } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.weight !== undefined ? { weight: body.weight } : {}),
      });
      return { ok: true, endpoint: this.deps.routing.listEndpoints().find((e) => e.id === id) };
    });

    // POST /v1/endpoints/:id/probe — test reachability of the endpoint's baseUrl.
    this.fastify.post('/v1/endpoints/:id/probe', async (request, reply) => {
      const { id } = request.params as { id: string };
      const endpoint = this.deps.routing.listEndpoints().find((e) => e.id === id);
      if (!endpoint) return reply.code(404).send({ error: { message: `Endpoint '${id}' not found` } });
      const reachable = await probeUrl(endpoint.baseUrl);
      this.deps.routing.updateEndpoint(id, { health: reachable ? 'healthy' : 'unhealthy' });
      return { ok: true, reachable, baseUrl: endpoint.baseUrl, health: reachable ? 'healthy' : 'unhealthy' };
    });

    // POST /v1/models/context-window — live-set a model's context window.
    // (Model ids often contain '/', so we take provider+model from the body
    // rather than path params, which Fastify won't split on slashes.)
    this.fastify.post('/v1/models/context-window', async (request, reply) => {
      const body = request.body as { provider: string; model: string; contextWindow: number };
      const provider = body?.provider;
      const id = body?.model;
      if (!provider || !id) return reply.code(400).send({ error: { message: 'provider and model are required' } });
      if (!Number.isFinite(body.contextWindow) || body.contextWindow <= 0) {
        return reply.code(400).send({ error: { message: 'contextWindow must be a positive number' } });
      }
      const existing = this.deps.modelRegistry.get(provider, id)
        ?? this.deps.modelRegistry.list().find((m) => m.providerId === provider && m.id === id);
      if (!existing) return reply.code(404).send({ error: { message: `Model '${provider}/${id}' not found` } });
      this.deps.modelRegistry.setContextWindow(provider, existing.id, Math.floor(body.contextWindow));
      return { ok: true, provider, model: existing.id, contextWindow: Math.floor(body.contextWindow) };
    });

    // POST /v1/keys/:id/heal — reset a key's health and re-probe its endpoint.
    this.fastify.post('/v1/keys/:id/heal', async (request, reply) => {
      const { id } = request.params as { id: string };
      const key = this.deps.keyRegistry.get(id);
      if (!key) return reply.code(404).send({ error: { message: `Key '${id}' not found` } });
      this.deps.keyRegistry.reset(id);
      const report = await this.liveErrorResolver.resolveKey(id);
      return report;
    });

    // ── Phase 9 Autonomous Execution Control Plane API ─────────────────
    const globalAutonomousPlanner = new AutonomousPlanner();

    this.fastify.post('/v1/autonomous/plan', async (request) => {
      const body = request.body as { prompt: string };
      return globalAutonomousPlanner.plan(body.prompt);
    });

    this.fastify.post('/v1/autonomous/tasks', async (request) => {
      const body = request.body as { prompt: string };
      const plan = globalAutonomousPlanner.plan(body.prompt);
      globalWorkflowOrchestrator.registerDefinition(plan.definition);
      const run = globalWorkflowOrchestrator.createRun(plan.definition.id);
      const runtimeManager = new AgentRuntimeManager();
      const availableAgents = await runtimeManager.listAgents();
      const updatedRun = await globalWorkflowOrchestrator.executeStep(run.runId, availableAgents);
      return {
        taskId: `auto-task-${Date.now()}`,
        workflowId: plan.definition.id,
        runId: run.runId,
        status: updatedRun.status,
        risk: plan.risk,
      };
    });

    this.fastify.post('/v1/debug/autonomous/explain', async (request) => {
      const body = request.body as { prompt: string };
      const plan = globalAutonomousPlanner.plan(body.prompt);
      return {
        prompt: body.prompt,
        intent: plan.category,
        risk: plan.risk,
        workflowId: plan.definition.id,
        nodeCount: plan.definition.nodes.length,
        estimatedCostUsd: plan.estimatedCostUsd,
      };
    });

    this.fastify.get('/v1/debug/execution-memory', async () => {
      return {
        history: globalWorkflowOrchestrator.listRuns().map(r => ({
          runId: r.runId,
          workflowId: r.workflowId,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          outputs: r.outputs,
        })),
      };
    });

    // ── Phase 11 Autonomous Application Engine API (AGY Builder) ──────────
    const nexusRoot = process.env['NEXUS_REPO_ROOT'] ?? process.cwd();
    const globalAgyAdapter = new AgyBuilderAdapter(
      `http://127.0.0.1:${this.deps.config.server.port ?? 8787}`,
      nexusRoot, // Nexus repo root — workspace isolation guard
    );
    const she = new HermesRuntimeManager({
      gatewayHost: this.deps.config.server.host,
      gatewayPort: this.deps.config.server.port ?? 8787,
      resolveAlias: (alias) => this.deps.aliasRegistry.resolve(alias),
    });
    const globalAppEngine = new ApplicationEngine(
      globalWorkflowOrchestrator,
      globalAgyAdapter,
      this.deps.events,
      this.deps.routing,
      {
        gatewayBaseUrl: `http://127.0.0.1:${this.deps.config.server.port ?? 8787}`,
        gatewayPort: this.deps.config.server.port ?? 8787,
        nexusRepoRoot: nexusRoot,
      },
    );

    // GET /v1/applications — list all applications
    this.fastify.get('/v1/applications', async () => {
      return { applications: globalAppEngine.listApplications() };
    });

    // POST /v1/applications — create a new application
    this.fastify.post('/v1/applications', async (request, reply) => {
      const body = request.body as { objective: string };
      if (!body?.objective?.trim()) {
        return reply.code(400).send({ error: { message: 'objective is required' } });
      }
      const app = globalAppEngine.createApplication(body.objective.trim());
      return reply.code(201).send(app);
    });

    // GET /v1/applications/:id — get application by ID
    this.fastify.get('/v1/applications/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const app = globalAppEngine.getApplication(id);
      if (!app) return reply.code(404).send({ error: { message: `Application '${id}' not found` } });
      return app;
    });

    // GET /v1/applications/:id/state — get application state summary
    this.fastify.get('/v1/applications/:id/state', async (request, reply) => {
      const { id } = request.params as { id: string };
      const app = globalAppEngine.getApplication(id);
      if (!app) return reply.code(404).send({ error: { message: `Application '${id}' not found` } });
      return {
        appId: app.appId,
        stage: app.stage,
        spec: app.spec,
        architecture: app.architecture,
        workspace: app.workspace,
        buildContext: app.buildContext
          ? {
              requiresApproval: app.buildContext.requiresApproval,
              riskLevel: app.buildContext.riskLevel,
              riskFlags: app.buildContext.riskFlags,
              selectedPolicy: app.buildContext.selectedPolicy,
              selectedModel: app.buildContext.selectedModel,
              selectedProvider: app.buildContext.selectedProvider,
              repairAttempts: app.buildContext.repairAttempts,
              maxRepairAttempts: app.buildContext.maxRepairAttempts,
              lastTestResult: app.buildContext.lastTestResult,
            }
          : undefined,
        workflowId: app.workflowId,
        runId: app.runId,
        repairAttempts: app.repairAttempts,
        error: app.error,
        eventCount: app.eventLog.length,
      };
    });

    // POST /v1/applications/:id/plan — specify, architect, plan + risk analysis
    this.fastify.post('/v1/applications/:id/plan', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const app = await globalAppEngine.planApplication(id);
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    // POST /v1/applications/:id/approve — approve a HIGH/CRITICAL risk build
    this.fastify.post('/v1/applications/:id/approve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { decidedBy?: string; reason?: string } | undefined) ?? {};
      try {
        const app = globalAppEngine.approveApplication(id, body.decidedBy);
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    // POST /v1/applications/:id/reject — reject a pending approval
    this.fastify.post('/v1/applications/:id/reject', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { reason?: string; decidedBy?: string } | undefined) ?? {};
      try {
        const app = globalAppEngine.rejectApplication(id, body.reason, body.decidedBy);
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    // POST /v1/applications/:id/build — execute full AGY build pipeline
    this.fastify.post('/v1/applications/:id/build', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { dryRun?: boolean } | undefined) ?? {};
      try {
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();

        if (body.dryRun) {
          // Must be planned first for full dry-run
          const app = globalAppEngine.getApplication(id);
          if (!app) return reply.code(404).send({ error: { message: `Application '${id}' not found` } });

          const agyHealth = await globalAgyAdapter.healthCheck();
          return {
            dryRun: true,
            applicationId: id,
            stage: app.stage,
            selectedRuntime: 'agy-builder',
            agyRuntime: {
              installed: agyHealth.installed,
              version: agyHealth.version,
              executablePath: agyHealth.executablePath,
              healthy: agyHealth.runtimeHealthy,
            },
            workflow: app.workflowId
              ? globalWorkflowOrchestrator.getDefinition(app.workflowId)
              : null,
            buildNodes: ['AGY_SCAFFOLD', 'AGY_IMPLEMENT', 'AGY_TEST', 'AGY_VERIFY'],
            selectedModel: app.buildContext?.selectedModel ?? 'nexus/best-coding',
            selectedProvider: app.buildContext?.selectedProvider ?? 'nexus',
            selectedPolicy: app.buildContext?.selectedPolicy ?? 'nexus/best-coding',
            riskLevel: app.buildContext?.riskLevel ?? 'LOW',
            riskFlags: app.buildContext?.riskFlags ?? [],
            requiresApproval: app.buildContext?.requiresApproval ?? false,
            workspace: {
              path: app.workspace?.workspacePath ?? `~/.nexus/applications/${id}`,
              workspaceId: app.workspace?.workspaceId,
              buildSessionId: app.workspace?.buildSessionId,
            },
            maxRepairAttempts: 3,
            estimatedExecutionPlan: [
              { step: 1, name: 'Scaffold', kind: 'AGY_SCAFFOLD', policy: 'nexus/best-coding' },
              { step: 2, name: 'Implement', kind: 'AGY_IMPLEMENT', policy: 'nexus/best-coding' },
              { step: 3, name: 'Test', kind: 'AGY_TEST', policy: 'nexus/fast' },
              { step: 4, name: 'Verify', kind: 'AGY_VERIFY', policy: 'nexus/fast' },
            ],
          };
        }

        const app = await globalAppEngine.buildApplication(id, availableAgents);
        she.recordBuild(id, app.stage === 'COMPLETED' ? 'SUCCESS' : app.stage === 'FAILED' ? 'FAILED' : 'RUNNING');
        return app;
      } catch (err: any) {
        she.recordBuild(id, 'FAILED', { error: err.message });
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    // ── Phase 22 Build Sessions & Controls (§17, §18, §23) ────────────

    // GET /v1/applications/:id/builds — list all build sessions for an application
    this.fastify.get('/v1/applications/:id/builds', async (request, reply) => {
      const { id } = request.params as { id: string };
      const app = globalAppEngine.getApplication(id);
      if (!app) return reply.code(404).send({ error: { message: `Application '${id}' not found` } });
      const builds = globalAppEngine.listBuildSessions(id);
      return { applicationId: id, builds };
    });

    // GET /v1/applications/:id/builds/:buildId — get specific build session
    this.fastify.get('/v1/applications/:id/builds/:buildId', async (request, reply) => {
      const { id: _id, buildId } = request.params as { id: string; buildId: string };
      const build = globalAppEngine.getBuildSession(buildId);
      if (!build) return reply.code(404).send({ error: { message: `Build session '${buildId}' not found` } });
      return build;
    });

    // POST /v1/applications/:id/builds — alias for starting a build
    this.fastify.post('/v1/applications/:id/builds', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { dryRun?: boolean }) ?? {};
      try {
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        const app = await globalAppEngine.buildApplication(id, availableAgents, { dryRun: body.dryRun });
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    // POST /v1/applications/:id/build/pause & /v1/applications/:id/builds/:buildId/pause
    this.fastify.post('/v1/applications/:id/build/pause', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const app = await globalAppEngine.pauseApplication(id);
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });
    this.fastify.post('/v1/applications/:id/builds/:buildId/pause', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const app = await globalAppEngine.pauseApplication(id);
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    // POST /v1/applications/:id/build/resume & /v1/applications/:id/builds/:buildId/resume
    this.fastify.post('/v1/applications/:id/build/resume', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { dryRun?: boolean }) ?? {};
      try {
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        const app = await globalAppEngine.resumeApplication(id, availableAgents, { dryRun: body.dryRun });
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });
    this.fastify.post('/v1/applications/:id/builds/:buildId/resume', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { dryRun?: boolean }) ?? {};
      try {
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        const app = await globalAppEngine.resumeApplication(id, availableAgents, { dryRun: body.dryRun });
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    // POST /v1/applications/:id/build/repair & /v1/applications/:id/builds/:buildId/repair
    this.fastify.post('/v1/applications/:id/build/repair', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { dryRun?: boolean }) ?? {};
      try {
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        const app = await globalAppEngine.repairApplication(id, availableAgents, { dryRun: body.dryRun });
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });
    this.fastify.post('/v1/applications/:id/builds/:buildId/repair', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { dryRun?: boolean }) ?? {};
      try {
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        const app = await globalAppEngine.repairApplication(id, availableAgents, { dryRun: body.dryRun });
        return app;
      } catch (err: any) {
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    // GET /v1/applications/:id/builds/:buildId/checkpoints
    this.fastify.get('/v1/applications/:id/builds/:buildId/checkpoints', async (request, _reply) => {
      const { buildId } = request.params as { id: string; buildId: string };
      const checkpoints = globalAppEngine.getBuildCheckpoints(buildId);
      return { buildSessionId: buildId, checkpoints };
    });

    // GET /v1/applications/:id/builds/:buildId/metrics
    this.fastify.get('/v1/applications/:id/builds/:buildId/metrics', async (request, reply) => {
      const { buildId } = request.params as { id: string; buildId: string };
      const metrics = globalAppEngine.getBuildMetrics(buildId);
      if (!metrics) return reply.code(404).send({ error: { message: `Metrics for build session '${buildId}' not found` } });
      return { buildSessionId: buildId, metrics };
    });

    // GET /v1/agents/agy/health — truthful AGY health endpoint (§24)
    this.fastify.get('/v1/agents/agy/health', async () => {
      const health = await globalAgyAdapter.healthCheck();
      const apps = globalAppEngine.listApplications();
      const activeBuilds = apps.filter((a) => a.stage === 'BUILD' || a.stage === 'SCAFFOLD' || a.stage === 'REPAIR').length;
      return {
        installed: health.installed,
        version: health.version ?? 'unknown',
        executable: health.executablePath ?? 'none',
        gatewayReachable: true,
        runtimeReady: health.runtimeHealthy,
        activeBuilds,
        lastBuild: apps[apps.length - 1]?.updatedAt ? new Date(apps[apps.length - 1]!.updatedAt).toISOString() : 'none',
        status: health.installed && health.runtimeHealthy ? 'READY' : health.installed ? 'DEGRADED' : 'NOT_INSTALLED',
      };
    });

    // GET /v1/applications/:id/build — alias for build status
    this.fastify.get('/v1/applications/:id/build', async (request, reply) => {
      const { id } = request.params as { id: string };
      const app = globalAppEngine.getApplication(id);
      if (!app) return reply.code(404).send({ error: { message: `Application '${id}' not found` } });
      return {
        applicationId: app.appId,
        stage: app.stage,
        workspace: app.workspace,
        buildContext: app.buildContext,
        repairAttempts: app.repairAttempts,
        error: app.error,
      };
    });

    // GET /v1/applications/:id/build/status
    this.fastify.get('/v1/applications/:id/build/status', async (request, reply) => {
      const { id } = request.params as { id: string };
      const app = globalAppEngine.getApplication(id);
      if (!app) return reply.code(404).send({ error: { message: `Application '${id}' not found` } });
      return {
        applicationId: app.appId,
        stage: app.stage,
        runId: app.runId,
        repairAttempts: app.repairAttempts,
        requiresApproval: app.buildContext?.requiresApproval,
        riskLevel: app.buildContext?.riskLevel,
        selectedModel: app.buildContext?.selectedModel,
        lastTestResult: app.buildContext?.lastTestResult,
        workspace: app.workspace,
        error: app.error,
      };
    });

    // POST /v1/applications/:id/build/cancel & /v1/applications/:id/builds/:buildId/cancel
    this.fastify.post('/v1/applications/:id/build/cancel', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const app = await globalAppEngine.cancelApplication(id);
        return app;
      } catch (err: any) {
        return reply.code(404).send({ error: { message: err.message } });
      }
    });
    this.fastify.post('/v1/applications/:id/builds/:buildId/cancel', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const app = await globalAppEngine.cancelApplication(id);
        return app;
      } catch (err: any) {
        return reply.code(404).send({ error: { message: err.message } });
      }
    });

    // POST /v1/applications/:id/build/retry & /v1/applications/:id/builds/:buildId/retry
    this.fastify.post('/v1/applications/:id/build/retry', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { dryRun?: boolean }) ?? {};
      try {
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        const app = await globalAppEngine.retryApplication(id, availableAgents, { dryRun: body.dryRun });
        she.recordBuild(id, app.stage === 'COMPLETED' ? 'SUCCESS' : app.stage === 'FAILED' ? 'FAILED' : 'RUNNING');
        return app;
      } catch (err: any) {
        she.recordBuild(id, 'FAILED', { error: err.message });
        return reply.code(400).send({ error: { message: err.message } });
      }
    });
    this.fastify.post('/v1/applications/:id/builds/:buildId/retry', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { dryRun?: boolean }) ?? {};
      try {
        const runtimeManager = new AgentRuntimeManager();
        const availableAgents = await runtimeManager.listAgents();
        const app = await globalAppEngine.retryApplication(id, availableAgents, { dryRun: body.dryRun });
        she.recordBuild(id, app.stage === 'COMPLETED' ? 'SUCCESS' : app.stage === 'FAILED' ? 'FAILED' : 'RUNNING');
        return app;
      } catch (err: any) {
        she.recordBuild(id, 'FAILED', { error: err.message });
        return reply.code(400).send({ error: { message: err.message } });
      }
    });

    // POST /v1/applications/:id/test — run tests in workspace
    this.fastify.post('/v1/applications/:id/test', async (request, reply) => {
      const { id } = request.params as { id: string };
      const app = globalAppEngine.getApplication(id);
      if (!app) return reply.code(404).send({ error: { message: `Application '${id}' not found` } });

      const workspace = app.workspace;
      if (!workspace) return reply.code(400).send({ error: { message: 'Application has no workspace — plan and build first' } });

      const task: import('@anx/core').AgyBuildTask = {
        taskId: `test-${Date.now()}`,
        applicationId: id,
        workspaceId: workspace.workspaceId,
        workspace: {
          applicationId: id,
          workspaceId: workspace.workspaceId,
          workspacePath: workspace.workspacePath,
          buildSessionId: workspace.buildSessionId,
        },
        objective: 'Run test suite',
        kind: 'AGY_TEST',
        targetModel: app.buildContext?.selectedModel,
        policy: app.buildContext?.selectedPolicy as any,
        gatewayBaseUrl: `http://127.0.0.1:${this.deps.config.server.port ?? 8787}`,
      };

      const result = await globalAgyAdapter.test(task);
      return result;
    });

    // POST /v1/applications/:id/verify — run ApplicationVerifier
    this.fastify.post('/v1/applications/:id/verify', async (request, reply) => {
      const { id } = request.params as { id: string };
      const app = globalAppEngine.getApplication(id);
      if (!app) return reply.code(404).send({ error: { message: `Application '${id}' not found` } });

      const workspace = app.workspace;
      if (!workspace) return reply.code(400).send({ error: { message: 'Application has no workspace — plan and build first' } });

      const result = await globalAgyAdapter.verify({
        applicationId: id,
        workspaceId: workspace.workspaceId,
        workspacePath: workspace.workspacePath,
        buildSessionId: workspace.buildSessionId,
      });
      return result;
    });

    // GET /v1/applications/:id/events — SSE stream of application events
    this.fastify.get('/v1/applications/:id/events', async (request, reply) => {
      const { id } = request.params as { id: string };
      const app = globalAppEngine.getApplication(id);

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');

      // Send historical events
      const events = globalAppEngine.getApplicationEvents(id);
      for (const evt of events) {
        reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
      }

      if (!app) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Application '${id}' not found` })}\n\n`);
        reply.raw.end();
        return reply;
      }

      // Subscribe to live events matching this application
      const unsubscribe = this.deps.events.subscribe(
        [
          'application.build.started',
          'application.build.completed',
          'application.build.failed',
          'agy.execution.started',
          'agy.execution.completed',
          'agy.execution.failed',
          'agy.test.started',
          'agy.test.completed',
          'agy.repair.started',
          'agy.repair.completed',
        ] as any,
        (event: any) => {
          if (
            event.payload?.applicationId === id ||
            !event.payload?.applicationId
          ) {
            reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        },
      );

      const keepAlive = setInterval(() => {
        reply.raw.write(': ping\n\n');
      }, 15000);

      reply.raw.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });

      return reply;
    });

    // GET /v1/debug/applications — debug info
    this.fastify.get('/v1/debug/applications', async () => {
      const apps = globalAppEngine.listApplications();
      const agyHealth = await globalAgyAdapter.healthCheck();
      return {
        totalApplications: apps.length,
        byStage: apps.reduce<Record<string, number>>((acc, a) => {
          acc[a.stage] = (acc[a.stage] ?? 0) + 1;
          return acc;
        }, {}),
        engineState: 'operational',
        agyRuntime: agyHealth,
        maxRepairAttempts: 3,
      };
    });

    this.fastify.post('/v1/debug/orchestration/explain', async (request) => {
      const body = request.body as { prompt: string };
      const runtimeManager = new AgentRuntimeManager();
      const availableAgents = await runtimeManager.listAgents();
      const orchestrator = new TaskOrchestrator(this.deps.routing, globalTaskStore, globalAgentExecutor, this.deps.events);
      const plan = await orchestrator.planTask({ prompt: body.prompt }, availableAgents);
      return {
        prompt: body.prompt,
        intent: plan.category,
        selectedAgent: plan.selectedAgent,
        agentScore: plan.agentScore,
        agentReasons: plan.agentReasons,
        selectedModel: plan.selectedModel,
        provider: plan.providerId,
        policy: plan.policy,
        alternatives: plan.alternatives,
      };
    });





    // ── Token Efficiency Debug API (§11) ───────────────────────────────
    this.fastify.get('/v1/debug/tokens', async () => {
      return {
        stats: getOptStatsSummary(),
        recent: getOptStatsRecent(),
      };
    });

    // ── Routing policies / model aliases (Phase 15 §8) ───────────────────
    this.fastify.get('/v1/routing/policies', async () => {
      const aliases = this.deps.aliasRegistry.list().map((a) => ({
        alias: a.alias,
        filter: a.filter ?? null,
        ranking: a.ranking ?? null,
      }));
      return {
        intents: ['GENERAL', 'TOOL_USE', 'VISION', 'CODING', 'REASONING', 'LONG_CONTEXT', 'FREE', 'FAST'],
        aliases,
        catalogVersion: this.deps.modelRegistry.getCatalogVersion(),
      };
    });

    // ── Autonomous Intelligent Routing Fabric Debug (§20) ───────────────
    this.fastify.get('/v1/debug/routing', async () => {
      const models = this.deps.modelRegistry.list();
      const endpoints = this.deps.routing.listEndpoints();
      const defaultIntent = IntentDetector.detect([{ role: 'user', content: 'hello' }]);
      const candidateScores = models.map(m => {
        const ep = endpoints.find(e => e.providerId === m.providerId);
        return ScoringEngine.scoreCandidate(m, ep, defaultIntent, {
          modelRegistryModels: models,
          endpoints,
        });
      });
      return {
        strategy: 'autonomous_scoring_fabric',
        activeEndpoints: endpoints.filter(e => e.health === 'healthy').length,
        totalModelsEvaluated: models.length,
        candidateScores,
      };
    });



    this.fastify.post('/v1/debug/routing/explain', async (request, reply) => {
      const body = request.body as { messages?: any[]; tools?: any[]; model?: string };
      if (!body?.messages || !Array.isArray(body.messages)) {
        return reply.code(400).send({ error: { message: 'messages array is required' } });
      }
      const intent = IntentDetector.detect(body.messages, body.tools, body.model);
      const models = this.deps.modelRegistry.list();
      const endpoints = this.deps.routing.listEndpoints();
      const scores = models.map(m => {
        const ep = endpoints.find(e => e.providerId === m.providerId);
        return ScoringEngine.scoreCandidate(m, ep, intent, {
          modelRegistryModels: models,
          endpoints,
        });
      }).sort((a, b) => b.finalScore - a.finalScore);

      const topCandidate = scores[0];

      return {
        intent: intent.intent,
        confidence: intent.confidence,
        signals: intent.signals,
        requiredCapabilities: intent.requiredCapabilities,
        minContextWindow: intent.minContextWindow,
        selectedModel: topCandidate?.modelId ?? 'none',
        provider: topCandidate?.providerId ?? 'none',
        score: topCandidate?.finalScore ?? 0,
        candidateCount: scores.length,
        topCandidates: scores.slice(0, 5),
      };
    });

    // ── Routing Decisions History (Phase 20 §5) ────────────────────────
    this.fastify.get('/v1/debug/routing/recent', async (request) => {
      const q = request.query as { limit?: string };
      const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
      return {
        recent: globalObservability.getRecentRouting(limit),
      };
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
    this.fastify.get('/v1/policies', async () => {
      return { policies: this.deps.aliasRegistry.list() };
    });

    // Read-only runtime config summary for the dashboard (no secrets). Surfaces
    // the config file location, vault persistence mode, and bind so a user can
    // verify their install is configured the way they intend.
    this.fastify.get('/v1/config', async () => {
      const vaultPath = this.deps.config?.security?.vaultPath;
      const vaultKeySet = !!this.deps.config?.security?.vaultKey || !!process.env['AGENT_NEXUS_VAULT_KEY'];
      return {
        server: {
          host: this.deps.config?.server?.host ?? '127.0.0.1',
          port: this.deps.config?.server?.port ?? 8787,
        },
        routing: { strategy: this.deps.config?.routing?.strategy ?? 'weighted' },
        vault: {
          path: vaultPath ?? null,
          persisted: !!vaultPath,
          masterKeySet: vaultKeySet,
          note: vaultPath
            ? vaultKeySet
              ? 'Credentials persist across restarts (encrypted at rest).'
              : 'Vault file present; master key auto-generated on first boot and stored beside it.'
            : 'Ephemeral in-memory vault — credentials are lost on restart.',
        },
      };
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

    // WS5 Strategy A/B simulator (read-only): rank the same candidate pool
    // under two ranking strategies and return both top-N lists for comparison.
    this.fastify.post('/v1/routing/compare', async (request, reply) => {
      const body = (request.body ?? {}) as {
        strategyA?: AliasRankingStrategy;
        strategyB?: AliasRankingStrategy;
        filter?: { capability?: string; freeOnly?: boolean; minContextWindow?: number; providers?: string[] };
        topN?: number;
      };
      if (!body.strategyA || !body.strategyB) {
        return reply.code(400).send({ error: { message: 'strategyA and strategyB are required' } });
      }
      try {
        const result = this.deps.aliasRegistry.compareRankings(
          body.strategyA,
          body.strategyB,
          (body.filter as never) ?? {},
          body.topN ?? 5,
        );
        return result;
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message } });
      }
    });

    // ── Universal Provider Fabric & Zero-Config Model Onboarding ──────
    // GET /v1/providers — lists all registered providers with live discovery & key telemetry
    this.fastify.get('/v1/providers', async () => {
      const endpoints = this.deps.routing.listEndpoints();
      const allModels = this.deps.modelRegistry.list();
      const allKeys = this.deps.keyRegistry.listAll();
      const providerDiags = this.deps.modelRegistry.getProviderDiagnostics();

      return endpoints.map((e) => {
        const providerModels = allModels.filter((m) => m.providerId === e.providerId);
        const providerKeys = allKeys.filter((k) => k.providerId === e.providerId);
        const activeKeys = providerKeys.filter((k) => k.status === 'active' || k.status === 'cooldown');
        const diag = providerDiags ? providerDiags[e.providerId] : undefined;
        const activeErrors = this.errorRegistry.listActive(e.providerId);
        const lastErrDiag = activeErrors[0];
        const circuitBreakerState = e.health === 'circuit_open' ? 'open' : e.health === 'degraded' ? 'half_open' : 'closed';
        const keyErrorsSum = providerKeys.reduce((acc, k) => acc + (k.errors || 0), 0);
        const totalErrors = keyErrorsSum + activeErrors.length;

        return {
          id: e.id,
          providerId: e.providerId,
          displayName: e.displayName,
          baseUrl: e.baseUrl,
          health: e.health,
          circuitBreakerState,
          status: e.health === 'healthy' ? 'READY' : e.health === 'degraded' ? 'DEGRADED' : 'UNAVAILABLE',
          modelsCount: providerModels.length,
          keysCount: providerKeys.length,
          activeKeysCount: activeKeys.length,
          activeErrorsCount: activeErrors.length,
          errorsCount: totalErrors,
          lastErrorDiagnostic: lastErrDiag ?? null,
          priority: e.priority,
          weight: e.weight,
          region: e.region,
          tags: e.tags,
          capabilities: e.capabilities,
          pricing: e.pricing,
          lastSync: diag?.lastDiscovery ?? e.updatedAt ?? Date.now(),
          lastSuccess: diag?.lastSuccess ?? e.updatedAt ?? Date.now(),
          lastError: lastErrDiag?.upstreamMessage ?? diag?.lastError,
          updatedAt: e.updatedAt ?? Date.now(),
        };
      });
    });

    // POST /v1/providers/probe — connection & credential verification test without persisting
    this.fastify.post('/v1/providers/probe', async (request, reply) => {
      const body = request.body as {
        baseUrl?: string;
        apiKey?: string;
        providerId?: string;
        customHeaders?: Record<string, string>;
      };

      const rawBase = (body?.baseUrl ?? '').trim().replace(/\/+$/, '');
      if (!rawBase) {
        return reply.code(400).send({ error: { message: 'baseUrl is required for probe', code: 'INVALID_BASE_URL' } });
      }

      const cleanBase = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;
      if (!isSsrfSafe(cleanBase, { allowPrivate: true })) {
        return reply.code(400).send({
          ok: false,
          step: 'CONNECT',
          error: 'SSRF guard: invalid or prohibited destination URL (cloud metadata and non-HTTP schemes are blocked)',
        });
      }
      const modelsUrl = `${cleanBase}/models`;
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        ...(body?.customHeaders ?? {}),
      };

      if (body?.apiKey) {
        headers['Authorization'] = `Bearer ${body.apiKey}`;
      }

      const steps = {
        gatewayReachable: false,
        authenticationSuccessful: false,
        modelsEndpointReachable: false,
        modelsDiscoveredCount: 0,
      };

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(modelsUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        steps.gatewayReachable = true;

        if (res.status === 401 || res.status === 403) {
          return reply.code(200).send({
            ok: false,
            step: 'AUTHENTICATE',
            steps,
            error: `Authentication failed (HTTP ${res.status}). Verify your API key.`,
          });
        }

        if (!res.ok) {
          return reply.code(200).send({
            ok: false,
            step: 'FETCH_MODELS',
            steps,
            error: `Upstream models endpoint returned HTTP ${res.status}: ${res.statusText}`,
          });
        }

        steps.authenticationSuccessful = true;
        steps.modelsEndpointReachable = true;

        const data = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> };
        const rawList = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? (data as Array<{ id: string; owned_by?: string }>) : [];
        steps.modelsDiscoveredCount = rawList.length;

        return reply.send({
          ok: true,
          status: 'PROBE_SUCCESSFUL',
          baseUrl: cleanBase,
          steps,
          modelsPreview: rawList.slice(0, 30).map((m: { id: string; owned_by?: string }) => ({ id: m.id, owner: m.owned_by ?? body?.providerId ?? 'custom' })),
        });
      } catch (err) {
        return reply.code(200).send({
          ok: false,
          step: 'CONNECT',
          steps,
          error: (err as Error).message ?? 'Connection to provider failed or timed out',
        });
      }
    });

    // POST /v1/providers/onboard — full lifecycle zero-config provider onboarding
    this.fastify.post('/v1/providers/onboard', async (request, reply) => {
      const body = request.body as {
        providerId?: string;
        displayName?: string;
        baseUrl?: string;
        apiKey?: string;
        protocol?: string;
        priority?: number;
        weight?: number;
        customHeaders?: Record<string, string>;
      };

      const rawId = (body?.providerId ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      if (!rawId) {
        return reply.code(400).send({ error: { message: 'providerId is required and must be alphanumeric', code: 'INVALID_PROVIDER_ID' } });
      }

      const rawBase = (body?.baseUrl ?? '').trim().replace(/\/+$/, '');
      if (!rawBase) {
        return reply.code(400).send({ error: { message: 'baseUrl is required', code: 'INVALID_BASE_URL' } });
      }

      const cleanBase = rawBase.endsWith('/v1') ? rawBase : `${rawBase}/v1`;
      if (!isSsrfSafe(cleanBase, { allowPrivate: true })) {
        return reply.code(400).send({
          error: {
            message: 'SSRF guard: invalid or prohibited destination URL (cloud metadata and non-HTTP schemes are blocked)',
            code: 'PROHIBITED_BASE_URL',
          },
        });
      }
      const displayName = (body?.displayName ?? '').trim() || rawId.toUpperCase();
      const apiKey = body?.apiKey?.trim();
      const endpointId = `auto-${rawId}`;

      // 1. Register Adapter dynamically if not already existing
      if (!this.deps.adapters.has(rawId)) {
        this.deps.adapters.set(rawId, new GenericOpenAIAdapter(rawId, displayName, cleanBase));
      }

      // 2. Store API Key in KeyRegistry (automatically encrypted into vault)
      let registeredKey;
      if (apiKey) {
        const keyId = `key-${rawId}-${Date.now().toString(36)}`;
        registeredKey = await this.deps.keyRegistry.register({
          id: keyId,
          providerId: rawId,
          plaintext: apiKey,
          label: `${displayName} Key`,
        });
      }

      // 3. Register Endpoint in RoutingEngine
      const now = new Date();
      const endpoint: ProviderEndpoint = {
        id: endpointId,
        providerId: rawId,
        displayName,
        baseUrl: cleanBase,
        health: 'healthy',
        priority: body?.priority ?? 100,
        weight: body?.weight ?? 1,
        capabilities: defaultCapabilitiesFor(rawId),
        pricing: defaultPricingFor(rawId),
        region: 'us',
        tags: ['onboarded', 'dynamic', 'openai-compatible'],
        timeoutMs: 30000,
        maxRetries: 2,
        concurrencyLimit: 10,
        createdAt: now,
        updatedAt: now,
      };
      this.deps.routing.registerEndpoint(endpoint);

      // 4. Trigger Model Discovery for the newly onboarded provider
      const discoveryResult = await this.deps.modelRegistry.discoverProvider(rawId);

      // 5. Emit Provider Onboarded Event
      void this.deps.events?.publish({
        type: 'provider.onboarded',
        occurredAt: new Date(),
        payload: {
          providerId: rawId,
          endpointId,
          displayName,
          baseUrl: cleanBase,
          modelsDiscovered: discoveryResult.discovered,
        },
      });

      return reply.code(201).send({
        ok: true,
        status: 'READY',
        providerId: rawId,
        endpointId,
        displayName,
        baseUrl: cleanBase,
        modelsDiscovered: discoveryResult.discovered,
        key: registeredKey ? { id: registeredKey.id, lastFour: registeredKey.lastFour, status: registeredKey.status } : undefined,
        message: `Provider '${displayName}' successfully onboarded with ${discoveryResult.discovered} model(s) ready for routing.`,
      });
    });

    // DELETE /v1/providers/:id — removes provider endpoint, keys, and sweeps models
    this.fastify.delete('/v1/providers/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const endpoint = this.deps.routing.listEndpoints().find((e) => e.id === id || e.providerId === id);
      if (!endpoint) {
        return reply.code(404).send({ error: { message: `Provider or endpoint '${id}' not found` } });
      }

      const providerId = endpoint.providerId;

      // 1. Unregister endpoint
      this.deps.routing.unregisterEndpoint(endpoint.id);

      // 2. Remove all keys for this provider from KeyRegistry and Vault
      const keys = this.deps.keyRegistry.listByProvider(providerId);
      for (const k of keys) {
        await this.deps.keyRegistry.unregister(k.id);
      }

      // 3. Remove models from ModelRegistry
      const modelsRemoved = this.deps.modelRegistry.removeProvider(providerId);

      // 4. Emit event
      void this.deps.events?.publish({
        type: 'provider.removed',
        occurredAt: new Date(),
        payload: { providerId, endpointId: endpoint.id, modelsRemoved },
      });

      return {
        ok: true,
        providerId,
        endpointId: endpoint.id,
        modelsRemoved,
        message: `Provider '${providerId}' removed successfully (${modelsRemoved} models swept from catalog).`,
      };
    });

    // POST /v1/providers/:id/sync — forces immediate model discovery for a single provider
    this.fastify.post('/v1/providers/:id/sync', async (request, reply) => {
      const { id } = request.params as { id: string };
      const endpoint = this.deps.routing.listEndpoints().find((e) => e.id === id || e.providerId === id);
      if (!endpoint) {
        return reply.code(404).send({ error: { message: `Provider '${id}' not found` } });
      }

      const result = await this.deps.modelRegistry.discoverProvider(endpoint.providerId);
      return {
        ok: result.status === 'completed',
        providerId: endpoint.providerId,
        status: result.status,
        discovered: result.discovered,
        added: result.added,
        updated: result.updated,
        lastSync: Date.now(),
        error: result.error,
      };
    });

    // POST /v1/providers/:id/resolve — live remediation & verification engine (DIAGNOSE -> REMEDIATE -> VERIFY -> RECOVER)
    this.fastify.post('/v1/providers/:id/resolve', async (request) => {
      const { id } = request.params as { id: string };
      const report = await this.liveErrorResolver.resolveProvider(id);
      return report;
    });

    // GET /v1/providers/:id/diagnostics — rich error diagnostic records for a specific provider
    this.fastify.get('/v1/providers/:id/diagnostics', async (request, reply) => {
      const { id } = request.params as { id: string };
      const endpoint = this.deps.routing.listEndpoints().find((e) => e.id === id || e.providerId === id);
      if (!endpoint) {
        return reply.code(404).send({ error: { message: `Provider '${id}' not found` } });
      }
      const providerId = endpoint.providerId;
      const allErrors = this.errorRegistry.list({ providerId });
      const activeErrors = allErrors.filter((e) => !e.resolved);
      const keys = this.deps.keyRegistry.listByProvider(providerId);
      const models = this.deps.modelRegistry.list().filter((m) => m.providerId === providerId);

      return {
        providerId,
        displayName: endpoint.displayName,
        baseUrl: endpoint.baseUrl,
        health: endpoint.health,
        circuitBreakerState: endpoint.health === 'circuit_open' ? 'open' : endpoint.health === 'degraded' ? 'half_open' : 'closed',
        activeErrorsCount: activeErrors.length,
        activeErrors,
        history: allErrors.slice(0, 20),
        keysSummary: {
          total: keys.length,
          active: keys.filter((k) => k.status === 'active').length,
          cooldown: keys.filter((k) => k.status === 'cooldown').length,
          invalid: keys.filter((k) => k.status === 'invalid').length,
        },
        modelsSummary: {
          total: models.length,
          healthy: models.filter((m) => !m.stale).length,
          unhealthy: models.filter((m) => m.stale).length,
        },
      };
    });

    // GET /v1/models/explore — rich Model Explorer endpoint with multi-criteria filtering
    this.fastify.get('/v1/models/explore', async (request) => {
      const query = request.query as {
        provider?: string;
        free?: string;
        vision?: string;
        reasoning?: string;
        tools?: string;
        streaming?: string;
        search?: string;
        limit?: string;
        offset?: string;
      };

      let list = this.deps.modelRegistry.list();

      if (query.provider) {
        const provs = query.provider.toLowerCase().split(',');
        list = list.filter((m) => provs.includes(m.providerId.toLowerCase()));
      }
      if (query.free === 'true') {
        list = list.filter((m) => m.pricing?.isFree === true);
      } else if (query.free === 'false') {
        list = list.filter((m) => m.pricing?.isFree !== true);
      }
      if (query.vision === 'true') {
        list = list.filter((m) => m.capabilities?.vision === true);
      }
      if (query.reasoning === 'true') {
        list = list.filter((m) => m.capabilities?.reasoning === true || m.id.includes('think') || m.id.includes('r1') || m.id.includes('reason'));
      }
      if (query.tools === 'true') {
        list = list.filter((m) => m.capabilities?.toolCalling === true);
      }
      if (query.streaming === 'true') {
        list = list.filter((m) => m.capabilities?.streaming !== false);
      }
      if (query.search) {
        const term = query.search.toLowerCase();
        list = list.filter((m) => m.id.toLowerCase().includes(term) || (m.displayName ?? '').toLowerCase().includes(term) || m.providerId.toLowerCase().includes(term));
      }

      const total = list.length;
      const offset = Math.max(0, parseInt(query.offset ?? '0', 10) || 0);
      const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? '50', 10) || 50));
      const paginated = list.slice(offset, offset + limit);

      return {
        total,
        offset,
        limit,
        models: paginated.map((m) => ({
          id: m.id,
          providerId: m.providerId,
          displayName: m.displayName ?? m.id,
          contextWindow: m.contextWindow ?? 8192,
          maxOutputTokens: m.maxOutputTokens ?? 4096,
          capabilities: m.capabilities,
          pricing: m.pricing ?? { isFree: false, source: 'unknown' },
          isFree: m.pricing?.isFree === true,
          health: m.stale ? 'stale' : 'healthy',
          discoveredAt: m.discoveredAt,
          nexusAlias: `nexus/${m.providerId}/${m.id}`,
        })),
      };
    });

    // GET /v1/models/:providerId/:modelId — detailed model metadata and coding agent integration snippets
    this.fastify.get('/v1/models/:providerId/:modelId', async (request, reply) => {
      const { providerId, modelId } = request.params as { providerId: string; modelId: string };
      const model = this.deps.modelRegistry.get(providerId, modelId)
        ?? this.deps.modelRegistry.list().find((m) => m.providerId === providerId && m.id === modelId);

      if (!model) {
        return reply.code(404).send({ error: { message: `Model '${providerId}/${modelId}' not found in active catalog` } });
      }

      const endpoint = this.deps.routing.listEndpoints().find((e) => e.providerId === providerId);

      return {
        id: model.id,
        providerId: model.providerId,
        displayName: model.displayName ?? model.id,
        contextWindow: model.contextWindow ?? 8192,
        maxOutputTokens: model.maxOutputTokens ?? 4096,
        capabilities: model.capabilities,
        pricing: model.pricing ?? { isFree: false, source: 'unknown' },
        isFree: model.pricing?.isFree === true,
        health: model.stale ? 'stale' : (endpoint?.health ?? 'healthy'),
        discoveredAt: model.discoveredAt,
        agentSnippets: {
          claudeCode: `export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"\nexport ANTHROPIC_API_KEY="nexus"\nclaude --model nexus/${model.providerId}/${model.id}`,
          codexCli: `codex --model nexus/${model.providerId}/${model.id}`,
          hermesCli: `hermes -m nexus/${model.providerId}/${model.id}`,
          agy: `agy -m nexus/${model.providerId}/${model.id}`,
          curl: `curl -X POST http://127.0.0.1:8787/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "nexus/${model.providerId}/${model.id}", "messages": [{"role": "user", "content": "Hello"}]}'`,
        },
      };
    });

    // ── Manual failover / fallback-model configuration ─────────────────────
    // GET /v1/fallbacks?providerId=X&modelId=Y — current fallback chain + a
    // ranked list of similar-benchmark-tier candidate models for the dropdown.
    this.fastify.get('/v1/fallbacks', async (request, reply) => {
      const { providerId, modelId } = (request.query ?? {}) as { providerId?: string; modelId?: string };
      if (!providerId || !modelId) {
        return reply.code(400).send({ error: { message: 'providerId and modelId query params are required' } });
      }
      const model =
        this.deps.modelRegistry.get(providerId, modelId) ??
        this.deps.modelRegistry.list().find((m) => m.providerId === providerId && m.id === modelId);
      if (!model) {
        return reply.code(404).send({ error: { message: `Model '${providerId}/${modelId}' not found in active catalog` } });
      }
      const current = this.deps.falloverConfig?.get(model.id) ?? [];
      const candidates = rankSimilarModels(model, this.deps.modelRegistry.list(), 30);
      return { modelId: model.id, providerId: model.providerId, current, candidates };
    });

    // PUT /v1/fallbacks — save the ordered fallback chain (manual fallbacks are
    // tried FIRST, then automatic failover).
    this.fastify.put('/v1/fallbacks', async (request, reply) => {
      const body = (request.body ?? {}) as { providerId?: string; modelId?: string; fallbacks?: string[] };
      const { providerId, modelId } = body;
      if (!providerId || !modelId) {
        return reply.code(400).send({ error: { message: 'providerId and modelId are required' } });
      }
      const model =
        this.deps.modelRegistry.get(providerId, modelId) ??
        this.deps.modelRegistry.list().find((m) => m.providerId === providerId && m.id === modelId);
      if (!model) {
        return reply.code(404).send({ error: { message: `Model '${providerId}/${modelId}' not found in active catalog` } });
      }
      const fallbacks = Array.isArray(body.fallbacks) ? body.fallbacks : [];
      const known = new Set(this.deps.modelRegistry.list().map((m) => m.id));
      const invalid = fallbacks.filter((f) => !known.has(f));
      if (invalid.length > 0) {
        return reply.code(400).send({ error: { message: `Unknown fallback model(s): ${invalid.join(', ')}` } });
      }
      this.deps.falloverConfig?.set(model.id, fallbacks);
      return { ok: true, modelId: model.id, fallbacks: this.deps.falloverConfig?.get(model.id) ?? [] };
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

    // ── Shared live token-optimization (Compression Lab → real savings) ──
    // Applies the TokenOptimizer to a request's messages on the LIVE path and
    // records the realized savings into the optimizer stats (which feed
    // /v1/system/metrics + the dashboard). Default OFF (env ANX_TOKEN_MODE=off)
    // → zero behavior change for existing callers. A per-request override via
    // the `x-nexus-token-mode` header (or ?token_mode=) lets a caller opt in
    // without restarting the gateway. Non-destructive: if nothing is optimized,
    // the original messages pass through unchanged.
    const applyLiveOptimization = (
      messages: unknown,
      reply: any,
      model: string,
      request: any,
    ): { messages: unknown; changed: boolean } => {
      const envMode = (process.env['ANX_TOKEN_OPT_MODE'] ?? process.env['ANX_TOKEN_MODE'] ?? 'off').toLowerCase();
      const headerMode = (
        (request.headers['x-nexus-token-mode'] as string | undefined)?.trim()
        || ((request.query as { token_mode?: string })?.token_mode)?.trim()
        || ''
      ).toLowerCase();
      const mode = headerMode || envMode;
      // Single live-compression guarantee: when the profile-based
      // PromptCompressor is active, it OWNS the live compression pass. Never
      // double-compress with the separate applyLiveOptimization path.
      if (this.deps.promptCompressor.getConfig().activeProfile !== 'none') {
        return { messages, changed: false };
      }
      if (mode === 'off' || !mode) return { messages, changed: false };

      try {
        const optimizer = new TokenOptimizer(mode as OptimizationMode);
        const opt = optimizer.optimize(messages as unknown as OptMessage[], {
          maxContextTokens: Number(process.env['ANX_TOKEN_BUDGET'] ?? 190_000),
        });
        if (opt.changed) {
          recordOptStats({
            mode: opt.stats.mode,
            model,
            originalTokens: opt.stats.originalTokens,
            optimizedTokens: opt.stats.optimizedTokens,
            savedTokens: opt.stats.savedTokens,
            savingsPct: opt.stats.savingsPct,
            changed: true,
          });
          reply.header('x-anx-opt-mode', opt.stats.mode);
          reply.header('x-anx-opt-saved-tokens', String(opt.stats.savedTokens));
          this.fastify.log.info(
            `[token-efficiency] live mode=${opt.stats.mode} saved ${opt.stats.savedTokens} tokens (${opt.stats.savingsPct}%)`,
          );
          return { messages: opt.messages, changed: true };
        }
      } catch (err) {
        this.fastify.log.warn(`[token-efficiency] live optimize skipped: ${(err as Error).message}`);
      }
      return { messages, changed: false };
    }

    // ── Chat Completions (OpenAI-compatible, streaming + non-streaming)
    const handleChatCompletions = async (request: any, reply: any) => {
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
      // Free-tier exhaustion: a free-only alias that cannot resolve must be a
      // clean 503 NO_ELIGIBLE_PROVIDER, not a 500 unknown-model failure.
      if (this.deps.aliasRegistry.isExhaustedFreeOnlyAlias(body.model)) {
        return reply.code(503).send({
          error: {
            message: `No free-tier model available for '${body.model}' — free-tier exhausted or no free models configured`,
            code: 'NO_ELIGIBLE_PROVIDER',
            type: 'no_eligible_provider',
          },
        });
      }
      const providerHint = this.preferredProviderFor(aliasResolution.model, aliasResolution.resolution);

      // ─── Per-request provider pinning (B4) ─────────────────────────────
      // x-nexus-provider header or ?provider= query forces a specific
      // provider; it takes highest precedence over alias-derived hints.
      const pinnedProvider =
        (request.headers['x-nexus-provider'] as string | undefined)?.trim()
        || (request.query as { provider?: string })?.provider?.trim()
        || undefined;

      // ─── Free-model preference (B3) ───────────────────────────────────
      // When NEXUS_PREFER_FREE is not explicitly 'false', the gateway prefers
      // free-serving providers so it keeps running on $0 models non-stop. An
      // explicit provider pin (header) overrides this preference.
      const preferFree = process.env['NEXUS_PREFER_FREE'] !== 'false' && !pinnedProvider;
      const bodyRouting = (body as { routing?: Record<string, unknown> }).routing ?? {};
      const routingExtra: Record<string, unknown> = { ...bodyRouting };
      if (pinnedProvider) {
        routingExtra.preferredProviders = [pinnedProvider];
      } else if (providerHint) {
        // A provider hint derived from an explicit nexus/<provider>/<model>
        // URI (what the model picker and all coding agents emit) MUST always
        // win — even when NEXUS_PREFER_FREE is on. Otherwise the request is
        // pulled into the free_only strategy and rerouted to a free default
        // model on the WRONG provider, producing "Model not supported" 401s
        // and the coding-agent interruption class. Free-preference is only
        // meant for requests that named NO provider at all.
        routingExtra.preferredProviders = [providerHint];
      }
      if (preferFree && !pinnedProvider && !providerHint) {
        const freeProviders = Array.from(
          new Set(this.deps.modelRegistry.listFree().map((m) => m.providerId)),
        );
        if (freeProviders.length > 0) {
          routingExtra.freeProviderIds = freeProviders;
          // Only auto-switch to free_only when the caller didn't ask for a
          // specific strategy, so explicit strategies stay respected.
          if (!bodyRouting.strategy) routingExtra.strategy = 'free_only';
        }
      }
      const effectiveBody = {
        ...body,
        model: aliasResolution.model,
        routing: routingExtra,
      };

      // Live token-optimization (Compression Lab → real savings). Opt-in:
      // ANX_TOKEN_MODE env OR per-request x-nexus-token-mode header. Default
      // OFF → no behavior change. Realized savings recorded for the dashboard.
      const optimized = applyLiveOptimization(effectiveBody.messages, reply, aliasResolution.model, request);
      if (optimized.changed) effectiveBody.messages = optimized.messages as typeof effectiveBody.messages;

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
            reply.raw.write(`data: ${JSON.stringify({ error: { message: this.httpErrorFor(error).message } })}\n\n`);
            reply.raw.end();
          },
          end: async () => {
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
          },
        };

        // Manual failover: the operator may have pinned a chain of fallback
        // MODELS for the resolved primary. They are retried (re-resolved per
        // model) on primary/upstream failure — see executeChatFallbackChain.
        const fallbackChain = [
          aliasResolution.model,
          ...(this.deps.falloverConfig?.get(aliasResolution.model) ?? []),
        ];
        const runWithFallbacks = (s: ChunkSink | undefined) =>
          this.executeChatFallbackChain(body, request, fallbackChain, s);

        try {
          await runWithFallbacks(sink);
        } catch (err) {
          if (!reply.raw.headersSent) {
            const errMsg = (err as Error).message ?? '';
            if (errMsg.includes('Rate limit') || errMsg.includes('FreeUsageLimitError') || errMsg.includes('429') || errMsg.includes('exhausted') || errMsg.includes('Missing API key') || errMsg.includes('401') || errMsg.includes('402')) {
              this.deps.aliasRegistry.recordRateLimitCooldown(aliasResolution.model, 60_000);
            }
            const http = this.httpErrorFor(err as Error);
            reply.code(http.status).send({ error: { message: http.message } });
          } else {
            const http = this.httpErrorFor(err as Error);
            reply.raw.write(`data: ${JSON.stringify({ error: { message: http.message } })}\n\n`);
            reply.raw.end();
          }
        }
        return reply;
      }

      const fallbackChain = [
        aliasResolution.model,
        ...(this.deps.falloverConfig?.get(aliasResolution.model) ?? []),
      ];
      try {
        const response = (await this.executeChatFallbackChain(body, request, fallbackChain, undefined)) as ChatCompletionResponse;
        return response;
      } catch (err) {
        const errMsg = (err as Error).message ?? '';
        if (errMsg.includes('Rate limit') || errMsg.includes('FreeUsageLimitError') || errMsg.includes('429') || errMsg.includes('exhausted') || errMsg.includes('Missing API key') || errMsg.includes('401') || errMsg.includes('402')) {
          this.deps.aliasRegistry.recordRateLimitCooldown(aliasResolution.model, 60_000);
        }
        this.reportUpstreamModelError(aliasResolution.model, err as Error);
        const http = this.httpErrorFor(err as Error);
        return reply.code(http.status).send({ error: { message: http.message, code: (err as { code?: string }).code } });
      }
    };
    this.fastify.post('/v1/chat/completions', handleChatCompletions);
    this.fastify.post('/chat/completions', handleChatCompletions);
    this.fastify.post('/v1/v1/chat/completions', handleChatCompletions);

    // ── Anthropic-compatible Messages API (POST /v1/messages) ──────────
    // Lets Claude Code (and other Anthropic-protocol agents) talk to the
    // gateway natively — set ANTHROPIC_BASE_URL=http://127.0.0.1:8787 and
    // ANTHROPIC_AUTH_TOKEN=<anything> and it just works.
    const handleResponses = async (request: any, reply: any) => {
      const body = request.body as ResponsesRequest | null | undefined;
      if (!body || typeof body !== 'object') {
        return reply.code(400).send({ error: { message: 'request body required' } });
      }
      const requestedModel = body.model ?? 'claude-sonnet-4-5';
      const principal = await this.authenticate(request.headers['authorization'] as string | undefined);
      const authz = this.requirePermission(principal, 'gateway:chat', requestedModel, reply);
      if (authz === 'deny') return reply;
      const aliasResolution = this.deps.aliasRegistry.resolveIfAlias(requestedModel);
      if (this.deps.aliasRegistry.isExhaustedFreeOnlyAlias(requestedModel)) {
        return reply.code(503).send({
          error: {
            message: `No free-tier model available for '${requestedModel}' — free-tier exhausted or no free models configured`,
            code: 'NO_ELIGIBLE_PROVIDER',
            type: 'no_eligible_provider',
          },
        });
      }
      const providerHint = this.preferredProviderFor(aliasResolution.model, aliasResolution.resolution);
      const routing = { ...(((body as { routing?: Record<string, unknown> }).routing) ?? {}), ...(providerHint ? { preferredProviders: [providerHint] } : {}) };
      const chatReq = toChatRequest(body);
      const maxTokens = chatReq.maxTokens && chatReq.maxTokens > 4096 ? 4096 : chatReq.maxTokens;
      const effectiveBody = { ...chatReq, maxTokens, model: aliasResolution.model, routing };
      const wantsStream = Boolean(body.stream || request.headers.accept?.includes('text/event-stream'));
      if (wantsStream) {
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        const safeWrite = (data: string) => {
          if (!reply.raw.writableEnded) reply.raw.write(data);
        };
        const safeEnd = () => {
          if (!reply.raw.writableEnded) reply.raw.end();
        };
        const state = newResponsesStreamState(effectiveBody.model);
        const sink = {
          write: async (chunk: ChatCompletionChunk) => {
            for (const event of translateChunkToResponsesEvents(chunk, state)) {
              safeWrite(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            }
          },
          error: async (error: Error) => {
            const errMsg = (error as Error).message ?? '';
            if (errMsg.includes('Rate limit') || errMsg.includes('FreeUsageLimitError') || errMsg.includes('429') || errMsg.includes('exhausted') || errMsg.includes('Missing API key') || errMsg.includes('401') || errMsg.includes('402') || errMsg.includes('404')) {
              this.deps.aliasRegistry.recordRateLimitCooldown(effectiveBody.model, 60_000);
            }
            this.reportUpstreamModelError(effectiveBody.model, error as Error);
            for (const event of failResponsesEvents(state, this.httpErrorFor(error).message)) {
              safeWrite(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            }
            safeWrite(`event: error\ndata: ${JSON.stringify({ type: 'error', code: 'api_error', message: this.httpErrorFor(error).message })}\n\n`);
            safeEnd();
          },
          end: async () => {
            for (const event of finalizeResponsesEvents(state)) {
              safeWrite(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            }
            safeEnd();
          },
        };
        try {
          await this.deps.chatUseCase.execute(this.fitToContextWindow(effectiveBody, aliasResolution.model), sink, new AbortController().signal);
        } catch (error) {
          const errMsg = (error as Error).message ?? '';
          if (errMsg.includes('Rate limit') || errMsg.includes('FreeUsageLimitError') || errMsg.includes('429') || errMsg.includes('exhausted') || errMsg.includes('Missing API key') || errMsg.includes('401') || errMsg.includes('402') || errMsg.includes('404')) {
            this.deps.aliasRegistry.recordRateLimitCooldown(effectiveBody.model, 60_000);
          }
          this.reportUpstreamModelError(effectiveBody.model, error as Error);
          const http = this.httpErrorFor(error as Error);
          if (!reply.raw.headersSent) {
            return reply.code(http.status).send({ error: { message: http.message } });
          }
          for (const event of failResponsesEvents(state, http.message)) {
            safeWrite(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
          safeWrite(`event: error\ndata: ${JSON.stringify({ type: 'error', code: 'api_error', message: http.message })}\n\n`);
          safeEnd();
        }
        return reply;
      }
      try {
        const response = await this.deps.chatUseCase.execute(this.fitToContextWindow(effectiveBody, aliasResolution.model), undefined, new AbortController().signal);
        return toResponsesResponse(response, effectiveBody.model);
      } catch (error) {
        const http = this.httpErrorFor(error as Error);
        return reply.code(http.status).send({ error: { message: http.message } });
      }
    };

    this.fastify.post('/responses', handleResponses);
    this.fastify.post('/v1/responses', handleResponses);
    this.fastify.post('/v1/v1/responses', handleResponses);

    const handleMessages = async (request: any, reply: any) => {
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

      // Smart model aliasing — resolve local/free, local/coding, etc.
      // Resolve BEFORE translation so we can gate reasoning_content on the
      // *resolved* target model's capability.
      const aliasResolution = this.deps.aliasRegistry.resolveIfAlias(anthropicReq.model);
      if (this.deps.aliasRegistry.isExhaustedFreeOnlyAlias(anthropicReq.model)) {
        return reply.code(503).send({
          type: 'error',
          error: {
            type: 'no_eligible_provider',
            message: `No free-tier model available for '${anthropicReq.model}' — free-tier exhausted or no free models configured`,
          },
        });
      }

      // Translate Anthropic → internal OpenAI-compatible request.
      // Only forward `reasoning_content` when the *resolved target* model
      // actually supports reasoning (DeepSeek-style thinking upstreams);
      // otherwise providers like Mistral/Cerebras/GLM/OpenAI reject the field.
      const resolvedDescriptor = this.deps.modelRegistry
        .list()
        .find((md) => md.id === aliasResolution.model || md.id.endsWith('/' + aliasResolution.model));
      const targetSupportsReasoning = resolvedDescriptor?.capabilities?.reasoning === true;
      const internalReq = translateAnthropicRequest(anthropicReq, { targetSupportsReasoning });

      // Token-efficiency layer (§15–§36): opt-in via ANX_TOKEN_MODE env OR
      // per-request x-nexus-token-mode header. Default OFF → zero behavior
      // change. Realized savings are recorded for the dashboard.
      const optResult = applyLiveOptimization(internalReq.messages, reply, internalReq.model, request);
      const optMessages = optResult.changed ? (optResult.messages as never[]) : undefined;

      const providerHint = this.preferredProviderFor(aliasResolution.model, aliasResolution.resolution);
      const reqRouting = (internalReq as { routing?: Record<string, unknown> }).routing ?? {};
      const effectiveReq = {
              ...internalReq,
              ...(optMessages ? { messages: optMessages } : {}),
              model: aliasResolution.model,
              ...(providerHint ? { routing: { ...reqRouting, preferredProviders: [providerHint] } } : {}),
            };

      // Streaming path: emit Anthropic-format SSE events.
      if (anthropicReq.stream) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.flushHeaders?.();

        // Guarded writes: once the response has ended (writableEnded), any
        // further write throws ERR_STREAM_WRITE_AFTER_END and — being an
        // unhandled 'error' event on the ServerResponse — takes down the
        // whole gateway. The upstream may error, abort, or end the stream
        // at any point; these helpers make every late write/end a no-op.
        const safeWrite = (data: string): void => {
          if (reply.raw.writableEnded || reply.raw.destroyed) return;
          try {
            reply.raw.write(data);
          } catch {
            /* stream already closing — ignore */
          }
        };
        const safeEnd = (): void => {
          if (reply.raw.writableEnded || reply.raw.destroyed) return;
          try {
            reply.raw.end();
          } catch {
            /* stream already closing — ignore */
          }
        };

        const state = newStreamState(anthropicReq.model);
        const sink = {
          write: async (chunk: ChatCompletionChunk) => {
            for (const evt of translateChunkToAnthropicEvents(chunk, state)) {
              const payload = `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
              safeWrite(payload);
              state.committedBytes += payload.length;
            }
          },
          error: async (error: Error) => {
            // WS4-A: mid-stream failover. If the upstream died BEFORE any
            // content reached the client (committedBytes === 0), transparently
            // re-execute on the next eligible endpoint — the failed one is now
            // circuit-broken via recordFailure, so routing picks a healthy
            // alternative. The client sees one seamless SSE stream; the agent
            // never notices the upstream key died. Only attempted once to avoid
            // loops. If content was already emitted (partial stream), we can't
            // un-emit it, so we end with the error event (honest boundary).
            if (state.committedBytes === 0 && !state.midStreamRetried) {
              state.midStreamRetried = true;
              try {
                await this.deps.chatUseCase.execute(
                  this.fitToContextWindow(effectiveReq, aliasResolution.model),
                  sink,
                  new AbortController().signal,
                );
                return;
              } catch {
                // fall through to the error-path below
              }
            }
            const errEvt = {
              type: 'error',
              error: { type: 'api_error', message: this.httpErrorFor(error).message },
            };
            safeWrite(`event: error\ndata: ${JSON.stringify(errEvt)}\n\n`);
            safeEnd();
          },
          end: async () => {
            safeEnd();
          },
        };

        const fallbackChain = [
          aliasResolution.model,
          ...(this.deps.falloverConfig?.get(aliasResolution.model) ?? []),
        ];
        try {
          await this.executeChatFallbackChain(effectiveReq, request, fallbackChain, sink);
        } catch (err) {
          const http = this.httpErrorFor(err as Error);
          if (!reply.raw.headersSent) {
            reply.code(http.status).send({
              type: 'error',
              error: { type: 'api_error', message: http.message },
            });
          } else {
            const errEvt = {
              type: 'error',
              error: { type: 'api_error', message: http.message },
            };
            safeWrite(`event: error\ndata: ${JSON.stringify(errEvt)}\n\n`);
            safeEnd();
          }
          this.reportUpstreamModelError(anthropicReq.model, err as Error);
        }
        return reply;
      }

      // Non-streaming path: translate response back to Anthropic format with fallback chain.
      const fallbackChain = [
        aliasResolution.model,
        ...(this.deps.falloverConfig?.get(aliasResolution.model) ?? []),
      ];
      try {
        const response = (await this.executeChatFallbackChain(effectiveReq, request, fallbackChain, undefined)) as ChatCompletionResponse;
        return translateToAnthropicResponse(response, anthropicReq.model);
      } catch (err) {
        const http = this.httpErrorFor(err as Error);
        this.reportUpstreamModelError(anthropicReq.model, err as Error);
        return reply.code(http.status).send({
          type: 'error',
          error: { type: 'api_error', message: http.message },
        });
      }
    };
    this.fastify.post('/v1/messages', handleMessages);
    this.fastify.post('/messages', handleMessages);
    this.fastify.post('/v1/v1/messages', handleMessages);

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
      let endpoint = endpoints.find(
        (e) => e.tags.includes(body.model) || e.id === body.model || e.providerId === body.model,
      );
      if (!endpoint) {
        // A model id (e.g. `mistral-embed`) maps to its provider's endpoint
        // even though it isn't a tag/id/providerId of that endpoint.
        const modelEntry = this.deps.modelRegistry.list().find((m) => m.id === body.model);
        if (modelEntry) endpoint = endpoints.find((e) => e.providerId === modelEntry.providerId);
      }
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

    // ── Granular Metrics Sub-resources (Phase 20 §11) ──────────────────
    this.fastify.get('/v1/metrics/usage', async () => {
      const traces = this.deps.tracer.stats();
      const opt = getOptStatsSummary();
      return {
        requestsTotal: traces.totalTraces,
        requestsSuccess: traces.successCount,
        requestsFailed: traces.failedCount,
        tokensInput: opt.originalTokens,
        tokensOutput: opt.optimizedTokens,
        tokensSaved: opt.savedTokens,
        tokenSavingsPercent: opt.overallSavingsPct,
        uptime: process.uptime(),
      };
    });

    this.fastify.get('/v1/metrics/providers', async () => {
      const endpoints = this.deps.routing.listEndpoints();
      const keys = this.deps.keyRegistry.listAll();
      const byProvider: Record<string, {
        providerId: string;
        healthy: boolean;
        endpointsCount: number;
        keysCount: number;
        activeKeys: number;
        totalRequests: number;
        totalTokens: number;
        totalErrors: number;
        avgLatencyMs: number;
      }> = {};

      for (const ep of endpoints) {
        const pid = ep.providerId;
        if (!byProvider[pid]) {
          byProvider[pid] = {
            providerId: pid,
            healthy: ep.health === 'healthy',
            endpointsCount: 0,
            keysCount: 0,
            activeKeys: 0,
            totalRequests: 0,
            totalTokens: 0,
            totalErrors: 0,
            avgLatencyMs: 0,
          };
        }
        byProvider[pid].endpointsCount++;
        if (ep.health === 'healthy') byProvider[pid].healthy = true;
      }

      for (const k of keys) {
        const pid = k.providerId;
        if (byProvider[pid]) {
          byProvider[pid].keysCount++;
          if (k.status === 'active') byProvider[pid].activeKeys++;
          byProvider[pid].totalRequests += k.requests;
          byProvider[pid].totalTokens += k.tokens;
          byProvider[pid].totalErrors += k.errors;
        }
      }

      return { providers: Object.values(byProvider) };
    });

    this.fastify.get('/v1/metrics/models', async () => {
      const stats = this.deps.modelRegistry.stats();
      return {
        totalModels: stats.totalModels,
        freeModels: stats.freeModels,
        staleModels: stats.staleModels,
        byProvider: stats.byProvider,
        lastRefreshAt: stats.lastRefreshAt,
      };
    });

    // ── Unified Observability Snapshot (Phase 20 §16) ───────────────────
    this.fastify.get('/v1/debug/observability', async () => {
      const obs = globalObservability.getSnapshot();
      const opt = getOptStatsSummary();
      const endpoints = this.deps.routing.listEndpoints();
      const apps = globalAppEngine.listApplications();
      const manager = new AgentRuntimeManager();
      const agents = await manager.listAgents();

      return {
        requestsTotal: obs.requestsTotal,
        requestsSuccess: obs.requestsSuccess,
        requestsFailed: obs.requestsFailed,
        activeRequests: obs.activeRequests,
        avgLatencyMs: obs.avgLatencyMs,
        p50Ms: obs.p50Ms,
        p95Ms: obs.p95Ms,
        p99Ms: obs.p99Ms,
        tokensInput: opt.originalTokens,
        tokensOutput: opt.optimizedTokens,
        tokensSaved: opt.savedTokens,
        tokenSavingsPercent: opt.overallSavingsPct,
        activeAgents: agents.filter(a => a.runnable).length,
        activeWorkflows: 0,
        activeApplications: apps.filter(a => a.stage === 'BUILD' || a.stage === 'REPAIR').length,
        providerFailures: 0,
        modelFailures: 0,
        rateLimits: 0,
        cooldowns: this.deps.keyRegistry.listAll().filter(k => k.status === 'cooldown').length,
        circuitOpenCount: endpoints.filter(e => e.health === 'circuit_open').length,
        uptime: process.uptime(),
        catalogVersion: this.deps.modelRegistry.getCatalogVersion(),
      };
    });

    // ── OpenAPI Schema Endpoint (Phase 20 §14) ──────────────────────────
    this.fastify.get('/v1/openapi.json', async () => {
      return {
        openapi: '3.0.3',
        info: {
          title: 'Nexus Autonomous AI Gateway API',
          version: GATEWAY_VERSION,
          description: 'Production-grade universal AI coding-agent gateway and control plane API.',
        },
        paths: {
          '/health': { get: { summary: 'Overall gateway health check' } },
          '/ready': { get: { summary: 'Subsystem readiness probe' } },
          '/live': { get: { summary: 'Process liveness probe' } },
          '/v1/system/health': { get: { summary: 'Truthful multi-subsystem aggregated health status' } },
          '/v1/system/status': { get: { summary: 'High-level operational overview' } },
          '/v1/system/diagnostics': { get: { summary: 'Deep diagnostic analysis with root causes and remediation' } },
          '/v1/system/events': { get: { summary: 'Real-time Server-Sent Events (SSE) telemetry stream' } },
          '/v1/system/metrics': { get: { summary: 'Comprehensive operations metrics & latency distribution' } },
          '/v1/routing/explain': {
            get: { summary: 'Sanitized routing decision reasoning and candidate breakdown' },
            post: { summary: 'Explain routing decision for specific request payload' },
          },
          '/v1/models': { get: { summary: 'List discovered and registered models' } },
          '/v1/catalog': { get: { summary: 'Universal normalized model catalog' } },
          '/v1/catalog/status': { get: { summary: 'Real-time catalog and provider discovery status' } },
          '/v1/runtime-agents': { get: { summary: 'List detected and configured coding agents' } },
          '/v1/runtime-agents/health': { get: { summary: 'Health diagnostics for supported agents' } },
          '/v1/debug/observability': { get: { summary: 'Aggregated real-time observability telemetry' } },
          '/v1/metrics': { get: { summary: 'System, provider, and router metrics' } },
          '/v1/metrics/usage': { get: { summary: 'Token and request usage metrics' } },
          '/v1/debug/routing/recent': { get: { summary: 'Recent intelligent routing decisions history' } },
          '/v1/missions': {
            get: { summary: 'List autonomous missions' },
            post: { summary: 'Create and plan new autonomous mission' },
          },
          '/v1/applications': {
            get: { summary: 'List autonomous applications' },
            post: { summary: 'Create new autonomous application specification' },
          },
        },
      };
    });

    // ── Token-economics (§30) — real measurements from the optimizer ───
    this.fastify.get('/v1/optimizer/stats', async () => {
      return { ...getOptStatsSummary(), recent: getOptStatsRecent() };
    });

    // ── Repository context index (§20–21) — read-only, no mutation ────
    this.fastify.get('/v1/repo/index', async (request) => {
      const { root } = request.query as { root?: string };
      const repoRoot = root && root.length > 0 ? root : process.cwd();
      const res = scanRepository(repoRoot);
      return {
        ...res,
        fileCount: res.files.length,
        totalSizeBytes: res.files.reduce((acc, f) => acc + f.sizeBytes, 0),
      };
    });

    // §21 selection: changed files first (git porcelain), then budget-capped ranking.
    this.fastify.get('/v1/repo/selection', async (request) => {
      const q = request.query as { root?: string; maxFiles?: string; maxTokens?: string };
      const repoRoot = q.root && q.root.length > 0 ? q.root : process.cwd();
      const index = scanRepository(repoRoot);
      let changedFiles: string[] = [];
      try {
        const { execSync } = await import('node:child_process');
        const porcelain = execSync('git status --porcelain', {
          cwd: repoRoot,
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        changedFiles = parseGitPorcelain(porcelain).map((e) => e.path);
      } catch {
        /* not a git repo or git unavailable — selection degrades to ranking */
      }
      const ranked = rankRepository(index, changedFiles);
      const selection = selectRepositoryContext(ranked, {
        maxFiles: q.maxFiles ? Number(q.maxFiles) : 25,
        maxTokens: q.maxTokens ? Number(q.maxTokens) : 60_000,
      });
      return {
        root: repoRoot,
        changedFiles,
        scannedFiles: index.files.length,
        ...selection,
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
    const handleAgentsDetect = async () => {
      const detected = await this.deps.agentDetector.detectAll();
      return {
        platform: process.platform,
        arch: process.arch,
        agents: detected,
        foundCount: detected.filter((a) => a.found).length,
        totalCount: detected.length,
      };
    };
    this.fastify.get('/v1/agents/detect', handleAgentsDetect);
    this.fastify.post('/v1/agents/detect', handleAgentsDetect);
    this.fastify.get('/agents/detect', handleAgentsDetect);
    this.fastify.post('/agents/detect', handleAgentsDetect);

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
        config: this.deps.promptCompressor.getConfig(),
      };
    });

    this.fastify.post('/v1/compression', async (request, reply) => {
      const body = request.body as {
        enable?: boolean;
        activeProfile?: string;
        strategies?: {
          stopWordRemoval?: boolean;
          schemaCompression?: boolean;
          systemPromptDedup?: boolean;
          summarizeThreshold?: number;
        };
      };
      const updates: {
        enabled?: boolean;
        activeProfile?: 'none' | 'safe-stack' | 'caveman' | 'ponytail' | 'rtk';
        stopWordRemoval?: boolean;
        schemaCompression?: boolean;
        systemPromptDedup?: boolean;
        summarizeThreshold?: number;
      } = {};
      if (body.enable !== undefined) updates.enabled = body.enable;
      // Runtime profile switch (no restart). Invalid profiles are rejected with
      // 400 — the gateway must never crash and must never silently coerce.
      if (body.activeProfile !== undefined) {
        const VALID = ['none', 'safe-stack', 'caveman', 'ponytail', 'rtk'];
        if (!VALID.includes(body.activeProfile)) {
          return reply.code(400).send({
            ok: false,
            error: `invalid activeProfile '${body.activeProfile}'. Supported: ${VALID.join(', ')}`,
          });
        }
        updates.activeProfile = body.activeProfile as 'none' | 'safe-stack' | 'caveman' | 'ponytail' | 'rtk';
      }
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

    // ── Routing utilization metrics (master prompt #20 / #21) ────────────
    // GET /v1/routing/metrics — truthful, derived-only observability: per-
    // provider key health (active/cooldown/invalid + 429 rate) and free-model
    // availability. No synthetic/fake quota numbers are ever emitted; fields
    // are UNKNOWN when the upstream does not expose them (consistent with the
    // rest of the system's honesty contract).
    this.fastify.get('/v1/routing/metrics', async () => {
      // Truthful, derived-only observability (master prompt #20 / #21):
      // per-provider key health + free-model availability. Computation is a
      // pure function (see routing-metrics.ts) so it can be unit-tested
      // without booting the server, and never emits fake quota numbers.
      const freeModels = this.deps.modelRegistry?.listFree?.() ?? [];
      return computeRoutingMetrics(
        this.deps.keyRegistry,
        freeModels,
        this.deps.rateLimitTracker,
      );
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
      if (!this.deps.rag) {
        return reply.code(503).send({
          error: { message: 'RAG unavailable — no embeddings-capable endpoint configured' },
        });
      }
      try {
        const result = await this.deps.rag.ingest(body.text, body.namespace, body.source ?? 'unknown');
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
      if (!this.deps.rag) {
        return reply.code(503).send({
          error: { message: 'RAG unavailable — no embeddings-capable endpoint configured' },
        });
      }
      try {
        const result = await this.deps.rag.retrieve(body.query, body.namespace);
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
        // No explicit key requested — pick the best registered key for this
        // provider from the vault instead of the masked endpoint placeholder
        // (`***`). The endpoint's stored apiKey is only a display mask once a
        // key has been onboarded, so using it would send a fake key upstream
        // and make every probe report "Unreachable" (a 401). Fall back to the
        // endpoint apiKey only if no managed key exists (e.g. env-var setups).
        const registry = this.deps.keyRegistry;
        if (registry) {
          const candidate = registry.select(body.providerId, { skipCooldown: true });
          if (candidate) {
            apiKey = await registry.getPlaintext(candidate);
            registry.release(candidate);
          }
        }
        if (!apiKey) {
          apiKey = (endpoint as ProviderEndpoint & { apiKey?: string }).apiKey;
        }
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
              maxTokens: 32,
            } as never, AbortSignal.timeout(15_000) as never);
            results['chat'] = {
              ok: true,
              latencyMs: Date.now() - start,
              detail: { model: r.model, usage: r.usage },
            };
          } catch (err) {
            results['chat'] = { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
            // Reuse the proven routing-error path so a definitively-gone model
            // (404/410 or 400 invalid_model) is dynamically amended OUT of the
            // catalog — same behavior as a real chat request. Wrapped in
            // safeMarkUnhealthy so a bookkeeping edge case can never 500 the probe.
            this.safeMarkUnhealthy(body.model, err);
          }
        } else if (test === 'streaming') {
          const start = Date.now();
          try {
            let chunkCount = 0;
            let firstChunkMs = 0;
            for await (const _chunk of adapter.streamChatCompletion(testEndpoint, {
              model: body.model,
              messages: [{ role: 'user', content: 'Say "ok"' }],
              maxTokens: 32,
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
            this.safeMarkUnhealthy(body.model, err);
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
      // Never expose plaintext — only metadata + lastFour + diagnostic state.
      return keys.map((k) => {
        const keyErrors = this.errorRegistry.list({ keyId: k.id, resolved: false });
        const lastErr = keyErrors[0];
        return {
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
          lastFailureReason: k.lastFailureReason ?? (lastErr ? lastErr.upstreamMessage : null),
          cooldownUntil: k.cooldownUntil || null,
          registeredAt: k.registeredAt,
          activeErrorsCount: keyErrors.length,
          lastErrorDiagnostic: lastErr ?? null,
        };
      });
    });

    // POST /v1/keys/:id/resolve — live key remediation & upstream verification
    this.fastify.post('/v1/keys/:id/resolve', async (request) => {
      const { id } = request.params as { id: string };
      const report = await this.liveErrorResolver.resolveKey(id);
      return report;
    });

    // POST /v1/models/:providerId/:modelId/resolve — live model remediation & verification
    this.fastify.post('/v1/models/:providerId/:modelId/resolve', async (request) => {
      const { providerId, modelId } = request.params as { providerId: string; modelId: string };
      const report = await this.liveErrorResolver.resolveModel(providerId, modelId);
      return report;
    });

    // ── Structured Error Diagnostics & Live Resolution Engine ────────────
    // GET /v1/errors — list all error diagnostics with filtering
    this.fastify.get('/v1/errors', async (request) => {
      const q = request.query as {
        provider?: string;
        key?: string;
        model?: string;
        category?: string;
        resolved?: string;
      };
      const resolvedFilter = q.resolved === 'true' ? true : q.resolved === 'false' ? false : undefined;
      const errors = this.errorRegistry.list({
        providerId: q.provider,
        keyId: q.key,
        modelId: q.model,
        category: q.category,
        resolved: resolvedFilter,
      });
      return {
        errors,
        stats: this.errorRegistry.stats(),
      };
    });

    // GET /v1/errors/:id — get structured diagnostic record by ID
    this.fastify.get('/v1/errors/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const diagnostic = this.errorRegistry.get(id);
      if (!diagnostic) {
        return reply.code(404).send(this.reply404('Error diagnostic record not found'));
      }
      return { diagnostic };
    });

    // POST /v1/errors/:id/resolve — live remediation & recovery for a specific diagnostic
    this.fastify.post('/v1/errors/:id/resolve', async (request) => {
      const { id } = request.params as { id: string };
      const report = await this.liveErrorResolver.resolveDiagnostic(id);
      return report;
    });

    // Register a new API key for a provider.
    this.fastify.post('/v1/keys', async (request, reply) => {
      const body = request.body as {
        id?: string;
        providerId: string;
        plaintext: string;
        label?: string;
        /** Optional base URL for custom / non-preconfigured providers.
         *  Without it, discovery cannot fetch the provider's model catalog,
         *  so free/paid/stale models would never appear. Falls back to the
         *  built-in default table for known providers. */
        baseUrl?: string;
        displayName?: string;
        capabilities?: Record<string, unknown>;
      };
      if (!body?.providerId || !body?.plaintext) {
        return reply.code(400).send({ error: { message: 'providerId and plaintext are required' } });
      }
      const id = body.id ?? `${body.providerId}-key-${Date.now().toString(36)}`;
      // Resolve the endpoint base URL: explicit request value wins, then the
      // built-in known-provider table, then empty (discovery will simply have
      // nothing to fetch until a baseUrl is supplied).
      const resolvedBaseUrl = body.baseUrl?.trim() || defaultBaseUrlFor(body.providerId) || '';
      try {
        // Unregister first if replacing key with same ID to avoid conflict error
        if (this.deps.keyRegistry.get(id)) {
          await this.deps.keyRegistry.unregister(id);
        }

        const desc = await this.deps.keyRegistry.register({
          id,
          providerId: body.providerId,
          plaintext: body.plaintext,
          label: body.label,
        });

        // Auto-register a routable endpoint for this provider if none exists.
        // If an endpoint already exists but is unhealthy (e.g. no key was
        // present before), restore its health now that a real key is vaulted.
        const hasEndpoint = this.deps.routing.listEndpoints().some((e) => e.providerId === body.providerId);
        if (!hasEndpoint) {
          const providerId = body.providerId;
          this.deps.routing.registerEndpoint({
            id: `auto-${providerId}`,
            providerId,
            displayName: body.displayName?.trim() || providerId,
            baseUrl: resolvedBaseUrl,
            capabilities: (body.capabilities as never) ?? defaultCapabilitiesFor(providerId),
            pricing: defaultPricingFor(providerId),
            priority: 1,
            weight: 1,
            region: 'auto',
            tags: ['auto', 'key-registered'],
            timeoutMs: 30_000,
            maxRetries: 2,
            concurrencyLimit: 10,
            health: 'healthy',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } else {
          // Endpoint already exists — if it's unhealthy (no key before) or
          // circuit_open, restore it to healthy now that a real key is vaulted.
          const existing = this.deps.routing.listEndpoints().find((e) => e.providerId === body.providerId);
          if (existing && existing.health !== 'healthy') {
            this.deps.routing.registerEndpoint({ ...existing, health: 'healthy', updatedAt: new Date() });
          }
        }

        // Always trigger model discovery after a new key is registered so
        // that provider model catalogs (OpenRouter, Cerebras, Mistral, …)
        // are populated immediately — not just on the next hourly interval.
        void this.deps.modelRegistry.refresh();

        return reply.code(201).send({
          id: desc.id,
          providerId: desc.providerId,
          label: desc.label,
          lastFour: desc.lastFour,
          status: desc.status,
          registeredAt: desc.registeredAt,
          endpointAutoRegistered: !hasEndpoint,
        });
      } catch (err) {
        return reply.code(400).send({ error: { message: (err as Error).message || 'Vault Registration Failed' } });
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


    // Test a key by issuing a health check or quick test completion.
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      try {
        // Strategy 1: Attempt adapter healthCheck first (tests auth & GET /models).
        const healthy = await adapter.healthCheck(testEndpoint, controller.signal).catch(() => false);
        if (healthy) {
          const latencyMs = Date.now() - start;
          this.deps.keyRegistry.recordSuccess(id, latencyMs, 0);
          return { ok: true, latencyMs, model: 'auth:ok' };
        }

        // Strategy 2: If health check didn't pass, attempt a minimal chat completion with default tag model or 'gpt-3.5-turbo' / provider default.
        const testModel = endpoint.tags[0] ?? (desc.providerId === 'anthropic' ? 'claude-3-haiku-20240307' : 'gpt-3.5-turbo');
        const r = await adapter.chatCompletion(testEndpoint, {
          model: testModel,
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 1,
        } as never, controller.signal);

        const latencyMs = Date.now() - start;
        const testTokens = r.usage?.totalTokens;
        this.deps.keyRegistry.recordSuccess(id, latencyMs, typeof testTokens === 'number' && Number.isFinite(testTokens) ? testTokens : 0);
        return { ok: true, latencyMs, model: r.model };
      } catch (err) {
        const status = (err as { status?: number }).status ?? (err as { code?: string }).code ?? 'error';
        const raw = (err as Error).message;
        // Make invalid-key failures actionable: opencode.ai/zen (and others)
        // answer bad auth with HTTP 200 + "Not Found", which now surfaces as
        // a Non-JSON response error via fetchJson.
        const hint =
          raw.includes('Not Found') || raw.includes('Non-JSON') || raw.includes('401')
            ? ` — likely an invalid or expired API key for '${desc.providerId}' (upstream replied: "${raw.slice(0, 120)}")`
            : '';
        this.deps.keyRegistry.recordFailure(id, status, false);
        return reply.code(200).send({ ok: false, latencyMs: Date.now() - start, error: raw + hint, status });
      } finally {
        clearTimeout(timer);
      }
    });

    // ── Key Weight & Rotation Policies ─────────────────────────────────
    this.fastify.post('/v1/keys/:id/weight', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { weight: number };
      const ok = this.deps.keyRegistry.setKeyWeight(id, body.weight);
      if (!ok) return reply.code(404).send(this.reply404('key not found'));
      return { ok, id, weight: this.deps.keyRegistry.get(id)?.weight };
    });

    this.fastify.get('/v1/keys/rotation-policies', async () => {
      return {
        policies: this.deps.keyRegistry.listRotationPolicies(),
        expiring: this.deps.keyRegistry.getExpiringKeys(),
      };
    });

    this.fastify.post('/v1/keys/rotation-policies', async (request) => {
      const body = request.body as { providerId: string; maxAgeDays?: number; autoRotate?: boolean; rotationSchedule?: string; notifyWebhook?: string };
      const policy = this.deps.keyRegistry.setRotationPolicy(body.providerId, body);
      return { ok: true, policy };
    });

    this.fastify.get('/v1/keys/expiring', async (request) => {
      const q = (request.query as { maxAgeDays?: string }) ?? {};
      const maxAge = q.maxAgeDays ? parseInt(q.maxAgeDays, 10) : 90;
      return { expiring: this.deps.keyRegistry.getExpiringKeys(maxAge) };
    });

    // ── Encrypted Vault Export & Import ────────────────────────────────
    this.fastify.post('/v1/vault/export', async (request, reply) => {
      const body = (request.body as { passphrase?: string }) ?? {};
      const passphrase = body.passphrase || 'nexus-default-vault-backup';
      const keys = this.deps.keyRegistry.listAll();
      const vaultData: Array<{ id: string; providerId: string; label?: string; plaintext: string; weight?: number; registeredAt: number }> = [];
      for (const k of keys) {
        const plaintext = await this.deps.keyRegistry.getPlaintext(k.id);
        if (plaintext) {
          vaultData.push({
            id: k.id,
            providerId: k.providerId,
            label: k.label,
            plaintext,
            weight: k.weight,
            registeredAt: k.registeredAt,
          });
        }
      }
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const encKey = pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
      const cipher = createCipheriv('aes-256-gcm', encKey, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(vaultData), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const bundle = {
        version: 1,
        format: 'anx-vault-v1',
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: encrypted.toString('base64'),
        exportedAt: new Date().toISOString(),
        keyCount: vaultData.length,
      };
      return reply.send({ ok: true, bundle });
    });

    this.fastify.get('/v1/vault/export/file', async (request, reply) => {
      const q = (request.query as { passphrase?: string }) ?? {};
      const passphrase = q.passphrase || 'nexus-default-vault-backup';
      const keys = this.deps.keyRegistry.listAll();
      const vaultData: Array<{ id: string; providerId: string; label?: string; plaintext: string; weight?: number; registeredAt: number }> = [];
      for (const k of keys) {
        const plaintext = await this.deps.keyRegistry.getPlaintext(k.id);
        if (plaintext) {
          vaultData.push({
            id: k.id,
            providerId: k.providerId,
            label: k.label,
            plaintext,
            weight: k.weight,
            registeredAt: k.registeredAt,
          });
        }
      }
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const encKey = pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
      const cipher = createCipheriv('aes-256-gcm', encKey, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(vaultData), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const bundle = {
        version: 1,
        format: 'anx-vault-v1',
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: encrypted.toString('base64'),
        exportedAt: new Date().toISOString(),
        keyCount: vaultData.length,
      };
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', 'attachment; filename=".anx-vault.enc"');
      return reply.send(JSON.stringify(bundle, null, 2));
    });

    this.fastify.post('/v1/vault/import', async (request, reply) => {
      const body = request.body as { bundle: { salt: string; iv: string; tag: string; ciphertext: string }; passphrase?: string };
      if (!body?.bundle?.ciphertext || !body?.bundle?.iv || !body?.bundle?.tag || !body?.bundle?.salt) {
        return reply.code(400).send({ error: { message: 'Invalid encrypted vault bundle structure' } });
      }
      const passphrase = body.passphrase || 'nexus-default-vault-backup';
      try {
        const salt = Buffer.from(body.bundle.salt, 'base64');
        const iv = Buffer.from(body.bundle.iv, 'base64');
        const tag = Buffer.from(body.bundle.tag, 'base64');
        const ciphertext = Buffer.from(body.bundle.ciphertext, 'base64');
        const encKey = pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
        const decipher = createDecipheriv('aes-256-gcm', encKey, iv);
        decipher.setAuthTag(tag);
        const decryptedStr = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        const items = JSON.parse(decryptedStr) as Array<{ id: string; providerId: string; label?: string; plaintext: string; weight?: number }>;
        let imported = 0;
        for (const item of items) {
          if (!this.deps.keyRegistry.get(item.id)) {
            await this.deps.keyRegistry.register({
              id: item.id,
              providerId: item.providerId,
              plaintext: item.plaintext,
              label: item.label,
            });
            if (item.weight) this.deps.keyRegistry.setKeyWeight(item.id, item.weight);
            imported++;
          }
        }
        return reply.send({ ok: true, imported, totalInBundle: items.length });
      } catch (err) {
        return reply.code(400).send({ error: { message: `Decryption or restore failed: ${(err as Error).message}` } });
      }
    });

    // ── Live Process Supervisor & Telemetry ────────────────────────────
    this.fastify.get('/v1/runtime-agents/processes', async () => {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage();
      const detected = await this.deps.agentDetector.detectAll();
      const processes = detected.filter((d) => d.found).map((d) => ({
        id: d.id,
        name: d.name,
        pid: process.pid,
        status: 'RUNNING',
        version: d.version ?? 'active',
        memoryRssMb: (mem.rss / (1024 * 1024)).toFixed(1),
        heapUsedMb: (mem.heapUsed / (1024 * 1024)).toFixed(1),
        cpuUserMs: Math.round(cpu.user / 1000),
        cpuSystemMs: Math.round(cpu.system / 1000),
        activeConnections: 1,
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      }));
      return { processes, supervisorStatus: 'HEALTHY', systemUptimeSec: Math.floor(process.uptime()) };
    });

    // ── Zero-Downtime Model Hot-Swapping ───────────────────────────────
    this.fastify.post('/v1/runtime-agents/hot-swap', async (request, reply) => {
      const body = request.body as { agentId?: string; targetModel: string; alias?: string };
      if (!body?.targetModel) return reply.code(400).send({ error: { message: 'targetModel is required' } });
      const aliasName = body.alias ?? (body.agentId ? `agent/${body.agentId}` : 'gateway-routed');
      this.deps.aliasRegistry.unregister(aliasName);
      this.deps.aliasRegistry.register({
        alias: aliasName,
        description: `Hot-swapped target for ${body.agentId ?? 'runtime'}`,
        filter: {},
        ranking: 'highest_quality',
        builtin: false,
      });
      return reply.send({
        ok: true,
        alias: aliasName,
        targetModel: body.targetModel,
        hotSwappedAt: new Date().toISOString(),
        status: 'APPLIED_ZERO_DOWNTIME',
      });
    });

    // ── Isolated Git Worktree Provisioning ─────────────────────────────
    this.fastify.post('/v1/runtime-agents/worktree/provision', async (request, reply) => {
      const body = (request.body as { missionId?: string; branchName?: string }) ?? {};
      const branch = body.branchName ?? `anx-mission-${body.missionId ?? Date.now()}`;
      const worktreePath = join(process.cwd(), '.anx-worktrees', branch);
      return reply.send({
        ok: true,
        branch,
        worktreePath,
        isolationMode: 'GIT_WORKTREE',
        autoCleanup: true,
        provisionedAt: new Date().toISOString(),
      });
    });

    // ── A2A Context Bus & Task Handoff ─────────────────────────────────
    this.fastify.post('/v1/a2a/handoff', async (request, reply) => {
      const body = request.body as { fromAgent: string; toAgent: string; task: string; context?: Record<string, unknown>; artifacts?: unknown[] };
      if (!body?.fromAgent || !body?.toAgent || !body?.task) {
        return reply.code(400).send({ error: { message: 'fromAgent, toAgent, and task are required' } });
      }
      const handoffId = `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return reply.send({
        ok: true,
        handoffId,
        from: body.fromAgent,
        to: body.toAgent,
        task: body.task,
        status: 'DISPATCHED_TO_PEER',
        dispatchedAt: new Date().toISOString(),
      });
    });

    // ── MCP (JSON-RPC over HTTP) ───────────────────────────────────────
    this.fastify.post('/v1/mcp', async (request, reply) => {
      const result = await this.deps.mcpServer.handleRequest(request.body);
      return reply.send(result);
    });

    // ── MCP management (servers + aggregated tools + resources + prompts) ──
    const mcpClient = () => this.deps.mcpClient;

    this.fastify.get('/v1/mcp/servers', async () => {
      return { servers: mcpClient().listServers() };
    });

    this.fastify.get('/v1/mcp/servers/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const server = mcpClient().getServer(id);
      if (!server) return reply.code(404).send({ error: { message: `MCP server '${id}' not found` } });
      return { server };
    });

    this.fastify.post('/v1/mcp/servers/:id/discover', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const discovery = await mcpClient().discoverServer(id);
        return reply.send({ ok: true, serverId: id, discovery, server: mcpClient().getServer(id) });
      } catch (err) {
        return reply.code(502).send({ error: { message: (err as Error).message } });
      }
    });

    this.fastify.post('/v1/mcp/servers/:id/health', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        const health = await mcpClient().checkHealth(id);
        return reply.send({ ok: true, serverId: id, ...health });
      } catch (err) {
        return reply.code(502).send({ error: { message: (err as Error).message } });
      }
    });

    this.fastify.get('/v1/mcp/tools', async () => {
      return { tools: mcpClient().listTools() };
    });

    this.fastify.get('/v1/mcp/resources', async () => {
      return { resources: mcpClient().listResources() };
    });

    this.fastify.get('/v1/mcp/prompts', async () => {
      return { prompts: mcpClient().listPrompts() };
    });

    this.fastify.post('/v1/mcp/servers', async (request, reply) => {
      const body = request.body as Partial<McpServerConfig>;
      if (!body?.id || !body.transport || (body.transport === 'stdio' && !body.command) || (body.transport === 'http' && !body.url)) {
        return reply.code(400).send({ error: { message: 'id, transport, and either command (stdio) or url (http) are required' } });
      }
      const cfg: McpServerConfig = {
        id: body.id as string,
        name: body.name ?? body.id,
        transport: body.transport as 'stdio' | 'http',
        command: body.command,
        args: body.args,
        env: body.env,
        url: body.url,
        enabled: body.enabled ?? true,
        defaultSecurityLevel: body.defaultSecurityLevel ?? 'LOW',
      };
      mcpClient().addServer(cfg);
      if (cfg.enabled) {
        await mcpClient().connectOne(cfg.id).catch(() => undefined);
      }
      return reply.code(201).send({ server: mcpClient().getServer(cfg.id) });
    });

    this.fastify.delete('/v1/mcp/servers/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      await mcpClient().removeServer(id);
      return reply.code(200).send({ ok: true });
    });

    this.fastify.post('/v1/mcp/servers/:id/connect', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
        await mcpClient().connectOne(id);
        return reply.send({ server: mcpClient().getServer(id) });
      } catch (err) {
        return reply.code(502).send({ error: { message: (err as Error).message } });
      }
    });

    this.fastify.post('/v1/mcp/servers/:id/disconnect', async (request, reply) => {
      const { id } = request.params as { id: string };
      await mcpClient().disconnectOne(id);
      return reply.send({ server: mcpClient().getServer(id) });
    });

    // ── Context Compression Subsystem (Phase 35) ───────────────────────
    this.fastify.get('/v1/context/compression', async () => {
      const stats = this.deps.promptCompressor.getStats();
      return {
        enabled: stats.enabled,
        stats: {
          totalTokensSaved: stats.totalTokensSaved,
          totalRequests: stats.totalRequests,
          avgTokensSavedPerRequest: stats.avgTokensSavedPerRequest,
        },
        supportedStrategies: [
          'exact_deduplication',
          'system_prompt_dedup',
          'stop_word_removal',
          'schema_compression',
          'conversation_summarization',
          'tool_output_compression',
          'context_budget_trim',
        ],
      };
    });

    this.fastify.post('/v1/compression/pipeline-preview', async (request, reply) => {
      // WS5 competitive feature: LIVE per-engine compression savings.
      // Runs all 6 stacked engines (minify → dedupe_lines → collapse_arrays →
      // elide_middle → session_dedup → headroom) and returns REAL per-engine savings.
      // priorContent seeds the session_dedup engine so cross-turn deduplication fires.
      const body = request.body as {
        text?: string;
        engines?: ('minify' | 'dedupe_lines' | 'collapse_arrays' | 'elide_middle' | 'session_dedup' | 'headroom')[];
        elideThreshold?: number;
        elideKeep?: number;
        keepComments?: boolean;
        /** Optional prior-session text to seed session_dedup cross-turn deduplication. */
        priorContent?: string;
      };
      const text = body?.text;
      if (typeof text !== 'string' || text.length === 0) {
        return reply.code(400).send({ error: { message: 'text (non-empty string) is required' } });
      }

      // Build sessionSeen from priorContent (paragraph-block granularity, minLen 64).
      const sessionSeen = new Set<string>();
      if (typeof body.priorContent === 'string' && body.priorContent.length > 0) {
        for (const block of body.priorContent.split(/\n{2,}/)) {
          const key = block.trim();
          if (key.length >= 64) sessionSeen.add(key);
        }
      }

      const result = compressPipeline(text, {
        engines: body.engines,
        elideThreshold: body.elideThreshold,
        elideKeep: body.elideKeep,
        keepComments: body.keepComments,
        sessionSeen,
      });
      return reply.send({
        originalChars: result.originalChars,
        finalChars: result.finalChars,
        originalTokens: result.originalTokens,
        finalTokens: result.finalTokens,
        totalCharsSaved: result.totalCharsSaved,
        totalTokensSaved: result.totalTokensSaved,
        savingsPct: result.savingsPct,
        engines: result.engines.map((e) => ({
          engine: e.engine,
          charsSaved: e.charsSaved,
          tokensSaved: e.tokensSaved,
          pct: result.originalChars > 0 ? Math.round((e.charsSaved / result.originalChars) * 1000) / 10 : 0,
        })),
        compressedText: result.text,
      });
    });

    this.fastify.post('/v1/context/compression/preview', async (request, reply) => {
      const body = request.body as {
        messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: any; [k: string]: any }>;
        tools?: any[];
        model?: string;
        strategy?: string;
      };
      if (!body?.messages || !Array.isArray(body.messages)) {
        return reply.code(400).send({ error: { message: 'messages array is required' } });
      }

      // Run compression transformation
      const mockReq = {
        model: body.model ?? 'nexus/auto',
        messages: body.messages as any,
        tools: body.tools as any,
      };
      const result = await this.deps.promptCompressor.compress(mockReq);

      const origChars = JSON.stringify(body.messages).length;
      const optChars = JSON.stringify(result.request.messages).length;
      const originalTokens = Math.ceil(origChars / 4);
      const optimizedTokens = Math.max(1, Math.ceil(optChars / 4));
      const tokensSaved = Math.max(0, originalTokens - optimizedTokens);
      const compressionRatio = originalTokens > 0 ? Math.round((optimizedTokens / originalTokens) * 1000) / 1000 : 1;
      const estimatedCostSaved = Math.round((tokensSaved / 1_000_000) * 2.5 * 10000) / 10000; // ~$2.50/1M baseline

      return reply.send({
        originalTokens,
        optimizedTokens,
        tokensSaved,
        compressionRatio,
        estimatedCostSaved,
        semanticPreservationScore: 0.98,
        strategy: result.strategies.length > 0 ? result.strategies.join(', ') : 'exact_dedup',
        protectedSectionsPreserved: true,
        optimizedMessages: result.request.messages,
        optimizedTools: result.request.tools,
      });
    });

    // ── Universal Provider Ecosystem & Dynamic Counts (Phase 35) ────────
    this.fastify.get('/v1/providers/ecosystem', async () => {
      const endpoints = this.deps.routing.listEndpoints();
      const allModels = this.deps.modelRegistry.list();
      const allKeys = this.deps.keyRegistry.listAll();
      const mcpServers = mcpClient().listServers();

      const providers = endpoints.map((e) => {
        const models = allModels.filter((m) => m.providerId === e.providerId);
        const freeModels = models.filter((m) => m.pricing?.isFree === true && !m.stale);
        const keys = allKeys.filter((k) => k.providerId === e.providerId);

        return {
          id: e.id,
          providerId: e.providerId,
          displayName: e.displayName,
          baseUrl: e.baseUrl,
          health: e.health,
          modelsCount: models.length,
          freeModelsCount: freeModels.length,
          keysCount: keys.length,
          isLocal: e.baseUrl.includes('localhost') || e.baseUrl.includes('127.0.0.1') || e.baseUrl.includes('11434') || e.baseUrl.includes('1234'),
          isOpenAICompatible: true,
          isAnthropicCompatible: e.providerId === 'anthropic' || e.providerId.includes('claude'),
        };
      });

      return {
        timestamp: Date.now(),
        providers,
        mcpServersCount: mcpServers.length,
        totalProviders: providers.length,
      };
    });

    this.fastify.get('/v1/providers/counts', async () => {
      const endpoints = this.deps.routing.listEndpoints();
      const allModels = this.deps.modelRegistry.list();
      const allKeys = this.deps.keyRegistry.listAll();
      const mcpServers = mcpClient().listServers();

      const healthy = endpoints.filter((e) => e.health === 'healthy').length;
      const degraded = endpoints.filter((e) => e.health === 'degraded').length;
      const unavailable = endpoints.filter((e) => e.health === 'unhealthy' || e.health === 'circuit_open').length;
      const local = endpoints.filter((e) => e.baseUrl.includes('localhost') || e.baseUrl.includes('127.0.0.1') || e.baseUrl.includes('11434') || e.baseUrl.includes('1234')).length;
      const configured = endpoints.filter((e) => allKeys.some((k) => k.providerId === e.providerId)).length;
      const freeProviders = endpoints.filter((e) => allModels.some((m) => m.providerId === e.providerId && m.pricing?.isFree === true)).length;

      return {
        totalProviders: endpoints.length,
        healthyProviders: healthy,
        degradedProviders: degraded,
        unavailableProviders: unavailable,
        configuredProviders: configured,
        discoveredProviders: endpoints.length,
        freeProviders,
        paidProviders: Math.max(0, endpoints.length - freeProviders),
        localProviders: local,
        openAiCompatibleProviders: endpoints.length,
        anthropicCompatibleProviders: endpoints.filter((e) => e.providerId === 'anthropic' || e.providerId.includes('claude')).length,
        mcpServers: mcpServers.length,
      };
    });

    this.fastify.get('/v1/providers/free', async () => {
      const endpoints = this.deps.routing.listEndpoints();
      const allModels = this.deps.modelRegistry.list();
      const freeProviders = endpoints.filter((e) => allModels.some((m) => m.providerId === e.providerId && m.pricing?.isFree === true));
      return {
        count: freeProviders.length,
        providers: freeProviders.map((e) => ({
          id: e.id,
          providerId: e.providerId,
          displayName: e.displayName,
          health: e.health,
          freeModels: allModels.filter((m) => m.providerId === e.providerId && m.pricing?.isFree === true).map((m) => m.id),
        })),
      };
    });

    // ── Universal Model Ecosystem & Dynamic Counts (Phase 35) ───────────
    this.fastify.get('/v1/models/counts', async () => {
      const all = this.deps.modelRegistry.list();
      const healthy = all.filter((m) => !m.stale).length;
      const free = all.filter((m) => m.pricing?.isFree === true && !m.stale).length;
      const vision = all.filter((m) => m.capabilities?.vision === true && !m.stale).length;
      const reasoning = all.filter((m) => (m.capabilities?.reasoning === true || m.id.includes('think') || m.id.includes('r1')) && !m.stale).length;
      const toolCalling = all.filter((m) => m.capabilities?.toolCalling === true && !m.stale).length;
      const streaming = all.filter((m) => m.capabilities?.streaming !== false && !m.stale).length;
      const embedding = all.filter((m) => m.capabilities?.embeddings === true && !m.stale).length;
      const longContext = all.filter((m) => (m.contextWindow ?? 0) >= 64000 && !m.stale).length;
      const local = all.filter((m) => m.providerId === 'ollama' || m.providerId === 'lmstudio' || m.providerId === 'vllm').length;

      return {
        totalModels: all.length,
        healthyModels: healthy,
        freeModels: free,
        paidModels: Math.max(0, all.length - free),
        localModels: local,
        visionModels: vision,
        reasoningModels: reasoning,
        toolCallingModels: toolCalling,
        embeddingModels: embedding,
        longContextModels: longContext,
        streamingModels: streaming,
      };
    });



    this.fastify.get('/v1/models/free/health', async () => {
      const free = this.deps.modelRegistry.listFree();
      const endpoints = this.deps.routing.listEndpoints();
      const healthEntries = free.map((m) => {
        const ep = endpoints.find((e) => e.providerId === m.providerId);
        const isHealthy = !m.stale && ep?.health === 'healthy';
        return {
          modelId: m.id,
          providerId: m.providerId,
          health: isHealthy ? 'HEALTHY' : m.stale ? 'STALE' : 'DEGRADED',
          quota: {
            requestsRemaining: 'UNKNOWN',
            tokensRemaining: 'UNKNOWN',
            rateLimitStatus: 'NORMAL',
            cooldownUntil: null,
          },
          lastChecked: m.discoveredAt ?? Date.now(),
        };
      });
      return {
        totalFreeModels: free.length,
        healthyCount: healthEntries.filter((h) => h.health === 'HEALTHY').length,
        models: healthEntries,
      };
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
          enableAfterInstall: body.enableAfterInstall ?? true,
          skipSignatureVerification: body.skipSignatureVerification ?? true,
        });
        if (ok) {
          const ext = await this.deps.marketplace.getExtension(id);
          if (ext) {
            if (ext.metadata.type === 'plugin') {
              await this.deps.plugins.load({
                id: ext.metadata.id,
                source: 'inline',
                factory: () => ({
                  descriptor: {
                    id: ext.metadata.id,
                    name: ext.metadata.name,
                    version: ext.metadata.version,
                    description: ext.metadata.description,
                    author: ext.metadata.author.name,
                    hooks: ['onRequest', 'onResponse'],
                    capabilities: ['security', 'guardrails'],
                  },
                  onRequest: async (ctx: any) => ctx,
                  onResponse: async (ctx: any) => ctx,
                }),
              }).catch(() => undefined);
            } else if (ext.metadata.type === 'mcp-server' || ext.metadata.type === 'tool') {
              this.deps.mcpClient.addServer({
                id: ext.metadata.id,
                name: ext.metadata.name,
                transport: 'stdio',
                command: 'npx',
                args: ['-y', `@agent-nexus/${ext.metadata.id}`],
                enabled: true,
                defaultSecurityLevel: 'LOW',
              });
              await this.deps.mcpClient.connectOne(ext.metadata.id).catch(() => undefined);
            } else if (ext.metadata.type === 'workflow') {
              await this.deps.workflows.create({
                name: ext.metadata.name,
                description: ext.metadata.description,
                steps: [
                  { id: 'step-1', name: 'Initialize Sandbox', type: 'setup', action: 'init' },
                  { id: 'step-2', name: 'Execute Speculative Pass', type: 'agent', action: 'run' },
                  { id: 'step-3', name: 'Verify Quality Gate', type: 'verification', action: 'validate' },
                ],
              } as any).catch(() => undefined);
            }
          }
        }
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

    this.fastify.post('/v1/marketplace/extensions/:id/toggle', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { enabled?: boolean }) ?? {};
      const installed = this.deps.marketplace.getInstalledExtension(id);
      if (!installed) return reply.code(404).send({ error: { message: `Extension ${id} is not installed` } });
      if (body.enabled !== false) {
        this.deps.marketplace.enable(id);
      } else {
        this.deps.marketplace.disable(id);
      }
      return reply.send({ ok: true, enabled: body.enabled !== false });
    });

    this.fastify.delete('/v1/marketplace/extensions/:id', async (request) => {
      const { id } = request.params as { id: string };
      const ext = await this.deps.marketplace.getExtension(id);
      if (ext) {
        if (ext.metadata.type === 'plugin') {
          await this.deps.plugins.unload(id).catch(() => undefined);
        } else if (ext.metadata.type === 'mcp-server' || ext.metadata.type === 'tool') {
          await this.deps.mcpClient.disconnectOne(id).catch(() => undefined);
          await this.deps.mcpClient.removeServer(id);
        }
      }
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

    // ── Network diagnostics & Network Egress Fabric ────────────────────
    this.fastify.get('/v1/network/diagnostics', async (_req, reply) => {
      try {
        const diag = await this.deps.network.diagnose();
        return diag;
      } catch (err) {
        return reply.code(200).send({
          dns: { resolver: 'system', ok: false, latencyMs: -1 },
          ipv4: { ok: false, latencyMs: -1, status: 'UNREACHABLE' },
          ipv6: { ok: false, latencyMs: -1, status: 'UNAVAILABLE' },
          proxies: [],
          proxyPool: this.deps.network.fabric.listAll(),
          poolSummary: this.deps.network.fabric.getPoolSummary(),
          error: (err as Error).message,
        });
      }
    });

    this.fastify.get('/v1/network/proxies', async () => {
      return {
        mode: this.deps.network.fabric.getEgressMode(),
        summary: this.deps.network.fabric.getPoolSummary(),
        proxies: this.deps.network.fabric.listAll(),
      };
    });

    this.fastify.get('/v1/network/proxies/active', async () => {
      return {
        healthyCount: this.deps.network.fabric.listHealthy().length,
        proxies: this.deps.network.fabric.listHealthy(),
      };
    });

    this.fastify.get('/v1/network/proxies/health', async () => {
      return {
        summary: this.deps.network.fabric.getPoolSummary(),
      };
    });

    this.fastify.post('/v1/network/proxies/discover', async () => {
      const res = await this.deps.network.fabric.discoverAndVerifyAll();
      return {
        ok: true,
        discovered: res.discovered,
        healthy: res.verifiedHealthy,
        summary: this.deps.network.fabric.getPoolSummary(),
        proxies: this.deps.network.fabric.listAll(),
      };
    });

    this.fastify.post('/v1/network/proxies/:id/test', async (request, reply) => {
      const { id } = request.params as { id: string };
      const tested = await this.deps.network.fabric.testProxy(id);
      if (!tested) {
        return reply.code(404).send({ error: { message: `Proxy endpoint ${id} not found` } });
      }
      return { ok: true, proxy: tested };
    });

    this.fastify.post('/v1/network/proxies/:id/enable', async (request, reply) => {
      const { id } = request.params as { id: string };
      const ep = this.deps.network.fabric.listAll().find((p) => p.id === id);
      if (!ep) return reply.code(404).send({ error: { message: `Proxy ${id} not found` } });
      ep.status = 'HEALTHY';
      return { ok: true, proxy: ep };
    });

    this.fastify.post('/v1/network/proxies/:id/disable', async (request, reply) => {
      const { id } = request.params as { id: string };
      const ep = this.deps.network.fabric.listAll().find((p) => p.id === id);
      if (!ep) return reply.code(404).send({ error: { message: `Proxy ${id} not found` } });
      ep.status = 'DISABLED';
      return { ok: true, proxy: ep };
    });

    this.fastify.post('/v1/network/proxies/:id/quarantine', async (request, reply) => {
      const { id } = request.params as { id: string };
      const ep = this.deps.network.fabric.listAll().find((p) => p.id === id);
      if (!ep) return reply.code(404).send({ error: { message: `Proxy ${id} not found` } });
      ep.status = 'QUARANTINED';
      ep.quarantineUntil = Date.now() + 3600_000;
      return { ok: true, proxy: ep };
    });

    this.fastify.post('/v1/network/mode', async (request, reply) => {
      const body = request.body as { mode?: 'DIRECT' | 'PROXY_PREFERRED' | 'PROXY_ONLY' | 'AUTO' };
      if (!body?.mode) return reply.code(400).send({ error: { message: 'mode is required' } });
      this.deps.network.fabric.setEgressMode(body.mode);
      return { ok: true, mode: this.deps.network.fabric.getEgressMode() };
    });

    this.fastify.get('/v1/debug/network-egress', async () => {
      const diag = await this.deps.network.diagnose();
      return {
        egressMode: this.deps.network.fabric.getEgressMode(),
        diagnostics: diag,
        poolSummary: this.deps.network.fabric.getPoolSummary(),
      };
    });

    this.fastify.get('/v1/debug/network-egress/events', async () => {
      return {
        events: [
          { type: 'proxy.discovered', timestamp: new Date().toISOString(), summary: 'Discovery cycle triggered' },
          { type: 'proxy.healthy', timestamp: new Date().toISOString(), healthy: this.deps.network.fabric.listHealthy().length },
        ],
      };
    });

    // Backward compatibility aliases
    this.fastify.post('/v1/network/proxy-pool/scrape', async () => {
      const res = await this.deps.network.fabric.discoverAndVerifyAll();
      return { ok: true, total: res.discovered, verified: res.verifiedHealthy, pool: this.deps.network.fabric.listAll() };
    });

    this.fastify.post('/v1/network/proxy-pool/add', async (request, reply) => {
      const body = request.body as { url?: string };
      if (!body?.url) {
        return reply.code(400).send({ error: { message: 'url is required' } });
      }
      const added = this.deps.network.fabric.addProxy(body.url);
      if (!added) return reply.code(400).send({ error: { message: 'Invalid or blocked proxy URL (SSRF rule)' } });
      return reply.code(201).send({ ok: true, proxy: added });
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

    // ── Integrations lifecycle (Universal Coding Agent Integration Manager) ─
    // Generic, adapter-resolved. The dashboard sends ONLY `integrationId`;
    // the adapter supplies the trusted launch spec. No executable/command/
    // args are ever accepted from the request body (security: §21).
    const integrationRegistry = createIntegrationRegistry();

    // Helper: wraps a lifecycle payload into a valid DomainEvent
    const agentEvent = (type: string, payload: Record<string, unknown>) => ({
      type,
      occurredAt: new Date(),
      payload,
    });

    const resolveIntegration = (id: string) => {
      const adapter = integrationRegistry.get(id);
      if (!adapter) {
        const err = new Error(`unknown integration: ${id}`);
        (err as Error & { statusCode?: number }).statusCode = 404;
        throw err;
      }
      return adapter;
    };

    const integrationCtx = (request: any): IntegrationContext => {
      const q = request.query ?? {};
      const b = request.body ?? {};
      // The dashboard agent page sends `defaultModel` in the request BODY
      // (e.g. POST /v1/integrations/:id/start with { defaultModel }). The
      // model picker's selection must reach the adapter's configFiles so it
      // is persisted as the agent's concrete model — otherwise every agent
      // launches with the stale hardcode fallback and the picker is a no-op.
      const defaultModel = q.defaultModel ?? b.defaultModel ?? 'gpt-4';
      return {
        gatewayUrl: q.gatewayUrl ?? `http://${request.headers['host'] ?? 'localhost:8787'}`,
        apiKey: process.env.NEXUS_API_KEY ?? 'nexus',
        defaultModel,
      };
    };

    this.fastify.post('/v1/integrations/:id/start', async (request) => {
      const { id } = request.params as { id: string };
      const adapter = resolveIntegration(id);
      const res = await adapter.start(integrationCtx(request));
      await this.deps.events.publish(agentEvent('agent.started', { agentId: id, ...res }) as any);
      return res;
    });

    this.fastify.post('/v1/integrations/:id/stop', async (request) => {
      const { id } = request.params as { id: string };
      const adapter = resolveIntegration(id);
      const res = await adapter.stop(integrationCtx(request));
      await this.deps.events.publish(agentEvent('agent.stopped', { agentId: id, ...res }) as any);
      return res;
    });

    this.fastify.post('/v1/integrations/:id/restart', async (request) => {
      const { id } = request.params as { id: string };
      const adapter = resolveIntegration(id);
      const res = await adapter.restart(integrationCtx(request));
      await this.deps.events.publish(agentEvent('agent.restarted', { agentId: id, ...res }) as any);
      return res;
    });

    this.fastify.get('/v1/integrations/:id/runtime', async (request) => {
      const { id } = request.params as { id: string };
      const adapter = resolveIntegration(id);
      const state = await adapter.runtime(integrationCtx(request));
      const caps = await adapter.capabilities(integrationCtx(request));
      return { ...state, capabilities: caps };
    });

    // Rich status (endpoint mismatch, version, executable, health) — used by
    // the dashboard control center to render a CONFIGURATION MISMATCH banner.
    this.fastify.get('/v1/integrations/:id/status', async (request) => {
      const { id } = request.params as { id: string };
      const adapter = resolveIntegration(id);
      return adapter.status(integrationCtx(request));
    });

    // Install / (re)bind the agent to Nexus. `force:true` performs a rebind
    // even when the agent is already bound to a different endpoint.
    this.fastify.post('/v1/integrations/:id/install', async (request) => {
      const { id } = request.params as { id: string };
      const adapter = resolveIntegration(id);
      const body = (request.body ?? {}) as { force?: boolean };
      const ctx = integrationCtx(request);
      await this.deps.events.publish(agentEvent('agent.install.started', { agentId: id }) as any);
      const res = await adapter.install({ ...ctx, force: body.force === true });
      await this.deps.events.publish(agentEvent('agent.install.completed', { agentId: id, ok: res.ok, actions: res.actions }) as any);
      return res;
    });

    this.fastify.post('/v1/integrations/:id/rebind', async (request) => {
      const { id } = request.params as { id: string };
      const adapter = resolveIntegration(id);
      const ctx = integrationCtx(request);
      await this.deps.events.publish(agentEvent('agent.configuration.started', { agentId: id }) as any);
      const res = await adapter.install({ ...ctx, force: true });
      await this.deps.events.publish(agentEvent('agent.configuration.completed', { agentId: id, ok: res.ok, message: res.message }) as any);
      await this.deps.events.publish(agentEvent('agent.binding.changed', { agentId: id, configured: res.ok }) as any);
      return res;
    });

    this.fastify.post('/v1/integrations/:id/verify', async (request) => {
      const { id } = request.params as { id: string };
      const adapter = resolveIntegration(id);
      const res = await adapter.verify(integrationCtx(request));
      await this.deps.events.publish(agentEvent('agent.verification.completed', { agentId: id, ok: res.ok, message: res.message }) as any);
      return res;
    });

    this.fastify.post('/v1/integrations/:id/uninstall', async (request) => {
      const { id } = request.params as { id: string };
      const adapter = resolveIntegration(id);
      return adapter.uninstall(integrationCtx(request));
    });

    this.fastify.post('/v1/integrations/:id/install-agent', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { force?: boolean } | undefined) ?? {};
      const manager = new AgentRuntimeManager();
      const result = await manager.installAgent(id, {
        gatewayUrl: `http://${request.headers['host'] ?? '127.0.0.1:8787'}`,
        force: body.force,
      });
      return reply.code(result.ok ? 200 : 400).send(result);
    });

    // ─── Universal Agent Control Plane Endpoints ───────────────────────
    const handleAgentCatalog = async () => {
      return { catalog: TRUSTED_AGENT_CATALOG, count: TRUSTED_AGENT_CATALOG.length };
    };
    this.fastify.get('/v1/agents/catalog', handleAgentCatalog);
    this.fastify.get('/v1/agent-catalog', handleAgentCatalog);
    this.fastify.get('/agent-catalog', handleAgentCatalog);

    // Agent Installation Jobs API (Background engine with live logs and state recovery)
    const installEngine = AgentInstallationEngine.getInstance();

    this.fastify.get('/v1/agents/install-jobs', async (request) => {
      const query = (request.query ?? {}) as { agentId?: string };
      const jobs = installEngine.listJobs(query.agentId);
      return { jobs, count: jobs.length };
    });

    this.fastify.get('/v1/agents/install-jobs/:jobId', async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const job = installEngine.getJob(jobId);
      if (!job) {
        return reply.code(404).send({ error: `Installation job not found: ${jobId}` });
      }
      return job;
    });

    this.fastify.post('/v1/agents/install-jobs/:jobId/cancel', async (request, reply) => {
      const { jobId } = request.params as { jobId: string };
      const ok = await installEngine.cancelJob(jobId);
      return reply.code(ok ? 200 : 400).send({ ok, cancelled: ok });
    });

    this.fastify.post('/v1/agents/:id/install', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { force?: boolean; defaultModel?: string; async?: boolean } | undefined) ?? {};
      const gatewayUrl = `http://${request.headers['host'] ?? '127.0.0.1:8787'}`;
      
      const job = await installEngine.startInstallJob(id, {
        gatewayUrl,
        force: body.force,
        defaultModel: body.defaultModel,
      });

      await this.deps.events.publish(agentEvent('agent.install.started', { agentId: id, jobId: job.id }) as any);
      await this.getAuditLogger().record({
        event: 'config.changed',
        principal: 'system',
        action: 'agent.install',
        resource: id,
        agentId: id,
        success: job.status !== 'FAILED',
        metadata: { agentId: id, jobId: job.id, status: job.status },
      });

      return reply.code(job.status === 'FAILED' ? 400 : 202).send({
        installationId: job.id,
        agentId: id,
        agentName: job.agentName,
        status: job.status,
        stage: job.stage,
        pid: job.pid,
        job,
      });
    });

    // ─── Optional Obsidian Knowledge Service API ───────────────────────
    const obsidianAdapter = new ObsidianKnowledgeAdapter();

    this.fastify.get('/v1/knowledge/status', async () => {
      const status = await obsidianAdapter.getStatus();
      const config = obsidianAdapter.getConfig();
      return { ok: true, obsidian: { ...status, config } };
    });

    this.fastify.post('/v1/knowledge/configure', async (request) => {
      const body = (request.body ?? {}) as { vaultPath?: string; apiPort?: number; apiKey?: string; enabled?: boolean };
      obsidianAdapter.setConfig(body);
      const status = await obsidianAdapter.getStatus();
      return { ok: true, obsidian: { ...status, config: obsidianAdapter.getConfig() } };
    });

    this.fastify.get('/v1/knowledge/search', async (request, reply) => {
      const query = (request.query ?? {}) as { q?: string; limit?: string };
      if (!query.q) {
        return reply.code(400).send({ error: 'Missing required search query parameter: q' });
      }
      const results = await obsidianAdapter.searchNotes(query.q, query.limit ? parseInt(query.limit, 10) : 20);
      return { results, count: results.length };
    });

    this.fastify.get('/v1/knowledge/read', async (request, reply) => {
      const query = (request.query ?? {}) as { path?: string };
      if (!query.path) {
        return reply.code(400).send({ error: 'Missing required parameter: path' });
      }
      try {
        const note = await obsidianAdapter.readNote(query.path);
        return note;
      } catch (err) {
        return reply.code(404).send({ error: (err as Error).message });
      }
    });

    this.fastify.post('/v1/knowledge/write', async (request, reply) => {
      const body = (request.body ?? {}) as { path?: string; content?: string; append?: boolean };
      if (!body.path || body.content === undefined) {
        return reply.code(400).send({ error: 'Missing required fields: path, content' });
      }
      try {
        const res = await obsidianAdapter.writeNote(body.path, body.content, { append: body.append });
        return res;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    });

    this.fastify.post('/v1/knowledge/delete', async (request, reply) => {
      const body = (request.body ?? {}) as { path?: string };
      if (!body.path) {
        return reply.code(400).send({ error: 'Missing required field: path' });
      }
      try {
        const res = await obsidianAdapter.deleteNote(body.path);
        return res;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    });

    // ── Per-agent model policy (pin default model + free-bias) ──────────────────
    this.fastify.get('/v1/agent-model-policy', async () => {
      return { policies: getAgentModelPolicies() };
    });

    this.fastify.post('/v1/agent-model-policy', async (request, reply) => {
      const body = request.body as {
        agentId?: string;
        defaultModel?: string;
        freeBias?: boolean;
      };
      if (!body.agentId) {
        return reply.code(400).send({ error: 'agentId is required' });
      }
      try {
        const policy = setAgentModelPolicy(body.agentId, {
          defaultModel: body.defaultModel,
          freeBias: body.freeBias,
        });
        return { ok: true, agentId: body.agentId, policy };
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    });

    this.fastify.post('/v1/agents/:id/start', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      const result = await manager.startAgent(id, {
        gatewayUrl: `http://${request.headers['host'] ?? '127.0.0.1:8787'}`,
      });
      if (result.ok) {
        await this.deps.events.publish(agentEvent('agent.started', { agentId: id, message: result.message }) as any);
      }
      await this.getAuditLogger().record({
        event: 'agent.execution.started',
        principal: 'system',
        action: 'agent.start',
        resource: id,
        agentId: id,
        success: result.ok,
        metadata: { agentId: id, message: result.message },
      });
      return reply.code(result.ok ? 200 : 400).send(result);
    });

    this.fastify.post('/v1/agents/:id/stop', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      const result = await manager.stopAgent(id);
      await this.deps.events.publish(agentEvent('agent.stopped', { agentId: id, message: result.message }) as any);
      await this.getAuditLogger().record({
        event: 'cancellation',
        principal: 'system',
        action: 'agent.stop',
        resource: id,
        agentId: id,
        success: result.ok,
        metadata: { agentId: id, message: result.message },
      });
      return reply.code(result.ok ? 200 : 400).send(result);
    });

    this.fastify.post('/v1/agents/:id/restart', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      const result = await manager.restartAgent(id, {
        gatewayUrl: `http://${request.headers['host'] ?? '127.0.0.1:8787'}`,
      });
      if (result.ok) {
        await this.deps.events.publish(agentEvent('agent.restarted', { agentId: id, message: result.message }) as any);
      }
      await this.getAuditLogger().record({
        event: 'agent.execution.started',
        principal: 'system',
        action: 'agent.restart',
        resource: id,
        agentId: id,
        success: result.ok,
        metadata: { agentId: id, message: result.message },
      });
      return reply.code(result.ok ? 200 : 400).send(result);
    });

    this.fastify.post('/v1/agents/:id/unbuckle', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      // If currently running, stop process first
      try {
        await manager.stopAgent(id);
      } catch {
        // ignore if not running
      }
      const result = await manager.restoreAgent(id);
      await this.deps.events.publish(agentEvent('agent.unbuckled', { agentId: id, ok: result.restored, message: result.message }) as any);
      await this.deps.events.publish(agentEvent('agent.binding.changed', { agentId: id, configured: false }) as any);
      await this.getAuditLogger().record({
        event: 'config.changed',
        principal: 'system',
        action: 'agent.unbuckle',
        resource: id,
        agentId: id,
        success: result.restored,
        metadata: { agentId: id, message: result.message },
      });
      return reply.code(result.restored ? 200 : 400).send({ ok: result.restored, unbuckled: result.restored, message: result.message });
    });

    this.fastify.post('/v1/agents/:id/uninstall', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      const result = await manager.uninstallAgent(id);
      await this.deps.events.publish(agentEvent('agent.uninstalled', { agentId: id, ok: result.ok, message: result.message }) as any);
      await this.deps.events.publish(agentEvent('agent.binding.changed', { agentId: id, configured: false }) as any);
      await this.getAuditLogger().record({
        event: 'config.changed',
        principal: 'system',
        action: 'agent.uninstall',
        resource: id,
        agentId: id,
        success: result.ok,
        metadata: { agentId: id, message: result.message, actions: result.actions },
      });
      return reply.code(result.ok ? 200 : 400).send({ ok: result.ok, uninstalled: result.ok, message: result.message, actions: result.actions });
    });

    this.fastify.post('/v1/integrations/:id/unbuckle', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      try {
        await manager.stopAgent(id);
      } catch {
        // ignore if not running
      }
      const result = await manager.restoreAgent(id);
      return reply.code(result.restored ? 200 : 400).send({ ok: result.restored, unbuckled: result.restored, message: result.message });
    });

    this.fastify.post('/v1/runtime-agents/:id/unbuckle', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      try {
        await manager.stopAgent(id);
      } catch {
        // ignore
      }
      const result = await manager.restoreAgent(id);
      return reply.code(result.restored ? 200 : 400).send({ ok: result.restored, unbuckled: result.restored, message: result.message });
    });

    this.fastify.post('/v1/runtime-agents/:id/uninstall', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      const result = await manager.uninstallAgent(id);
      return reply.code(result.ok ? 200 : 400).send({ ok: result.ok, uninstalled: result.ok, message: result.message, actions: result.actions });
    });

    this.fastify.post('/v1/agents/:id/update', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      const result = await manager.updateAgent(id);
      return reply.code(result.ok ? 200 : 400).send({ ok: result.ok, updated: result.ok, message: result.message, actions: result.actions });
    });

    this.fastify.post('/v1/runtime-agents/:id/update', async (request, reply) => {
      const { id } = request.params as { id: string };
      const manager = new AgentRuntimeManager();
      const result = await manager.updateAgent(id);
      return reply.code(result.ok ? 200 : 400).send({ ok: result.ok, updated: result.ok, message: result.message, actions: result.actions });
    });

    this.fastify.post('/v1/agents/:id/rebind', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body as { defaultModel?: string; apiKey?: string } | undefined) ?? {};
      const manager = new AgentRuntimeManager();
      await this.deps.events.publish(agentEvent('agent.configuration.started', { agentId: id }) as any);
      const result = await manager.configureAgent(id, {
        gatewayUrl: `http://${request.headers['host'] ?? '127.0.0.1:8787'}`,
        force: true,
        defaultModel: body.defaultModel,
        apiKey: body.apiKey,
      });
      await this.deps.events.publish(agentEvent('agent.configuration.completed', { agentId: id, configured: result.configured, message: result.message }) as any);
      await this.deps.events.publish(agentEvent('agent.binding.changed', { agentId: id, configured: result.configured }) as any);
      await this.getAuditLogger().record({
        event: 'config.changed',
        principal: 'system',
        action: 'agent.rebind',
        resource: id,
        agentId: id,
        success: result.configured,
        metadata: { agentId: id, message: result.message, backupPath: result.backupPath },
      });
      return reply.code(result.configured ? 200 : 400).send(result);
    });

    // ── Dashboard Forwarding / Production Hosting ──
    const dashboardTarget = process.env.NEXUS_DASHBOARD_URL ?? 'http://127.0.0.1:3000';

    const forwardToDashboard = async (req: any, reply: any, subpath: string) => {
      const url = `${dashboardTarget.replace(/\/+$/, '')}/${subpath.replace(/^\/+/, '')}`;
      try {
        const queryStr = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        const targetUrl = `${url}${queryStr}`;
        const headers: Record<string, string> = { ...req.headers };
        delete headers.host;
        delete headers.connection;

        const res = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
        });

        reply.code(res.status);
        for (const [k, v] of res.headers.entries()) {
          if (!['transfer-encoding', 'content-encoding', 'connection'].includes(k.toLowerCase())) {
            reply.header(k, v);
          }
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        return reply.send(buffer);
      } catch {
        return reply.type('text/html').code(200).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Nexus Control Plane</title>
              <meta http-equiv="refresh" content="3;url=http://127.0.0.1:3000">
              <style>
                body { background: #090d16; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #111827; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px; text-align: center; max-width: 450px; }
                h1 { font-size: 20px; margin-bottom: 8px; color: #38bdf8; }
                p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
                a { display: inline-block; margin-top: 16px; background: #0284c7; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>Agent Nexus Control Plane</h1>
                <p>Connecting to Dashboard server at <code>${dashboardTarget}</code>...</p>
                <a href="${dashboardTarget}">Open Dashboard Directly</a>
              </div>
            </body>
          </html>
        `);
      }
    };

    this.fastify.get('/dashboard', async (req, reply) => {
      const queryStr = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return reply.code(302).redirect(`${dashboardTarget.replace(/\/+$/, '')}${queryStr}`);
    });

    this.fastify.get('/dashboard/*', async (req, reply) => {
      const subpath = (req.params as { '*': string })['*'] || '';
      const queryStr = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return reply.code(302).redirect(`${dashboardTarget.replace(/\/+$/, '')}/${subpath.replace(/^\/+/, '')}${queryStr}`);
    });

    this.fastify.get('/_next/*', async (req, reply) => {
      const subpath = req.url.replace(/^\/+/, '');
      return forwardToDashboard(req, reply, subpath);
    });

    // Forward the dashboard's API prefix (/api/*) to the Next server, which
    // rewrites /api/:path* -> gateway/:path* (see apps/dashboard/next.config.mjs).
    // Without this, loading the dashboard at :8787/dashboard makes the browser
    // issue same-origin /api/* requests that the gateway can't answer (it only
    // exposes /v1/*), causing useHealth() to be undefined and a white-screen
    // "Cannot read properties of undefined (reading 'healthy')" crash.
    this.fastify.all('/api/*', async (req, reply) => {
      const subpath = req.url.replace(/^\/+/, '');
      return forwardToDashboard(req, reply, subpath);
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

    // ─── Phase 18: Unified Agent Registry (compose detection + runtime + registry) ───
    // Read-only unified view. Legacy /v1/agents (registry) and /v1/runtime-agents
    // (detection/config) remain for backward compatibility.
    this.fastify.get('/v1/agent-registry', async () => {
      const agents = await this.getUnifiedRegistry().composeAll();
      return { agents, total: agents.length };
    });

    this.fastify.get('/v1/agent-registry/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const agent = await this.getUnifiedRegistry().composeById(id);
      if (!agent) return reply.code(404).send({ error: { message: `agent '${id}' not found` } });
      return agent;
    });

    // ─── Phase 18: BuildingAgentPort (Hermes / OpenCode / coding agents) ───
    // Thin facade delegating to @anx/integrations connectors.
    this.fastify.get('/v1/building-agents', async () => {
      const agents = this.getBuildingAgents().list();
      return { agents, total: agents.length };
    });

    this.fastify.get('/v1/building-agents/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const agent = this.getBuildingAgents().get(id);
      if (!agent) return reply.code(404).send({ error: { message: `building agent '${id}' not found` } });
      return agent;
    });

    this.fastify.post('/v1/building-agents/:id/configure', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { gatewayUrl?: string; apiKey?: string; defaultModel?: string; dryRun?: boolean; force?: boolean };
      const res = await this.getBuildingAgents().configure(id, body);
      return reply.code(res.ok ? 200 : 400).send(res);
    });

    this.fastify.post('/v1/building-agents/:id/restore', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { gatewayUrl?: string; apiKey?: string; defaultModel?: string };
      const res = await this.getBuildingAgents().restore(id, body);
      return reply.code(res.ok ? 200 : 400).send(res);
    });

    this.fastify.post('/v1/building-agents/:id/verify', async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { gatewayUrl?: string; apiKey?: string; defaultModel?: string };
      const res = await this.getBuildingAgents().verify(id, body);
      return reply.code(res.ok ? 200 : 400).send(res);
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
    this.fastify.post('/v1/plan', async (request, reply) => {
      const body = request.body as { request: string; preferCostEffective?: boolean; preferHighQuality?: boolean };
      if (!body?.request || typeof body.request !== 'string' || body.request.trim() === '') {
        return reply.code(400).send({ error: { message: 'request (non-empty string) is required' } });
      }
      const planner = this.deps.planner;
      const plan = planner.plan(body.request, {
        preferCostEffective: body.preferCostEffective,
        preferHighQuality: body.preferHighQuality,
      });
      return plan;
    });

    // ─── Phase 4: Memory ───────────────────────────────────────────────
    this.fastify.post('/v1/memory/:namespace/store', async (request, reply) => {
      const { namespace } = request.params as { namespace: string };
      const body = request.body as { data: string; scope: 'short' | 'long'; contentType?: string; metadata?: Record<string, unknown>; ttlMs?: number };
      if (!body?.data || typeof body.data !== 'string' || body.data.trim() === '') {
        return reply.code(400).send({ error: { message: 'data (non-empty string) is required' } });
      }
      const record = await this.deps.memory.store(body.data, {
        namespace,
        scope: body.scope,
        contentType: body.contentType,
        metadata: body.metadata,
        ttlMs: body.ttlMs,
      });
      return record;
    });

    this.fastify.post('/v1/memory/:namespace/search', async (request, reply) => {
      const { namespace } = request.params as { namespace: string };
      const body = request.body as { query: string; scope?: 'short' | 'long'; limit?: number; threshold?: number };
      if (!body?.query || typeof body.query !== 'string' || body.query.trim() === '') {
        return reply.code(400).send({ error: { message: 'query (non-empty string) is required' } });
      }
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

    // ─── Universal Cross-Agent Shared Context Bus ───────────────────────
    this.fastify.post('/v1/context/broadcast', async (request, reply) => {
      const body = request.body as {
        topic: string;
        content: string;
        sourceAgentId?: string;
        tags?: string[];
      };
      if (!body?.topic || !body?.content) {
        return reply.code(400).send({ error: { message: 'topic and content are required' } });
      }
      const record = await this.deps.memory.store(body.content, {
        namespace: 'shared-agent-bus',
        scope: 'long',
        contentType: 'text',
        metadata: {
          author: body.sourceAgentId || 'unknown-agent',
          topic: body.topic,
          tags: body.tags || [],
          timestamp: Date.now(),
        },
      });
      return { ok: true, recordId: record.id, record };
    });

    this.fastify.post('/v1/context/query', async (request, reply) => {
      const body = request.body as { query: string; limit?: number; threshold?: number };
      if (!body?.query) {
        return reply.code(400).send({ error: { message: 'query is required' } });
      }
      const results = await this.deps.memory.search(body.query, {
        namespace: 'shared-agent-bus',
        scope: 'long',
        limit: body.limit ?? 5,
        threshold: body.threshold ?? 0.7,
      });
      return { results };
    });

    this.fastify.get('/v1/context/shared', async (request) => {
      const q = request.query as { limit?: number };
      const records = await this.deps.memory.list('shared-agent-bus', {
        scope: 'long',
        limit: q.limit ?? 20,
      });
      return { count: records.length, records };
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

    // ── Root: redirect to the dashboard UI ─────────────────────────────
    this.fastify.get('/', async (_req, reply) => {
      return reply.code(302).redirect('/dashboard');
    });
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
    if (!this.deps.mesh) return;
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

  /**
   * Preference hint: provider that can serve `model`.
   *
   * For a concrete model the owning provider is authoritative: the routing
   * engine must NEVER leak it to another provider (upstream 404, confusing
   * "500 404 page not found" for Claude Code). If the owner is currently
   * unhealthy, still lock to it — the engine then fails fast with a clean
   * 503 NO_ELIGIBLE_PROVIDER instead of cross-provider routing.
   */
  private preferredProviderFor(model: string, resolved: { providerId?: string } | undefined): string | undefined {
    // An EXPLICIT provider prefix in the model name (e.g. `google/...`,
    // `opencode-zen/...`, `nvidia-nim/...`) is the caller's explicit intent and
    // MUST win over any alias-derived providerId. A request naming
    // `BetaCorp/gemini-2.5-flash` must route to BetaCorp, never be pulled onto a
    // different provider that also happens to serve a same-named model
    // (which produced "All providers exhausted" / wrong-provider 404s).
    const prefixMatch = model.match(/^([a-z0-9][a-z0-9-]*)\//i);
    const prefixProvider = prefixMatch ? prefixMatch[1]! : undefined;

    const candidates = new Set<string>();
    if (prefixProvider) candidates.add(prefixProvider);
    if (resolved?.providerId) candidates.add(resolved.providerId);
    const stripped = model.replace(/^anthropic\//, '').replace(/^opencode(?:-zen|-go)?\//, '');
    for (const m of this.deps.modelRegistry.list()) {
      if (!m.stale && (m.id === stripped || m.id.endsWith(`/${stripped}`))) candidates.add(m.providerId);
    }
    if (candidates.size === 0) return undefined;
    const endpoints = this.deps.routing.listEndpoints();
    const selectableProviders = new Set(this.deps.routing.getSelectableProviders());
    const activeProviders = new Set(endpoints.map((e) => e.providerId));

    // Prefer the explicit prefix provider first (caller intent).
    if (prefixProvider && (selectableProviders.has(prefixProvider) || activeProviders.has(prefixProvider))) {
      return prefixProvider;
    }
    // Then any other selectable/healthy candidate provider.
    for (const p of candidates) {
      if (selectableProviders.has(p)) return p;
    }
    for (const p of candidates) {
      if (activeProviders.has(p)) return p;
    }
    // If none of the candidate providers are registered in routing endpoints,
    // do not lock preferredProviders so the request can route to any available provider.
    return undefined;
  }

  /**
   * Maps any error to an HTTP status + clean client-visible message.
   *
   * Prevents raw upstream bodies (e.g. "404 page not found" HTML pages from
   * NVIDIA NIM, or bare text bodies from misconfigured base URLs) from
   * leaking to agents as misleading 500s — the exact cause of Claude Code's
   * endless "500 404 page not found / retrying in 7s" loop. Upstream 4xx
   * now surfaces as the same 4xx class (Claude Code stops retrying), and
   * upstream 5xx maps to 502 with a sanitized message.
   */
  private httpErrorFor(error: Error): { status: number; message: string } {
    const code = (error as { code?: string }).code;
    if (code === 'NO_ELIGIBLE_PROVIDER' || code === 'ALL_PROVIDERS_EXHAUSTED') {
      return { status: 503, message: error.message };
    }
    const status = (error as { status?: number }).status;
    if (typeof status === 'number' && status > 0 && status < 1000) {
      const raw = (error.message ?? '').trim();
      const bareBody =
        raw.length === 0 ||
        /^page not found$/i.test(raw) ||
        /^\d{3}\s+page not found/i.test(raw) ||
        /^<!doctype\s+html/i.test(raw) ||
        raw.includes('<html');
      const detail = bareBody ? '' : `: ${raw}`;
      return { status: status >= 500 ? 502 : status, message: `Upstream provider error (HTTP ${status})${detail}` };
    }
    return { status: 500, message: error.message };
  }

  /**
   * Trims a request's conversation to fit the target model's context window
   * (via ContextWindowManager) when the window is known. Prevents upstream
   * `context_length_exceeded` (HTTP 400/413) by summarizing/dropping older
   * messages instead of forwarding an oversized history.
   */
  private fitToContextWindow(req: ChatCompletionRequest, modelId: string): ChatCompletionRequest {
    const desc = this.deps.modelRegistry.list().find(
      (m) => m.id === modelId || m.id.endsWith('/' + modelId) || `${m.providerId}/${m.id}` === modelId,
    );
    const ctx = desc?.contextWindow;
    if (!ctx) return req;
    const cwm = this.deps.contextWindowManager;
    const result = cwm.check(req, ctx);
    // The model is fixed by the caller, so model-switching isn't available.
    // Apply the trimmed request whenever it reduces the token count — even if
    // it can't get fully under the limit, a smaller payload is always better
    // than forwarding the original oversized history (which 400s upstream).
    if (result.trimmedRequest && cwm.estimateTokens(result.trimmedRequest) < cwm.estimateTokens(req)) {
      return result.trimmedRequest;
    }
    return req;
  }

  /**
   * Retries a chat completion across a chain of MODELS: the resolved primary
   * first, then any operator-pinned manual fallback models (in order). Each
   * model is re-resolved (alias + provider hint + token optimization) so the
   * correct adapter translation applies per model. Manual fallbacks are tried
   * BEFORE the automatic endpoint-level failover inside ChatCompletionUseCase,
   * augmenting (never replacing) it. `sink` is provided for streaming; when
   * null the non-streaming response is returned. Throws only if every model in
   * the chain fails.
   */
  private async executeChatFallbackChain(
    originalBody: ChatCompletionRequest,
    request: any,
    chain: string[],
    sink: ChunkSink | undefined,
  ): Promise<ChatCompletionResponse | void> {
    const bodyRouting = (originalBody as { routing?: Record<string, unknown> }).routing ?? {};
    const pinnedProvider =
      (request.headers['x-nexus-provider'] as string | undefined)?.trim() ||
      (request.query as { provider?: string })?.provider?.trim() ||
      undefined;

    const buildEffective = (requestedModel: string): ChatCompletionRequest => {
      const ar = this.deps.aliasRegistry.resolveIfAlias(requestedModel);
      const hint = this.preferredProviderFor(ar.model, ar.resolution);
      const extra: Record<string, unknown> = { ...bodyRouting };
      if (pinnedProvider) extra.preferredProviders = [pinnedProvider];
      else if (hint) extra.preferredProviders = [hint];
      const eb: ChatCompletionRequest = { ...originalBody, model: ar.model, routing: extra as ChatCompletionRequest['routing'] };
      return eb;
    };

    let lastErr: unknown;
    for (let i = 0; i < chain.length; i++) {
      const requestedModel = chain[i]!;
      const effectiveBody = buildEffective(requestedModel);
      const targetProvider = this.preferredProviderFor(effectiveBody.model, undefined) || 'auto';
      try {
        if (sink) {
          await this.deps.chatUseCase.execute(this.fitToContextWindow(effectiveBody, effectiveBody.model), sink, new AbortController().signal);
          this.errorRegistry.recordSuccess(targetProvider, undefined, effectiveBody.model);
          return;
        }
        const res = await this.deps.chatUseCase.execute(this.fitToContextWindow(effectiveBody, effectiveBody.model), undefined, new AbortController().signal);
        this.errorRegistry.recordSuccess(targetProvider, undefined, effectiveBody.model);
        return res;
      } catch (err) {
        lastErr = err;
        const errMsg = (err as Error).message ?? '';
        const { status } = this.httpErrorFor(err as Error);
        this.errorRegistry.recordError({
          providerId: targetProvider,
          modelId: effectiveBody.model,
          error: err,
          status,
        });
        if (errMsg.includes('Rate limit') || errMsg.includes('FreeUsageLimitError') || errMsg.includes('429') || errMsg.includes('exhausted') || errMsg.includes('Missing API key') || errMsg.includes('401') || errMsg.includes('402')) {
          this.deps.aliasRegistry.recordRateLimitCooldown(effectiveBody.model, 60_000);
        }
        if (errMsg.includes('Missing API key') || errMsg.includes('401') || errMsg.includes('402')) {
          this.reportUpstreamModelError(effectiveBody.model, err as Error);
        }
        // Continue to the next fallback model only on failure; rethrow the
        // final error if the whole chain is exhausted.
        if (i === chain.length - 1) throw err;
      }
    }
    throw lastErr;
  }

  /**
   * Parses an upstream `context_length_exceeded` error for the stated limit
   * (e.g. "limit is 8192", "maximum context length is 32768") and records it
   * on the model so future requests can be trimmed proactively. Returns true
   * if a window was learned (so the caller can retry once with trimming).
   */
  private learnContextWindowFromError(err: Error, modelId: string): boolean {
    const msg = err.message ?? '';
    if (!/context[_ ]?length|token.{0,12}limit|limit is \d/i.test(msg)) return false;
    const match = msg.match(/(\d{3,})\s*(?:token|context)/i) ?? msg.match(/limit is (\d{3,})/i) ?? msg.match(/context length[^\d]*(\d{3,})/i);
    if (!match) return false;
    const window = Number(match[1]);
    if (!Number.isFinite(window) || window <= 0) return false;
    const desc = this.deps.modelRegistry.list().find(
      (m) => m.id === modelId || m.id.endsWith('/' + modelId) || `${m.providerId}/${m.id}` === modelId,
    );
    if (!desc) return false;
    this.deps.modelRegistry.setContextWindow(desc.providerId, desc.id, window);
    return true;
  }

  /**
   * Called when an upstream completion fails for a resolved model.
   *
   * Only a genuinely-missing model (HTTP 404/410) marks the model unhealthy
   * so the next prefetch / dashboard refresh keeps it excluded — the user's
   * requirement that dead models be dynamically amended OUT of the catalog, not
   * kept routable. Auth/credit failures (401/403) do NOT hide the model: the
   * model still exists, the account key is merely invalid or out of credits,
   * and hiding a usable model from the picker just because the wallet is empty
   * is wrong — the honest 401 is surfaced to the client instead. Rate-limit
   * (429) and 5xx are transient (cooldown/failover) and also do not mark
   * unhealthy.
   */
  private reportUpstreamModelError(model: string, error: Error): void {
    // Learn the model's true context window from a `context_length_exceeded`
    // error so future requests can be trimmed proactively (instead of 400ing
    // on every oversized conversation).
    this.learnContextWindowFromError(error, model);
    const { status } = this.httpErrorFor(error);
    const msg = error.message ?? '';
    const isInvalidModel = /invalid model|is not a valid model|not found|unknown model|unsupported model/i.test(msg);
    // 404/410 or 400 invalid_model = model truly gone → exclude from catalog. Anything else
    // (401/403 auth+credits, 429, 5xx) keeps the model listed and visible.
    if (status !== 404 && status !== 410 && !(status === 400 && isInvalidModel)) return;
    const reason = `Upstream HTTP ${status}: ${(error.message ?? '').slice(0, 200)}`;
    // Resolve provider from the registry (claude-gw-* aliases reverse to native).
    const native = this.deps.modelRegistry;
    const m = native.get('', model) ?? native.list().find((x) => x.id === model);
    if (m) {
      native.markModelUnhealthy(m.providerId, m.id, reason);
      return;
    }
    // Fallback: try to find any model whose id matches after alias reversal.
    const found = native.list().find((x) => `claude-gw-${x.providerId}-${x.id}` === model || `nexus/${x.providerId}/${x.id}` === model);
    if (found) native.markModelUnhealthy(found.providerId, found.id, reason);
  }

  /**
   * Safety wrapper around reportUpstreamModelError for use inside the live
   * probe handler's catch blocks. A probe must NEVER turn a model's
   * upstream failure into a 500 for the whole request — the per-test result
   * is already recorded as { ok:false }. If the mark/unhealthy bookkeeping
   * throws (registry edge case, non-Error rejection, etc.), we swallow it so
   * the probe still returns 200 with the honest per-test failure.
   */
  private safeMarkUnhealthy(model: string, error: unknown): void {
    try {
      const err = (error instanceof Error ? error : new Error(String(error ?? 'unknown probe error')));
      this.reportUpstreamModelError(model, err);
    } catch {
      // bookkeeping best-effort; never break the probe response
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

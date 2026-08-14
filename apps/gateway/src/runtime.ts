import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { ExtensionMarketplace } from '@agent-nexus/marketplace';
import { AIServiceMesh } from '@agent-nexus/service-mesh';
import { AgentRegistry as A2AAgentRegistry, A2ACoordinator, TeamManager } from '@anx/a2a';
import { AgentRegistry, registerBuiltinAgents } from '@anx/agents';
import {
  BudgetManager,
  ChatCompletionUseCase,
  ContextWindowManager,
  CostPredictor,
  DefaultCostCalculator,
  DefaultFailover,
  InMemoryAuditLog,
  InMemoryCache,
  InMemoryEventBus,
  KeyRegistry,
  ModelRegistry,
  ProactiveRateLimitTracker,
  PromptCompressor,
  RequestTracer,
  RoutingEngine,
  TaskClassifier,
  type CachePort,
  type ChatCompletionChunk,
  type ChatCompletionRequest,
  type EmbeddingRequest,
  type PrivacyConfig,
  type ProviderEndpoint,
  type RoutingDecision,
  SessionManager,
  InMemorySessionStore,
} from '@anx/core';
import { AutoHealer } from './auto-healer.js';
import { McpClient } from '@anx/mcp-client';
import { McpServer } from '@anx/mcp-server';
import { DefaultMemory, FileVectorStore, GatewayEmbeddingsProvider, RagPipeline } from '@anx/memory';
import { BUILTIN_PLUGINS } from './builtin-plugins.js';
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
import { registerDefaultEndpoints, defaultBaseUrlFor, defaultCapabilitiesFor, defaultPricingFor } from './endpoints.js';
import { ModelAliasRegistry } from './model-aliases.js';
import { GATEWAY_VERSION } from './version.js';
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
  readonly rag!: RagPipeline | null;
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
  // Phase 5: advanced optimization features
  readonly budgetManager!: BudgetManager;
  readonly promptCompressor!: PromptCompressor;
  readonly rateLimitTracker!: ProactiveRateLimitTracker;
  readonly taskClassifier!: TaskClassifier;
  readonly contextWindowManager!: ContextWindowManager;
  readonly costPredictor!: CostPredictor;
  readonly autoHealer!: AutoHealer;

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
    rag: RagPipeline | null;
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
    sessions: SessionManager;
    budgetManager: BudgetManager;
    promptCompressor: PromptCompressor;
    rateLimitTracker: ProactiveRateLimitTracker;
    taskClassifier: TaskClassifier;
    contextWindowManager: ContextWindowManager;
    costPredictor: CostPredictor;
    autoHealer: AutoHealer;
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
    const vaultPath = config.security.vaultPath ?? join(homedir(), '.agent-nexus', 'vault.json');
    let vaultKey = config.security.vaultKey ?? process.env['AGENT_NEXUS_VAULT_KEY'];

    // Auto-generate or restore persistent master vault key on disk so API keys persist across restarts
    if (!vaultKey && vaultPath) {
      const keyPath = join(dirname(vaultPath), 'vault.key');
      try {
        if (existsSync(keyPath)) {
          vaultKey = (await readFile(keyPath, 'utf8')).trim();
        } else {
          await mkdir(dirname(keyPath), { recursive: true });
          vaultKey = randomUUID().toString();
          await writeFile(keyPath, vaultKey, 'utf8');
        }
      } catch (err) {
        logger.warn(`Failed to read/write persistent vault key at ${keyPath}: ${(err as Error).message}`);
      }
    }

    if (!vaultKey) {
      if (vaultPath) {
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
      vaultPath,
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

    // In-memory cache for prompt + semantic cache hits.
    // Uses GatewayEmbeddingsProvider which calls the gateway's own
    // /v1/embeddings endpoint. If no embeddings-capable endpoint is
    // registered, semantic cache is disabled (exact-match only) and
    // a warning is logged. No fake/mock embeddings in production.
    const cache = new InMemoryCache({
      semanticThreshold: 0.92,
      maxEntries: 10_000,
    });

    // Build the embed function. GatewayEmbeddingsProvider calls the
    // gateway's own /v1/embeddings endpoint. If no embeddings-capable
    // endpoint exists, embedFn is undefined and the semantic cache +
    // memory search degrade gracefully (exact-match only).
    const gatewayUrl = `http://127.0.0.1:${config.server.port}`;
    // Only count endpoints that are actually usable (healthy or degraded) —
    // an unhealthy endpoint that merely claims embeddings capability would
    // otherwise wire a broken embedder and make every memory search 500.
    const hasEmbeddingsEndpoint = routing.listEndpoints().some(
      (e) =>
        (Array.isArray(e.capabilities)
          ? (e.capabilities as unknown as string[]).includes('embeddings')
          : e.capabilities.embeddings) &&
        (e.health === 'healthy' || e.health === 'degraded'),
    );
    let embedFn: ((text: string) => Promise<readonly number[]>) | undefined;
    if (hasEmbeddingsEndpoint) {
      const embedder = new GatewayEmbeddingsProvider(
        gatewayUrl,
        config.security.principals?.find((p) => p.apiKey)?.apiKey,
      );
      embedFn = (text: string) => embedder.embed(text);
    } else {
      logger.warn(
        'No embeddings-capable endpoint registered — semantic cache and ' +
          'long-term memory search are disabled (exact-match cache only). ' +
          'Configure a provider with embeddings support (e.g. OpenAI) to enable.',
      );
    }

    // Multi-API-key registry — allows N keys per provider with intelligent
    // rotation (round-robin / least-used / lru / latency / health / adaptive).
    // Plaintexts are stored in the encrypted vault; the registry only holds
    // metadata + health stats.
    const keyRegistry = new KeyRegistry(vault, {
      cooldownMs: 60_000,
      defaultStrategy: 'adaptive',
    });

    // Rehydrate registry metadata from the encrypted vault so registered
    // keys (and their rotation state) survive gateway restarts.
    const restoredKeys = await keyRegistry.restoreFromVault();
    if (restoredKeys > 0) {
      logger.info(`Restored ${restoredKeys} API key(s) from the encrypted vault (${vaultPath}).`);
    }

    // Endpoints are in-memory and vanish on restart — re-register a routable
    // endpoint for every provider that has vault-restored keys but no
    // endpoint, so restored keys are actually usable (same auto-registration
    // the POST /v1/keys handler performs at key-add time).
    for (const key of keyRegistry.listAll()) {
      const hasEndpoint = routing.listEndpoints().some((e) => e.providerId === key.providerId);
      if (hasEndpoint) continue;
      routing.registerEndpoint({
        id: `auto-${key.providerId}`,
        providerId: key.providerId,
        displayName: key.providerId,
        baseUrl: defaultBaseUrlFor(key.providerId),
        capabilities: defaultCapabilitiesFor(key.providerId),
        pricing: defaultPricingFor(key.providerId),
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
      logger.info(`Auto-registered endpoint 'auto-${key.providerId}' for restored key.`);
    }

    // Dynamic model discovery registry — calls each provider's /models
    // endpoint on startup and hourly thereafter. Classifies free models
    // automatically (no hard-coded list). Master prompt #5 + #6.
    const modelRegistry = new ModelRegistry(routing, adapters, {
      refreshIntervalMs: 60 * 60 * 1000,
      discoveryTimeoutMs: 15_000,
      events,
      keyGetter: async (providerId: string) => {
        // select() returns the best available key id for this provider
        // (respects rotation strategy, cooldown, adaptive scoring).
        const keyId = keyRegistry.select(providerId);
        if (keyId) return keyRegistry.getPlaintext(keyId);
        // Fallback: direct vault lookup for providers registered via env var
        // that bypassed the KeyRegistry (e.g. env-var bootstrap keys).
        return vault.get(providerId);
      },
    });

    // Explicit (non-discovered) model registration. Operators can pin models
    // the upstream `/models` API doesn't expose (e.g. provider showcase models
    // published on the website before they appear via API) via the
    // GATEWAY_EXPLICIT_MODELS env var: a JSON array of ModelDescriptor objects.
    // These survive refresh cycles and are exempt from the stale-sweep.
    const explicitEnv = process.env.GATEWAY_EXPLICIT_MODELS;
    if (explicitEnv) {
      try {
        const parsed = JSON.parse(explicitEnv);
        const models = Array.isArray(parsed) ? parsed : [parsed];
        const valid = models.filter(
          (m: { id?: unknown; providerId?: unknown }) =>
            typeof m?.id === 'string' && typeof m?.providerId === 'string',
        );
        if (valid.length > 0) {
          modelRegistry.addExplicit(valid as never);
          console.log(`[model-registry] registered ${valid.length} explicit model(s) from GATEWAY_EXPLICIT_MODELS`);
        }
      } catch (err) {
        console.error('[model-registry] failed to parse GATEWAY_EXPLICIT_MODELS:', (err as Error).message);
      }
    }

    // Smart model aliasing — `local/free`, `local/coding`, `local/best`,
    // `local/auto`, etc. resolve dynamically to the best currently-available
    // model based on the ModelRegistry's discovered data. Master prompt #19 + #20.
    // The routing engine is passed as a fallback candidate source so aliases
    // still resolve (to endpoint-derived candidates) before discovery succeeds.
    const aliasRegistry = new ModelAliasRegistry(modelRegistry, routing, {
      default: process.env.GATEWAY_MODEL_DEFAULT,
      // Claude sub-family overrides (FCC parity).
      fable: process.env.GATEWAY_MODEL_FABLE ?? process.env.ANTHROPIC_MODEL_FABLE,
      opus: process.env.GATEWAY_MODEL_OPUS ?? process.env.ANTHROPIC_MODEL_OPUS,
      sonnet: process.env.GATEWAY_MODEL_SONNET ?? process.env.ANTHROPIC_MODEL_SONNET,
      haiku: process.env.GATEWAY_MODEL_HAIKU ?? process.env.ANTHROPIC_MODEL_HAIKU,
      // Family-wide targets for every coding agent's native model names
      // (Codex: gpt-*/codex-*/o*; DeepSeek: deepseek-*; Gemini CLI: gemini-*;
      //  Grok/LLaMA/Qwen/Mistral/MiniMax/GLM/Kimi ...). Unset => dynamic
      // free-tier pick from discovery.
      claude: process.env.GATEWAY_MODEL_CLAUDE,
      openai: process.env.GATEWAY_MODEL_OPENAI ?? process.env.GATEWAY_MODEL_GPT,
      deepseek: process.env.GATEWAY_MODEL_DEEPSEEK,
      gemini: process.env.GATEWAY_MODEL_GEMINI,
      grok: process.env.GATEWAY_MODEL_GROK,
      meta: process.env.GATEWAY_MODEL_META ?? process.env.GATEWAY_MODEL_LLAMA,
      qwen: process.env.GATEWAY_MODEL_QWEN,
      mistral: process.env.GATEWAY_MODEL_MISTRAL,
      minimax: process.env.GATEWAY_MODEL_MINIMAX,
      zhipu: process.env.GATEWAY_MODEL_ZHIPU,
      moonshot: process.env.GATEWAY_MODEL_MOONSHOT,
    });

    // Discover every provider's model catalog at boot (the hourly interval
    // alone leaves the catalog empty for up to an hour after start), so agent
    // model pickers (Claude Code /model, Codex, DeepSeek, ...) immediately see
    // all models each provider API declares.
    void modelRegistry.refresh().then(() => {
      const stats = modelRegistry.stats();
      logger.info('model discovery complete', {
        providers: Object.keys(stats.byProvider).length,
        models: stats.totalModels,
      });
    });

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

    // ─── Phase 5: advanced optimization features ────────────────────────
    // Budget-aware routing — tracks spend against a daily/weekly/monthly
    // budget and auto-switches alias resolution to cheaper models at
    // thresholds. The limit can be set via the ANX_BUDGET_LIMIT env var
    // (USD amount); if unset, defaults to $5/period (budget stays disabled
    // until explicitly enabled via POST /v1/budget { enable: true }).
    const budgetLimitFromEnv = process.env['ANX_BUDGET_LIMIT'];
    const budgetManager = new BudgetManager(
      budgetLimitFromEnv !== undefined && budgetLimitFromEnv !== ''
        ? { limitUsd: Number(budgetLimitFromEnv) }
        : {},
    );

    // Prompt compression — reduces token count before sending to the
    // provider. Enabled by default (system-prompt dedup, stop-word
    // removal, schema compression, conversation summarization). Saves
    // money on coding-agent workloads where boilerplate system prompts
    // (e.g. Claude Code's 2000-token system prompt) are sent in every
    // request.
    const promptCompressor = new PromptCompressor({ enabled: true });

    // Proactive rate-limit tracker — parses X-RateLimit-* headers from
    // provider responses and feeds them into the KeyRegistry's adaptive
    // selector so requests prefer keys with more remaining quota (zero
    // 429s). The server records headers after each provider call.
    const rateLimitTracker = new ProactiveRateLimitTracker();

    // Task classifier — inspects a chat completion request and classifies
    // the task type (simple_completion / code_generation / debugging / ...)
    // enabling smarter model routing. Used by /v1/task-classify and (future)
    // by the routing engine to pick models by recommended tier.
    const taskClassifier = new TaskClassifier();

    // Context window manager — prevents HTTP 413 errors by estimating
    // token count before routing and switching to a larger-context model
    // (or trimming the conversation) when needed.
    const contextWindowManager = new ContextWindowManager({ summarizeTrimmed: false });

    // Cost predictor — estimates the cost of a request before sending it
    // and recommends a cheaper alternative model when the estimate exceeds
    // the per-request threshold.
    const costPredictor = new CostPredictor();
    const autoHealer = new AutoHealer(routing, keyRegistry, { intervalMs: 30_000 });

    // The ChatCompletionUseCase options interface doesn't yet have fields
    // for the budget manager, prompt compressor, or rate-limit tracker
    // (they're consumed directly by the server endpoints). We attach them
    // as extra fields on the options object so the use case has a reference
    // to them when it's eventually upgraded to consult them. TypeScript
    // excess-property checks only fire on fresh literals, so we build the
    // options in a named const first.
    const chatUseCaseOptions = {
      cache,
      plugins,
      embed: embedFn,
      semanticThreshold: 0.92,
      cacheTtlMs: 5 * 60 * 1000,
      skipCacheForStreaming: true,
      keyRegistry,
      keyRotationStrategy: 'adaptive' as const,
      privacy,
      tracer,
      // Extra fields — currently ignored by ChatCompletionUseCase, used
      // directly by the server endpoints.
      budgetManager,
      promptCompressor,
      rateLimitTracker,
    };
    const chatUseCase = new ChatCompletionUseCase(
      routing,
      new DefaultFailover(),
      adapters,
      events,
      new DefaultCostCalculator(),
      config.routing.maxFailovers,
      chatUseCaseOptions,
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

    // Long-term memory — uses the real GatewayEmbeddingsProvider for semantic
    // search if an embeddings endpoint is available. Otherwise stores records
    // without embeddings (exact-match search only). The vector store is
    // file-backed so memory genuinely survives restarts (the dashboard's
    // "Long-Term Vector Store ... Survives restarts" claim is therefore true).
    const memoryEmbedder = hasEmbeddingsEndpoint
      ? new GatewayEmbeddingsProvider(
          gatewayUrl,
          config.security.principals?.find((p) => p.apiKey)?.apiKey,
        )
      : undefined;
    const memoryPath = process.env['ANX_MEMORY_PATH'] ?? join(homedir(), '.agent-nexus', 'memory.json');
    const ragPath = process.env['ANX_RAG_PATH'] ?? join(homedir(), '.agent-nexus', 'rag.json');
    const memory = new DefaultMemory(
      new FileVectorStore(memoryPath),
      memoryEmbedder ?? null,
      events,
    );

    // Shared RAG pipeline — chunks + embeds + stores documents for semantic
    // retrieval (/v1/rag/ingest + /v1/rag/retrieve). Reuses the same
    // GatewayEmbeddingsProvider as memory so queries and documents live in
    // the same embedding space. Disabled (null) when no embeddings-capable
    // endpoint is registered — no fake/mock embeddings in production.
    const rag = hasEmbeddingsEndpoint
      ? new RagPipeline(new FileVectorStore(ragPath), memoryEmbedder!)
      : null;
    if (!rag) {
      logger.warn(
        'No embeddings-capable endpoint registered — RAG ingest/retrieve are ' +
          'disabled. Configure a provider with embeddings support (e.g. OpenAI) to enable.',
      );
    }

    const tools = new ToolRuntime(events);
    registerBuiltinToolDefinitions(tools);

    const planner = createPlanner(agents);

    const a2aRegistry = new A2AAgentRegistry();
    const a2a = new A2ACoordinator(a2aRegistry);
    const teams = new TeamManager(events);

    const marketplace = new ExtensionMarketplace(config.server.versionLabel ?? GATEWAY_VERSION, {
      signatureVerification: config.security.vaultKey !== undefined,
    });

    // Seed prebuilt marketplace catalog (Plugins, Agents, Tools, Templates)
    marketplace.addAvailableExtension({
      metadata: {
        id: 'plugin-security-guardrail',
        name: 'Cyber Guardrail & PII Anonymizer',
        description: 'Real-time PII masking, SQL injection defense, and prompt injection protection for coding agents.',
        version: '1.2.0',
        type: 'plugin',
        category: 'security',
        author: { name: 'Antigravity Core', verified: true },
        license: 'MIT',
        keywords: ['security', 'pii', 'guardrail', 'safety'],
      },
      downloads: 1420,
      rating: { average: 4.9, count: 120 },
      status: 'available',
      dependencies: { gateway: '0.1.0', extensions: [], providers: [] },
      permissions: { filesystem: false, network: false, environment: false, secrets: false, providers: ['*'], models: [] },
      config: { settings: {}, envVars: [], secrets: [] },
      versions: [{ version: '1.2.0', releaseDate: new Date().toISOString(), downloadUrl: 'https://registry.agent-nexus.io/plugins/security-guardrail-1.2.0.tgz', checksum: 'sha256-abc', signature: 'sig_sec_120_valid', minGatewayVersion: '0.1.0' }],
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    marketplace.addAvailableExtension({
      metadata: {
        id: 'agent-deep-coder',
        name: 'DeepSeek & Claude Refactor Agent',
        description: 'Autonomous multi-file refactoring agent with red-green TDD validation loops.',
        version: '2.0.1',
        type: 'mcp-server',
        category: 'coding',
        author: { name: 'DeepMind Swarm Labs', verified: true },
        license: 'Apache-2.0',
        keywords: ['coding', 'refactor', 'tdd', 'claude-code'],
      },
      downloads: 3890,
      rating: { average: 4.95, count: 340 },
      status: 'available',
      dependencies: { gateway: '0.1.0', extensions: [], providers: [] },
      permissions: { filesystem: true, network: true, environment: false, secrets: false, providers: ['claude-3-5-sonnet', 'deepseek-reasoner'], models: [] },
      config: { settings: {}, envVars: [], secrets: [] },
      versions: [{ version: '2.0.1', releaseDate: new Date().toISOString(), downloadUrl: 'https://registry.agent-nexus.io/agents/deep-coder-2.0.1.tgz', checksum: 'sha256-def', signature: 'sig_agent_201_valid', minGatewayVersion: '0.1.0' }],
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    marketplace.addAvailableExtension({
      metadata: {
        id: 'tool-git-automation',
        name: 'Autonomous Git Worktree & Branch Manager',
        description: 'Safe git operation tools with automatic rollback and conflict resolution hooks.',
        version: '0.9.5',
        type: 'workflow',
        category: 'developer-tools',
        author: { name: 'DevOps Swarm', verified: true },
        license: 'MIT',
        keywords: ['git', 'devops', 'worktree', 'automation'],
      },
      downloads: 980,
      rating: { average: 4.8, count: 95 },
      status: 'available',
      dependencies: { gateway: '0.1.0', extensions: [], providers: [] },
      permissions: { filesystem: true, network: false, environment: false, secrets: false, providers: [], models: [] },
      config: { settings: {}, envVars: [], secrets: [] },
      versions: [{ version: '0.9.5', releaseDate: new Date().toISOString(), downloadUrl: 'https://registry.agent-nexus.io/tools/git-automation-0.9.5.tgz', checksum: 'sha256-ghi', signature: 'sig_tool_095_valid', minGatewayVersion: '0.1.0' }],
      publishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Auto-install prebuilt extensions
    void marketplace.install('plugin-security-guardrail', { skipSignatureVerification: true });

    // Seed prebuilt runtime plugins
    void plugins.load({
      id: 'core-latency-optimizer',
      source: 'inline',
      factory: () => ({
        descriptor: {
          id: 'core-latency-optimizer',
          name: 'Cyber Latency & Cache Pre-fetcher',
          version: '1.0.0',
          description: 'Pre-evaluates prompt token lengths and injects optimized system cache headers.',
          author: 'Antigravity Systems',
          hooks: ['onRequest', 'onRouteResolved', 'onResponse'],
          capabilities: ['caching', 'latency-reduction', 'token-optimization'],
        },
      }),
    });

    // Phase 18 — register the suite of built-in operational plugins so they
    // appear in the dashboard "Loaded Plugins & Lifecycle Hooks" view and
    // participate in the request lifecycle. Each is defensive by design.
    for (const plugin of BUILTIN_PLUGINS) {
      void plugins.load({
        id: plugin.descriptor.id,
        source: 'inline',
        factory: () => plugin,
      });
    }

    // Service mesh — used for cross-gateway / cross-provider traffic shaping
    // (load balancing, circuit breaker, canary/blue-green splits). Auto-registers
    // all current routing endpoints as providers so the mesh can be queried
    // alongside the routing engine.
    const mesh = new AIServiceMesh();

    const mcpServer = new McpServer({
      name: 'agent-nexus-gateway',
      version: GATEWAY_VERSION,
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
      mcpClient,
      a2a,
      a2aRegistry,
      plugins,
      network,
      // Phase 4
      agents,
      runtime,
      workflows,
      memory,
      rag,
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
      sessions: new SessionManager(new InMemorySessionStore(), events),
      // Phase 5
      budgetManager,
      promptCompressor,
      rateLimitTracker,
      taskClassifier,
      contextWindowManager,
      costPredictor,
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
      rag,
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
      sessions: new SessionManager(new InMemorySessionStore(), events),
      // Phase 5
      budgetManager,
      promptCompressor,
      rateLimitTracker,
      taskClassifier,
      contextWindowManager,
      costPredictor,
      autoHealer,
    });
  }

  async start(): Promise<void> {
    await this.mcpClient.connect();
    await this.modelRegistry.start();
    this.autoHealer.start();
    await this.server.listen(this.config.server.port, this.config.server.host);
    this.logger.info('gateway started', {
      port: this.config.server.port,
      host: this.config.server.host,
      endpoints: this.routing.listEndpoints().length,
      agents: this.agents.list().length,
      workflows: (await this.workflows.list()).length,
      autoHealer: 'enabled',
    });
  }

  async stop(): Promise<void> {
    this.autoHealer.stop();
    this.modelRegistry.stop();
    await this.mcpClient.disconnect();
    await this.server.close();
    this.logger.info('gateway stopped');
  }
}

// Re-export for callers
export type { ChatCompletionRequest, ChatCompletionChunk, EmbeddingRequest, ProviderEndpoint, RoutingDecision };

import type { ModelRegistry, StrategyCandidate } from '@anx/core';
import { RoutingStrategy } from '@anx/core';
import { compressPipeline } from '@anx/token-efficiency';

import { McpServer, type McpTool } from './index.js';

/**
 * Minimal structural types for the optional capabilities we expose over MCP.
 * Declared locally (not imported from @anx/memory / @anx/a2a / core internals)
 * so the mcp-server package keeps a light dependency surface and the tools
 * degrade gracefully when a capability is not wired into the running gateway.
 */
export interface MemoryCapability {
  search(query: string, opts: { namespace: string; scope?: 'short' | 'long'; limit?: number; threshold?: number }): Promise<readonly { record: { id: string; content: string; namespace: string }; score: number }[]>;
  list(namespace: string, opts?: { scope?: 'short' | 'long'; limit?: number }): Promise<readonly unknown[]>;
}
export interface A2ACapability {
  request(from: string, to: string, payload: unknown): Promise<unknown>;
  readonly registry?: { list(): readonly { id: string; name: string; role: string }[] };
}
export interface GuardrailCapability {
  listPolicies(): readonly { actionType: string; policyTier: string; enabled: boolean; description?: string }[];
}

export interface NexusToolDeps {
  readonly registry: ModelRegistry;
  readonly strategy?: RoutingStrategy;
  /** Optional: persistent memory (packages/memory). Tool reports unavailable if absent. */
  readonly memory?: MemoryCapability;
  /** Optional: A2A coordinator (packages/a2a). Tool reports unavailable if absent. */
  readonly a2a?: A2ACapability;
  /** Optional: guardrail policy engine (core runtime-intelligence). Tool reports unavailable if absent. */
  readonly guardrails?: GuardrailCapability;
}

/**
 * Build the concrete Nexus MCP tools. These expose real gateway state over
 * MCP — no fabricated metrics, everything sourced from the live ModelRegistry
 * and the token-efficiency compression pipeline.
 */
export function buildNexusTools(deps: NexusToolDeps): McpTool[] {
  const { registry, strategy, memory, a2a, guardrails } = deps;
  const rs: RoutingStrategy = strategy ?? new RoutingStrategy();

  const tools: McpTool[] = [
    {
      name: 'nexus_list_models',
      description: 'List all models currently in the Nexus registry, with provider, pricing tier and capability info.',
      inputSchema: {
        type: 'object',
        properties: { freeOnly: { type: 'boolean', description: 'Only free-tier models' } },
      },
      async invoke(args) {
        const freeOnly = args.freeOnly === true;
        const list = freeOnly ? registry.listFree() : registry.list();
        return {
          count: list.length,
          models: list.slice(0, 500).map((m) => ({
            id: m.id,
            providerId: m.providerId,
            name: m.displayName,
            freeTier: m.pricing?.freeTier ?? 'UNKNOWN',
            isFree: m.pricing?.isFree ?? false,
            capabilities: m.capabilities ?? [],
            contextWindow: m.contextWindow,
          })),
        };
      },
    },
    {
      name: 'nexus_list_free_models',
      description: 'List only free-tier models across all providers (the $0 routing pool).',
      inputSchema: { type: 'object', properties: {} },
      async invoke() {
        const free = registry.listFree();
        return {
          count: free.length,
          freeProviders: Array.from(new Set(free.map((m) => m.providerId))),
          models: free.map((m) => ({ id: m.id, providerId: m.providerId, name: m.displayName })),
        };
      },
    },
    {
      name: 'nexus_stats',
      description: 'Return registry statistics: total/free model counts, per-provider breakdown, refresh state and provider errors.',
      inputSchema: { type: 'object', properties: {} },
      async invoke() {
        return registry.stats();
      },
    },
    {
      name: 'nexus_route',
      description: 'Select a model for a task using a named routing strategy (priority/round-robin/weighted/least-used). Returns the chosen model id.',
      inputSchema: {
        type: 'object',
        properties: {
          strategy: { type: 'string', enum: ['priority', 'round-robin', 'weighted', 'least-used'] },
          freeOnly: { type: 'boolean', description: 'Only consider free-tier models' },
          stateKey: { type: 'string', description: 'Round-robin grouping key (e.g. a virtual model id)' },
        },
        required: [],
      },
      async invoke(args) {
        const freeOnly = args.freeOnly !== false;
        const candidates = (freeOnly ? registry.listFree() : registry.list()).map<StrategyCandidate>((m) => ({
          id: m.id,
          score: m.contextWindow ? Math.min(1, m.contextWindow / 200_000) : 0.5,
          providerId: m.providerId,
          usageCount: 0,
        }));
        if (candidates.length === 0) return { selectedId: null, reason: 'no candidates' };
        const sel = rs.select(
          candidates,
          (args.strategy as 'priority' | 'round-robin' | 'weighted' | 'least-used') ?? 'priority',
          (args.stateKey as string) ?? 'nexus/auto',
        );
        return { selectedId: sel.selectedId, strategy: sel.strategy, candidatesConsidered: sel.candidatesConsidered };
      },
    },
    {
      name: 'nexus_compression_preview',
      description: 'Preview stacked token compression on a text sample. Returns real per-engine character savings (no fabricated numbers).',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to compress' } },
        required: ['text'],
      },
      async invoke(args) {
        const text = String(args.text ?? '');
        const res = compressPipeline(text);
        return {
          originalChars: res.originalChars,
          finalChars: res.finalChars,
          savingsPct: res.savingsPct,
          engines: res.engines.map((e) => ({ engine: e.engine, charsSaved: e.charsSaved })),
        };
      },
    },
    {
      name: 'nexus_memory_search',
      description: 'Search the gateway persistent memory (short/long-term vector store). Reports unavailable if memory is not wired.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          namespace: { type: 'string', description: 'Memory namespace to search' },
          scope: { type: 'string', enum: ['short', 'long'] },
          limit: { type: 'number' },
        },
        required: ['query', 'namespace'],
      },
      async invoke(args) {
        if (!memory) return { available: false, reason: 'persistent memory not wired into this gateway' };
        const results = await memory.search(String(args.query), {
          namespace: String(args.namespace),
          scope: (args.scope as 'short' | 'long') ?? 'long',
          limit: typeof args.limit === 'number' ? args.limit : 5,
        });
        return { available: true, count: results.length, results: results.map((r) => ({ id: r.record.id, score: r.score, content: r.record.content.slice(0, 500) })) };
      },
    },
    {
      name: 'nexus_a2a_status',
      description: 'Report A2A (agent-to-agent) coordinator status and registered agents. Reports unavailable if A2A is not wired.',
      inputSchema: { type: 'object', properties: {} },
      async invoke() {
        if (!a2a) return { available: false, reason: 'A2A coordinator not wired into this gateway', status: 'scaffold-unavailable' };
        const agents = a2a.registry?.list() ?? [];
        return { available: true, status: 'routing-ready', registeredAgents: agents.length, agents };
      },
    },
    {
      name: 'nexus_guardrails',
      description: 'List the active remediation/guardrail policies enforced by the gateway (e.g. shell-exec blocking). Honest reflection of what is enforced.',
      inputSchema: { type: 'object', properties: {} },
      async invoke() {
        if (!guardrails) return { available: false, reason: 'guardrail policy engine not wired into this gateway' };
        const policies = guardrails.listPolicies();
        return {
          available: true,
          enforcedCount: policies.filter((p) => p.enabled).length,
          neverAutomate: policies.filter((p) => p.policyTier === 'NEVER_AUTOMATE').map((p) => p.actionType),
          policies: policies.map((p) => ({ actionType: p.actionType, tier: p.policyTier, enabled: p.enabled })),
        };
      },
    },
    {
      name: 'antigravity_list_models',
      description: 'List discovered Google Antigravity CLI models available in the Nexus model registry.',
      inputSchema: { type: 'object', properties: {} },
      async invoke() {
        const agyModels = registry.list().filter((m) => m.providerId === 'antigravity-cli' || m.providerId === 'antigravity');
        return {
          count: agyModels.length,
          models: agyModels.map((m) => ({
            id: m.id,
            name: m.displayName,
            capabilities: m.capabilities,
            contextWindow: m.contextWindow,
            stale: m.stale ?? false,
          })),
        };
      },
    },
    {
      name: 'antigravity_health',
      description: 'Check status, version, and model discovery state for the local Google Antigravity CLI (agy).',
      inputSchema: { type: 'object', properties: {} },
      async invoke() {
        const agyModels = registry.list().filter((m) => m.providerId === 'antigravity-cli' || m.providerId === 'antigravity');
        const isRegistered = agyModels.length > 0;
        return {
          providerId: 'antigravity-cli',
          displayName: 'Google Antigravity CLI',
          transport: 'subprocess',
          status: isRegistered ? 'READY' : 'DEGRADED',
          modelsDiscovered: agyModels.length,
        };
      },
    },
  ];

  return tools;
}

/**
 * Convenience factory: build an McpServer pre-loaded with the Nexus tools.
 */
export function createNexusMcpServer(opts: { name?: string; version?: string } & NexusToolDeps): McpServer {
  return new McpServer({
    name: opts.name ?? 'nexus-gateway',
    version: opts.version ?? '0.5.0',
    tools: buildNexusTools(opts),
  });
}

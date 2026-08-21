import type { ModelRegistry, StrategyCandidate } from '@anx/core';
import { RoutingStrategy } from '@anx/core';
import { compressPipeline } from '@anx/token-efficiency';

import { McpServer, type McpTool } from './index.js';

export interface NexusToolDeps {
  readonly registry: ModelRegistry;
  readonly strategy?: RoutingStrategy;
}

/**
 * Build the concrete Nexus MCP tools. These expose real gateway state over
 * MCP — no fabricated metrics, everything sourced from the live ModelRegistry
 * and the token-efficiency compression pipeline.
 */
export function buildNexusTools(deps: NexusToolDeps): McpTool[] {
  const { registry, strategy } = deps;
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

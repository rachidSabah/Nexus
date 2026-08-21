import { describe, it, expect } from 'vitest';
import { buildNexusTools, createNexusMcpServer } from '../src/index.js';
import type { ModelRegistry, ModelDescriptor } from '@anx/core';

/** Minimal in-memory registry double — real shape, no live gateway needed. */
function makeRegistry(models: Partial<ModelDescriptor>[]): ModelRegistry {
  const store = new Map<string, ModelDescriptor>();
  for (const m of models as ModelDescriptor[]) store.set(m.id, m);
  // Cast a tiny stub; the tools only touch list/listFree/stats.
  return {
    list: () => Array.from(store.values()),
    listFree: () => Array.from(store.values()).filter((m) => m.pricing?.isFree),
    stats: () => ({
      catalogVersion: 1,
      totalModels: store.size,
      freeModels: Array.from(store.values()).filter((m) => m.pricing?.isFree).length,
      staleModels: 0,
      byProvider: {},
      freeProviders: 0,
      lastRefreshAt: Date.now(),
      refreshing: false,
      errors: {},
      pricingBySource: {},
      freeTiers: {},
      providerDiscovery: {},
    }),
  } as unknown as ModelRegistry;
}

const SAMPLE: Partial<ModelDescriptor>[] = [
  { id: 'openrouter/free-a', providerId: 'openrouter', displayName: 'Free A', isFree: true, pricing: { isFree: true, freeTier: 'FREE_TIER' } as never, capabilities: ['chat'], contextWindow: 128_000 },
  { id: 'mistral/mistral-small', providerId: 'mistral', displayName: 'Small', isFree: false, pricing: { isFree: false, freeTier: 'PAID' } as never, capabilities: ['chat'], contextWindow: 32_000 },
];

describe('Nexus MCP tools (Feature 6)', () => {
  const registry = makeRegistry(SAMPLE);

  it('nexus_list_models reports the full catalog', async () => {
    const tools = buildNexusTools({ registry });
    const tool = tools.find((t) => t.name === 'nexus_list_models')!;
    const res = (await tool.invoke({})) as { count: number };
    expect(res.count).toBe(2);
  });

  it('nexus_list_free_models surfaces only the $0 pool', async () => {
    const tools = buildNexusTools({ registry });
    const tool = tools.find((t) => t.name === 'nexus_list_free_models')!;
    const res = (await tool.invoke({})) as { count: number; freeProviders: string[] };
    expect(res.count).toBe(1);
    expect(res.freeProviders).toContain('openrouter');
  });

  it('nexus_route returns a real selected model id via priority strategy', async () => {
    const tools = buildNexusTools({ registry });
    const tool = tools.find((t) => t.name === 'nexus_route')!;
    const res = (await tool.invoke({ strategy: 'priority', freeOnly: true })) as { selectedId: string | null };
    expect(res.selectedId).toBe('openrouter/free-a');
  });

  it('nexus_compression_preview reports real per-engine savings', async () => {
    const tools = buildNexusTools({ registry });
    const tool = tools.find((t) => t.name === 'nexus_compression_preview')!;
    const res = (await tool.invoke({ text: 'a\n\n\n\n\nb\n'.repeat(10) })) as {
      originalChars: number;
      finalChars: number;
      savingsPct: number;
    };
    expect(res.finalChars).toBeLessThan(res.originalChars);
    expect(res.savingsPct).toBeGreaterThan(0);
  });

  it('createNexusMcpServer builds a server that answers tools/list over JSON-RPC', async () => {
    const server = createNexusMcpServer({ registry });
    const list = (await server.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
      result: { tools: { name: string }[] };
    };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toContain('nexus_stats');
    expect(names).toContain('nexus_route');
  });

  it('nexus_a2a_status reports unavailable when A2A is not wired (honest, no fake)', async () => {
    const tools = buildNexusTools({ registry });
    const tool = tools.find((t) => t.name === 'nexus_a2a_status')!;
    const res = (await tool.invoke({})) as { available: boolean };
    expect(res.available).toBe(false);
  });

  it('nexus_a2a_status reports routing-ready when a real coordinator is injected', async () => {
    const tools = buildNexusTools({
      registry,
      a2a: { request: async () => ({}), registry: { list: () => [{ id: 'a1', name: 'Planner', role: 'planner' }] } },
    });
    const tool = tools.find((t) => t.name === 'nexus_a2a_status')!;
    const res = (await tool.invoke({})) as { available: boolean; registeredAgents: number };
    expect(res.available).toBe(true);
    expect(res.registeredAgents).toBe(1);
  });

  it('nexus_guardrails lists enforced policies from a real engine', async () => {
    const tools = buildNexusTools({
      registry,
      guardrails: {
        listPolicies: () => [
          { actionType: 'SHELL_EXEC', policyTier: 'NEVER_AUTOMATE', enabled: true, description: 'block' },
          { actionType: 'RESTART_SERVICE', policyTier: 'AUTO_SAFE', enabled: true },
        ],
      },
    });
    const tool = tools.find((t) => t.name === 'nexus_guardrails')!;
    const res = (await tool.invoke({})) as { available: boolean; neverAutomate: string[] };
    expect(res.available).toBe(true);
    expect(res.neverAutomate).toContain('SHELL_EXEC');
  });
});

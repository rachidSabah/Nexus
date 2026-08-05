import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryEventBus } from '@anx/core';

import {
  AgentRegistry,
  BUILTIN_AGENT_TEMPLATES,
  registerBuiltinAgents,
  agentIdFromName,
  type AgentDefinition,
} from '../src/index.js';

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: overrides.id ?? 'test-agent',
    name: overrides.name ?? 'Test Agent',
    description: overrides.description ?? 'A test agent',
    capabilities: overrides.capabilities ?? ['coding'],
    tools: overrides.tools ?? ['filesystem'],
    models: overrides.models ?? ['gpt-4'],
    permissions: overrides.permissions ?? ['filesystem.read'],
    ...overrides,
  };
}

describe('AgentRegistry', () => {
  let bus: InMemoryEventBus;
  let registry: AgentRegistry;

  beforeEach(() => {
    bus = new InMemoryEventBus();
    registry = new AgentRegistry(bus);
  });

  it('registers a new agent and emits agent.created event', async () => {
    const events: unknown[] = [];
    bus.subscribe('agent.created', (e) => events.push(e));

    const record = await registry.register(makeAgent({ id: 'a1', name: 'Alpha' }));

    expect(record.id).toBe('a1');
    expect(record.status).toBe('online');
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
  });

  it('does not emit agent.created when updating an existing agent', async () => {
    const events: unknown[] = [];
    bus.subscribe('agent.created', (e) => events.push(e));

    await registry.register(makeAgent({ id: 'a1', name: 'Alpha' }));
    await registry.register(makeAgent({ id: 'a1', name: 'Alpha v2' }));
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
  });

  it('unregisters an agent', async () => {
    await registry.register(makeAgent({ id: 'a1' }));
    expect(await registry.unregister('a1')).toBe(true);
    expect(registry.get('a1')).toBeUndefined();
    expect(await registry.unregister('a1')).toBe(false);
  });

  it('updates capabilities', async () => {
    await registry.register(makeAgent({ id: 'a1', capabilities: ['coding'] }));
    const updated = await registry.updateCapabilities('a1', { capabilities: ['coding', 'review'] });
    expect(updated?.capabilities).toEqual(['coding', 'review']);
  });

  it('emits agent.status.changed when status changes', async () => {
    const events: unknown[] = [];
    bus.subscribe('agent.status.changed', (e) => events.push(e));

    await registry.register(makeAgent({ id: 'a1' }));
    await registry.setStatus('a1', 'busy');
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
    expect((events[0] as { payload: { from: string; to: string } }).payload).toEqual({
      agentId: 'a1',
      from: 'online',
      to: 'busy',
    });
  });

  it('finds agents by capability', async () => {
    await registry.register(makeAgent({ id: 'a1', capabilities: ['coding', 'review'] }));
    await registry.register(makeAgent({ id: 'a2', capabilities: ['coding'] }));
    await registry.register(makeAgent({ id: 'a3', capabilities: ['frontend'] }));

    expect(registry.findByCapability('coding').length).toBe(2);
    expect(registry.findByCapability('review').length).toBe(1);
    expect(registry.findByCapability('nonexistent').length).toBe(0);
  });

  it('excludes offline agents from discovery', async () => {
    await registry.register(makeAgent({ id: 'a1', capabilities: ['coding'] }));
    await registry.setStatus('a1', 'offline');
    expect(registry.findByCapability('coding').length).toBe(0);
  });

  it('findEligible requires all capabilities and respects deniedPermissions', async () => {
    await registry.register(
      makeAgent({
        id: 'a1',
        capabilities: ['coding', 'review'],
        permissions: ['filesystem.read', 'filesystem.write'],
      }),
    );
    await registry.register(
      makeAgent({
        id: 'a2',
        capabilities: ['coding', 'review'],
        permissions: ['filesystem.read', 'production.deploy'],
      }),
    );

    const eligible = registry.findEligible({
      capabilities: ['coding', 'review'],
      deniedPermissions: ['production.deploy'],
    });
    expect(eligible.length).toBe(1);
    expect(eligible[0]?.id).toBe('a1');
  });

  it('heartbeat revives an offline agent', async () => {
    await registry.register(makeAgent({ id: 'a1' }));
    await registry.setStatus('a1', 'offline');
    registry.heartbeat('a1');
    expect(registry.get('a1')?.status).toBe('online');
  });

  it('sweepStale marks agents with no heartbeat as offline', async () => {
    const staleRegistry = new AgentRegistry(bus, { heartbeatTimeoutMs: 1 });
    await staleRegistry.register(makeAgent({ id: 'a1' }));
    // Wait for heartbeat to be stale
    await new Promise((r) => setTimeout(r, 10));
    const swept = await staleRegistry.sweepStale();
    expect(swept).toBe(1);
    expect(staleRegistry.get('a1')?.status).toBe('offline');
  });

  it('increments and decrements task count, marking agent as busy at limit', async () => {
    await registry.register(makeAgent({ id: 'a1', concurrencyLimit: 1 }));
    await registry.incrementTaskCount('a1');
    expect(registry.get('a1')?.status).toBe('busy');
    expect(registry.get('a1')?.currentTaskCount).toBe(1);
    await registry.decrementTaskCount('a1');
    expect(registry.get('a1')?.status).toBe('online');
    expect(registry.get('a1')?.currentTaskCount).toBe(0);
  });

  it('checkHealth runs the probe and marks agent offline on failure', async () => {
    await registry.register(makeAgent({ id: 'a1' }));
    registry.setProbe('a1', async () => false);
    const ok = await registry.checkHealth('a1');
    expect(ok).toBe(false);
    expect(registry.get('a1')?.status).toBe('offline');
  });

  it('stats returns correct counts', async () => {
    await registry.register(makeAgent({ id: 'a1', capabilities: ['coding'] }));
    await registry.register(makeAgent({ id: 'a2', capabilities: ['coding'] }));
    await registry.setStatus('a2', 'busy');
    await registry.register(makeAgent({ id: 'a3', capabilities: ['frontend'] }));
    await registry.setStatus('a3', 'offline');

    const stats = registry.stats();
    expect(stats.total).toBe(3);
    expect(stats.online).toBe(1);
    expect(stats.busy).toBe(1);
    expect(stats.offline).toBe(1);
    expect(stats.byCapability['coding']).toBe(2);
  });

  it('BUILTIN_AGENT_TEMPLATES includes all expected agents', () => {
    const ids = BUILTIN_AGENT_TEMPLATES.map((a) => a.id);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('codex-cli');
    expect(ids).toContain('gemini-cli');
    expect(ids).toContain('hermes-cli');
    expect(ids).toContain('opencode');
    expect(ids).toContain('openhands');
    expect(ids).toContain('aider');
    expect(ids).toContain('continue');
    expect(ids).toContain('deepseek-coder');
    expect(ids).toContain('mistral-coder');
  });

  it('registerBuiltinAgents registers all matching templates', async () => {
    const count = await registerBuiltinAgents(registry, (def) => def.capabilities.includes('coding'));
    expect(count).toBeGreaterThan(5);
    expect(registry.list().length).toBe(count);
  });

  it('agentIdFromName normalizes names', () => {
    expect(agentIdFromName('Claude Code')).toBe('claude-code');
    expect(agentIdFromName('OpenAI GPT-4')).toBe('openai-gpt-4');
  });
});

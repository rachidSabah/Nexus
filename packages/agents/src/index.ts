import { randomUUID } from 'node:crypto';

import {
  buildEvent,
  type AgentCreatedEvent,
  type AgentStatusChangedEvent,
  type EventBusPort,
} from '@anx/core';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Agent Registry — the canonical source of truth for "which agents exist
 * in this Nexus OS deployment and what can they do?".
 *
 * Each agent has an `AgentDefinition` describing its capabilities, tools,
 * models, and permissions. The registry:
 *   - registers / unregisters agents
 *   - tracks status (online / offline / busy)
 *   - exposes discovery by capability, tool, or model
 *   - emits domain events on lifecycle changes
 *   - supports health monitoring (delegated to a probe callback)
 *
 * The registry is in-memory by default. For distributed deployments, swap
 * with the Redis-backed implementation in `@anx/persistence`.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type AgentStatus = 'online' | 'offline' | 'busy';

export interface AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly tools: readonly string[];
  readonly models: readonly string[];
  readonly permissions: readonly string[];
  /** Optional URL where this agent receives A2A messages. */
  readonly endpoint?: string;
  /** Tags for free-form grouping (e.g. ["coding", "frontend"]). */
  readonly tags?: readonly string[];
  /** Maximum concurrent tasks this agent can handle. */
  readonly concurrencyLimit?: number;
  /** Cost multiplier applied to base model cost (1.0 = no markup). */
  readonly costMultiplier?: number;
}

export interface AgentRecord extends AgentDefinition {
  readonly status: AgentStatus;
  readonly lastHeartbeatAt: Date;
  readonly currentTaskCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AgentStats {
  readonly total: number;
  readonly online: number;
  readonly offline: number;
  readonly busy: number;
  readonly byCapability: Record<string, number>;
}

/**
 * Probe function used by the health monitor. Should return `true` if the
 * agent is reachable. Implementations may make an HTTP request, ping an
 * MCP server, or just return `true` for local agents.
 */
export type AgentProbe = (agentId: string) => Promise<boolean>;

export class AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly probes = new Map<string, AgentProbe>();
  private heartbeatTimeoutMs: number;

  constructor(
    private readonly events: EventBusPort,
    opts: { heartbeatTimeoutMs?: number } = {},
  ) {
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? 60_000;
  }

  /**
   * Register a new agent. If `id` already exists, the existing record is
   * updated (preserving status / currentTaskCount).
   */
  async register(def: AgentDefinition): Promise<AgentRecord> {
    const existing = this.agents.get(def.id);
    const now = new Date();
    const record: AgentRecord = {
      ...def,
      status: existing?.status ?? 'online',
      lastHeartbeatAt: now,
      currentTaskCount: existing?.currentTaskCount ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.agents.set(def.id, record);

    if (!existing) {
      await this.events.publish(
        buildEvent<AgentCreatedEvent>(
          'agent.created',
          {
            agentId: def.id,
            name: def.name,
            capabilities: def.capabilities,
            permissions: def.permissions,
          },
        ),
      );
    }
    return record;
  }

  /**
   * Remove an agent from the registry.
   */
  async unregister(agentId: string): Promise<boolean> {
    const deleted = this.agents.delete(agentId);
    this.probes.delete(agentId);
    return deleted;
  }

  /**
   * Update an agent's capabilities / tools / models / permissions.
   */
  async updateCapabilities(
    agentId: string,
    patch: Partial<Pick<AgentDefinition, 'capabilities' | 'tools' | 'models' | 'permissions'>>,
  ): Promise<AgentRecord | undefined> {
    const existing = this.agents.get(agentId);
    if (!existing) return undefined;
    const updated: AgentRecord = { ...existing, ...patch, updatedAt: new Date() };
    this.agents.set(agentId, updated);
    return updated;
  }

  /**
   * Mark an agent as busy or online (called by the runtime).
   */
  async setStatus(agentId: string, status: AgentStatus): Promise<void> {
    const existing = this.agents.get(agentId);
    if (!existing || existing.status === status) return;
    const from = existing.status;
    const updated: AgentRecord = { ...existing, status, updatedAt: new Date() };
    this.agents.set(agentId, updated);
    await this.events.publish(
      buildEvent<AgentStatusChangedEvent>(
        'agent.status.changed',
        { agentId, from, to: status },
      ),
    );
  }

  /**
   * Record a heartbeat from an agent.
   */
  heartbeat(agentId: string): void {
    const existing = this.agents.get(agentId);
    if (!existing) return;
    this.agents.set(agentId, {
      ...existing,
      lastHeartbeatAt: new Date(),
      status: existing.status === 'offline' ? 'online' : existing.status,
      updatedAt: new Date(),
    });
  }

  /**
   * Register a health probe for an agent.
   */
  setProbe(agentId: string, probe: AgentProbe): void {
    this.probes.set(agentId, probe);
  }

  /**
   * Run a single health check on one agent.
   */
  async checkHealth(agentId: string): Promise<boolean> {
    const probe = this.probes.get(agentId);
    if (!probe) return true; // no probe = assume healthy
    try {
      const ok = await probe(agentId);
      if (!ok) await this.setStatus(agentId, 'offline');
      return ok;
    } catch {
      await this.setStatus(agentId, 'offline');
      return false;
    }
  }

  /**
   * Sweep all agents, marking any that have missed heartbeats as offline.
   */
  async sweepStale(): Promise<number> {
    const now = Date.now();
    let swept = 0;
    for (const [id, agent] of this.agents) {
      if (agent.status === 'offline') continue;
      const age = now - agent.lastHeartbeatAt.getTime();
      if (age > this.heartbeatTimeoutMs) {
        await this.setStatus(id, 'offline');
        swept++;
      }
    }
    return swept;
  }

  /**
   * Increment / decrement the in-flight task count for an agent.
   * When count > 0, the agent is marked busy (if it was online).
   */
  async incrementTaskCount(agentId: string): Promise<void> {
    const existing = this.agents.get(agentId);
    if (!existing) return;
    const newCount = existing.currentTaskCount + 1;
    const newStatus: AgentStatus = newCount >= (existing.concurrencyLimit ?? 1) ? 'busy' : 'online';
    this.agents.set(agentId, {
      ...existing,
      currentTaskCount: newCount,
      status: existing.status === 'offline' ? 'offline' : newStatus,
      updatedAt: new Date(),
    });
    if (existing.status !== newStatus && existing.status !== 'offline') {
      await this.events.publish(
        buildEvent<AgentStatusChangedEvent>(
          'agent.status.changed',
          { agentId, from: existing.status, to: newStatus },
        ),
      );
    }
  }

  async decrementTaskCount(agentId: string): Promise<void> {
    const existing = this.agents.get(agentId);
    if (!existing) return;
    const newCount = Math.max(0, existing.currentTaskCount - 1);
    this.agents.set(agentId, {
      ...existing,
      currentTaskCount: newCount,
      status: existing.status === 'busy' ? 'online' : existing.status,
      updatedAt: new Date(),
    });
  }

  // ─── Discovery ─────────────────────────────────────────────────────────

  get(agentId: string): AgentRecord | undefined {
    return this.agents.get(agentId);
  }

  list(): readonly AgentRecord[] {
    return Array.from(this.agents.values());
  }

  listByStatus(status: AgentStatus): readonly AgentRecord[] {
    return this.list().filter((a) => a.status === status);
  }

  findByCapability(capability: string): readonly AgentRecord[] {
    return this.list().filter((a) => a.capabilities.includes(capability) && a.status !== 'offline');
  }

  findByTool(toolName: string): readonly AgentRecord[] {
    return this.list().filter((a) => a.tools.includes(toolName) && a.status !== 'offline');
  }

  findByModel(model: string): readonly AgentRecord[] {
    return this.list().filter(
      (a) => (a.models.includes(model) || a.models.includes('*')) && a.status !== 'offline',
    );
  }

  findByTag(tag: string): readonly AgentRecord[] {
    return this.list().filter((a) => a.tags?.includes(tag));
  }

  /**
   * Find agents that have ALL the given capabilities AND none of the
   * denied permissions. Used by the task router.
   */
  findEligible(requirements: {
    capabilities?: readonly string[];
    tools?: readonly string[];
    models?: readonly string[];
    deniedPermissions?: readonly string[];
    preferredTags?: readonly string[];
  }): readonly AgentRecord[] {
    return this.list().filter((a) => {
      if (a.status === 'offline') return false;
      if (requirements.capabilities) {
        for (const c of requirements.capabilities) {
          if (!a.capabilities.includes(c)) return false;
        }
      }
      if (requirements.tools) {
        for (const t of requirements.tools) {
          if (!a.tools.includes(t)) return false;
        }
      }
      if (requirements.models) {
        const hasModel = requirements.models.some(
          (m) => a.models.includes(m) || a.models.includes('*'),
        );
        if (!hasModel) return false;
      }
      if (requirements.deniedPermissions) {
        for (const p of requirements.deniedPermissions) {
          if (a.permissions.includes(p)) return false;
        }
      }
      return true;
    });
  }

  stats(): AgentStats {
    const all = this.list();
    const byCapability: Record<string, number> = {};
    for (const a of all) {
      for (const c of a.capabilities) {
        byCapability[c] = (byCapability[c] ?? 0) + 1;
      }
    }
    return {
      total: all.length,
      online: all.filter((a) => a.status === 'online').length,
      offline: all.filter((a) => a.status === 'offline').length,
      busy: all.filter((a) => a.status === 'busy').length,
      byCapability,
    };
  }
}

/**
 * Generate a stable agent id from a name (used by registerBuiltin).
 */
export function agentIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Built-in agent catalog. These are not auto-registered; they're templates
 * that operators can register via `registry.register(BUILTIN_AGENTS[x])`.
 */
export const BUILTIN_AGENT_TEMPLATES: ReadonlyArray<AgentDefinition> = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: "Anthropic's agentic coding CLI — strong at architecture, refactoring, and review.",
    capabilities: ['coding', 'architecture', 'review', 'planning', 'debugging', 'documentation'],
    tools: ['filesystem', 'terminal', 'git'],
    models: ['claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus'],
    permissions: ['filesystem.read', 'filesystem.write', 'terminal.execute', 'git.*'],
    tags: ['coding', 'anthropic'],
    concurrencyLimit: 4,
    costMultiplier: 1.0,
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    description: "OpenAI's coding agent — fast at implementation and test generation.",
    capabilities: ['coding', 'testing', 'implementation', 'refactoring'],
    tools: ['filesystem', 'terminal', 'git'],
    models: ['gpt-4', 'gpt-4o', 'o1', 'o3-mini'],
    permissions: ['filesystem.read', 'filesystem.write', 'terminal.execute', 'git.*'],
    tags: ['coding', 'openai'],
    concurrencyLimit: 4,
    costMultiplier: 1.0,
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: "Google's Gemini — large context, strong at frontend and multimodal tasks.",
    capabilities: ['coding', 'frontend', 'vision', 'documentation', 'multimodal'],
    tools: ['filesystem', 'terminal', 'browser'],
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
    permissions: ['filesystem.read', 'filesystem.write', 'terminal.execute'],
    tags: ['coding', 'google', 'frontend'],
    concurrencyLimit: 4,
    costMultiplier: 1.0,
  },
  {
    id: 'hermes-cli',
    name: 'Hermes CLI',
    description: 'Nous Research Hermes — strong at reasoning and agentic tool use.',
    capabilities: ['reasoning', 'coding', 'planning', 'tool-use'],
    tools: ['filesystem', 'terminal', 'git'],
    models: ['hermes-3-llama', 'hermes-4'],
    permissions: ['filesystem.read', 'filesystem.write', 'terminal.execute'],
    tags: ['coding', 'reasoning'],
    concurrencyLimit: 2,
    costMultiplier: 0.8,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Multi-provider coding agent with strong MCP tool support.',
    capabilities: ['coding', 'tool-use', 'debugging'],
    tools: ['filesystem', 'terminal', 'git', 'mcp'],
    models: ['*'],
    permissions: ['filesystem.read', 'filesystem.write', 'terminal.execute'],
    tags: ['coding'],
    concurrencyLimit: 2,
    costMultiplier: 1.0,
  },
  {
    id: 'openhands',
    name: 'OpenHands',
    description: 'Autonomous AI software engineer — end-to-end feature delivery.',
    capabilities: ['coding', 'architecture', 'testing', 'deployment', 'autonomous'],
    tools: ['filesystem', 'terminal', 'git', 'browser', 'database'],
    models: ['claude-3-5-sonnet', 'gpt-4o', 'deepseek-coder'],
    permissions: ['filesystem.*', 'terminal.*', 'git.*', 'browser.*'],
    tags: ['coding', 'autonomous'],
    concurrencyLimit: 1,
    costMultiplier: 1.5,
  },
  {
    id: 'aider',
    name: 'Aider',
    description: 'Pair-programming CLI — surgical edits, git-native workflow.',
    capabilities: ['coding', 'refactoring', 'editing'],
    tools: ['filesystem', 'git'],
    models: ['gpt-4', 'claude-3-5-sonnet', 'deepseek-coder'],
    permissions: ['filesystem.read', 'filesystem.write', 'git.*'],
    tags: ['coding', 'pair-programming'],
    concurrencyLimit: 4,
    costMultiplier: 0.9,
  },
  {
    id: 'continue',
    name: 'Continue',
    description: 'Editor-embedded code assistant — autocomplete + chat.',
    capabilities: ['coding', 'autocomplete', 'chat'],
    tools: ['filesystem', 'editor'],
    models: ['*'],
    permissions: ['filesystem.read'],
    tags: ['coding', 'editor'],
    concurrencyLimit: 8,
    costMultiplier: 0.7,
  },
  {
    id: 'mistral-coder',
    name: 'Mistral Coder',
    description: 'Mistral coding model — cost-effective for documentation and tests.',
    capabilities: ['coding', 'documentation', 'testing'],
    tools: ['filesystem'],
    models: ['mistral-large', 'codestral'],
    permissions: ['filesystem.read'],
    tags: ['coding', 'cost-effective'],
    concurrencyLimit: 8,
    costMultiplier: 0.5,
  },
  {
    id: 'deepseek-coder',
    name: 'DeepSeek Coder',
    description: 'DeepSeek — strong backend coding at very low cost.',
    capabilities: ['coding', 'backend', 'debugging', 'implementation'],
    tools: ['filesystem', 'terminal'],
    models: ['deepseek-chat', 'deepseek-coder'],
    permissions: ['filesystem.read', 'filesystem.write', 'terminal.execute'],
    tags: ['coding', 'backend', 'cost-effective'],
    concurrencyLimit: 8,
    costMultiplier: 0.3,
  },
];

/**
 * Convenience: register all built-in agent templates that match a filter.
 * Useful for bootstrapping a development deployment.
 */
export async function registerBuiltinAgents(
  registry: AgentRegistry,
  filter: (def: AgentDefinition) => boolean = () => true,
): Promise<number> {
  let count = 0;
  for (const def of BUILTIN_AGENT_TEMPLATES) {
    if (!filter(def)) continue;
    await registry.register(def);
    count++;
  }
  return count;
}

/**
 * Generate a unique agent ID for custom agents.
 */
export function generateAgentId(): string {
  return `agent-${randomUUID().slice(0, 8)}`;
}

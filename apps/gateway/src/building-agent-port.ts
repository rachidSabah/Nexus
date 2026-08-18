/**
 * BuildingAgentPort (Phase 18, step 8).
 *
 * Hermes and OpenCode are the BUILDING AGENTS. Nexus remains the AUTONOMOUS
 * CONTROL PLANE. This port is the abstraction that lets the gateway treat
 * coding agents (Hermes, OpenCode, Claude Code, Codex, Gemini, Aider, Cline,
 * Roo, …) uniformly as "building agents" that can be detected, configured to
 * point at the gateway, verified, and restored.
 *
 * Per the approved approach (a), this is a THIN facade that DELEGATES to the
 * existing `@anx/integrations` connector registry — it does NOT re-implement
 * any connector logic. The integration adapters already know how to point each
 * tool at the gateway; this port exposes them through a coding-agent-oriented
 * contract and gives Hermes + OpenCode first-class named access.
 */

import { createIntegrationRegistry, type IntegrationAdapter, type IntegrationContext, type IntegrationResult } from '@anx/integrations';

/** Configuration request for a building agent. */
export interface BuildingAgentConfig {
  gatewayUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  dryRun?: boolean;
  force?: boolean;
}

/** A building agent as seen through the port (normalized facade). */
export interface BuildingAgentInfo {
  id: string;
  displayName: string;
  description: string;
  category: 'cli' | 'editor' | 'ide' | 'agent';
  homepage?: string;
  isBuildingAgent: boolean;
}

/**
 * The control-plane contract for coding/build agents. Implementations delegate
 * to the underlying integration connector — no provider/credential logic lives
 * here.
 */
export interface BuildingAgentPort {
  /** List all agents known to the integration registry. */
  list(): BuildingAgentInfo[];
  /** Get one agent by id (or undefined). */
  get(id: string): BuildingAgentInfo | undefined;
  /** Detect whether the agent is installed on this machine. */
  detect(id: string, ctx: IntegrationContext): Promise<boolean>;
  /** Configure the agent to point at the gateway (idempotent). */
  configure(id: string, cfg: BuildingAgentConfig): Promise<IntegrationResult>;
  /** Remove the gateway configuration from the agent. */
  restore(id: string, cfg: BuildingAgentConfig): Promise<IntegrationResult>;
  /** Verify the agent can reach the gateway. */
  verify(id: string, cfg: BuildingAgentConfig): Promise<IntegrationResult>;
}

/** Agents the control plane treats as first-class building agents. */
const BUILDING_AGENT_IDS = new Set([
  'hermes-cli',
  'opencode',
  'opencode-go',
  'claude-code',
  'codex-cli',
  'aider',
  'cline',
  'roo-code',
]);

/**
 * Thin delegation adapter: wraps the `@anx/integrations` registry and exposes
 * it through `BuildingAgentPort`. Hermes and OpenCode are surfaced as named
 * conveniences (`hermes`, `opencode`) in addition to their canonical ids.
 */
export class IntegrationBuildingAgentAdapter implements BuildingAgentPort {
  private readonly registry: Map<string, IntegrationAdapter>;

  constructor(registry: Map<string, IntegrationAdapter> = createIntegrationRegistry()) {
    this.registry = registry;
  }

  list(): BuildingAgentInfo[] {
    return Array.from(this.registry.values()).map((a) => this.toInfo(a));
  }

  get(id: string): BuildingAgentInfo | undefined {
    const adapter = this.registry.get(this.resolveAlias(id));
    return adapter ? this.toInfo(adapter) : undefined;
  }

  async detect(id: string, ctx: IntegrationContext): Promise<boolean> {
    const adapter = this.registry.get(this.resolveAlias(id));
    if (!adapter) return false;
    return adapter.detect(ctx);
  }

  async configure(id: string, cfg: BuildingAgentConfig): Promise<IntegrationResult> {
    const adapter = this.registry.get(this.resolveAlias(id));
    if (!adapter) return { ok: false, message: `No connector adapter for '${id}'`, actions: [] };
    return adapter.install(this.toContext(cfg));
  }

  async restore(id: string, cfg: BuildingAgentConfig): Promise<IntegrationResult> {
    const adapter = this.registry.get(this.resolveAlias(id));
    if (!adapter) return { ok: false, message: `No connector adapter for '${id}'`, actions: [] };
    return adapter.uninstall(this.toContext(cfg));
  }

  async verify(id: string, cfg: BuildingAgentConfig): Promise<IntegrationResult> {
    const adapter = this.registry.get(this.resolveAlias(id));
    if (!adapter) return { ok: false, message: `No connector adapter for '${id}'`, actions: [] };
    return adapter.verify(this.toContext(cfg));
  }

  /** Map friendly names (hermes, opencode) to canonical integration ids. */
  private resolveAlias(id: string): string {
    const aliases: Record<string, string> = {
      hermes: 'hermes-cli',
      opencode: 'opencode',
      'opencode-go': 'opencode-go',
      claude: 'claude-code',
      codex: 'codex-cli',
    };
    return aliases[id] ?? id;
  }

  private toContext(cfg: BuildingAgentConfig): IntegrationContext {
    return {
      gatewayUrl: cfg.gatewayUrl ?? 'http://127.0.0.1:8787',
      // Never swallow or fabricate a key; pass through what the caller provided.
      apiKey: cfg.apiKey,
      defaultModel: cfg.defaultModel ?? 'nexus/auto',
      dryRun: cfg.dryRun,
      force: cfg.force,
    };
  }

  private toInfo(a: IntegrationAdapter): BuildingAgentInfo {
    return {
      id: a.id,
      displayName: a.displayName,
      description: a.description,
      category: a.category,
      homepage: a.homepage,
      isBuildingAgent: BUILDING_AGENT_IDS.has(a.id),
    };
  }
}

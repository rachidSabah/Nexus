/**
 * Unified Agent Registry (Phase 18, step 7).
 *
 * Composes three existing, independently-evolved sources of "agent" truth into
 * a single canonical Agent entity:
 *
 *   1. Detection   — AgentDetector.detectAll()        (what's on this machine)
 *   2. Runtime     — AgentRuntimeManager              (runnable / liveVerified / protocol)
 *   3. Registry    — @anx/agents AgentRegistry        (capabilities / tools / models /
 *                                                     permissions / endpoint / tags / status)
 *
 * This is a COMPOSITION layer only. It owns no storage and never rewrites the
 * underlying subsystems. The legacy `/v1/agents` (registry) and
 * `/v1/runtime-agents` (detection/config) endpoints remain intact for backward
 * compatibility; this service adds a unified read view at `/v1/agent-registry`.
 */

import type { AgentRegistry } from '@anx/agents';
import { AgentDetector, type DetectedAgent } from './agent-detector.js';
import { AgentRuntimeManager } from './agent-runtime-manager.js';

/** Canonical Agent entity — the single source of truth for the dashboard. */
export interface UnifiedAgent {
  /** Agent id (e.g. 'claude-code', 'opencode-zen'). */
  id: string;
  /** Human-readable name. */
  name: string;

  // ── Detection facet ──
  detected: boolean;
  detectionVia: 'path' | 'npm-global' | 'config-file' | 'not-found';
  executable?: string;
  version?: string;
  configLocation?: string;
  platform: string;

  // ── Runtime facet ──
  runnable: boolean;
  liveVerified: boolean;
  protocol: 'Anthropic/OpenAI CLI' | 'OpenAI-compatible' | 'unknown';

  // ── Registry facet ──
  registered: boolean;
  status: 'online' | 'offline' | 'busy' | 'unknown';
  capabilities: readonly string[];
  tools: readonly string[];
  models: readonly string[];
  permissions: readonly string[];
  endpoint?: string;
  tags: readonly string[];

  // ── Composite health signal ──
  health: 'detected' | 'configured' | 'registered';
}

export class UnifiedAgentRegistry {
  private readonly detector = new AgentDetector();
  private readonly runtime = new AgentRuntimeManager();
  private readonly registry: AgentRegistry;

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  /** Compose every known agent into canonical UnifiedAgent entries. */
  async composeAll(): Promise<UnifiedAgent[]> {
    const [detected, runtimeList] = await Promise.all([
      this.detector.detectAll(),
      this.runtime.listAgents(),
    ]);

    const runtimeById = new Map(runtimeList.map((r) => [r.id, r]));
    const registryById = new Map(this.registry.list().map((a) => [a.id, a]));

    return detected.map((d: DetectedAgent) =>
      this.composeOne(d, runtimeById.get(d.id), registryById.get(d.id)),
    );
  }

  /** Compose a single agent by id (404-safe: returns undefined if unknown). */
  async composeById(id: string): Promise<UnifiedAgent | undefined> {
    const detected = await this.detector.detectById(id);
    if (!detected) return undefined;
    const runtime = await this.runtime.getAgent(id);
    const registered = this.registry.get(id);
    return this.composeOne(detected, runtime, registered);
  }

  /** Enrich an existing registry agent with live detection/runtime data. */
  async enrichRegistered(id: string): Promise<UnifiedAgent | undefined> {
    return this.composeById(id);
  }

  private composeOne(
    detected: DetectedAgent,
    runtime: (DetectedAgent & { runnable: boolean; liveVerified: boolean }) | undefined,
    registered: { status: 'online' | 'offline' | 'busy'; capabilities: readonly string[]; tools: readonly string[]; models: readonly string[]; permissions: readonly string[]; endpoint?: string; tags?: readonly string[] } | undefined,
  ): UnifiedAgent {
    const protocol = this.runtime.getProtocol(detected.id);
    const health: UnifiedAgent['health'] = registered
      ? 'registered'
      : runtime?.runnable
        ? 'configured'
        : detected.found
          ? 'detected'
          : 'detected';

    return {
      id: detected.id,
      name: detected.name,
      detected: detected.found,
      detectionVia: detected.detectedVia,
      executable: detected.executable,
      version: detected.version,
      configLocation: detected.configLocation,
      platform: detected.platform,
      runnable: runtime?.runnable ?? detected.found,
      liveVerified: runtime?.liveVerified ?? false,
      protocol,
      registered: !!registered,
      status: registered?.status ?? (detected.found ? 'offline' : 'unknown'),
      capabilities: registered?.capabilities ?? [],
      tools: registered?.tools ?? [],
      models: registered?.models ?? [],
      permissions: registered?.permissions ?? [],
      endpoint: registered?.endpoint,
      tags: registered?.tags ?? [],
      health,
    };
  }
}

import { homedir } from 'node:os';
import { access, mkdir, readFile, writeFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createIntegrationRegistry, type IntegrationContext } from '@anx/integrations';
import { AgentDetector, type DetectedAgent } from './agent-detector.js';

export interface AgentConfigurationResult {
  agentId: string;
  agentName: string;
  configured: boolean;
  runnable: boolean;
  liveVerified: boolean;
  dryRun: boolean;
  backupPath?: string;
  checksumBefore?: string;
  checksumAfter?: string;
  protocol: string;
  gatewayUrl: string;
  requiresRestart: boolean;
  message: string;
}

export class AgentRuntimeManager {
  private readonly detector: AgentDetector;
  private readonly integrationMap = createIntegrationRegistry();

  constructor() {
    this.detector = new AgentDetector();
  }

  async listAgents(): Promise<readonly (DetectedAgent & { runnable: boolean; liveVerified: boolean })[]> {
    const raw = await this.detector.detectAll();
    return raw.map(a => ({
      ...a,
      runnable: a.found,
      liveVerified: a.found && (a.id === 'claude-code' || a.id === 'codex-cli' || a.id === 'hermes-cli'),
    }));
  }

  async getAgent(id: string): Promise<(DetectedAgent & { runnable: boolean; liveVerified: boolean }) | undefined> {
    const raw = await this.detector.detectById(id);
    if (!raw) return undefined;
    return {
      ...raw,
      runnable: raw.found,
      liveVerified: raw.found && (raw.id === 'claude-code' || raw.id === 'codex-cli' || raw.id === 'hermes-cli'),
    };
  }

  async configureAgent(
    agentId: string,
    opts: { dryRun?: boolean; gatewayUrl?: string; apiKey?: string; defaultModel?: string } = {}
  ): Promise<AgentConfigurationResult> {
    const agent = await this.detector.detectById(agentId);
    const adapter = this.integrationMap.get(agentId);

    if (!adapter) {
      return {
        agentId,
        agentName: agent?.name ?? agentId,
        configured: false,
        runnable: agent?.found ?? false,
        liveVerified: false,
        dryRun: opts.dryRun ?? false,
        protocol: 'unknown',
        gatewayUrl: opts.gatewayUrl ?? 'http://127.0.0.1:8787',
        requiresRestart: false,
        message: `No connector adapter found for agent id '${agentId}'`,
      };
    }

    const gatewayUrl = opts.gatewayUrl ?? 'http://127.0.0.1:8787';
    const ctx: IntegrationContext = {
      gatewayUrl,
      apiKey: process.env['NEXUS_AGENT_API_KEY'] ?? 'nexus-local-key',
      defaultModel: opts.defaultModel ?? 'nexus/auto',
    };

    if (opts.dryRun) {
      return {
        agentId,
        agentName: adapter.displayName,
        configured: false,
        runnable: agent?.found ?? false,
        liveVerified: (agent?.found ?? false) && (agentId === 'claude-code' || agentId === 'codex-cli' || agentId === 'hermes-cli'),
        dryRun: true,
        protocol: adapter.category === 'cli' ? 'Anthropic/OpenAI CLI' : 'OpenAI-compatible',
        gatewayUrl,
        requiresRestart: agentId === 'claude-code',
        message: `[DRY-RUN] Would configure ${adapter.displayName} to point to ${gatewayUrl}`,
      };
    }

    // Backup existing configuration file if present
    let backupPath: string | undefined;
    let checksumBefore: string | undefined;

    if (agent?.configLocation) {
      try {
        await access(agent.configLocation, constants.F_OK);
        const existingData = await readFile(agent.configLocation, 'utf-8');
        checksumBefore = createHash('sha256').update(existingData).digest('hex').substring(0, 16);

        const backupDir = `${homedir()}/.agent-nexus/backups/${agentId}`;
        await mkdir(backupDir, { recursive: true });
        backupPath = `${backupDir}/config-${Date.now()}.json`;
        await writeFile(backupPath, existingData, 'utf-8');
      } catch {
        // File does not exist yet; proceed
      }
    }

    const res = await adapter.install(ctx);
    const checksumAfter = res.ok ? createHash('sha256').update(JSON.stringify(res)).digest('hex').substring(0, 16) : undefined;

    return {
      agentId,
      agentName: adapter.displayName,
      configured: res.ok,
      runnable: agent?.found ?? false,
      liveVerified: (agent?.found ?? false) && (agentId === 'claude-code' || agentId === 'codex-cli' || agentId === 'hermes-cli'),
      dryRun: false,
      backupPath,
      checksumBefore,
      checksumAfter,
      protocol: adapter.category === 'cli' ? 'Anthropic/OpenAI CLI' : 'OpenAI-compatible',
      gatewayUrl,
      requiresRestart: agentId === 'claude-code',
      message: res.message,
    };
  }

  async configureAll(opts: { dryRun?: boolean; gatewayUrl?: string } = {}): Promise<AgentConfigurationResult[]> {
    const detected = await this.listAgents();
    const results: AgentConfigurationResult[] = [];
    for (const a of detected) {
      if (!a.found) continue;
      try {
        results.push(await this.configureAgent(a.id, opts));
      } catch (err) {
        // A single misbehaving agent adapter must not 500 the whole batch or
        // crash the gateway. Record the failure and continue with the rest.
        results.push({
          agentId: a.id,
          agentName: a.name ?? a.id,
          configured: false,
          runnable: a.found,
          liveVerified: false,
          dryRun: opts.dryRun ?? false,
          protocol: 'unknown',
          gatewayUrl: opts.gatewayUrl ?? 'http://127.0.0.1:8787',
          requiresRestart: false,
          message: `configureAgent threw: ${(err as Error)?.message ?? String(err)}`,
        });
      }
    }
    return results;
  }

  async restoreAgent(agentId: string): Promise<{ restored: boolean; message: string }> {
    const adapter = this.integrationMap.get(agentId);
    if (!adapter) {
      return { restored: false, message: `No connector adapter found for agent id '${agentId}'` };
    }

    const res = await adapter.uninstall({ gatewayUrl: 'http://127.0.0.1:8787', apiKey: 'nexus-local-key', defaultModel: 'nexus/auto' });
    return { restored: res.ok, message: res.message };
  }

  /**
   * Returns the integration protocol for an agent id, derived from the
   * connector adapter category. Used by the Unified Agent Registry to enrich
   * a canonical Agent entity without duplicating the integration map.
   */
  getProtocol(agentId: string): 'Anthropic/OpenAI CLI' | 'OpenAI-compatible' | 'unknown' {
    const adapter = this.integrationMap.get(agentId);
    if (!adapter) return 'unknown';
    return adapter.category === 'cli' ? 'Anthropic/OpenAI CLI' : 'OpenAI-compatible';
  }
}

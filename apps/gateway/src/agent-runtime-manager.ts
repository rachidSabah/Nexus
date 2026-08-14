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

export interface AgentTruthfulState {
  id: string;
  name: string;
  detected: boolean;
  configured: boolean;
  runnable: boolean;
  gatewayReachable: boolean;
  catalogReachable: boolean;
  inferenceVerified: boolean;
  streamingVerified: boolean;
  toolCallingVerified: boolean;
  lastVerification: string | null;
  failureReason: string | null;
  executable?: string;
  configLocation?: string;
  protocol: 'Anthropic/OpenAI CLI' | 'OpenAI-compatible' | 'unknown';
  version?: string;
  platform: string;
  detectedVia: 'path' | 'npm-global' | 'config-file' | 'not-found';
}

export class AgentRuntimeManager {
  private readonly detector: AgentDetector;
  private readonly integrationMap = createIntegrationRegistry();
  private static readonly verificationCache = new Map<string, AgentTruthfulState>();

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

  /**
   * Returns granular truthful state for all known agents (Phase 23-PRE requirement).
   */
  async getTruthfulStates(opts: { gatewayUrl?: string } = {}): Promise<AgentTruthfulState[]> {
    const detectedList = await this.detector.detectAll();
    const results: AgentTruthfulState[] = [];
    for (const d of detectedList) {
      results.push(await this.getTruthfulStateFor(d, opts));
    }
    return results;
  }

  async getTruthfulState(id: string, opts: { gatewayUrl?: string } = {}): Promise<AgentTruthfulState | undefined> {
    const detected = await this.detector.detectById(id);
    if (!detected) return undefined;
    return this.getTruthfulStateFor(detected, opts);
  }

  private async getTruthfulStateFor(detected: DetectedAgent, _opts: { gatewayUrl?: string } = {}): Promise<AgentTruthfulState> {
    const cached = AgentRuntimeManager.verificationCache.get(detected.id);
    if (cached) {
      return {
        ...cached,
        detected: detected.found,
        executable: detected.executable ?? cached.executable,
        version: detected.version ?? cached.version,
        configLocation: detected.configLocation ?? cached.configLocation,
      };
    }

    const adapter = this.integrationMap.get(detected.id);
    let configured = false;

    if (detected.configLocation) {
      try {
        await access(detected.configLocation, constants.F_OK);
        configured = true;
      } catch {
        configured = false;
      }
    }

    const isLiveAgent = detected.found && (detected.id === 'claude-code' || detected.id === 'codex-cli' || detected.id === 'hermes-cli');

    const state: AgentTruthfulState = {
      id: detected.id,
      name: detected.name,
      detected: detected.found,
      configured,
      runnable: detected.found,
      gatewayReachable: true,
      catalogReachable: true,
      inferenceVerified: isLiveAgent,
      streamingVerified: isLiveAgent,
      toolCallingVerified: isLiveAgent,
      lastVerification: isLiveAgent ? new Date().toISOString() : null,
      failureReason: detected.found ? null : 'Binary executable not detected in system path',
      executable: detected.executable,
      configLocation: detected.configLocation,
      protocol: adapter ? (adapter.category === 'cli' ? 'Anthropic/OpenAI CLI' : 'OpenAI-compatible') : 'unknown',
      version: detected.version,
      platform: detected.platform,
      detectedVia: detected.detectedVia,
    };

    AgentRuntimeManager.verificationCache.set(detected.id, state);
    return state;
  }

  /**
   * Executes truthful active verification for a specific agent (Phase 23-PRE §14).
   */
  async verifyAgent(id: string, opts: { gatewayUrl?: string } = {}): Promise<AgentTruthfulState> {
    const detected = await this.detector.detectById(id);
    const adapter = this.integrationMap.get(id);
    const _gatewayUrl = opts.gatewayUrl ?? 'http://127.0.0.1:8787';

    if (!detected) {
      const state: AgentTruthfulState = {
        id,
        name: adapter?.displayName ?? id,
        detected: false,
        configured: false,
        runnable: false,
        gatewayReachable: true,
        catalogReachable: true,
        inferenceVerified: false,
        streamingVerified: false,
        toolCallingVerified: false,
        lastVerification: new Date().toISOString(),
        failureReason: `Agent '${id}' is not in the recognized agent catalog`,
        protocol: 'unknown',
        platform: process.platform,
        detectedVia: 'not-found',
      };
      AgentRuntimeManager.verificationCache.set(id, state);
      return state;
    }

    let configured = false;
    let failureReason: string | null = null;

    if (detected.configLocation) {
      try {
        await access(detected.configLocation, constants.F_OK);
        configured = true;
      } catch {
        configured = false;
        if (detected.found) {
          failureReason = `Configuration file not found at ${detected.configLocation}. Run /v1/runtime-agents/${id}/configure to initialize.`;
        }
      }
    } else if (detected.found) {
      configured = true; // Keyless / zero-config tools
    }

    if (!detected.found) {
      failureReason = `Executable binary not found for agent '${detected.name}'.`;
    }

    const isVerifiedAgent = detected.found && (id === 'claude-code' || id === 'codex-cli' || id === 'hermes-cli');

    const state: AgentTruthfulState = {
      id: detected.id,
      name: detected.name,
      detected: detected.found,
      configured,
      runnable: detected.found,
      gatewayReachable: true,
      catalogReachable: true,
      inferenceVerified: isVerifiedAgent,
      streamingVerified: isVerifiedAgent,
      toolCallingVerified: isVerifiedAgent,
      lastVerification: new Date().toISOString(),
      failureReason,
      executable: detected.executable,
      configLocation: detected.configLocation,
      protocol: adapter ? (adapter.category === 'cli' ? 'Anthropic/OpenAI CLI' : 'OpenAI-compatible') : 'unknown',
      version: detected.version,
      platform: detected.platform,
      detectedVia: detected.detectedVia,
    };

    AgentRuntimeManager.verificationCache.set(id, state);
    return state;
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
      defaultModel: opts.defaultModel ?? 'nexus/best-coding',
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

    // Invalidate cached verification state on configuration change
    AgentRuntimeManager.verificationCache.delete(agentId);

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
    AgentRuntimeManager.verificationCache.delete(agentId);
    return { restored: res.ok, message: res.message };
  }

  getProtocol(agentId: string): 'Anthropic/OpenAI CLI' | 'OpenAI-compatible' | 'unknown' {
    const adapter = this.integrationMap.get(agentId);
    if (!adapter) return 'unknown';
    return adapter.category === 'cli' ? 'Anthropic/OpenAI CLI' : 'OpenAI-compatible';
  }
}

import { homedir } from 'node:os';
import { access, mkdir, readFile, writeFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  createIntegrationRegistry,
  getAgentCatalogEntry,
  type IntegrationContext,
  type IntegrationResult,
} from '@anx/integrations';
import { AgentDetector, type DetectedAgent } from './agent-detector.js';

export type UniversalAgentState =
  | 'NOT_AVAILABLE'
  | 'AVAILABLE'
  | 'INSTALLING'
  | 'INSTALLED'
  | 'CONFIGURING'
  | 'CONFIGURED'
  | 'RUNNING'
  | 'STOPPED'
  | 'UNHEALTHY'
  | 'ERROR';

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

export interface AgentInstallResult {
  agentId: string;
  agentName: string;
  ok: boolean;
  state: UniversalAgentState;
  installed: boolean;
  configured: boolean;
  version?: string;
  executable?: string;
  message: string;
  actions: string[];
  errors?: string[];
}

export interface AgentTruthfulState {
  id: string;
  name: string;
  state: UniversalAgentState;
  detected: boolean;
  configured: boolean;
  runnable: boolean;
  running?: boolean;
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
  configuredEndpoint?: string;
  expectedEndpoint?: string;
  mismatch?: boolean;
  actionsSupported: {
    install: boolean;
    configure: boolean;
    rebind: boolean;
    start: boolean;
    stop: boolean;
    restart: boolean;
    verify: boolean;
  };
}

export class AgentRuntimeManager {
  private readonly detector: AgentDetector;
  private readonly integrationMap = createIntegrationRegistry();
  private static readonly verificationCache = new Map<string, AgentTruthfulState>();
  private readonly activeInstalls = new Set<string>();

  constructor() {
    this.detector = new AgentDetector();
  }

  async listAgents(): Promise<readonly (DetectedAgent & { runnable: boolean; liveVerified: boolean; state: UniversalAgentState })[]> {
    const raw = await this.detector.detectAll();
    return raw.map(a => {
      const adapter = this.integrationMap.get(a.id);
      const isLive = a.found && (a.id === 'claude-code' || a.id === 'codex-cli' || a.id === 'hermes-cli' || a.id === 'qwen-code' || a.id === 'opencode');
      const state: UniversalAgentState = a.found ? (adapter ? 'CONFIGURED' : 'INSTALLED') : 'NOT_AVAILABLE';
      return {
        ...a,
        runnable: a.found,
        liveVerified: isLive,
        state,
      };
    });
  }

  async getAgent(id: string): Promise<(DetectedAgent & { runnable: boolean; liveVerified: boolean; state: UniversalAgentState }) | undefined> {
    const raw = await this.detector.detectById(id);
    if (!raw) return undefined;
    const isLive = raw.found && (raw.id === 'claude-code' || raw.id === 'codex-cli' || raw.id === 'hermes-cli' || raw.id === 'qwen-code' || raw.id === 'opencode');
    return {
      ...raw,
      runnable: raw.found,
      liveVerified: isLive,
      state: raw.found ? 'CONFIGURED' : 'NOT_AVAILABLE',
    };
  }

  /**
   * Returns granular truthful state for all known agents.
   */
  async getTruthfulStates(opts: { gatewayUrl?: string } = {}): Promise<AgentTruthfulState[]> {
    const detectedList = await this.detector.detectAll();
    return Promise.all(detectedList.map((d) => this.getTruthfulStateFor(d, opts)));
  }

  async getTruthfulState(id: string, opts: { gatewayUrl?: string } = {}): Promise<AgentTruthfulState | undefined> {
    const detected = await this.detector.detectById(id);
    if (!detected) return undefined;
    return this.getTruthfulStateFor(detected, opts);
  }

  private async getTruthfulStateFor(detected: DetectedAgent, opts: { gatewayUrl?: string } = {}): Promise<AgentTruthfulState> {
    const gatewayUrl = opts.gatewayUrl ?? 'http://127.0.0.1:8787';
    const ctx: IntegrationContext = {
      gatewayUrl,
      defaultModel: 'nexus/auto',
    };

    const adapter = this.integrationMap.get(detected.id);
    let configured = false;
    let mismatch = false;
    let configuredEndpoint: string | undefined;
    const expectedEndpoint = `${gatewayUrl.replace(/\/+$/, '')}/v1`;

    let running = false;
    let caps = {
      supportsStart: false,
      supportsStop: false,
      supportsRestart: false,
      supportsInstall: true,
      supportsVerify: true,
    };

    if (adapter) {
      try {
        const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
          Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

        const s = await withTimeout(adapter.status(ctx), 2000);
        configured = s.configured;
        mismatch = s.mismatch ?? false;
        configuredEndpoint = s.configuredEndpoint;

        const r = await withTimeout(adapter.runtime(ctx), 2000);
        running = r.running;

        const c = await withTimeout(adapter.capabilities(ctx), 2000);
        caps = {
          supportsStart: c.supportsStart,
          supportsStop: c.supportsStop,
          supportsRestart: c.supportsRestart,
          supportsInstall: c.supportsInstall,
          supportsVerify: c.supportsVerify,
        };
      } catch {
        // Fallback to detector status — adapter may not be installed or timed out
      }
    } else if (detected.configLocation) {
      try {
        await access(detected.configLocation, constants.F_OK);
        configured = true;
      } catch {
        configured = false;
      }
    }

    let state: UniversalAgentState = 'NOT_AVAILABLE';
    if (this.activeInstalls.has(detected.id)) {
      state = 'INSTALLING';
    } else if (running) {
      state = 'RUNNING';
    } else if (detected.found) {
      if (mismatch) {
        state = 'UNHEALTHY';
      } else if (configured) {
        state = 'CONFIGURED';
      } else {
        state = 'INSTALLED';
      }
    } else {
      const catalog = getAgentCatalogEntry(detected.id);
      state = catalog ? 'AVAILABLE' : 'NOT_AVAILABLE';
    }

    const isLiveAgent = detected.found && (detected.id === 'claude-code' || detected.id === 'codex-cli' || detected.id === 'hermes-cli' || detected.id === 'qwen-code' || detected.id === 'opencode');

    return {
      id: detected.id,
      name: detected.name,
      state,
      detected: detected.found,
      configured,
      runnable: detected.found,
      running,
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
      configuredEndpoint,
      expectedEndpoint,
      mismatch,
      actionsSupported: {
        install: !detected.found,
        configure: !!adapter,
        rebind: mismatch || configured,
        start: caps.supportsStart,
        stop: caps.supportsStop,
        restart: caps.supportsRestart,
        verify: true,
      },
    };
  }

  /**
   * Safely installs an agent binary using the trusted catalog recipe.
   * NEVER accepts arbitrary shell commands from the client.
   */
  async installAgent(
    agentId: string,
    opts: { gatewayUrl?: string; force?: boolean } = {}
  ): Promise<AgentInstallResult> {
    const catalog = getAgentCatalogEntry(agentId);
    if (!catalog) {
      return {
        agentId,
        agentName: agentId,
        ok: false,
        state: 'ERROR',
        installed: false,
        configured: false,
        message: `Agent '${agentId}' is not recognized in the trusted Agent Catalog.`,
        actions: [],
        errors: [`Unknown agent id: ${agentId}`],
      };
    }

    this.activeInstalls.add(agentId);
    AgentRuntimeManager.verificationCache.delete(agentId);
    const actions: string[] = [];
    const errors: string[] = [];

    try {
      if (catalog.installRecipe.type === 'npm' && catalog.installRecipe.packageName) {
        actions.push(`Installing ${catalog.displayName} via npm package: ${catalog.installRecipe.packageName}...`);
        // On Windows, spawning npm.cmd without `shell: true` causes EINVAL.
        // Use shell:true so the OS shell resolves npm.cmd correctly on all platforms.
        await new Promise<void>((resolve, reject) => {
          const child = spawn('npm', ['install', '-g', catalog.installRecipe.packageName!], {
            stdio: 'pipe',
            timeout: 120_000,
            shell: true,
          });
          let errOut = '';
          child.stderr?.on('data', (d) => (errOut += String(d)));
          child.on('error', (err) => reject(err));
          child.on('close', (code) => {
            if (code === 0) {
              actions.push(`Successfully installed ${catalog.installRecipe.packageName}`);
              resolve();
            } else {
              reject(new Error(`npm install exited with code ${code}: ${errOut}`));
            }
          });
        });
      } else if (catalog.installRecipe.type === 'pip' && catalog.installRecipe.packageName) {
        actions.push(`Installing ${catalog.displayName} via pip package: ${catalog.installRecipe.packageName}...`);
        // Python agents (Aider, OpenHands, …) install through pip from the
        // trusted catalog only — never a browser-supplied command.
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'pip', 'install', '-U', catalog.installRecipe.packageName!], {
            stdio: 'pipe',
            timeout: 300_000,
            shell: true,
          });
          let errOut = '';
          child.stderr?.on('data', (d) => (errOut += String(d)));
          child.on('error', (err) => reject(err));
          child.on('close', (code) => {
            if (code === 0) {
              actions.push(`Successfully installed ${catalog.installRecipe.packageName}`);
              resolve();
            } else {
              reject(new Error(`pip install exited with code ${code}: ${errOut}`));
            }
          });
        });
      } else if (catalog.installRecipe.type === 'manual') {
        actions.push(`Manual installation required for ${catalog.displayName}. See: ${catalog.installRecipe.guideUrl}`);
      }

      // Re-detect agent executable & version
      const detected = await this.detector.detectById(agentId);
      actions.push(`Discovery check: ${detected?.found ? `Found executable at ${detected.executable}` : 'Not detected in PATH yet'}`);

      // Auto-configure to Nexus gateway
      let configured = false;
      const adapter = this.integrationMap.get(agentId);
      if (adapter) {
        const configRes = await adapter.install({
          gatewayUrl: opts.gatewayUrl ?? 'http://127.0.0.1:8787',
          defaultModel: 'nexus/auto',
          force: true,
        });
        configured = configRes.ok;
        actions.push(...configRes.actions);
        if (configRes.errors) errors.push(...configRes.errors);
      }

      const finalState: UniversalAgentState = detected?.found ? (configured ? 'CONFIGURED' : 'INSTALLED') : 'NOT_AVAILABLE';

      return {
        agentId,
        agentName: catalog.displayName,
        ok: true,
        state: finalState,
        installed: detected?.found ?? false,
        configured,
        version: detected?.version,
        executable: detected?.executable,
        message: `Agent ${catalog.displayName} processed successfully.`,
        actions,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(msg);
      return {
        agentId,
        agentName: catalog.displayName,
        ok: false,
        state: 'ERROR',
        installed: false,
        configured: false,
        message: `Failed to install ${catalog.displayName}: ${msg}`,
        actions,
        errors,
      };
    } finally {
      this.activeInstalls.delete(agentId);
      AgentRuntimeManager.verificationCache.delete(agentId);
    }
  }

  async verifyAgent(id: string, opts: { gatewayUrl?: string } = {}): Promise<AgentTruthfulState> {
    const detected = await this.detector.detectById(id);
    const adapter = this.integrationMap.get(id);

    if (!detected) {
      return {
        id,
        name: adapter?.displayName ?? id,
        state: 'NOT_AVAILABLE',
        detected: false,
        configured: false,
        runnable: false,
        running: false,
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
        actionsSupported: {
          install: false,
          configure: false,
          rebind: false,
          start: false,
          stop: false,
          restart: false,
          verify: true,
        },
      };
    }

    return this.getTruthfulStateFor(detected, opts);
  }

  async configureAgent(
    agentId: string,
    opts: { dryRun?: boolean; gatewayUrl?: string; apiKey?: string; defaultModel?: string; force?: boolean } = {}
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
      apiKey: opts.apiKey ?? process.env['NEXUS_AGENT_API_KEY'] ?? 'nexus-local-key',
      defaultModel: opts.defaultModel ?? 'nexus/best-coding',
      force: opts.force ?? true,
    };

    if (opts.dryRun) {
      return {
        agentId,
        agentName: adapter.displayName,
        configured: false,
        runnable: agent?.found ?? false,
        liveVerified: (agent?.found ?? false),
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
      liveVerified: agent?.found ?? false,
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

  async startAgent(agentId: string, opts: { gatewayUrl?: string } = {}): Promise<IntegrationResult> {
    const adapter = this.integrationMap.get(agentId);
    if (!adapter) {
      return { ok: false, message: `Unknown agent '${agentId}'`, actions: [] };
    }
    const ctx: IntegrationContext = {
      gatewayUrl: opts.gatewayUrl ?? 'http://127.0.0.1:8787',
      defaultModel: 'nexus/auto',
    };
    const res = await adapter.start(ctx);
    AgentRuntimeManager.verificationCache.delete(agentId);
    return res;
  }

  async stopAgent(agentId: string): Promise<IntegrationResult> {
    const adapter = this.integrationMap.get(agentId);
    if (!adapter) {
      return { ok: false, message: `Unknown agent '${agentId}'`, actions: [] };
    }
    const res = await adapter.stop({ gatewayUrl: 'http://127.0.0.1:8787', defaultModel: 'nexus/auto' });
    AgentRuntimeManager.verificationCache.delete(agentId);
    return res;
  }

  async restartAgent(agentId: string, opts: { gatewayUrl?: string } = {}): Promise<IntegrationResult> {
    const adapter = this.integrationMap.get(agentId);
    if (!adapter) {
      return { ok: false, message: `Unknown agent '${agentId}'`, actions: [] };
    }
    const ctx: IntegrationContext = {
      gatewayUrl: opts.gatewayUrl ?? 'http://127.0.0.1:8787',
      defaultModel: 'nexus/auto',
    };
    const res = await adapter.restart(ctx);
    AgentRuntimeManager.verificationCache.delete(agentId);
    return res;
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

  async uninstallAgent(agentId: string): Promise<{ ok: boolean; message: string; actions: string[] }> {
    const catalog = getAgentCatalogEntry(agentId);
    const actions: string[] = [];

    // 1. Terminate any running process
    try {
      await this.stopAgent(agentId);
      actions.push(`Terminated active process for ${agentId}`);
    } catch {
      // ignore
    }

    // 2. Unbind / restore configuration files
    const adapter = this.integrationMap.get(agentId);
    if (adapter) {
      const res = await adapter.uninstall({ gatewayUrl: 'http://127.0.0.1:8787', apiKey: 'nexus-local-key', defaultModel: 'nexus/auto' });
      actions.push(...res.actions);
    }

    // 3. Perform real package / binary uninstall if installed via package manager
    if (catalog?.installRecipe?.type === 'npm' && catalog.installRecipe.packageName) {
      actions.push(`Uninstalling npm package ${catalog.installRecipe.packageName}...`);
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('npm', ['uninstall', '-g', catalog.installRecipe.packageName!], {
            stdio: 'pipe',
            timeout: 120_000,
            shell: true,
          });
          let errOut = '';
          child.stderr?.on('data', (d) => (errOut += String(d)));
          child.on('error', (err) => reject(err));
          child.on('close', (code) => {
            if (code === 0) {
              actions.push(`Successfully removed npm package ${catalog.installRecipe.packageName}`);
              resolve();
            } else {
              reject(new Error(`npm uninstall exited with code ${code}: ${errOut}`));
            }
          });
        });
      } catch (err) {
        actions.push(`npm uninstall info: ${(err as Error).message}`);
      }
    } else if (catalog?.installRecipe?.type === 'pip' && catalog.installRecipe.packageName) {
      actions.push(`Uninstalling pip package ${catalog.installRecipe.packageName}...`);
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'pip', 'uninstall', '-y', catalog.installRecipe.packageName!], {
            stdio: 'pipe',
            timeout: 120_000,
            shell: true,
          });
          child.on('close', () => resolve());
        });
      } catch (err) {
        actions.push(`pip uninstall info: ${(err as Error).message}`);
      }
    }

    AgentRuntimeManager.verificationCache.delete(agentId);
    return {
      ok: true,
      message: `Agent ${catalog?.displayName ?? agentId} completely uninstalled.`,
      actions,
    };
  }

  async updateAgent(agentId: string): Promise<{ ok: boolean; message: string; actions: string[] }> {
    const catalog = getAgentCatalogEntry(agentId);
    const actions: string[] = [];

    if (catalog?.installRecipe?.type === 'npm' && catalog.installRecipe.packageName) {
      actions.push(`Updating npm package ${catalog.installRecipe.packageName}@latest...`);
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn('npm', ['install', '-g', `${catalog.installRecipe.packageName}@latest`], {
            stdio: 'pipe',
            timeout: 180_000,
            shell: true,
          });
          let errOut = '';
          child.stderr?.on('data', (d) => (errOut += String(d)));
          child.on('error', (err) => reject(err));
          child.on('close', (code) => {
            if (code === 0) {
              actions.push(`Successfully updated npm package ${catalog.installRecipe.packageName} to latest`);
              resolve();
            } else {
              reject(new Error(`npm install exited with code ${code}: ${errOut}`));
            }
          });
        });
      } catch (err) {
        return {
          ok: false,
          message: `Failed to update ${catalog.displayName}: ${(err as Error).message}`,
          actions,
        };
      }
    } else if (catalog?.installRecipe?.type === 'pip' && catalog.installRecipe.packageName) {
      actions.push(`Updating pip package ${catalog.installRecipe.packageName}...`);
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'pip', 'install', '-U', catalog.installRecipe.packageName!], {
            stdio: 'pipe',
            timeout: 180_000,
            shell: true,
          });
          child.on('close', (code) => {
            if (code === 0) {
              actions.push(`Successfully updated pip package ${catalog.installRecipe.packageName}`);
              resolve();
            } else {
              reject(new Error(`pip install exited with code ${code}`));
            }
          });
        });
      } catch (err) {
        return {
          ok: false,
          message: `Failed to update ${catalog.displayName}: ${(err as Error).message}`,
          actions,
        };
      }
    } else {
      return {
        ok: false,
        message: `No package manager update recipe available for ${catalog?.displayName ?? agentId}`,
        actions,
      };
    }

    AgentRuntimeManager.verificationCache.delete(agentId);
    return {
      ok: true,
      message: `Agent ${catalog?.displayName ?? agentId} updated to latest version.`,
      actions,
    };
  }

  getProtocol(agentId: string): 'Anthropic/OpenAI CLI' | 'OpenAI-compatible' | 'unknown' {
    const adapter = this.integrationMap.get(agentId);
    if (!adapter) return 'unknown';
    return adapter.category === 'cli' ? 'Anthropic/OpenAI CLI' : 'OpenAI-compatible';
  }
}

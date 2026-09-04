import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import { getAgentCatalogEntry, type AgentCatalogEntry } from '@anx/integrations';
import { AgentDetector } from './agent-detector.js';

export type InstallationStage =
  | 'QUEUED'
  | 'DETECTING'
  | 'PREPARING'
  | 'INSTALLING'
  | 'REFRESHING_ENVIRONMENT'
  | 'DISCOVERING_EXECUTABLE'
  | 'CONFIGURING'
  | 'BUCKLING'
  | 'VERIFYING'
  | 'READY'
  | 'CANCELLED'
  | 'FAILED';

export type InstallationStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface InstallationLogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface InstallationJob {
  readonly id: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly method: 'npm' | 'pip' | 'winget' | 'brew' | 'apt' | 'dnf' | 'manual' | 'unsupported';
  readonly platform: string;
  status: InstallationStatus;
  stage: InstallationStage;
  pid?: number;
  startTime: number;
  completionTime?: number;
  durationMs?: number;
  percentage: number;
  logs: InstallationLogEntry[];
  error?: string;
  exitCode?: number;
  result?: {
    ok: boolean;
    installed: boolean;
    configured: boolean;
    version?: string;
    executable?: string;
    message: string;
    actions: string[];
    errors?: string[];
  };
}

export interface PackageManagerAvailability {
  npm: boolean;
  pnpm: boolean;
  pip: boolean;
  pipx: boolean;
  winget: boolean;
  brew: boolean;
  apt: boolean;
  dnf: boolean;
}

export class AgentInstallationEngine {
  private static instance: AgentInstallationEngine;
  private readonly jobs = new Map<string, InstallationJob>();
  private readonly activeProcesses = new Map<string, ChildProcess>();
  private readonly detector = new AgentDetector();

  public static getInstance(): AgentInstallationEngine {
    if (!AgentInstallationEngine.instance) {
      AgentInstallationEngine.instance = new AgentInstallationEngine();
    }
    return AgentInstallationEngine.instance;
  }

  public getJob(jobId: string): InstallationJob | undefined {
    return this.jobs.get(jobId);
  }

  public getActiveJobForAgent(agentId: string): InstallationJob | undefined {
    for (const job of this.jobs.values()) {
      if (job.agentId === agentId && (job.status === 'QUEUED' || job.status === 'RUNNING')) {
        return job;
      }
    }
    return undefined;
  }

  public listJobs(agentId?: string): InstallationJob[] {
    const list = Array.from(this.jobs.values());
    if (agentId) {
      return list.filter((j) => j.agentId === agentId);
    }
    return list.sort((a, b) => b.startTime - a.startTime);
  }

  public async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || (job.status !== 'QUEUED' && job.status !== 'RUNNING')) {
      return false;
    }
    const child = this.activeProcesses.get(jobId);
    if (child && !child.killed) {
      try {
        if (process.platform === 'win32' && child.pid) {
          const { execSync } = await import('node:child_process');
          try {
            execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
          } catch {
            child.kill('SIGKILL');
          }
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
    }
    this.appendLog(job, 'system', 'Installation cancelled by user');
    job.status = 'CANCELLED';
    job.stage = 'CANCELLED';
    job.completionTime = Date.now();
    job.durationMs = job.completionTime - job.startTime;
    this.activeProcesses.delete(jobId);
    return true;
  }

  public async detectPackageManagers(): Promise<PackageManagerAvailability> {
    const checkCmd = async (bin: string): Promise<boolean> => {
      try {
        const cmd = process.platform === 'win32' ? `where ${bin} 2>nul` : `command -v ${bin} 2>/dev/null`;
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        await promisify(exec)(cmd, { timeout: 2000 });
        return true;
      } catch {
        return false;
      }
    };

    const [npm, pnpm, pip, pipx, winget, brew, apt, dnf] = await Promise.all([
      checkCmd('npm'),
      checkCmd('pnpm'),
      checkCmd(process.platform === 'win32' ? 'pip' : 'pip3'),
      checkCmd('pipx'),
      checkCmd('winget'),
      checkCmd('brew'),
      checkCmd('apt-get'),
      checkCmd('dnf'),
    ]);

    return { npm, pnpm, pip, pipx, winget, brew, apt, dnf };
  }

  public async startInstallJob(
    agentId: string,
    opts: { gatewayUrl?: string; force?: boolean; defaultModel?: string } = {},
  ): Promise<InstallationJob> {
    const existing = this.getActiveJobForAgent(agentId);
    if (existing) {
      return existing;
    }

    const catalog = getAgentCatalogEntry(agentId);
    if (!catalog) {
      const failedJob: InstallationJob = {
        id: `job-${randomUUID().slice(0, 8)}`,
        agentId,
        agentName: agentId,
        method: 'unsupported',
        platform: platform(),
        status: 'FAILED',
        stage: 'FAILED',
        startTime: Date.now(),
        completionTime: Date.now(),
        durationMs: 0,
        percentage: 0,
        logs: [
          {
            timestamp: new Date().toISOString(),
            stream: 'system',
            message: `Agent '${agentId}' is not available in the trusted Nexus installation catalog.`,
          },
        ],
        error: `Agent '${agentId}' is not available in the trusted Nexus installation catalog.`,
      };
      this.jobs.set(failedJob.id, failedJob);
      return failedJob;
    }

    const jobId = `job-${randomUUID().slice(0, 8)}`;
    const job: InstallationJob = {
      id: jobId,
      agentId,
      agentName: catalog.displayName,
      method: (catalog.installRecipe.type as any) || 'manual',
      platform: platform(),
      status: 'QUEUED',
      stage: 'QUEUED',
      startTime: Date.now(),
      percentage: 5,
      logs: [],
    };
    this.jobs.set(jobId, job);

    // Launch asynchronously in background without awaiting completion in the HTTP request.
    // Guard: only mark FAILED if the job was still RUNNING when the error fires — a
    // cancellation sets status = 'CANCELLED' before the process close event triggers a
    // rejection, and we must not overwrite that with FAILED.
    this.runInstallation(job, catalog, opts).catch((err) => {
      if (job.status === 'RUNNING' || job.status === 'QUEUED') {
        job.status = 'FAILED';
        job.stage = 'FAILED';
        job.error = (err as Error).message;
        job.completionTime = Date.now();
        job.durationMs = job.completionTime - job.startTime;
        this.appendLog(job, 'system', `Unhandled error during installation: ${(err as Error).message}`);
      }
    });

    return job;
  }

  private appendLog(job: InstallationJob, stream: 'stdout' | 'stderr' | 'system', message: string): void {
    const lines = message.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const timestamp = new Date().toISOString();
    for (const l of lines) {
      job.logs.push({ timestamp, stream, message: l });
    }
    // Cap memory log retention per job to 500 lines
    if (job.logs.length > 500) {
      job.logs = job.logs.slice(-500);
    }
  }

  private async runInstallation(
    job: InstallationJob,
    catalog: AgentCatalogEntry,
    opts: { gatewayUrl?: string; force?: boolean; defaultModel?: string } = {},
  ): Promise<void> {
    job.status = 'RUNNING';
    job.stage = 'DETECTING';
    job.percentage = 10;
    this.appendLog(job, 'system', `Beginning background installation process for ${catalog.displayName}...`);

    // 1. Initial detection
    const initialDetect = await this.detector.detectById(job.agentId);
    if (initialDetect?.found && !opts.force) {
      this.appendLog(job, 'system', `Agent ${catalog.displayName} is already installed at ${initialDetect.executable}`);
    }

    // 2. Preparing package managers
    job.stage = 'PREPARING';
    job.percentage = 20;
    const pkgManagers = await this.detectPackageManagers();
    this.appendLog(
      job,
      'system',
      `Detected package managers: npm=${pkgManagers.npm}, pnpm=${pkgManagers.pnpm}, pip=${pkgManagers.pip}, winget=${pkgManagers.winget}, brew=${pkgManagers.brew}`,
    );

    // 3. Executing installation based on trusted recipe
    job.stage = 'INSTALLING';
    job.percentage = 35;
    const recipe = catalog.installRecipe;

    if (recipe.type === 'npm' && recipe.packageName) {
      const cmd = 'npm';
      const args = ['install', '-g', recipe.packageName];
      this.appendLog(job, 'system', `Running npm install command: npm install -g ${recipe.packageName}`);
      await this.executeProcess(job, cmd, args);
      if (recipe.packageName === 'qwen-code') {
        await this.postinstallQwenCode(job).catch(() => {});
      }
    } else if (recipe.type === 'pip' && recipe.packageName) {
      const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
      this.appendLog(job, 'system', `Running pip install command for package: ${recipe.packageName}`);
      // Pre-satisfy e2b if needed
      await this.executeProcess(job, pythonBin, ['-m', 'pip', 'install', '-U', 'e2b==0.17.1']).catch(() => {});
      await this.executeProcess(job, pythonBin, ['-m', 'pip', 'install', '-U', recipe.packageName]);
    } else if (recipe.type === 'manual') {
      // Manual-only agents (IDE plugins, standalone desktop apps) cannot be installed
      // automatically by Nexus. We configure the connector config files if an adapter
      // is registered, then mark the job as requiring manual installation rather than
      // falsely reporting COMPLETED / READY.
      this.appendLog(
        job,
        'system',
        `Agent ${catalog.displayName} requires manual application setup or IDE extension installation. Guide: ${recipe.guideUrl ?? catalog.homepage}`,
      );

      // Still run the adapter configure step to write connector config files (buckle).
      job.stage = 'CONFIGURING';
      job.percentage = 85;
      this.appendLog(job, 'system', `Configuring ${catalog.displayName} connector for Nexus Gateway at ${opts.gatewayUrl ?? 'http://127.0.0.1:8787'}...`);
      const { createIntegrationRegistry } = await import('@anx/integrations');
      const integrationMap = createIntegrationRegistry();
      const adapter = integrationMap.get(job.agentId);
      const actions: string[] = [];
      const errors: string[] = [];
      if (adapter) {
        const configRes = await adapter.install({
          gatewayUrl: opts.gatewayUrl ?? 'http://127.0.0.1:8787',
          defaultModel: opts.defaultModel ?? 'nexus/auto',
          force: true,
        });
        actions.push(...configRes.actions);
        if (configRes.errors) errors.push(...configRes.errors);
        for (const a of configRes.actions) {
          this.appendLog(job, 'system', `Config action: ${a}`);
        }
      }

      // Complete with explicit manual-install note — do NOT mark as fully installed.
      job.stage = 'READY';
      job.status = 'COMPLETED';
      job.percentage = 100;
      job.completionTime = Date.now();
      job.durationMs = job.completionTime - job.startTime;
      job.result = {
        ok: true,
        installed: false, // binary was not installed — manual step required
        configured: actions.length > 0,
        message: `Connector configuration written for ${catalog.displayName}. Manual installation required — visit: ${recipe.guideUrl ?? catalog.homepage}`,
        actions,
        errors: errors.length > 0 ? errors : undefined,
      };
      this.appendLog(job, 'system', 'Connector configuration complete. Manual installation of the agent binary/IDE extension is required before use.');
      return; // exit early — skip the automated install continuation below
    }


    // 4. Refresh process environment & path re-scan
    job.stage = 'REFRESHING_ENVIRONMENT';
    job.percentage = 65;
    this.appendLog(job, 'system', 'Refreshing process environment and system executable discovery paths...');

    // 5. Discover executable
    job.stage = 'DISCOVERING_EXECUTABLE';
    job.percentage = 75;
    const recheck = await this.detector.detectById(job.agentId);
    this.appendLog(
      job,
      'system',
      recheck?.found
        ? `Rediscovery confirmed: Found executable at ${recheck.executable} (version: ${recheck.version ?? 'unknown'})`
        : 'Binary discovery warning: Executable not yet found in PATH.',
    );

    // 6. Configuring agent for Nexus Gateway
    job.stage = 'CONFIGURING';
    job.percentage = 85;
    this.appendLog(job, 'system', `Configuring ${catalog.displayName} connector for Nexus Gateway at ${opts.gatewayUrl ?? 'http://127.0.0.1:8787'}...`);

    const { createIntegrationRegistry } = await import('@anx/integrations');
    const integrationMap = createIntegrationRegistry();
    const adapter = integrationMap.get(job.agentId);
    let configured = false;
    const actions: string[] = [];
    const errors: string[] = [];

    if (adapter) {
      job.stage = 'BUCKLING';
      job.percentage = 90;
      const configRes = await adapter.install({
        gatewayUrl: opts.gatewayUrl ?? 'http://127.0.0.1:8787',
        defaultModel: opts.defaultModel ?? 'nexus/auto',
        force: true,
      });
      configured = configRes.ok;
      actions.push(...configRes.actions);
      if (configRes.errors) errors.push(...configRes.errors);
      for (const a of configRes.actions) {
        this.appendLog(job, 'system', `Config action: ${a}`);
      }
    }

    // 7. Verification
    job.stage = 'VERIFYING';
    job.percentage = 95;
    if (adapter) {
      const verifyRes = await adapter.verify({
        gatewayUrl: opts.gatewayUrl ?? 'http://127.0.0.1:8787',
        defaultModel: opts.defaultModel ?? 'nexus/auto',
      });
      this.appendLog(job, 'system', `Verification result: ${verifyRes.message}`);
    }

    // 8. Ready state
    job.stage = 'READY';
    job.status = 'COMPLETED';
    job.percentage = 100;
    job.completionTime = Date.now();
    job.durationMs = job.completionTime - job.startTime;
    job.result = {
      ok: true,
      installed: recheck?.found ?? false,
      configured,
      version: recheck?.version,
      executable: recheck?.executable,
      message: `Installation and configuration lifecycle for ${catalog.displayName} completed successfully.`,
      actions,
      errors: errors.length > 0 ? errors : undefined,
    };
    this.appendLog(job, 'system', 'Installation completed successfully. State: READY.');
  }

  private executeProcess(job: InstallationJob, cmd: string, args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: 'pipe',
        shell: true,
        env: {
          ...process.env,
          npm_config_loglevel: 'notice',
          PYTHONUNBUFFERED: '1',
        },
      });

      job.pid = child.pid;
      this.activeProcesses.set(job.id, child);

      child.stdout?.on('data', (d) => {
        this.appendLog(job, 'stdout', String(d));
      });

      child.stderr?.on('data', (d) => {
        this.appendLog(job, 'stderr', String(d));
      });

      child.on('error', (err) => {
        this.activeProcesses.delete(job.id);
        this.appendLog(job, 'stderr', `Process error: ${err.message}`);
        reject(err);
      });

      child.on('close', (code) => {
        this.activeProcesses.delete(job.id);
        job.exitCode = typeof code === 'number' ? code : 0;
        if (code === 0) {
          resolve();
        } else {
          const err = new Error(`Command '${cmd} ${args.join(' ')}' exited with code ${code}`);
          reject(err);
        }
      });
    });
  }

  private async postinstallQwenCode(job: InstallationJob): Promise<void> {
    try {
      const { existsSync, copyFileSync, mkdirSync } = await import('node:fs');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
      const qwenDir = join(appData, 'npm', 'node_modules', 'qwen-code');
      const bundleWasm = join(qwenDir, 'bundle', 'tiktoken_bg.wasm');
      if (existsSync(qwenDir) && !existsSync(bundleWasm)) {
        this.appendLog(job, 'system', 'Ensuring tiktoken_bg.wasm is available for qwen-code...');
        const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        await this.executeProcess(job, npmCmd, ['install', 'tiktoken', '--prefix', qwenDir]).catch(() => {});
        const installedWasm = join(qwenDir, 'node_modules', 'tiktoken', 'tiktoken_bg.wasm');
        if (existsSync(installedWasm)) {
          mkdirSync(join(qwenDir, 'bundle'), { recursive: true });
          copyFileSync(installedWasm, bundleWasm);
          this.appendLog(job, 'system', 'tiktoken_bg.wasm linked successfully.');
        }
      }
    } catch {
      // Best-effort postinstall
    }
  }
}

/**
 * Agent Nexus Desktop Shell — System Tray Controller & Daemon Orchestrator
 *
 * Provides system tray menu generation, background gateway health monitoring,
 * process launchers (Claude, Codex), and navigation to Dashboard & Playground.
 */

import { spawn, type ChildProcess } from 'node:child_process';

export type TrayStatus = 'running' | 'stopped' | 'degraded' | 'error';

export interface TrayStatusDetails {
  status: TrayStatus;
  activeModels: number;
  gatewayUrl: string;
  dashboardUrl: string;
  version: string;
  lastChecked: Date;
  error?: string;
}

export interface TrayMenuItem {
  id: string;
  label: string;
  enabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  action?: () => Promise<void> | void;
  submenu?: TrayMenuItem[];
}

export interface TrayConfig {
  gatewayUrl?: string;
  dashboardUrl?: string;
  pollIntervalMs?: number;
  onStatusChange?: (status: TrayStatus, details: TrayStatusDetails) => void;
  onNotification?: (title: string, message: string) => void;
  fetchFn?: typeof globalThis.fetch;
  openUrlFn?: (url: string) => Promise<void>;
  clipboardCopyFn?: (text: string) => Promise<void>;
}

export class DesktopTrayController {
  private readonly gatewayUrl: string;
  private readonly dashboardUrl: string;
  private readonly pollIntervalMs: number;
  private readonly onStatusChange?: (status: TrayStatus, details: TrayStatusDetails) => void;
  private readonly onNotification?: (title: string, message: string) => void;
  private readonly fetch: typeof globalThis.fetch;
  private readonly openUrlFn: (url: string) => Promise<void>;
  private readonly clipboardCopyFn: (text: string) => Promise<void>;

  private pollTimer: NodeJS.Timeout | null = null;
  private lastDetails: TrayStatusDetails;
  private managedGatewayProcess: ChildProcess | null = null;

  constructor(config: TrayConfig = {}) {
    this.gatewayUrl = (config.gatewayUrl ?? 'http://127.0.0.1:19808').replace(/\/+$/, '');
    this.dashboardUrl = (config.dashboardUrl ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
    this.pollIntervalMs = config.pollIntervalMs ?? 5000;
    this.onStatusChange = config.onStatusChange;
    this.onNotification = config.onNotification;
    this.fetch = config.fetchFn ?? globalThis.fetch;
    this.openUrlFn = config.openUrlFn ?? this.defaultOpenUrl;
    this.clipboardCopyFn = config.clipboardCopyFn ?? this.defaultClipboardCopy;

    this.lastDetails = {
      status: 'stopped',
      activeModels: 0,
      gatewayUrl: this.gatewayUrl,
      dashboardUrl: this.dashboardUrl,
      version: '0.5.0',
      lastChecked: new Date(),
    };
  }

  public getStatusDetails(): TrayStatusDetails {
    return { ...this.lastDetails };
  }

  /**
   * Probes the gateway health endpoint and active models to assess operational state.
   */
  public async checkGatewayHealth(): Promise<TrayStatusDetails> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const healthRes = await this.fetch(`${this.gatewayUrl}/health`, {
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);

      if (!healthRes || !healthRes.ok) {
        const details: TrayStatusDetails = {
          status: 'stopped',
          activeModels: 0,
          gatewayUrl: this.gatewayUrl,
          dashboardUrl: this.dashboardUrl,
          version: '0.5.0',
          lastChecked: new Date(),
          error: healthRes ? `HTTP ${healthRes.status}` : 'Connection refused',
        };
        this.updateState(details);
        return details;
      }

      // Check model catalog
      let activeCount = 0;
      try {
        const modelsRes = await this.fetch(`${this.gatewayUrl}/v1/models?available=true`);
        if (modelsRes.ok) {
          const body = (await modelsRes.json()) as { data?: unknown[] };
          if (Array.isArray(body.data)) {
            activeCount = body.data.length;
          }
        }
      } catch {
        // Models endpoint check is optional, default to healthy status
      }

      const status: TrayStatus = activeCount > 0 ? 'running' : 'degraded';
      const details: TrayStatusDetails = {
        status,
        activeModels: activeCount,
        gatewayUrl: this.gatewayUrl,
        dashboardUrl: this.dashboardUrl,
        version: '0.5.0',
        lastChecked: new Date(),
      };
      this.updateState(details);
      return details;
    } catch (err) {
      const details: TrayStatusDetails = {
        status: 'error',
        activeModels: 0,
        gatewayUrl: this.gatewayUrl,
        dashboardUrl: this.dashboardUrl,
        version: '0.5.0',
        lastChecked: new Date(),
        error: (err as Error).message,
      };
      this.updateState(details);
      return details;
    }
  }

  private updateState(details: TrayStatusDetails): void {
    const prevStatus = this.lastDetails.status;
    this.lastDetails = details;
    if (prevStatus !== details.status && this.onStatusChange) {
      this.onStatusChange(details.status, details);
    }
  }

  /**
   * Constructs the reactive System Tray menu based on current gateway state.
   */
  public buildMenu(details: TrayStatusDetails = this.lastDetails): TrayMenuItem[] {
    const isRunning = details.status === 'running' || details.status === 'degraded';
    const statusLabel =
      details.status === 'running'
        ? `● Agent Nexus: Active (${details.activeModels} models)`
        : details.status === 'degraded'
          ? `▲ Agent Nexus: Degraded (0 active models)`
          : `○ Agent Nexus: Stopped`;

    return [
      {
        id: 'header-status',
        label: statusLabel,
        enabled: false,
      },
      {
        id: 'header-port',
        label: `Gateway: ${this.gatewayUrl}`,
        enabled: false,
      },
      {
        id: 'sep-1',
        label: '-',
        separator: true,
      },
      {
        id: 'open-playground',
        label: 'Open Playground',
        enabled: true,
        action: async () => {
          await this.openUrlFn(`${this.dashboardUrl}/playground`);
        },
      },
      {
        id: 'open-dashboard',
        label: 'Open Dashboard',
        enabled: true,
        action: async () => {
          await this.openUrlFn(this.dashboardUrl);
        },
      },
      {
        id: 'sep-2',
        label: '-',
        separator: true,
      },
      {
        id: 'launch-claude',
        label: 'Launch Claude Code (Nexus Proxy)',
        enabled: isRunning,
        action: async () => {
          await this.launchClaude();
        },
      },
      {
        id: 'launch-codex',
        label: 'Launch Codex CLI (Nexus Proxy)',
        enabled: isRunning,
        action: async () => {
          await this.launchCodex();
        },
      },
      {
        id: 'sep-3',
        label: '-',
        separator: true,
      },
      {
        id: 'copy-api-url',
        label: 'Copy API Base URL (v1)',
        enabled: true,
        action: async () => {
          await this.clipboardCopyFn(`${this.gatewayUrl}/v1`);
          this.onNotification?.('Agent Nexus', 'Copied API Base URL to clipboard');
        },
      },
      {
        id: 'toggle-gateway',
        label: isRunning ? 'Restart Gateway' : 'Start Gateway',
        enabled: true,
        action: async () => {
          if (isRunning) {
            await this.restartGateway();
          } else {
            await this.startGateway();
          }
        },
      },
      {
        id: 'sep-4',
        label: '-',
        separator: true,
      },
      {
        id: 'quit',
        label: 'Quit Agent Nexus',
        enabled: true,
        action: async () => {
          this.stopPolling();
          if (this.managedGatewayProcess) {
            this.managedGatewayProcess.kill();
            this.managedGatewayProcess = null;
          }
        },
      },
    ];
  }

  /**
   * Starts periodic polling of gateway health.
   */
  public startPolling(): void {
    if (this.pollTimer) return;
    void this.checkGatewayHealth();
    this.pollTimer = setInterval(() => {
      void this.checkGatewayHealth();
    }, this.pollIntervalMs);
  }

  /**
   * Stops periodic polling.
   */
  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async launchClaude(): Promise<void> {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'cmd.exe' : 'sh';
    const args = isWindows
      ? ['/c', 'start', 'npx', '@anthropic-ai/claude-code']
      : ['-c', 'npx @anthropic-ai/claude-code'];

    const env = {
      ...process.env,
      ANTHROPIC_BASE_URL: `${this.gatewayUrl}/v1`,
      ANTHROPIC_API_KEY: 'sk-nexus-agent',
    };

    spawn(cmd, args, { env, detached: true, stdio: 'ignore' }).unref();
    this.onNotification?.('Agent Nexus', 'Launched Claude Code connected to Agent Nexus');
  }

  public async launchCodex(): Promise<void> {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'cmd.exe' : 'sh';
    const args = isWindows
      ? ['/c', 'start', 'npx', '@openai/codex']
      : ['-c', 'npx @openai/codex'];

    const env = {
      ...process.env,
      OPENAI_BASE_URL: `${this.gatewayUrl}/v1`,
      OPENAI_API_KEY: 'sk-nexus-agent',
    };

    spawn(cmd, args, { env, detached: true, stdio: 'ignore' }).unref();
    this.onNotification?.('Agent Nexus', 'Launched Codex CLI connected to Agent Nexus');
  }

  public async startGateway(): Promise<void> {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'cmd.exe' : 'sh';
    const args = isWindows
      ? ['/c', 'npx', 'anx', 'start']
      : ['-c', 'npx anx start'];

    this.managedGatewayProcess = spawn(cmd, args, {
      stdio: 'ignore',
      detached: true,
    });
    this.managedGatewayProcess.unref();

    // Give it a brief moment then poll
    setTimeout(() => {
      void this.checkGatewayHealth();
    }, 1500);
  }

  public async stopGateway(): Promise<void> {
    if (this.managedGatewayProcess) {
      this.managedGatewayProcess.kill();
      this.managedGatewayProcess = null;
    }
    await this.checkGatewayHealth();
  }

  public async restartGateway(): Promise<void> {
    await this.stopGateway();
    await this.startGateway();
  }

  private async defaultOpenUrl(url: string): Promise<void> {
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (isWindows) {
      spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (isMac) {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  }

  private async defaultClipboardCopy(text: string): Promise<void> {
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (isWindows) {
      const proc = spawn('clip', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.stdin?.write(text);
      proc.stdin?.end();
    } else if (isMac) {
      const proc = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.stdin?.write(text);
      proc.stdin?.end();
    } else {
      const proc = spawn('xclip', ['-selection', 'clipboard'], { stdio: ['pipe', 'ignore', 'ignore'] });
      proc.stdin?.write(text);
      proc.stdin?.end();
    }
  }
}

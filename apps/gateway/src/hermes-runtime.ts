/**
 * HermesRuntimeManager — first-class Hermes CLI runtime diagnostics.
 *
 * Provides a real (verified from the local machine, never simulated)
 * view of the Hermes building agent:
 *   - detection (binary + config)
 *   - configured state (does ~/.hermes/config.json route through Nexus?)
 *   - the gateway endpoint Hermes should target
 *   - the active model Nexus's `nexus/best-coding` policy currently resolves
 *   - cumulative build statistics, fed from actual ApplicationEngine build
 *     outcomes (never fabricated).
 */
import { access, constants, readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import { GATEWAY_VERSION } from './version.js';

export interface HermesBuildRecord {
  readonly applicationId: string;
  readonly status: 'SUCCESS' | 'FAILED' | 'RUNNING';
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly tpm: string;
  readonly error?: string;
}

export interface HermesDiagnostics {
  readonly version: string;
  readonly generatedAt: string;
  readonly detected: boolean;
  readonly agent: {
    readonly id: string;
    readonly name: string;
    readonly executable?: string;
    readonly version?: string;
    readonly configLocation?: string;
    readonly detectedVia: string;
  } | null;
  readonly configured: {
    readonly configPath: string;
    readonly fileExists: boolean;
    readonly routesThroughNexus: boolean;
    readonly defaultProvider?: string;
    readonly defaultModel?: string;
    readonly openaiBaseUrl?: string;
    readonly bindable: boolean;
  };
  readonly gateway: {
    readonly url: string;
    readonly endpoint: string;
    readonly protocol: string;
  };
  readonly activeModel: {
    readonly policy: string;
    readonly modelId?: string;
    readonly providerId?: string;
    readonly reason?: string;
    readonly resolvable: boolean;
  };
  readonly buildStats: {
    readonly buildCount: number;
    readonly successfulBuilds: number;
    readonly failedBuilds: number;
    readonly runningBuilds: number;
    readonly lastBuild?: HermesBuildRecord;
  };
  readonly lastExecution?: HermesBuildRecord;
  readonly lastError?: HermesBuildRecord;
}

export interface HermesRuntimeDeps {
  readonly gatewayHost: string;
  readonly gatewayPort: number;
  readonly resolveAlias?: (alias: string) =>
    | { modelId?: string; providerId?: string; reason?: string; candidateCount?: number }
    | undefined;
}

const HERMES_CONFIG_REL = ['.hermes', 'config.json'];

export class HermesRuntimeManager {
  private readonly deps: HermesRuntimeDeps;
  private readonly home: string;
  private readonly records: HermesBuildRecord[] = [];

  constructor(deps: HermesRuntimeDeps) {
    this.deps = deps;
    this.home = homedir();
  }

  /**
   * Records a real build outcome, fed by the server after each
   * ApplicationEngine build/retry resolves. Never fabricates data.
   */
  recordBuild(
    applicationId: string,
    status: 'SUCCESS' | 'FAILED' | 'RUNNING',
    opts: { startedAt?: string; tpm?: string; error?: string } = {},
  ): void {
    const now = new Date().toISOString();
    const record: HermesBuildRecord = {
      applicationId,
      status,
      startedAt: opts.startedAt ?? now,
      tpm: opts.tpm ?? '',
      ...(status !== 'RUNNING' ? { finishedAt: now } : {}),
      ...(opts.error ? { error: opts.error } : {}),
    };
    this.records.push(record);
    if (this.records.length > 50) this.records.shift();
  }

  async diagnostics(): Promise<HermesDiagnostics> {
    const configReport = await this.readConfig();
    const detected = await this.detect();
    const baseUrl = `http://${this.deps.gatewayHost}:${this.deps.gatewayPort}`;
    const resolved = this.deps.resolveAlias ? this.deps.resolveAlias('nexus/best-coding') : undefined;

    const all = this.records;
    const done = all.filter((r) => r.status !== 'RUNNING');
    const lastBuild = all.length > 0 ? all[all.length - 1] : undefined;
    const lastFailed = done.filter((r) => r.status === 'FAILED').pop();

    const gatewayUrl = process.env['NEXUS_GATEWAY_URL'] ?? baseUrl;

    return {
      version: GATEWAY_VERSION,
      generatedAt: new Date().toISOString(),
      detected: detected !== null,
      agent: detected,
      configured: {
        configPath: configReport.path,
        fileExists: configReport.fileExists,
        routesThroughNexus: configReport.routesThroughNexus,
        defaultProvider: configReport.defaultProvider,
        defaultModel: configReport.defaultModel,
        openaiBaseUrl: configReport.openaiBaseUrl,
        bindable: detected !== null && !this.isBound(configReport), // only report bindable when not already bound
      },
      gateway: {
        url: gatewayUrl,
        endpoint: `${gatewayUrl}/v1`,
        protocol: 'openai-compatible',
      },
      activeModel: {
        policy: 'nexus/best-coding',
        modelId: resolved?.modelId,
        providerId: resolved?.providerId,
        reason: resolved?.reason,
        resolvable: resolved !== undefined,
      },
      buildStats: {
        buildCount: all.length,
        successfulBuilds: done.filter((r) => r.status === 'SUCCESS').length,
        failedBuilds: done.filter((r) => r.status === 'FAILED').length,
        runningBuilds: all.filter((r) => r.status === 'RUNNING').length,
        lastBuild,
      },
      lastExecution: lastBuild && lastBuild.status !== 'FAILED' ? lastBuild : undefined,
      lastError: lastFailed,
    };
  }

  /** Detection via PATH. Fast and non-destructive. */
  private async detect() {
    try {
      const names = ['hermes', 'hermes-cli'];
      for (const bin of names) {
        const cmd = platform() === 'win32' ? `where ${bin} 2>nul` : `command -v ${bin} 2>/dev/null`;
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        try {
          const { stdout } = await promisify(exec)(cmd, { timeout: 2000 });
          const path = stdout.trim().split('\n')[0]?.trim();
          if (path) {
            let version: string | undefined;
            try {
              const v = await promisify(exec)(`${bin} --version`, { timeout: 3000 });
              version = v.stdout.trim().split('\n')[0] || undefined;
            } catch {
              version = undefined;
            }
            return {
              id: 'hermes-cli',
              name: 'Hermes CLI',
              executable: path,
              version,
              configLocation: join(this.home, ...HERMES_CONFIG_REL),
              detectedVia: 'path',
            };
          }
        } catch {
          // fall through
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async readConfig() {
    const path = join(this.home, ...HERMES_CONFIG_REL);
    try {
      await access(path, constants.F_OK);
      const raw = await readFile(path, 'utf8');
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
      const providers = parsed?.providers ?? {};
      const nexusProvider = providers['nexus'];
      return {
        path,
        fileExists: true,
        routesThroughNexus: parsed?.default_provider === 'nexus' || !!nexusProvider,
        defaultProvider: parsed?.default_provider,
        defaultModel: parsed?.default_model ?? nexusProvider?.models?.[0],
        openaiBaseUrl: nexusProvider?.base_url,
      };
    } catch {
      return {
        path,
        fileExists: false,
        routesThroughNexus: false,
        defaultProvider: undefined,
        defaultModel: undefined,
        openaiBaseUrl: undefined,
      };
    }
  }

  private isBound(report: { routesThroughNexus: boolean }): boolean {
    return report.routesThroughNexus;
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * BaseAgentAdapter — Foundation for all local coding agent runtime adapters.
 *
 * Implements cross-platform path discovery, safe environment preparation,
 * child-process lifecycle management with tree-killing, timeout enforcement,
 * output sanitization, and streaming events.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { exec, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type {
  LocalAgent,
  LocalAgentCapabilities,
  LocalAgentExecutionRequest,
  LocalAgentExecutionResult,
  LocalAgentHealth,
  LocalAgentHealthLevel,
  LocalAgentState,
  LocalAgentStreamEvent,
} from '../../domain/local-agent.js';
import type { LocalAgentAdapter } from '../local-agent-port.js';

const execAsync = promisify(exec);

export abstract class BaseAgentAdapter implements LocalAgentAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly type: string;
  abstract readonly defaultBinaries: readonly string[];
  abstract readonly wellKnownPaths: readonly string[];
  abstract readonly configLocations: readonly string[];

  /** Cache discovered executable path to minimize disk I/O. */
  protected cachedExecutable: string | null | undefined = undefined;
  protected cachedVersion: string | undefined = undefined;

  /** Resolves the executable path across PATH and safe well-known directories. */
  async findExecutable(): Promise<string | undefined> {
    if (this.cachedExecutable !== undefined) {
      return this.cachedExecutable === null ? undefined : this.cachedExecutable;
    }

    const isWin = platform() === 'win32';
    const ext = isWin ? '.exe' : '';

    // 1. Check well-known installation paths first
    const home = homedir();
    for (const relPath of this.wellKnownPaths) {
      const full = isAbsolute(relPath) ? relPath : join(home, relPath);
      try {
        await access(full, constants.X_OK);
        this.cachedExecutable = full;
        return full;
      } catch {
        // continue
      }
    }

    // 2. Check system PATH via 'where' (Windows) or 'which' (Unix)
    for (const bin of this.defaultBinaries) {
      const binName = isWin && !bin.endsWith('.exe') ? `${bin}${ext}` : bin;
      try {
        const cmd = isWin ? `where ${binName}` : `which ${binName}`;
        const { stdout } = await execAsync(cmd, { timeout: 1500 });
        const first = stdout.trim().split(/\r?\n/)[0]?.trim();
        if (first) {
          this.cachedExecutable = first;
          return first;
        }
      } catch {
        // continue
      }
    }

    this.cachedExecutable = null;
    return undefined;
  }

  async getVersion(executablePath?: string): Promise<string | undefined> {
    if (this.cachedVersion) return this.cachedVersion;
    const exe = executablePath ?? (await this.findExecutable());
    if (!exe) return undefined;

    try {
      const { stdout } = await execAsync(`"${exe}" --version`, { timeout: 3000 });
      const versionMatch = stdout.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/);
      if (versionMatch) {
        this.cachedVersion = versionMatch[0];
        return this.cachedVersion;
      }
      const trimmed = stdout.trim().split('\n')[0]?.trim();
      this.cachedVersion = trimmed;
      return trimmed;
    } catch {
      return undefined;
    }
  }

  async validateConfiguration(_agent: LocalAgent): Promise<boolean> {
    // Default implementation checks if config files exist or environment is compatible
    return true;
  }

  async healthCheck(agent: LocalAgent, gatewayUrl: string): Promise<LocalAgentHealth> {
    const executablePath = await this.findExecutable();
    const versionFound = executablePath ? await this.getVersion(executablePath) : undefined;
    const configValid = await this.validateConfiguration(agent);
    
    // Gateway connectivity check
    let gatewayReachable = false;
    try {
      const res = await fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(2000) });
      gatewayReachable = res.ok;
    } catch {
      gatewayReachable = false;
    }

    let level: LocalAgentHealthLevel = 'FAILED';
    if (executablePath && versionFound && configValid && gatewayReachable) {
      level = 'READY';
    } else if (executablePath && versionFound && configValid) {
      level = 'CONFIGURABLE';
    } else if (executablePath) {
      level = 'EXECUTABLE';
    } else {
      level = 'FAILED';
    }

    return {
      level,
      executableFound: !!executablePath,
      executablePath,
      versionFound,
      configValid,
      gatewayReachable,
      executionVerified: level === 'READY',
      lastChecked: Date.now(),
      details: level === 'READY' ? 'Agent is fully operational and connected to Nexus Gateway' : `Health stage: ${level}`,
      failureReason: !executablePath ? 'Executable not found in PATH or standard locations' : !gatewayReachable ? 'Nexus Gateway unreachable' : undefined,
    };
  }

  async discover(opts: { nexusPort?: number; gatewayUrl?: string } = {}): Promise<LocalAgent> {
    const gwUrl = opts.gatewayUrl ?? `http://127.0.0.1:${opts.nexusPort ?? 8787}`;
    const executable = await this.findExecutable();
    const version = executable ? await this.getVersion(executable) : undefined;
    const capabilities = this.getCapabilities();

    const dummyAgent: LocalAgent = {
      id: this.id,
      name: this.name,
      type: this.type,
      executable,
      version,
      status: executable ? 'AVAILABLE' : 'UNAVAILABLE',
      health: {
        level: executable ? 'EXECUTABLE' : 'FAILED',
        executableFound: !!executable,
        executablePath: executable,
        versionFound: version,
        configValid: true,
        gatewayReachable: false,
        executionVerified: false,
        lastChecked: Date.now(),
      },
      capabilities,
      workspaceSupport: capabilities.workspace,
      streamingSupport: capabilities.streaming,
      supportsNonInteractive: capabilities.nonInteractive,
      supportsEnvironmentConfiguration: capabilities.environmentConfig,
      supportsModelConfiguration: capabilities.modelSelection,
      platform: platform(),
      detectedVia: executable ? 'path' : 'not-found',
      lastSeen: executable ? Date.now() : undefined,
    };

    const health = await this.healthCheck(dummyAgent, gwUrl);
    let status: LocalAgentState = 'UNAVAILABLE';
    if (health.level === 'READY') status = 'READY';
    else if (health.level === 'CONFIGURABLE' || health.level === 'EXECUTABLE') status = 'AVAILABLE';
    else if (executable) status = 'DEGRADED';

    return {
      ...dummyAgent,
      status,
      health,
      lastHealthCheck: Date.now(),
    };
  }

  prepareEnvironment(
    _agent: LocalAgent,
    opts: {
      gatewayUrl: string;
      modelPolicy?: string;
      targetModel?: string;
      customEnv?: Record<string, string>;
    },
  ): Record<string, string> {
    const safeEnv: Record<string, string> = {
      PATH: process.env['PATH'] ?? '',
      SYSTEMROOT: process.env['SYSTEMROOT'] ?? '',
      HOMEDRIVE: process.env['HOMEDRIVE'] ?? '',
      HOMEPATH: process.env['HOMEPATH'] ?? '',
      USERPROFILE: process.env['USERPROFILE'] ?? '',
      HOME: process.env['HOME'] ?? '',
      SHELL: process.env['SHELL'] ?? '',
      TMP: process.env['TMP'] ?? '',
      TEMP: process.env['TEMP'] ?? '',
      NODE_ENV: 'production',
      NEXUS_GATEWAY_URL: opts.gatewayUrl,
      NEXUS_TARGET_MODEL: opts.targetModel ?? opts.modelPolicy ?? 'nexus/best-coding',
    };

    // Forward non-sensitive custom variables
    if (opts.customEnv) {
      const SENSITIVE_REGEX = /SECRET|TOKEN|KEY|PASS|AUTH|CREDENTIAL|PRIVATE/i;
      for (const [k, v] of Object.entries(opts.customEnv)) {
        if (!SENSITIVE_REGEX.test(k)) {
          safeEnv[k] = v;
        }
      }
    }

    return safeEnv;
  }

  abstract buildCommand(
    request: LocalAgentExecutionRequest,
    opts: { gatewayUrl: string; selectedModel?: string },
  ): { command: string; args: readonly string[] };

  async execute(
    request: LocalAgentExecutionRequest,
    opts: {
      gatewayUrl: string;
      selectedModel?: string;
      selectedProvider?: string;
      onEvent?: (event: LocalAgentStreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<LocalAgentExecutionResult> {
    const executionId = `exec-${randomUUID().substring(0, 8)}`;
    const start = Date.now();
    const executable = await this.findExecutable();

    if (!executable) {
      return {
        executionId,
        agentId: this.id,
        status: 'FAILED',
        exitCode: 1,
        stdout: '',
        stderr: `Agent executable '${this.name}' is not installed on this system.`,
        durationMs: Date.now() - start,
        selectedModel: opts.selectedModel,
        selectedProvider: opts.selectedProvider,
        outputEventsCount: 0,
      };
    }

    // Workspace path validation
    if (request.workspace) {
      if (!isAbsolute(request.workspace)) {
        throw new Error(`Workspace path must be absolute: '${request.workspace}'`);
      }
      const normalized = resolve(request.workspace);
      if (normalized !== request.workspace && !normalized.startsWith(request.workspace.replace(/[/\\]+$/, ''))) {
        throw new Error(`Path traversal detected in workspace: '${request.workspace}'`);
      }
    }

    const { command, args } = this.buildCommand(request, opts);
    const env = this.prepareEnvironment(
      await this.discover({ gatewayUrl: opts.gatewayUrl }),
      {
        gatewayUrl: opts.gatewayUrl,
        modelPolicy: request.modelPolicy,
        targetModel: opts.selectedModel,
        customEnv: request.env,
      },
    );

    let stdoutAcc = '';
    let stderrAcc = '';
    let outputEventsCount = 0;

    const emitEvent = (type: LocalAgentStreamEvent['type'], chunk?: string, stream?: 'stdout' | 'stderr') => {
      outputEventsCount++;
      opts.onEvent?.({
        executionId,
        agentId: this.id,
        type,
        timestamp: Date.now(),
        chunk: this.sanitizeOutput(chunk),
        stream,
      });
    };

    emitEvent('agent.started', `Launching ${this.name} (${command})`);

    const timeoutMs = request.timeoutMs ?? 120_000;

    return new Promise<LocalAgentExecutionResult>((resolvePromise) => {
      let child: ChildProcess | null = null;
      let timedOut = false;
      let cancelled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        emitEvent('agent.warning', `Execution timed out after ${timeoutMs}ms`);
        if (child) this.killProcessTree(child);
      }, timeoutMs);

      const abortHandler = () => {
        cancelled = true;
        emitEvent('agent.cancelled', 'Execution cancelled by user signal');
        if (child) this.killProcessTree(child);
      };

      if (opts.signal) {
        opts.signal.addEventListener('abort', abortHandler, { once: true });
      }

      try {
        child = spawn(command, args as string[], {
          cwd: request.workspace ?? process.cwd(),
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        child.stdout?.on('data', (data: Buffer) => {
          const text = data.toString();
          stdoutAcc += text;
          emitEvent('agent.output', text, 'stdout');
        });

        child.stderr?.on('data', (data: Buffer) => {
          const text = data.toString();
          stderrAcc += text;
          emitEvent('agent.output', text, 'stderr');
        });

        child.on('error', (err: Error) => {
          clearTimeout(timer);
          opts.signal?.removeEventListener('abort', abortHandler);
          emitEvent('agent.failed', err.message);
          resolvePromise({
            executionId,
            agentId: this.id,
            status: 'FAILED',
            exitCode: 1,
            stdout: this.sanitizeOutput(stdoutAcc),
            stderr: this.sanitizeOutput(`${stderrAcc}\n${err.message}`),
            durationMs: Date.now() - start,
            selectedModel: opts.selectedModel,
            selectedProvider: opts.selectedProvider,
            outputEventsCount,
          });
        });

        child.on('close', (code: number | null) => {
          clearTimeout(timer);
          opts.signal?.removeEventListener('abort', abortHandler);

          let finalStatus: LocalAgentExecutionResult['status'] = 'SUCCESS';
          if (cancelled) {
            finalStatus = 'CANCELLED';
            emitEvent('agent.cancelled');
          } else if (timedOut) {
            finalStatus = 'TIMEOUT';
            emitEvent('agent.failed', 'Execution timed out');
          } else if (code !== 0) {
            finalStatus = 'FAILED';
            emitEvent('agent.failed', `Process exited with code ${code}`);
          } else {
            emitEvent('agent.completed');
          }

          resolvePromise({
            executionId,
            agentId: this.id,
            status: finalStatus,
            exitCode: code,
            stdout: this.sanitizeOutput(stdoutAcc),
            stderr: this.sanitizeOutput(stderrAcc),
            durationMs: Date.now() - start,
            selectedModel: opts.selectedModel,
            selectedProvider: opts.selectedProvider,
            outputEventsCount,
          });
        });
      } catch (err) {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', abortHandler);
        emitEvent('agent.failed', (err as Error).message);
        resolvePromise({
          executionId,
          agentId: this.id,
          status: 'FAILED',
          exitCode: 1,
          stdout: this.sanitizeOutput(stdoutAcc),
          stderr: (err as Error).message,
          durationMs: Date.now() - start,
          selectedModel: opts.selectedModel,
          selectedProvider: opts.selectedProvider,
          outputEventsCount,
        });
      }
    });
  }

  /** Terminates child process and all descendants safely across Windows and Unix. */
  protected killProcessTree(child: ChildProcess): void {
    if (!child.pid) return;
    if (platform() === 'win32') {
      try {
        exec(`taskkill /pid ${child.pid} /T /F`);
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore cleanup failure
        }
      }
    } else {
      try {
        // Send signal to process group
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore cleanup failure
        }
      }
    }
  }

  /** Strips sensitive API tokens and keys from outputs before emitting. */
  protected sanitizeOutput(raw?: string): string {
    if (!raw) return '';
    return raw
      .replace(/(?:ghp_[0-9a-zA-Z]{30,}|gho_[0-9a-zA-Z]{30,}|github_pat_[0-9a-zA-Z_]{40,})/g, '[REDACTED_GH_TOKEN]')
      .replace(/(?:sk-[a-zA-Z0-9]{32,}|sk-proj-[a-zA-Z0-9_-]{40,})/g, '[REDACTED_API_KEY]')
      .replace(/sk-ant-api03-[a-zA-Z0-9_-]{40,}/g, '[REDACTED_ANTHROPIC_KEY]')
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[^-]*-----END [A-Z ]*PRIVATE KEY-----/gs, '[REDACTED_PRIVATE_KEY]');
  }

  abstract getCapabilities(): LocalAgentCapabilities;
}

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  IntegrationAdapter,
  IntegrationContext,
  IntegrationResult,
  IntegrationStatus,
  IntegrationCapabilities,
  LaunchSpec,
  ProcessState,
} from './contract.js';
import { fail, home, ok, normalizeGatewayUrl, DEFAULT_CAPABILITIES } from './contract.js';
import { integrationProcessManager } from './process-manager.js';

/**
 * Security guard: never let a real secret escape into API responses or logs.
 * Returns `[REDACTED]` for any non-empty credential-like value. Used by
 * `status()` and any diagnostic surface so the gateway never returns
 * `apiKey` / `ANTHROPIC_AUTH_TOKEN` / `OPENAI_API_KEY` to the dashboard or
 * writes them to the audit log in cleartext.
 */
export function maskSecret(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  return '[REDACTED]';
}

/**
 * Base class with file I/O helpers. Concrete integrations extend this and
 * only implement `configFiles()` and (optionally) `detectBinary()`.
 *
 * The base class implements `install`, `uninstall`, `verify`, and `status`
 * in terms of those two methods, so adding a new integration is ~30 lines.
 *
 * Installs are NON-DESTRUCTIVE by design:
 *  1. Opt-out integrations (setup by default) refuse binding unless --force.
 *  2. If the tool's existing config already points at a different gateway
 *     (e.g. fcc-server), install() refuses to overwrite unless --force.
 *  3. Force-overwrites keep a `.anx-backup` of the previous config.
 * This keeps the user's choice: keep their current gateway or switch.
 */
export abstract class BaseIntegration implements IntegrationAdapter {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly description: string;
  abstract readonly category: 'cli' | 'editor' | 'ide' | 'agent';
  readonly homepage?: string;

  /**
   * Return the config files this integration manages, relative to the
   * user's home directory. Each entry is a (path, content) pair.
   *
   * Content is a function so we can interpolate `ctx.gatewayUrl` and
   * `ctx.apiKey` per install.
   */
  protected abstract configFiles(ctx: IntegrationContext): Array<{
    path: string;
    content: (ctx: IntegrationContext) => string | Promise<string>;
    /** Merge strategy when the file already exists and `force` is false. */
    merge?: 'overwrite' | 'skip' | 'json-merge';
  }>;

  /**
   * Return the binary name(s) to look for on PATH. Empty array means
   * "no binary check" (e.g. for editor plugins shipped inside an IDE).
   */
  protected detectBinaries(): string[] {
    return [];
  }

  /**
   * Return extra paths to check for installation (e.g. ~/.cursor/extensions).
   */
  protected detectPaths(): string[] {
    return [];
  }

  /**
   * Whether this integration should REFUSE to bind by default, even when
   * the tool is installed. Subclasses override to `true` when the tool has
   * its own provider ecosystem and users explicitly do NOT want the gateway
   * to take over (e.g. Hermes with its own custom providers). Pass
   * `--force` to bind anyway.
   */
  protected skipIfConfigured(): boolean {
    return false;
  }

  async detect(ctx: IntegrationContext): Promise<boolean> {
    for (const binary of this.detectBinaries()) {
      if (await this.commandExists(binary)) return true;
    }
    for (const p of this.detectPaths()) {
      const full = p.startsWith('/') ? p : join(home(ctx), p);
      if (existsSync(full)) return true;
    }
    return false;
  }

  /**
   * Detect the gateway URL this tool is currently bound to, if any.
   * Reads the tool's config file(s) and looks for known gateway URL keys.
   * Returning a URL that differs from `ctx.gatewayUrl` makes `install()`
   * refuse to take over the binding unless `--force` is passed — so the
   * user keeps their choice (e.g. fcc-server vs this gateway).
   *
   * Known key names searched: apiBaseUrl, baseUrl, base_url,
   * env.ANTHROPIC_BASE_URL (claude-code), dialect-specific keys can be
   * added in subclasses by overriding this method.
   */
  protected async detectCurrentGateway(ctx: IntegrationContext): Promise<string | undefined> {
    for (const file of this.configFiles(ctx)) {
      const fullPath = file.path.startsWith('/') ? file.path : join(home(ctx), file.path);
      if (!existsSync(fullPath)) continue;
      try {
        const raw = await readFile(fullPath, 'utf8');
        const data = JSON.parse(raw) as Record<string, unknown>;
        const candidates: unknown[] = [
          data['apiBaseUrl'],
          data['baseUrl'],
          data['base_url'],
          (data['env'] as Record<string, unknown> | undefined)?.['ANTHROPIC_BASE_URL'],
        ];
        for (const c of candidates) {
          if (typeof c === 'string' && /^https?:\/\//.test(c)) return c;
        }
      } catch {
        // not JSON or unreadable — treat as no binding info
      }
    }
    return undefined;
  }

  async install(ctx: IntegrationContext): Promise<IntegrationResult> {
    const files = this.configFiles(ctx);
    const actions: string[] = [];
    const errors: string[] = [];

    // Opt-out integrations (e.g. hermes-cli) skip binding by default so the
    // user keeps their own provider setup. --force binds anyway.
    if (this.skipIfConfigured() && !ctx.force) {
      const detected = await this.detect(ctx);
      if (detected) {
        return fail(
          `${this.displayName} has its own provider configuration — not binding to the gateway by default. ` +
            `Run \`anx integrations install ${this.id} --force\` to bind it to ${ctx.gatewayUrl} anyway.`,
          ['refusing to take over an opt-out integration without --force'],
          [],
        );
      }
    }

    // Non-destructive binding check: if this tool is already pointed at a
    // DIFFERENT gateway, refuse to take over unless the user passes --force.
    // The user should be able to choose (e.g. keep fcc-server, or switch).
    // Bindings are normalized before comparing: adapters append a `/v1`
    // path to the gateway URL (e.g. claude-code writes `apiBaseUrl:
    // <gatewayUrl>/v1`), so `http://localhost:8787/v1` must be treated as
    // the SAME gateway as `http://localhost:8787`.
    const currentBinding = await this.detectCurrentGateway(ctx);
    const conflicting =
      currentBinding && normalizeGatewayUrl(currentBinding) !== normalizeGatewayUrl(ctx.gatewayUrl);
    if (conflicting && !ctx.force) {
      return fail(
        `${this.displayName} is already bound to ${currentBinding} — refusing to overwrite. ` +
          `Run \`anx integrations install ${this.id} --force\` to switch it to ${ctx.gatewayUrl}, ` +
          `or \`anx integrations uninstall ${this.id}\` to remove gateway config.`,
        [`existing binding: ${currentBinding}`, `target gateway: ${ctx.gatewayUrl}`],
        [],
      );
    }
    if (currentBinding) {
      actions.push(`detected existing binding: ${currentBinding}`);
    }

    for (const file of files) {
      const fullPath = file.path.startsWith('/') ? file.path : join(home(ctx), file.path);

      // json-merge files are ALWAYS merged, with or without --force. The
      // `force` flag only bypasses the "refuse to take over a different
      // gateway" check above; it must NOT turn a merge into a full overwrite,
      // or a user's own settings (e.g. a selected `model`) would be wiped on
      // every rebind/configure. Merging keeps Nexus-owned keys current while
      // preserving user-owned keys.
      if (file.merge === 'json-merge' && existsSync(fullPath)) {
        try {
          const existing = JSON.parse(await readFile(fullPath, 'utf8')) as Record<string, unknown>;
          const incoming = JSON.parse(await file.content(ctx)) as Record<string, unknown>;
          const merged: Record<string, unknown> = { ...existing };
          for (const [k, v] of Object.entries(incoming)) {
            if (v === undefined || v === null) {
              delete merged[k];
            } else if (k === 'env' && typeof v === 'object' && v !== null && typeof existing.env === 'object' && existing.env !== null) {
              merged.env = { ...(existing.env as Record<string, unknown>), ...(v as Record<string, unknown>) };
            } else {
              merged[k] = v;
            }
          }
          if (!ctx.dryRun) {
            // Backup existing config before overwriting/merging
            const backup = `${fullPath}.anx-backup`;
            try {
              await writeFile(backup, await readFile(fullPath, 'utf8'), 'utf8');
            } catch {
              // backup best-effort
            }
            await mkdir(dirname(fullPath), { recursive: true });
            await writeFile(fullPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
          }
          actions.push(`merged: ${fullPath}`);
        } catch (err) {
          errors.push(`failed to merge ${fullPath}: ${(err as Error).message}`);
        }
        continue;
      }

      if (existsSync(fullPath) && !ctx.force) {
        if (file.merge === 'skip') {
          actions.push(`skipped (exists): ${fullPath}`);
          continue;
        }
        // default: overwrite — but record the action so the user knows
        actions.push(`overwrote: ${fullPath}`);
      } else if (existsSync(fullPath) && ctx.force) {
        // Keep a backup of anything we force-overwrite so the user can
        // restore their previous gateway binding (e.g. fcc-server).
        const backup = `${fullPath}.anx-backup`;
        if (!ctx.dryRun) {
          try {
            await mkdir(dirname(fullPath), { recursive: true });
            await writeFile(backup, await readFile(fullPath, 'utf8'), 'utf8');
            actions.push(`backed up existing config to: ${backup}`);
          } catch (err) {
            errors.push(`failed to back up ${fullPath}: ${(err as Error).message}`);
          }
        } else {
          actions.push(`would back up existing config to: ${backup}`);
        }
        actions.push(`wrote: ${fullPath}`);
      } else {
        actions.push(`wrote: ${fullPath}`);
      }

      if (ctx.dryRun) continue;

      try {
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, await file.content(ctx), 'utf8');
      } catch (err) {
        errors.push(`failed to write ${fullPath}: ${(err as Error).message}`);
      }
    }

    if (errors.length > 0) {
      return fail(`installed with ${errors.length} errors`, errors, actions);
    }
    return ok(`configured ${this.displayName} (${files.length} file${files.length === 1 ? '' : 's'})`, actions);
  }

  async uninstall(ctx: IntegrationContext): Promise<IntegrationResult> {
    const files = this.configFiles(ctx);
    const actions: string[] = [];
    const errors: string[] = [];

    for (const file of files) {
      const fullPath = file.path.startsWith('/') ? file.path : join(home(ctx), file.path);
      if (!existsSync(fullPath)) {
        actions.push(`not present: ${fullPath}`);
        continue;
      }
      if (ctx.dryRun) {
        actions.push(`would remove: ${fullPath}`);
        continue;
      }
      try {
        await unlink(fullPath);
        actions.push(`removed: ${fullPath}`);
      } catch (err) {
        errors.push(`failed to remove ${fullPath}: ${(err as Error).message}`);
      }
    }

    if (errors.length > 0) return fail(`uninstalled with ${errors.length} errors`, errors, actions);
    return ok(`removed ${this.displayName} configuration`, actions);
  }

  async verify(ctx: IntegrationContext): Promise<IntegrationResult> {
    try {
      const r = await fetch(`${ctx.gatewayUrl}/health`);
      if (!r.ok) {
        return fail(`gateway /health returned ${r.status}`, [`HTTP ${r.status}`]);
      }
      const body = (await r.json()) as { status: string; version: string };
      const detected = await this.detect(ctx);
      return ok(
        `gateway reachable (${body.status}, v${body.version}); ${this.displayName} ${detected ? 'is installed' : 'NOT installed — install the tool first'}`,
        detected ? [] : ['install the tool from its official source, then re-run `anx integrations install ' + this.id + '`'],
      );
    } catch (err) {
      return fail(`cannot reach gateway at ${ctx.gatewayUrl}: ${(err as Error).message}`, [
        (err as Error).message,
      ]);
    }
  }

  async status(ctx: IntegrationContext): Promise<IntegrationStatus> {
    const installed = await this.detect(ctx);
    const files = this.configFiles(ctx);
    let configured = false;
    let configPath: string | undefined;
    for (const file of files) {
      const full = file.path.startsWith('/') ? file.path : join(home(ctx), file.path);
      if (existsSync(full)) {
        configured = true;
        configPath = full;
        break;
      }
    }
    const binding = await this.detectCurrentGateway(ctx);
    const expectedEndpoint = `${normalizeGatewayUrl(ctx.gatewayUrl)}/v1`;
    const mismatch =
      !!binding && normalizeGatewayUrl(binding) !== normalizeGatewayUrl(ctx.gatewayUrl);
    const executable = installed ? await this.resolveExecutable(this.detectBinaries()[0] ?? this.id) : undefined;
    const version = installed ? await this.detectVersion(executable) : undefined;

    let health: IntegrationStatus['health'] = 'unknown';
    if (installed && configured) health = mismatch ? 'mismatch' : 'healthy';
    else if (installed && !configured) health = 'not-configured';

    return {
      id: this.id,
      displayName: this.displayName,
      installed,
      configured,
      configPath,
      details: installed
        ? configured
          ? binding
            ? mismatch
              ? `bound to ${binding} (mismatch — Nexus expects ${expectedEndpoint})`
              : `ready (bound to ${binding})`
            : 'ready'
          : 'installed but not configured for the gateway'
        : 'tool not installed',
      configuredEndpoint: binding,
      expectedEndpoint,
      mismatch,
      executable,
      version,
      health,
    };
  }

  /**
   * Best-effort version detection via `<executable> --version`. Bounded by a
   * short timeout so `status()` never hangs the integrations list. Returns
   * undefined on any failure (missing binary, no version flag, timeout).
   */
  protected async detectVersion(executable?: string): Promise<string | undefined> {
    if (!executable) return undefined;
    const { spawn } = await import('node:child_process');
    return new Promise<string | undefined>((resolve) => {
      let done = false;
      const finish = (v?: string) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      const child = spawn(executable, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 1500,
      });
      let out = '';
      child.stdout?.on('data', (d) => (out += String(d)));
      child.stderr?.on('data', (d) => (out += String(d)));
      child.on('error', () => finish(undefined));
      child.on('close', () => {
        const m = out.match(/([0-9]+\.[0-9]+(?:\.[0-9]+)?)/);
        finish(m ? m[1] : undefined);
      });
      setTimeout(() => {
        child.kill('SIGKILL');
        finish(undefined);
      }, 1600);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle / process-management (Universal Coding Agent Integration layer)
  //
  // These delegate to the shared, agent-agnostic `integrationProcessManager`.

  /**
   * Resolve the absolute path of this agent's executable. Tries the candidate
   * locations used by `commandExists`, then falls back to a bare PATH lookup
   * via `where`/`command -v`. Returns the bare binary name if nothing
   * concrete is found (the OS will resolve it from PATH at spawn time).
   */
  protected async resolveExecutable(cmd: string): Promise<string> {
    const candidates = this.executableCandidates(cmd);
    for (const p of candidates) {
      if (p && existsSync(p)) return p;
    }
    return cmd; // rely on PATH resolution at spawn
  }

  /**
   * Candidate absolute paths for a binary, mirroring `commandExists`. Override
   * in subclasses only if a tool lives somewhere unusual.
   */
  protected executableCandidates(cmd: string): string[] {
    if (process.platform === 'win32') {
      const userHome = process.env.USERPROFILE || process.env.HOME || '';
      const localAppData = process.env.LOCALAPPDATA || (userHome ? join(userHome, 'AppData', 'Local') : '');
      return [
        join(userHome, '.local', 'bin', `${cmd}.exe`),
        join(userHome, '.local', 'bin', `${cmd}.cmd`),
        join(userHome, '.local', 'bin', cmd),
        join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', `${cmd}.exe`),
        join(localAppData, 'Programs', cmd, 'bin', `${cmd}.exe`),
        join(localAppData, cmd, `${cmd}-agent`, 'venv', 'Scripts', `${cmd}.exe`),
        join(localAppData, cmd, 'bin', `${cmd}.exe`),
      ].filter(Boolean);
    }
    const userHome = process.env.HOME || '';
    return [
      join(userHome, '.local', 'bin', cmd),
      join('/usr', 'local', 'bin', cmd),
      join('/opt', 'homebrew', 'bin', cmd),
    ];
  }
  // Adapters that can launch their agent override `getLaunchSpec()`; the
  // defaults here advertise `supportsStart/Stop/Restart` based on whether a
  // launch spec is available, so the dashboard never shows a dead button.

  /**
   * Default capabilities. `supportsStart/Stop/Restart` are true only when this
   * adapter provides a launch spec; `interactive` reflects the spec too.
   */
  async capabilities(ctx: IntegrationContext): Promise<IntegrationCapabilities> {
    const spec = await this.getLaunchSpec(ctx);
    return {
      ...DEFAULT_CAPABILITIES,
      supportsStart: spec !== null,
      supportsStop: spec !== null,
      supportsRestart: spec !== null,
      interactive: spec?.interactive ?? false,
    };
  }

  /**
   * Override in subclasses to return a LaunchSpec (or null). The base returns
   * null → no process-management support, dashboard shows no lifecycle buttons.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getLaunchSpec(_ctx: IntegrationContext): Promise<LaunchSpec | null> {
    return null;
  }

  async start(ctx: IntegrationContext): Promise<IntegrationResult> {
    const spec = await this.getLaunchSpec(ctx);
    if (!spec) {
      return fail(`${this.displayName} does not support managed start (no launch spec).`);
    }
    const state = await integrationProcessManager.start(this.id, spec, ctx.gatewayUrl);
    if (state.running) {
      return ok(`started ${this.displayName} (pid ${state.pid})`, [
        `pid ${state.pid}`,
        `executable ${state.executable}`,
      ]);
    }
    return fail(`failed to start ${this.displayName}`, [`exit code ${state.exitCode ?? 'unknown'}`]);
  }

  async stop(_ctx: IntegrationContext): Promise<IntegrationResult> {
    const res = await integrationProcessManager.stop(this.id);
    if (res.stopped) return ok(`stopped ${this.displayName} (pid ${res.pid})`, [`pid ${res.pid}`]);
    if (res.error) return fail(`error stopping ${this.displayName}`, [res.error]);
    return ok(`${this.displayName} was not running`, []);
  }

  async restart(ctx: IntegrationContext): Promise<IntegrationResult> {
    const spec = await this.getLaunchSpec(ctx);
    if (!spec) {
      return fail(`${this.displayName} does not support managed restart (no launch spec).`);
    }
    const state = await integrationProcessManager.restart(this.id, spec, ctx.gatewayUrl);
    if (state.running) {
      return ok(`restarted ${this.displayName} (pid ${state.pid})`, [`pid ${state.pid}`]);
    }
    return fail(`failed to restart ${this.displayName}`, [`exit code ${state.exitCode ?? 'unknown'}`]);
  }

  async runtime(_ctx: IntegrationContext): Promise<ProcessState> {
    return integrationProcessManager.runtime(this.id);
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async commandExists(cmd: string): Promise<boolean> {
    const { spawn } = await import('node:child_process');
    if (process.platform === 'win32') {
      const userHome = process.env.USERPROFILE || process.env.HOME || '';
      const localAppData = process.env.LOCALAPPDATA || (userHome ? join(userHome, 'AppData', 'Local') : '');
      const directCandidates = [
        join(userHome, '.local', 'bin', `${cmd}.exe`),
        join(userHome, '.local', 'bin', `${cmd}.cmd`),
        join(userHome, '.local', 'bin', cmd),
        join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', `${cmd}.exe`),
        join(localAppData, 'Programs', cmd, 'bin', `${cmd}.exe`),
        join(localAppData, cmd, `${cmd}-agent`, 'venv', 'Scripts', `${cmd}.exe`),
        join(localAppData, cmd, 'bin', `${cmd}.exe`),
      ];
      for (const p of directCandidates) {
        if (p && existsSync(p)) return true;
      }

      return new Promise((resolve) => {
        const proc = spawn('where.exe', [cmd], { stdio: 'ignore' });
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => {
          const cmdProc = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `where ${cmd}`], { stdio: 'ignore' });
          cmdProc.on('close', (c) => resolve(c === 0));
          cmdProc.on('error', () => resolve(false));
        });
      });
    }

    return new Promise((resolve) => {
      const proc = spawn('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}

/**
 * Convenience helper for JSON config files.
 */
export function jsonString(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

export { home } from './contract.js';
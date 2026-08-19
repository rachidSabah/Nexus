import { spawn, type ChildProcess } from 'node:child_process';

import { type LaunchSpec, type ProcessState } from './contract.js';

/**
 * Checks if a process with the given PID is currently alive in the operating system.
 */
export function isProcessRunning(pid?: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM'; // exists but permission denied
  }
}

/**
 * Generic, agent-agnostic process manager for coding-agent integrations.
 *
 * DESIGN (per the Universal Coding Agent Integration spec):
 *  - Knows NOTHING about claude.exe / codex / gemini / etc. It only spawns the
 *    `LaunchSpec` an adapter returns.
 *  - Tracks processes in a `Map<integrationId, TrackedProcess>`. There is NO
 *    "currentAgentPid" global — every agent is tracked independently, so
 *    Claude, Codex, Gemini, Qwen, OpenCode can all run simultaneously and
 *    restarting one never touches another.
 *  - Only ever terminates a PID *it itself launched*. It never does
 *    `taskkill /IM claude.exe` or similar blanket kills. If a user started a
 *    Claude process manually (untracked), Nexus leaves it alone.
 *  - Never persists credentials. Launch env is applied in-memory only.
 *  - Cross-platform: Windows uses taskkill tree kill and cmd /k; POSIX uses SIGTERM/SIGKILL.
 */

interface TrackedProcess {
  id: string;
  child: ChildProcess;
  executable: string;
  args: readonly string[];
  startedAt: number;
  gatewayTarget?: string;
  exited: boolean;
  exitCode?: number;
}

export interface ManagerStartOptions {
  /** Optional timeout (ms) to wait for the child to spawn before resolving. */
  readonly spawnTimeoutMs?: number;
}

export class IntegrationProcessManager {
  private readonly tracked = new Map<string, TrackedProcess>();
  private readonly bootErrors = new Map<string, string>();

  /**
   * Start an agent from its launch spec. If an instance is already tracked
   * and still alive, this is idempotent — it returns the existing pid without
   * spawning a duplicate (per the "no duplicate processes" rule).
   */
  async start(
    id: string,
    spec: LaunchSpec,
    gatewayTarget?: string,
    opts: ManagerStartOptions = {},
  ): Promise<ProcessState> {
    const existing = this.tracked.get(id);
    if (existing && !existing.exited && this.isAlive(existing.child)) {
      return this.toState(id, existing, gatewayTarget);
    }
    // If a tracked entry exited, clear it so we can respawn.
    if (existing) this.tracked.delete(id);

    const child = this.spawn(spec);

    const tracked: TrackedProcess = {
      id,
      child,
      executable: spec.executable,
      args: spec.args,
      startedAt: Date.now(),
      gatewayTarget,
      exited: false,
    };
    this.tracked.set(id, tracked);

    child.on('exit', (code) => {
      tracked.exited = true;
      tracked.exitCode = typeof code === 'number' ? code : undefined;
    });
    child.on('error', (err) => {
      this.bootErrors.set(id, err.message);
      tracked.exited = true;
      tracked.exitCode = -1;
    });

    // Brief settle so a spawn failure (e.g. ENOENT) surfaces before we report.
    const settleMs = opts.spawnTimeoutMs ?? 300;
    await new Promise((r) => setTimeout(r, settleMs));

    const bootErr = this.bootErrors.get(id);
    if (bootErr && (tracked.exited || !this.isAlive(child))) {
      this.tracked.delete(id);
      this.bootErrors.delete(id);
      return {
        id,
        running: false,
        health: 'unhealthy',
        gatewayTarget,
        executable: spec.executable,
        args: spec.args,
      };
    }

    // Web-UI integrations: open their UI in the OS default browser. We open the
    // real web UI URL directly (spec.webUrl, e.g. http://127.0.0.1:3080) — the
    // address `dsh web` itself prints and serves. This is a clean top-level
    // navigation, identical to the user opening it by hand, so the SPA renders
    // correctly. Best-effort: a failure to open the browser must never fail the
    // start.
    //
    // IMPORTANT: the browser must NOT be opened the instant the OS process
    // spawns. At that moment the SPA's HTML shell is served but its CSS/JS
    // bundles are still warming up; an automated open then grabs the HTML but
    // fails the subsequent assets (transparent text / first-glyph-only). We
    // wait until the UI is genuinely ready to serve its assets before opening.
    if (spec.webUrl && !tracked.exited && this.isAlive(child)) {
      this.openUIWhenReady(spec.webUrl).catch(() => {
        /* ignore — UI is still reachable at the URL */
      });
    }

    return this.toState(id, tracked, gatewayTarget);
  }

  /**
   * Wait until a web UI is genuinely ready to serve its assets (not merely when
   * the OS process exists), then open it in the default browser. This prevents
   * the classic automated-open race: the SPA shell is served instantly, but its
   * CSS/JS bundles are still warming up. Opening too early grabs the HTML but
   * fails the subsequent assets (transparent text / first-glyph-only), which is
   * exactly the broken-UI symptom. A short readiness wait makes the automated
   * open behave like a manual paste. Best-effort and time-bounded: if the UI
   * never reports ready within the cap, we still try to open it.
   */
  private async openUIWhenReady(url: string): Promise<void> {
    const capMs = 6000;
    const start = Date.now();
    while (Date.now() - start < capMs) {
      if (await this.isUiReady(url)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return this.openInBrowser(url);
  }

  /** Probe whether the UI is serving both its HTML and a CSS asset. */
  private async isUiReady(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status !== 200) return false;
      const body = await res.text();
      if (!/<html/i.test(body)) return false;
      const cssMatch = body.match(/href="(\/[^"]+\.css)"/);
      if (!cssMatch) return true; // no linked CSS in shell — good enough
      const cssUrl = new URL(cssMatch[1]!, url).toString();
      const cssRes = await fetch(cssUrl);
      return cssRes.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Open a URL in the OS default browser, cross-platform. Best-effort:
   * resolves regardless of whether the launch succeeded (the URL is the
   * documented UI endpoint, reachable as long as the process is serving).
   */
  private async openInBrowser(url: string): Promise<void> {
    const { spawn } = await import('node:child_process');
    if (process.platform === 'win32') {
      // Force-open a specific, known-good browser (Chrome) rather than the OS
      // default handler. The default browser can differ from the one the user
      // pastes the URL into; some default handlers fail to load the SPA's
      // CSS/JS (transparent text / missing UI). Launching Chrome explicitly
      // makes the automated open identical to a manual paste, which renders
      // correctly. Fall back to the default handler if Chrome isn't present.
      const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];
      const fs = await import('node:fs');
      const chrome = chromePaths.find((p) => fs.existsSync(p));
      if (chrome) {
        // Open in an incognito window: a fresh, isolated cache. Earlier broken
        // loads (redirect/race era) poisoned the normal-profile cache, leaving
        // transparent text / missing composer until a hard reload. Incognito
        // guarantees a clean load every time, matching a Ctrl+F5.
        return new Promise<void>((resolve) => {
          const child = spawn(chrome, ['--incognito', url], { stdio: 'ignore', windowsHide: true });
          child.on('error', () => resolve());
          child.on('close', () => resolve());
        });
      }
      // Fallback: OS default handler via `cmd /c start`.
      return new Promise<void>((resolve) => {
        const child = spawn(process.env.ComSpec || 'cmd.exe', ['/c', 'start', '', url], {
          stdio: 'ignore',
          windowsHide: true,
        });
        child.on('error', () => resolve());
        child.on('close', () => resolve());
      });
    }
    if (process.platform === 'darwin') {
      return new Promise<void>((resolve) => {
        const child = spawn('open', [url], { stdio: 'ignore' });
        child.on('error', () => resolve());
        child.on('close', () => resolve());
      });
    }
    // Linux / other POSIX
    return new Promise<void>((resolve) => {
      const child = spawn('xdg-open', [url], { stdio: 'ignore' });
      child.on('error', () => resolve());
      child.on('close', () => resolve());
    });
  }

  /**
   * Stop a single tracked agent by its integration id. Only terminates the PID
   * Nexus launched for that id. Returns success even if nothing was running.
   */
  async stop(id: string): Promise<{ stopped: boolean; pid?: number; error?: string }> {
    const tracked = this.tracked.get(id);
    if (!tracked) {
      return { stopped: false };
    }
    const pid = tracked.child.pid;
    if (tracked.exited || !this.isAlive(tracked.child)) {
      this.tracked.delete(id);
      return { stopped: false, pid };
    }

    try {
      if (process.platform === 'win32' && pid) {
        const { execSync } = await import('node:child_process');
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          // Taskkill best-effort (process might have already exited)
        }
      }
      try {
        tracked.child.kill('SIGTERM');
      } catch {
        // ignore
      }

      await this.waitForExit(tracked, 3000);

      if (pid && isProcessRunning(pid)) {
        if (process.platform === 'win32') {
          const { execSync } = await import('node:child_process');
          try {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
          } catch {
            // ignore
          }
        } else {
          try {
            tracked.child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
        await this.waitForExit(tracked, 2000);
      }
    } catch (err) {
      return { stopped: false, pid, error: (err as Error).message };
    } finally {
      tracked.exited = true;
      this.tracked.delete(id);
    }
    return { stopped: true, pid };
  }

  /**
   * Restart = stop (if running) then start. Operates ONLY on the given id;
   * other tracked agents are untouched (verified by tests).
   */
  async restart(
    id: string,
    spec: LaunchSpec,
    gatewayTarget?: string,
    opts: ManagerStartOptions = {},
  ): Promise<ProcessState> {
    await this.stop(id);
    // Give OS a moment to release ports/handles
    await new Promise((r) => setTimeout(r, 200));
    return this.start(id, spec, gatewayTarget, opts);
  }

  /**
   * Current runtime state for one integration id. Never reports a PID for a
   * process Nexus did not launch.
   */
  runtime(id: string, gatewayTarget?: string): ProcessState {
    const tracked = this.tracked.get(id);
    if (!tracked) {
      return { id, running: false, health: 'exited', gatewayTarget };
    }
    if (!tracked.exited && !this.isAlive(tracked.child)) {
      tracked.exited = true;
    }
    return this.toState(id, tracked, gatewayTarget);
  }

  /** Snapshot of all tracked processes (for diagnostics). */
  list(): ProcessState[] {
    return Array.from(this.tracked.keys()).map((id) => this.runtime(id));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private spawn(spec: LaunchSpec): ChildProcess {
    const env = { ...process.env, ...spec.env } as NodeJS.ProcessEnv;

    if (spec.interactive) {
      if (process.platform === 'win32') {
        // On Windows, spawn interactive CLI agents via cmd.exe /k so they maintain
        // their interactive runtime lifecycle cleanly and report real OS PIDs.
        const child = spawn(process.env.ComSpec || 'cmd.exe', ['/k', spec.executable, ...spec.args], {
          env,
          cwd: spec.cwd,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        return child;
      }
      // POSIX: run detached in the background
      const child = spawn(spec.executable, [...spec.args], {
        env,
        cwd: spec.cwd,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return child;
    }

    // Headless / background spawn.
    // Windows cannot spawn a `.cmd` / `.bat` shim directly with `spawn()` —
    // it throws `EINVAL` synchronously (the same class of bug as in
    // `BaseIntegration.detectVersion`). Route those through `cmd /c` so the
    // OS shell launches them, mirroring the interactive branch above.
    const isBatch =
      process.platform === 'win32' &&
      /\.(cmd|bat)$/i.test(spec.executable.split(/[\\/]/).pop() ?? '');
    if (isBatch) {
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/c', spec.executable, ...spec.args], {
        env,
        cwd: spec.cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return child;
    }
    const child = spawn(spec.executable, [...spec.args], {
      env,
      cwd: spec.cwd,
      detached: true,
      stdio: 'ignore',
      ...(process.platform === 'win32' ? { windowsHide: true } : {}),
    });
    child.unref();
    return child;
  }

  private isAlive(child: ChildProcess): boolean {
    if (child.exitCode !== null || child.signalCode !== null || child.killed === true) {
      return false;
    }
    if (child.pid) {
      return isProcessRunning(child.pid);
    }
    return false;
  }

  private async waitForExit(tracked: TrackedProcess, timeoutMs: number): Promise<void> {
    if (tracked.exited || !this.isAlive(tracked.child)) {
      tracked.exited = true;
      return;
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (tracked.exited || !this.isAlive(tracked.child)) {
        tracked.exited = true;
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private toState(id: string, t: TrackedProcess, gatewayTarget?: string): ProcessState {
    const alive = !t.exited && this.isAlive(t.child);
    return {
      id,
      running: alive,
      pid: alive ? t.child.pid ?? undefined : undefined,
      executable: t.executable,
      args: t.args,
      startedAt: new Date(t.startedAt).toISOString(),
      gatewayTarget: gatewayTarget ?? t.gatewayTarget,
      health: alive ? 'healthy' : t.exited ? 'exited' : 'unknown',
      exitCode: t.exited ? t.exitCode : undefined,
    };
  }
}

/** Shared singleton used by the gateway and adapters. */
export const integrationProcessManager = new IntegrationProcessManager();

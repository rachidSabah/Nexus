import { spawn, type ChildProcess } from 'node:child_process';

import { type LaunchSpec, type ProcessState } from './contract.js';

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
 *  - Cross-platform: Windows uses `cmd /c` (or `cmd /k` for interactive
 *    TTY windows); POSIX uses `sh -c`. Platform-specific executable resolution
 *    is the adapter's job (via LaunchSpec.executable).
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
    if (existing && existing.exited) this.tracked.delete(id);

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
      // Keep the entry (with exit info) for status queries; cleared on next start.
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
    if (bootErr && tracked.exited) {
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

    return this.toState(id, tracked, gatewayTarget);
  }

  /**
   * Stop a single tracked agent by its integration id. Only terminates the PID
   * Nexus launched for that id. Returns success even if nothing was running.
   */
  async stop(id: string): Promise<{ stopped: boolean; pid?: number; error?: string }> {
    const tracked = this.tracked.get(id);
    if (!tracked || tracked.exited) {
      this.tracked.delete(id);
      return { stopped: false };
    }
    const pid = tracked.child.pid;
    try {
      if (!tracked.child.kill('SIGTERM')) {
        // Already gone.
        this.tracked.delete(id);
        return { stopped: false };
      }
      // Give it a moment; escalate to SIGKILL if still alive.
      await this.waitForExit(tracked, 5000);
      if (!tracked.exited) {
        tracked.child.kill('SIGKILL');
        await this.waitForExit(tracked, 3000);
      }
    } catch (err) {
      return { stopped: false, pid, error: (err as Error).message };
    } finally {
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
      // Interactive agents are driven through the gateway (they connect to
      // ANTHROPIC_BASE_URL / the gateway's /v1 endpoint), so they do NOT need a
      // visible terminal. Spawn them hidden — never open a console window.
      // (On Windows a console-subsystem exe would otherwise pop a black `cmd`
      // window that lingers; `windowsHide: true` suppresses it.)
      if (process.platform === 'win32') {
        const child = spawn(spec.executable, [...spec.args], {
          env,
          cwd: spec.cwd,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
        return child;
      }
      // macOS / Linux: run detached in the background (no terminal emulator popup).
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
    const child = spawn(spec.executable, [...spec.args], {
      env,
      cwd: spec.cwd,
      detached: true,
      stdio: 'ignore',
      // Suppress the black console window on Windows for console-subsystem exes.
      ...(process.platform === 'win32' ? { windowsHide: true } : {}),
    });
    // Unref so the gateway process can exit independently of the agent.
    child.unref();
    return child;
  }

  private isAlive(child: ChildProcess): boolean {
    return child.exitCode === null && child.signalCode === null && child.killed === false;
  }

  private async waitForExit(tracked: TrackedProcess, timeoutMs: number): Promise<void> {
    if (tracked.exited) return;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (tracked.exited) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private toState(id: string, t: TrackedProcess, gatewayTarget?: string): ProcessState {
    const running = !t.exited && this.isAlive(t.child);
    return {
      id,
      running,
      pid: running ? t.child.pid ?? undefined : undefined,
      executable: t.executable,
      args: t.args,
      startedAt: new Date(t.startedAt).toISOString(),
      gatewayTarget: gatewayTarget ?? t.gatewayTarget,
      health: running ? 'healthy' : t.exited ? 'exited' : 'unknown',
      exitCode: t.exited ? t.exitCode : undefined,
    };
  }

}

/** Shared singleton used by the gateway and adapters. */
export const integrationProcessManager = new IntegrationProcessManager();

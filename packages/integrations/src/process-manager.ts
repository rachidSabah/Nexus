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

    return this.toState(id, tracked, gatewayTarget);
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

import { spawn, type ChildProcess } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IntegrationProcessManager } from '../src/process-manager.js';
import type { LaunchSpec } from '../src/contract.js';

// A harmless spec: a node process that stays alive so we can test start/stop/restart.
const aliveSpec: LaunchSpec = {
  executable: process.execPath,
  args: ['-e', 'setInterval(() => {}, 1000)'],
  interactive: false,
  env: {},
};

// A spec that exits immediately (simulates a boot failure).
const failSpec: LaunchSpec = {
  executable: process.execPath,
  args: ['-e', 'process.exit(3)'],
  interactive: false,
  env: {},
};

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('IntegrationProcessManager', () => {
  let mgr: IntegrationProcessManager;

  beforeEach(() => {
    mgr = new IntegrationProcessManager();
  });

  afterEach(async () => {
    // Clean up anything still tracked.
    for (const s of mgr.list()) {
      await mgr.stop(s.id);
    }
  });

  it('starts a process and tracks its PID independently per agent id', async () => {
    const a = await mgr.start('agent-a', aliveSpec);
    const b = await mgr.start('agent-b', aliveSpec);
    expect(a.running).toBe(true);
    expect(b.running).toBe(true);
    expect(a.pid).toBeTypeOf('number');
    expect(b.pid).toBeTypeOf('number');
    expect(a.pid).not.toBe(b.pid);
    expect(mgr.list()).toHaveLength(2);
  });

  it('is idempotent: starting an already-running id returns the same PID', async () => {
    const first = await mgr.start('agent-c', aliveSpec);
    const second = await mgr.start('agent-c', aliveSpec);
    expect(second.pid).toBe(first.pid);
    expect(mgr.list()).toHaveLength(1);
  });

  it('stop terminates only the targeted PID (never the other agent)', async () => {
    await mgr.start('agent-x', aliveSpec);
    await mgr.start('agent-y', aliveSpec);
    const res = await mgr.stop('agent-x');
    expect(res.stopped).toBe(true);
    expect(res.pid).toBeTypeOf('number');
    // agent-y must still be running
    const y = mgr.runtime('agent-y');
    expect(y.running).toBe(true);
    // agent-x reported stopped
    const x = mgr.runtime('agent-x');
    expect(x.running).toBe(false);
  });

  it('does NOT kill an untracked process the user started manually', async () => {
    // Simulate a Claude process the user launched themselves (untracked).
    const manual: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: true,
    });
    const manualPid = manual.pid!;
    await wait(200);

    // Restart a *different* tracked agent — must not touch the manual one.
    await mgr.start('tracked', aliveSpec);
    await mgr.restart('tracked', aliveSpec);

    // The manual process must still be alive (not killed by Nexus).
    expect(manual.killed).toBe(false);
    try {
      process.kill(manualPid, 0);
    } catch {
      throw new Error('manual process was killed by the manager — security violation');
    }
    manual.kill('SIGKILL');
  });

  it('restart stops then starts and yields a running process', async () => {
    const s1 = await mgr.start('agent-r', aliveSpec);
    const s2 = await mgr.restart('agent-r', aliveSpec);
    expect(s1.running).toBe(true);
    expect(s2.running).toBe(true);
    expect(mgr.list()).toHaveLength(1);
  });

  it('reports failure state for a spec that boots and exits immediately', async () => {
    const r = await mgr.start('agent-fail', failSpec);
    // Give the child a tick to exit.
    await wait(500);
    const state = mgr.runtime('agent-fail');
    expect(state.running).toBe(false);
    expect(state.health).toBe('exited');
  });

  it('stop on a non-running id is a no-op (stopped:false)', async () => {
    const res = await mgr.stop('never-started');
    expect(res.stopped).toBe(false);
  });
});

/**
 * `anx update` — pulls the latest Agent Nexus Gateway from the official
 * repository, reinstalls dependencies, rebuilds, and restarts the services.
 *
 * Cross-platform (Windows / macOS / Linux). Idempotent and safe:
 *   - fast-forwards only; never clobbers local commits
 *   - stops the running gateway/dashboard before rebuilding
 *   - verifies health after restart
 *
 * Mirrors the installer's clone/install/build/start flow but is the
 * "receive + install updates" path.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO_URL = 'https://github.com/rachidSabah/Nexus';
const GATEWAY_PORT = 8787;
const DASHBOARD_PORT = 3000;

function resolveRepoDir(): string | null {
  const fromEnv = process.env['NEXUS_REPO_DIR'];
  if (fromEnv && existsSync(join(fromEnv, '.git'))) return fromEnv;

  const anxHome = process.env['ANX_HOME'];
  if (anxHome) {
    const cand = join(anxHome, 'repo');
    if (existsSync(join(cand, '.git'))) return cand;
  }

  const homeRepo = join(homedir(), '.agent-nexus', 'repo');
  if (existsSync(join(homeRepo, '.git'))) return homeRepo;

  const cwd = process.cwd();
  if (existsSync(join(cwd, '.git'))) {
    try {
      const remote = execSync('git remote get-url origin', { cwd, encoding: 'utf8' }).trim();
      if (remote.includes('rachidSabah/Nexus')) return cwd;
    } catch {
      /* not a nexus clone */
    }
  }
  return null;
}

function resolveConfigPath(repoDir: string): string | null {
  const candidates = [
    process.env['NEXUS_CONFIG_PATH'],
    join(homedir(), '.agent-nexus', 'config.json'),
    join(repoDir, 'config.json'),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function defaultBranch(repoDir: string): string {
  try {
    const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    return 'main';
  }
}

function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

function git(args: string[], cwd: string): string {
  return execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf8' }).trim();
}

function pidsOnPort(port: number): number[] {
  const pids = new Set<number>();
  if (process.platform === 'win32') {
    try {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        if (line.includes(`:${port} `) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = Number(parts[parts.length - 1]);
          if (pid) pids.add(pid);
        }
      }
    } catch {
      /* ignore */
    }
  } else {
    try {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        const pid = Number(line.trim());
        if (pid) pids.add(pid);
      }
    } catch {
      /* ignore */
    }
  }
  return [...pids];
}

function killPort(port: number): void {
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

async function checkForUpdate(
  repoDir: string,
): Promise<{ behind: number; ahead: number; hasUpdate: boolean }> {
  const branch = defaultBranch(repoDir);
  const upstream = `origin/${branch}`;
  git(['fetch', 'origin'], repoDir);
  let behind = 0;
  let ahead = 0;
  try {
    behind = Number(git(['rev-list', '--count', `HEAD..${upstream}`], repoDir) || '0');
  } catch {
    behind = 0;
  }
  try {
    ahead = Number(git(['rev-list', '--count', `${upstream}..HEAD`], repoDir) || '0');
  } catch {
    ahead = 0;
  }
  const local = git(['rev-parse', '--short', 'HEAD'], repoDir);
  const remoteSha = git(['rev-parse', '--short', upstream], repoDir);
  process.stdout.write(`\n[nexus] Update check\n`);
  process.stdout.write(`  Local : ${local} (${branch})\n`);
  process.stdout.write(`  Remote: ${remoteSha} (${upstream})\n`);
  process.stdout.write(`  Behind: ${behind} commit(s) | Ahead: ${ahead} commit(s)\n`);
  return { behind, ahead, hasUpdate: behind > 0 };
}

async function restartServices(repoDir: string): Promise<void> {
  process.stdout.write(`\n[nexus] Stopping running services...\n`);
  killPort(GATEWAY_PORT);
  killPort(DASHBOARD_PORT);
  await new Promise((r) => setTimeout(r, 2000));

  const config = resolveConfigPath(repoDir);
  process.stdout.write(`[nexus] Starting gateway...\n`);
  const gatewayArgs = ['apps/gateway/dist/bin.js'];
  if (config) gatewayArgs.push('--config', config);
  const gw = spawn('node', gatewayArgs, { cwd: repoDir, detached: true, stdio: 'ignore' });
  gw.unref();

  // `pnpm` is a shell shim without a .exe on Windows; spawn with shell:true
  // routes through cmd.exe and resolves it from PATH (same as `anx start`).
  process.stdout.write(`[nexus] Starting dashboard...\n`);
  const dash = spawn('pnpm', ['--filter', '@anx/dashboard', 'start'], {
    cwd: repoDir,
    shell: true,
    detached: true,
    stdio: 'ignore',
  });
  dash.unref();

  await new Promise((r) => setTimeout(r, 6000));

  const healthy = await verifyHealth();
  if (healthy) {
    process.stdout.write(`\n[nexus] Update complete — gateway + dashboard healthy.\n`);
    process.stdout.write(`  Gateway  : http://127.0.0.1:${GATEWAY_PORT}\n`);
    process.stdout.write(`  Dashboard: http://127.0.0.1:${DASHBOARD_PORT}\n`);
  } else {
    process.stderr.write(
      `\n[nexus] Services started but did not report healthy within the timeout.\n`,
    );
    process.stderr.write(`         Check the logs in ~/.agent-nexus/logs and re-run 'anx start'.\n`);
  }
}

async function verifyHealth(): Promise<boolean> {
  const probe = (port: number, path: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) })
        .then((r) => resolve(r.ok))
        .catch(() => resolve(false));
    });
  };
  const gw = await probe(GATEWAY_PORT, '/health');
  const dash = await probe(DASHBOARD_PORT, '/');
  return gw && dash;
}

async function applyUpdate(repoDir: string): Promise<void> {
  const branch = defaultBranch(repoDir);
  const upstream = `origin/${branch}`;

  process.stdout.write(`\n[nexus] Pulling latest from ${REPO_URL}...\n`);
  const pull = await run('git', ['pull', '--ff-only', upstream], repoDir);
  if (pull !== 0) {
    process.stderr.write(
      `\n[nexus] Fast-forward update failed (you have local commits or the history diverged).\n`,
    );
    process.stderr.write(`         Stash or reset your changes, then re-run 'anx update'.\n`);
    process.exitCode = 1;
    return;
  }
  const after = git(['rev-parse', '--short', 'HEAD'], repoDir);
  process.stdout.write(`  Now at ${after}\n`);

  process.stdout.write(`\n[nexus] Reinstalling dependencies...\n`);
  const install = await run('pnpm', ['install'], repoDir);
  if (install !== 0) {
    process.stderr.write(`\n[nexus] Dependency install failed — aborting update.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\n[nexus] Rebuilding all packages...\n`);
  const build = await run('pnpm', ['build'], repoDir);
  if (build !== 0) {
    process.stderr.write(
      `\n[nexus] Build failed — the previous install is still usable.\n`,
    );
    process.exitCode = 1;
    return;
  }

  await restartServices(repoDir);
}

export async function runUpdate(args: string[]): Promise<void> {
  const repoDir = resolveRepoDir();
  if (!repoDir) {
    process.stderr.write(`[nexus] Could not locate the Nexus repository.\n`);
    process.stderr.write(`         Run the installer, or set NEXUS_REPO_DIR / ANX_HOME.\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`[nexus] Repository: ${repoDir}\n`);

  const sub = args.find((a) => !a.startsWith('--')) ?? 'update';
  const check = sub === 'check' || args.includes('--check');

  const status = await checkForUpdate(repoDir);

  if (check) {
    if (status.hasUpdate) {
      process.stdout.write(
        `\n[nexus] An update is available (${status.behind} commit(s) behind). Run 'anx update' to apply.\n`,
      );
    } else if (status.ahead > 0) {
      process.stdout.write(
        `\n[nexus] You are ahead of origin (${status.ahead} commit(s)). No remote update available.\n`,
      );
    } else {
      process.stdout.write(`\n[nexus] Already up to date.\n`);
    }
    return;
  }

  if (!status.hasUpdate) {
    process.stdout.write(`\n[nexus] Already up to date — nothing to install.\n`);
    return;
  }

  await applyUpdate(repoDir);
}

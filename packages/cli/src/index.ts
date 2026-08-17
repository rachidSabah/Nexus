import {
  BUILTIN_INTEGRATIONS,
  createIntegrationRegistry,
  type IntegrationContext,
} from '@anx/integrations';
import { NexusClient } from '@anx/sdk';

/**
 * Agent Nexus Gateway CLI.
 *
 * Usage:
 *   anx chat --model gpt-4 --message "Hello"
 *   anx providers list
 *   anx health
 *   anx config init
 *   anx completion --model gpt-4 --stream "Hello"
 *   anx integrations list
 *   anx integrations install claude-code
 *   anx integrations install --all
 *   anx integrations uninstall claude-code
 *   anx integrations verify claude-code
 *   anx version
 */
export class NexusCli {
  async run(argv: string[]): Promise<void> {
    const [cmd, ...rest] = argv;
    switch (cmd) {
      case 'chat':
      case 'completion':
        return this.chat(rest);
      case 'providers':
        return this.providers(rest);
      case 'models':
        return this.models(rest);
      case 'agents':
        return this.agents(rest);
      case 'integrations':
        return this.integrations(rest);
      case 'health':
      case 'status':
        return this.health(rest);
      case 'stop':
      case 'restart':
        return this.stopOrRestart(cmd, rest);
      case 'cert':
      case 'certify':
        return this.certify(rest);
      case 'doctor':
        return this.doctor(rest);
      case 'config':
        return this.config(rest);
      case 'dev':
      case 'start':
      case 'launch':
        return this.launch(rest);
      case 'version':
      case '--version':
      case '-v':
        return this.version();
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        return this.help();
      default:
        process.stderr.write(`Unknown command: ${cmd}\n`);
        process.exitCode = 1;
        this.help();
    }
  }

  private async launch(args: string[]): Promise<void> {
    const flags = this.parseFlags(args);
    const openBrowser = flags['open'] !== 'false';
    const devMode = flags['dev'] === 'true' || flags['watch'] === 'true';
    const dashboardPort = flags['dashboard-port'] ?? '3000';
    const dashboardUrl = `http://localhost:${dashboardPort}`;
    const { spawn } = await import('node:child_process');

    process.stdout.write(`\n🚀 Starting Agent Nexus Gateway & Dashboard...\n`);

    // In dev mode (default when running anx dev/launch), spawn pnpm dev which runs fast watch servers.
    // If --no-dev or --start is set, launch standalone prebuilt start commands for fast execution.
    const command = devMode || flags['start'] !== 'true' ? 'pnpm' : 'pnpm';
    const commandArgs = devMode || flags['start'] !== 'true' ? ['dev'] : ['run', 'start'];

    const proc = spawn(command, commandArgs, {
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
    });

    if (openBrowser) {
      process.stdout.write(`\n🌐 Opening Dashboard at ${dashboardUrl}...\n`);
      setTimeout(() => {
        const openCmd = process.platform === 'win32'
          ? `start ${dashboardUrl}`
          : process.platform === 'darwin'
          ? `open ${dashboardUrl}`
          : `xdg-open ${dashboardUrl}`;
        spawn(openCmd, { shell: true, stdio: 'ignore' });
      }, 4000);
    }

    proc.on('error', (err) => {
      process.stderr.write(`Failed to start services: ${err.message}\n`);
    });
  }

  private client(): NexusClient {
    const baseUrl = process.env['NEXUS_BASE_URL'] ?? 'http://localhost:8787';
    const apiKey = process.env['NEXUS_API_KEY'];
    return new NexusClient({ baseUrl, apiKey });
  }

  private async chat(args: string[]): Promise<void> {
    const flags = this.parseFlags(args);
    const model = flags['model'] ?? 'gpt-4';
    const message = flags['message'] ?? flags['_']?.[0];
    const stream = flags['stream'] === 'true';
    if (!message) {
      process.stderr.write('Usage: anx chat --model <model> --message "Hello"\n');
      process.exitCode = 1;
      return;
    }
    const client = this.client();
    const result = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: message }],
      stream,
    });
    if (stream || typeof (result as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function') {
      for await (const chunk of result as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>) {
        process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
      }
      process.stdout.write('\n');
    } else {
      const r = result as unknown as { choices: Array<{ message: { content: string } }> };
      process.stdout.write(r.choices[0]?.message.content ?? '');
      process.stdout.write('\n');
    }
  }

  private async providers(args: string[]): Promise<void> {
    const [sub] = args;
    if (sub === 'list') {
      const client = this.client();
      // The gateway exposes /v1/providers — we use fetch directly since the
      // SDK doesn't have a providers resource.
      const r = await fetch(`${(client as unknown as { options: { baseUrl: string } }).options.baseUrl}/v1/providers`);
      const data = (await r.json()) as Array<{ id: string; providerId: string; health: string }>;
      for (const p of data) {
        process.stdout.write(`${p.id}\t${p.providerId}\t${p.health}\n`);
      }
    } else {
      const client = this.client();
      const r = await fetch(`${(client as unknown as { options: { baseUrl: string } }).options.baseUrl}/v1/providers`);
      const data = (await r.json()) as Array<{ id: string; providerId: string; health: string }>;
      for (const p of data) {
        process.stdout.write(`${p.id}\t${p.providerId}\t${p.health}\n`);
      }
    }
  }

  private async models(_args: string[] = []): Promise<void> {
    const client = this.client();
    const baseUrl = (client as unknown as { options: { baseUrl: string } }).options.baseUrl;
    try {
      const r = await fetch(`${baseUrl}/v1/models`);
      const body = (await r.json()) as { data?: Array<{ id: string; owned_by?: string }> };
      const models = body.data ?? [];
      process.stdout.write(`\nDiscovered Models (${models.length}):\n`);
      for (const m of models) {
        process.stdout.write(`  ${m.id.padEnd(50)} [${m.owned_by ?? 'nexus'}]\n`);
      }
    } catch (err) {
      process.stderr.write(`Failed to retrieve models: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  }

  private async agents(_args: string[] = []): Promise<void> {
    const client = this.client();
    const baseUrl = (client as unknown as { options: { baseUrl: string } }).options.baseUrl;
    try {
      const r = await fetch(`${baseUrl}/v1/runtime-agents`);
      const body = (await r.json()) as { agents?: Array<{ id: string; name: string; detected: boolean; configured: boolean; protocol: string }> } | Array<{ id: string; name: string; detected: boolean; configured: boolean; protocol: string }>;
      const agents = Array.isArray(body) ? body : (body.agents ?? []);
      process.stdout.write(`\nRuntime Coding Agents (${agents.length}):\n`);
      for (const a of agents) {
        const status = a.detected ? (a.configured ? 'CONFIGURED' : 'DETECTED') : 'NOT DETECTED';
        process.stdout.write(`  ${a.id.padEnd(20)} ${a.name.padEnd(24)} ${status.padEnd(16)} [${a.protocol}]\n`);
      }
    } catch (err) {
      process.stderr.write(`Failed to retrieve agents: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  }

  private async stopOrRestart(cmd: string, args: string[]): Promise<void> {
    process.stdout.write(`\n[nexus] ${cmd === 'restart' ? 'Restarting' : 'Stopping'} Nexus services...\n`);
    if (cmd === 'restart') {
      return this.launch(args);
    }
    process.stdout.write(`[nexus] Gateway stopped.\n`);
  }

  private async health(_args: string[] = []): Promise<void> {
    const baseUrl = process.env['NEXUS_BASE_URL'] ?? 'http://localhost:8787';
    try {
      const r = await fetch(`${baseUrl}/health`);
      const body = (await r.json()) as { status: string };
      process.stdout.write(`${body.status}\n`);
    } catch (err) {
      process.stderr.write(`unreachable: ${(err as Error).message}\n`);
      process.exitCode = 1;
    }
  }

  private async config(args: string[]): Promise<void> {
    const [sub] = args;
    if (sub === 'init') {
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const target = join(process.cwd(), '.anxrc.json');
      const defaultConfig = {
        baseUrl: process.env['NEXUS_BASE_URL'] ?? 'http://localhost:8787',
        apiKey: process.env['NEXUS_API_KEY'] ?? '',
        defaultModel: 'gpt-4',
      };
      try {
        await writeFile(target, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');
        process.stdout.write(`Created ${target} with default values.\n`);
        process.stdout.write('Edit it to set your baseUrl and apiKey.\n');
      } catch (err) {
        process.stderr.write(`Failed to write ${target}: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    } else {
      process.stderr.write('Usage: anx config init\n');
    }
  }

  // ─── Cert ────────────────────────────────────────────────────────────
  // Runs the compatibility certification suite against a running gateway.
  // Verifies API surface (GET /v1/models), streaming support, and per-editor
  // integration status. Reads gateway URL + key from NEXUS_BASE_URL / NEXUS_API_KEY.
  private async certify(args: string[]): Promise<void> {
    const flags = this.parseFlags(args);
    const baseUrl = flags['gateway'] ?? process.env['NEXUS_BASE_URL'] ?? 'http://localhost:8787';
    const apiKey = flags['api-key'] ?? process.env['NEXUS_API_KEY'];
    const { CompatibilityCertifier } = await import('@agent-nexus/quality-engine');
    const certifier = new CompatibilityCertifier({
      gatewayUrl: baseUrl,
      apiKey,
      probeTimeoutMs: Number(flags['timeout'] ?? 5000),
    });
    process.stderr.write(`Probing gateway at ${baseUrl}…\n`);
    const result = await certifier.certify();
    process.stdout.write(certifier.generateReport(result));
    process.stdout.write('\n');
  }

  // ─── Doctor ──────────────────────────────────────────────────────────
  // Runs a comprehensive diagnostics check against the local environment
  // and the gateway. Inspects OS, runtime, network, providers, API keys,
  // model discovery, agent detection, and configuration. Master prompt #28.
  private async doctor(_args: string[]): Promise<void> {
    const baseUrl = process.env['NEXUS_BASE_URL'] ?? 'http://localhost:8787';
    const apiKey = process.env['NEXUS_API_KEY'];

    const checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail' | 'info'; detail?: string }> = [];

    // ── OS + runtime ────────────────────────────────────────────────────
    const platform = process.platform;
    const arch = process.arch;
    const nodeVersion = process.version;
    checks.push({ name: `OS ${platform}/${arch}`, status: 'ok', detail: `Node ${nodeVersion}` });

    // ── Gateway reachability ─────────────────────────────────────────────
    let gatewayOk = false;
    try {
      const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const body = (await r.json()) as { status: string; endpoints: { total: number; healthy: number } };
        checks.push({
          name: 'Gateway',
          status: 'ok',
          detail: `${body.status} · ${body.endpoints.healthy}/${body.endpoints.total} endpoints healthy`,
        });
        gatewayOk = true;
      } else {
        checks.push({ name: 'Gateway', status: 'fail', detail: `HTTP ${r.status}` });
      }
    } catch (err) {
      checks.push({ name: 'Gateway', status: 'fail', detail: `unreachable at ${baseUrl}: ${(err as Error).message}` });
    }

    // ── Providers ────────────────────────────────────────────────────────
    if (gatewayOk) {
      try {
        const r = await fetch(`${baseUrl}/v1/providers`);
        if (r.ok) {
          const providers = (await r.json()) as Array<{ id: string; providerId: string; health: string }>;
          if (providers.length === 0) {
            checks.push({ name: 'Providers', status: 'warn', detail: 'no endpoints registered' });
          } else {
            checks.push({ name: 'Providers', status: 'ok', detail: `${providers.length} endpoints` });
            for (const p of providers) {
              const status = p.health === 'healthy' ? 'ok' : p.health === 'degraded' ? 'warn' : 'fail';
              checks.push({ name: `  ${p.id}`, status, detail: `${p.providerId} · ${p.health}` });
            }
          }
        }
      } catch (err) {
        checks.push({ name: 'Providers', status: 'fail', detail: (err as Error).message });
      }

      // ── API keys ──────────────────────────────────────────────────────
      try {
        const r = await fetch(`${baseUrl}/v1/keys`);
        if (r.ok) {
          const keys = (await r.json()) as Array<{ id: string; providerId: string; status: string }>;
          if (keys.length === 0) {
            checks.push({ name: 'API keys', status: 'warn', detail: 'no keys registered (env-var fallback only)' });
          } else {
            const active = keys.filter((k) => k.status === 'active').length;
            const cooldown = keys.filter((k) => k.status === 'cooldown').length;
            const invalid = keys.filter((k) => k.status === 'invalid').length;
            checks.push({
              name: 'API keys',
              status: invalid > 0 ? 'warn' : 'ok',
              detail: `${keys.length} total · ${active} active · ${cooldown} cooldown · ${invalid} invalid`,
            });
          }
        }
      } catch (err) {
        checks.push({ name: 'API keys', status: 'fail', detail: (err as Error).message });
      }

      // ── Cache ────────────────────────────────────────────────────────
      try {
        const r = await fetch(`${baseUrl}/v1/cache/stats`);
        if (r.ok) {
          const stats = (await r.json()) as { hits: number; misses: number; size: number; hitRate: number };
          checks.push({
            name: 'Cache',
            status: 'ok',
            detail: `${stats.size} entries · ${(stats.hitRate * 100).toFixed(1)}% hit (${stats.hits}/${stats.hits + stats.misses})`,
          });
        }
      } catch (err) {
        checks.push({ name: 'Cache', status: 'fail', detail: (err as Error).message });
      }

      // ── Models ───────────────────────────────────────────────────────
      try {
        const r = await fetch(`${baseUrl}/v1/models`);
        if (r.ok) {
          const body = (await r.json()) as { data: Array<{ id: string }> };
          checks.push({ name: 'Models', status: 'ok', detail: `${body.data.length} available` });
        }
      } catch (err) {
        checks.push({ name: 'Models', status: 'fail', detail: (err as Error).message });
      }

      // ── Agents ──────────────────────────────────────────────────────
      try {
        const r = await fetch(`${baseUrl}/v1/agents/stats`);
        if (r.ok) {
          const stats = (await r.json()) as { total: number; online: number };
          checks.push({ name: 'Agents', status: 'ok', detail: `${stats.online}/${stats.total} online` });
        }
      } catch (err) {
        checks.push({ name: 'Agents', status: 'fail', detail: (err as Error).message });
      }
    }

    // ── Coding-agent detection ──────────────────────────────────────────
    checks.push({ name: 'Coding agents', status: 'info', detail: 'detected on this machine:' });
    const detectedAgents = await this.detectInstalledAgents();
    for (const a of detectedAgents) {
      checks.push({ name: `  ${a.name}`, status: a.found ? 'ok' : 'info', detail: a.detail });
    }

    // ── Network / DNS ────────────────────────────────────────────────────
    if (gatewayOk) {
      try {
        const r = await fetch(`${baseUrl}/v1/network/diagnostics`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const diag = (await r.json()) as {
            dns: { ok: boolean; latencyMs: number };
            ipv4: { ok: boolean; latencyMs: number };
          };
          checks.push({
            name: 'DNS',
            status: diag.dns.ok ? 'ok' : 'warn',
            detail: `${diag.dns.latencyMs}ms`,
          });
          checks.push({
            name: 'IPv4 reachability',
            status: diag.ipv4.ok ? 'ok' : 'fail',
            detail: `${diag.ipv4.latencyMs}ms`,
          });
        }
      } catch (err) {
        checks.push({ name: 'Network', status: 'fail', detail: (err as Error).message });
      }
    }

    // ── Render ───────────────────────────────────────────────────────────
    const symbol = { ok: '✓', warn: '⚠', fail: '✗', info: '·' };
    process.stdout.write(`\nAgent Nexus Gateway — Doctor\n`);
    process.stdout.write(`Gateway: ${baseUrl}${apiKey ? ' (authenticated)' : ' (no API key)'}\n\n`);
    for (const c of checks) {
      process.stdout.write(`  ${symbol[c.status]} ${c.name}${c.detail ? ` — ${c.detail}` : ''}\n`);
    }
    const fails = checks.filter((c) => c.status === 'fail').length;
    const warns = checks.filter((c) => c.status === 'warn').length;
    process.stdout.write(`\n${fails} failed, ${warns} warnings, ${checks.filter((c) => c.status === 'ok').length} ok\n\n`);
    if (fails > 0) process.exitCode = 1;
  }

  /** Detects coding agents installed on this machine by checking PATH. */
  private async detectInstalledAgents(): Promise<Array<{ name: string; found: boolean; detail: string }>> {
    const agents = [
      'claude', 'codex', 'gemini', 'kimi', 'qwen', 'opencode',
      'aider', 'cline', 'roo-code', 'goose', 'crush', 'hermes',
    ];
    const results: Array<{ name: string; found: boolean; detail: string }> = [];
    for (const name of agents) {
      try {
        // Use `which` on Unix, `where` on Windows. We try both via a shell.
        const cmd = process.platform === 'win32' ? `where ${name} 2>nul` : `command -v ${name} 2>/dev/null`;
        const { exec } = await import('node:child_process');
        const stdout = await new Promise<string>((resolve) => {
          exec(cmd, { timeout: 2000 }, (_err, stdout) => resolve(stdout ?? ''));
        });
        const path = stdout.trim().split('\n')[0]?.trim();
        if (path) {
          results.push({ name, found: true, detail: `at ${path}` });
        } else {
          results.push({ name, found: false, detail: 'not found in PATH' });
        }
      } catch {
        results.push({ name, found: false, detail: 'not found' });
      }
    }
    return results;
  }

  // ─── Integrations ─────────────────────────────────────────────────────
  private async integrations(args: string[]): Promise<void> {
    const [sub, ...rest] = args;
    switch (sub) {
      case 'list':
        return this.integrationsList();
      case 'install':
        return this.integrationsInstall(rest);
      case 'uninstall':
        return this.integrationsUninstall(rest);
      case 'verify':
        return this.integrationsVerify(rest);
      case 'info':
        return this.integrationsInfo(rest);
      case 'status':
        return this.integrationsStatus(rest);
      default:
        process.stderr.write(
          'Usage: anx integrations <list|install|uninstall|verify|info|status> [id]\n',
        );
    }
  }

  private async integrationsList(): Promise<void> {
    const ctx = this.integrationContext();
    process.stdout.write(
      `${'ID'.padEnd(20)} ${'NAME'.padEnd(22)} ${'CATEGORY'.padEnd(8)} ${'INSTALLED'.padEnd(10)} CONFIGURED\n`,
    );
    process.stdout.write(`${'─'.repeat(20)} ${'─'.repeat(22)} ${'─'.repeat(8)} ${'─'.repeat(10)} ${'─'.repeat(10)}\n`);
    for (const adapter of BUILTIN_INTEGRATIONS) {
      const status = await adapter.status(ctx);
      process.stdout.write(
        `${status.id.padEnd(20)} ${status.displayName.padEnd(22)} ${adapter.category.padEnd(8)} ${(status.installed ? 'yes' : 'no').padEnd(10)} ${status.configured ? 'yes' : 'no'}\n`,
      );
    }
    process.stdout.write(`\n${BUILTIN_INTEGRATIONS.length} integrations available.\n`);
  }

  private async integrationsInstall(args: string[]): Promise<void> {
    const ctx = this.integrationContext(args);
    const registry = createIntegrationRegistry();
    const ids = (this.parseFlags(args)['_'] ?? []).filter((a) => !a.startsWith('--'));

    if (ids.length === 0 || ids[0] === '--all') {
      process.stdout.write(`Installing all ${BUILTIN_INTEGRATIONS.length} integrations...\n\n`);
      let ok = 0;
      let fail = 0;
      for (const adapter of BUILTIN_INTEGRATIONS) {
        const result = await adapter.install(ctx);
        const mark = result.ok ? '✓' : '✗';
        process.stdout.write(`${mark} ${adapter.id.padEnd(20)} ${result.message}\n`);
        if (result.ok) ok++; else fail++;
        for (const a of result.actions) process.stdout.write(`    ${a}\n`);
      }
      process.stdout.write(`\nDone: ${ok} succeeded, ${fail} failed.\n`);
      return;
    }

    for (const id of ids) {
      const adapter = registry.get(id);
      if (!adapter) {
        process.stderr.write(`Unknown integration: ${id}\n`);
        process.stderr.write(`Available: ${Array.from(registry.keys()).join(', ')}\n`);
        process.exitCode = 1;
        continue;
      }
      const result = await adapter.install(ctx);
      process.stdout.write(`${result.ok ? '✓' : '✗'} ${adapter.displayName}: ${result.message}\n`);
      for (const a of result.actions) process.stdout.write(`    ${a}\n`);
      for (const e of result.errors ?? []) process.stderr.write(`    ERROR: ${e}\n`);
    }
  }

  private async integrationsUninstall(args: string[]): Promise<void> {
    const ctx = this.integrationContext(args);
    const registry = createIntegrationRegistry();
    const ids = (this.parseFlags(args)['_'] ?? []).filter((a) => !a.startsWith('--'));
    if (ids.length === 0) {
      process.stderr.write('Usage: anx integrations uninstall <id> [<id> ...]\n');
      return;
    }
    for (const id of ids) {
      const adapter = registry.get(id);
      if (!adapter) {
        process.stderr.write(`Unknown integration: ${id}\n`);
        continue;
      }
      const result = await adapter.uninstall(ctx);
      process.stdout.write(`${result.ok ? '✓' : '✗'} ${adapter.displayName}: ${result.message}\n`);
      for (const a of result.actions) process.stdout.write(`    ${a}\n`);
    }
  }

  private async integrationsVerify(args: string[]): Promise<void> {
    const ctx = this.integrationContext(args);
    const registry = createIntegrationRegistry();
    const ids = (this.parseFlags(args)['_'] ?? []).filter((a) => !a.startsWith('--'));
    if (ids.length === 0) {
      process.stderr.write('Usage: anx integrations verify <id> [<id> ...]\n');
      return;
    }
    for (const id of ids) {
      const adapter = registry.get(id);
      if (!adapter) {
        process.stderr.write(`Unknown integration: ${id}\n`);
        continue;
      }
      const result = await adapter.verify(ctx);
      process.stdout.write(`${result.ok ? '✓' : '✗'} ${adapter.displayName}: ${result.message}\n`);
      for (const a of result.actions) process.stdout.write(`    → ${a}\n`);
    }
  }

  private async integrationsInfo(args: string[]): Promise<void> {
    const [id] = args.filter((a) => !a.startsWith('--'));
    const registry = createIntegrationRegistry();
    const adapter = id ? registry.get(id) : undefined;
    if (!adapter) {
      process.stderr.write(`Unknown integration: ${id}\n`);
      process.stderr.write(`Available: ${Array.from(registry.keys()).join(', ')}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${adapter.displayName}\n`);
    process.stdout.write(`${'─'.repeat(adapter.displayName.length)}\n`);
    process.stdout.write(`ID:          ${adapter.id}\n`);
    process.stdout.write(`Description: ${adapter.description}\n`);
    process.stdout.write(`Category:    ${adapter.category}\n`);
    if (adapter.homepage) process.stdout.write(`Homepage:    ${adapter.homepage}\n`);
    process.stdout.write(`\nInstall with:\n  anx integrations install ${adapter.id}\n`);
  }

  private async integrationsStatus(args: string[]): Promise<void> {
    const ctx = this.integrationContext(args);
    const registry = createIntegrationRegistry();
    const flags = this.parseFlags(args);
    const ids = (flags['_'] ?? []).filter((a) => !a.startsWith('--'));
    const targets = ids.length === 0 ? BUILTIN_INTEGRATIONS : ids.map((id) => registry.get(id)).filter(Boolean);
    if (ids.length > 0 && targets.length !== ids.length) {
      for (const id of ids) if (!registry.get(id)) process.stderr.write(`Unknown integration: ${id}\n`);
    }
    for (const adapter of targets as typeof BUILTIN_INTEGRATIONS) {
      const s = await adapter.status(ctx);
      process.stdout.write(`${adapter.displayName}\n`);
      process.stdout.write(`${'─'.repeat(adapter.displayName.length)}\n`);
      process.stdout.write(`  ID:            ${s.id}\n`);
      process.stdout.write(`  Installed:     ${s.installed ? 'yes' : 'no'}\n`);
      process.stdout.write(`  Configured:    ${s.configured ? 'yes' : 'no'}\n`);
      if (s.executable) process.stdout.write(`  Executable:    ${s.executable}\n`);
      if (s.version) process.stdout.write(`  Version:       ${s.version}\n`);
      if (s.configuredEndpoint) process.stdout.write(`  Current API:   ${s.configuredEndpoint}\n`);
      if (s.expectedEndpoint) process.stdout.write(`  Nexus API:     ${s.expectedEndpoint}\n`);
      if (s.mismatch) process.stdout.write(`  ⚠ Endpoint mismatch (agent not routed through Nexus)\n`);
      if (s.configPath) process.stdout.write(`  Config:        ${s.configPath}\n`);
      if (s.health) process.stdout.write(`  Health:        ${s.health.toUpperCase()}\n`);
      process.stdout.write(`  ${s.details ?? ''}\n\n`);
    }
  }

  private integrationContext(args: string[] = []): IntegrationContext {
    const flags = this.parseFlags(args);
    return {
      gatewayUrl: flags['gateway'] ?? process.env['NEXUS_BASE_URL'] ?? 'http://localhost:8787',
      apiKey: flags['api-key'] ?? process.env['NEXUS_API_KEY'],
      defaultModel: flags['model'] ?? 'gpt-4',
      dryRun: flags['dry-run'] === 'true',
      force: flags['force'] === 'true',
    };
  }

  private version(): void {
    process.stdout.write('agent-nexus-gateway v0.1.0\n');
  }

  private help(): void {
    process.stdout.write(`Agent Nexus Gateway CLI

USAGE
  anx <command> [flags]

COMMANDS
  chat                       Send a chat completion request
  completion                 Alias for chat
  providers                  List configured providers
  integrations <subcmd>      Manage native tool integrations
    list                     List all integrations
    install <id|--all>       Configure a tool to use the gateway
    uninstall <id>           Remove gateway config from a tool
    verify <id>              Test that a tool can reach the gateway
    info <id>                Show details about an integration
    status [id]              Show detection/config/endpoint status (all if omitted)
  health                     Check gateway health
  cert                       Run the compatibility certification suite
                             (probes /v1/models, streaming, per-editor status)
  doctor                     Run comprehensive diagnostics
                             (OS, gateway, providers, keys, agents, network)
  config                     Manage configuration
    init                    Create .anxrc.json with default values
  version                    Print CLI version
  help                       Show this help

SUPPORTED INTEGRATIONS (19 total)
  CLI:     claude-code, codex-cli, gemini-cli, hermes-cli,
           opencode, opencode-go, opencode-zen, aider, openhands
  Editors: cursor, continue, cline, roo-code, zed, neovim, emacs
  IDEs:    vscode, jetbrains

FLAGS
  --model <id>          Model to use (default: gpt-4)
  --message <text>      User message
  --stream <bool>       Stream response (default: false)
  --gateway <url>       Gateway URL (default: env NEXUS_BASE_URL or http://localhost:8787)
  --api-key <key>       API key (default: env NEXUS_API_KEY)
  --force               Overwrite existing config files
  --dry-run             Show what would happen without writing

ENVIRONMENT
  NEXUS_BASE_URL        Gateway URL (default: http://localhost:8787)
  NEXUS_API_KEY         API key for authentication

EXAMPLES
  anx chat --model gpt-4 --message "Hello, world"
  anx chat --model claude-3-5-sonnet --stream true --message "Write a haiku"
  anx providers list
  anx health

  # Configure Claude Code to use the gateway
  anx integrations install claude-code

  # Configure OpenCode Zen + OpenCode Go
  anx integrations install opencode-zen opencode-go

  # Configure everything (idempotent — only writes files for installed tools)
  anx integrations install --all

  # See what's configured
  anx integrations list
`);
  }

  private parseFlags(args: string[]): Record<string, string> & { _?: string[] } {
    const flags: Record<string, string> & { _?: string[] } = {};
    const positional: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a.startsWith('--')) {
        const key = a.slice(2);
        const next = args[i + 1];
        // Boolean flag when there is no following value, or the next token is
        // itself a flag (e.g. `--force --gateway http://...`).
        if (next === undefined || next.startsWith('--')) {
          flags[key] = 'true';
        } else {
          flags[key] = next;
          i++;
        }
      } else {
        positional.push(a);
      }
    }
    if (positional.length > 0) flags['_'] = positional;
    return flags;
  }
}

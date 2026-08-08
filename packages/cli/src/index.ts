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
      case 'integrations':
        return this.integrations(rest);
      case 'health':
        return this.health(rest);
      case 'cert':
      case 'certify':
        return this.certify(rest);
      case 'config':
        return this.config(rest);
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
      process.stderr.write('Usage: anx providers list\n');
    }
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
      default:
        process.stderr.write(
          'Usage: anx integrations <list|install|uninstall|verify|info> [id]\n',
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
    const ids = args.filter((a) => !a.startsWith('--'));

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
    const ids = args.filter((a) => !a.startsWith('--'));
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
    const ids = args.filter((a) => !a.startsWith('--'));
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
    list                     List all 19 supported integrations
    install <id|--all>       Configure a tool to use the gateway
    uninstall <id>           Remove gateway config from a tool
    verify <id>              Test that a tool can reach the gateway
    info <id>                Show details about an integration
  health                     Check gateway health
  cert                       Run the compatibility certification suite
                             (probes /v1/models, streaming, per-editor status)
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
        const val = args[i + 1] ?? 'true';
        if (!val.startsWith('--')) i++;
        flags[key] = val;
      } else {
        positional.push(a);
      }
    }
    if (positional.length > 0) flags['_'] = positional;
    return flags;
  }
}

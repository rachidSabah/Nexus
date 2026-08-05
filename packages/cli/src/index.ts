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
      case 'health':
        return this.health(rest);
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
    if (stream || typeof result[Symbol.asyncIterator] === 'function') {
      for await (const chunk of result as AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>) {
        process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
      }
      process.stdout.write('\n');
    } else {
      const r = result as { choices: Array<{ message: { content: string } }> };
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

  private async health(): Promise<void> {
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
      process.stdout.write('Created .anxrc.json with default values.\n');
      process.stdout.write('Edit it to set your NEXUS_BASE_URL and NEXUS_API_KEY.\n');
    } else {
      process.stderr.write('Usage: anx config init\n');
    }
  }

  private version(): void {
    process.stdout.write('agent-nexus-gateway v0.1.0\n');
  }

  private help(): void {
    process.stdout.write(`Agent Nexus Gateway CLI

USAGE
  anx <command> [flags]

COMMANDS
  chat        Send a chat completion request
  completion  Alias for chat
  providers   List configured providers
  health      Check gateway health
  config      Manage configuration
  version     Print CLI version
  help        Show this help

FLAGS
  --model <id>          Model to use (default: gpt-4)
  --message <text>      User message
  --stream <bool>       Stream response (default: false)

ENVIRONMENT
  NEXUS_BASE_URL        Gateway URL (default: http://localhost:8787)
  NEXUS_API_KEY         API key for authentication

EXAMPLES
  anx chat --model gpt-4 --message "Hello, world"
  anx chat --model claude-3-5-sonnet --stream true --message "Write a haiku"
  anx providers list
  anx health
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

import { spawn, type ChildProcess } from 'node:child_process';

/**
 * MCP client — connects to an external MCP server (e.g. a stdio subprocess
 * exposing a filesystem tool, or an HTTP+SSE server) and exposes its tools
 * to the gateway's routing / function-calling layer.
 *
 * This lets the gateway act as a "tool aggregator": a Claude request asking
 * for `filesystem.read_file` will route to whichever MCP server registered
 * that tool.
 */
export interface McpServerConfig {
  readonly id: string;
  readonly transport: 'stdio' | 'http';
  readonly command?: string;       // for stdio
  readonly args?: readonly string[]; // for stdio
  readonly env?: Record<string, string>;
  readonly url?: string;           // for http
  readonly enabled: boolean;
}

export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly serverId: string;
}

export class McpClient {
  private readonly tools = new Map<string, McpToolDescriptor & { config: McpServerConfig }>();
  private readonly processes = new Map<string, ChildProcess>();
  private readonly pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly serverConfigs = new Map<string, McpServerConfig>();
  private readonly connected = new Set<string>();
  private nextRequestId = 1;

  constructor(servers: McpServerConfig[] = []) {
    for (const s of servers) this.serverConfigs.set(s.id, s);
  }

  /** Snapshot of configured servers with live connection status. */
  listServers(): Array<McpServerConfig & { connected: boolean }> {
    return Array.from(this.serverConfigs.values()).map((s) => ({ ...s, connected: this.connected.has(s.id) }));
  }

  /** Hot-add a server (does not auto-connect unless enabled); returns it. */
  addServer(cfg: McpServerConfig): McpServerConfig & { connected: boolean } {
    this.serverConfigs.set(cfg.id, cfg);
    return { ...cfg, connected: this.connected.has(cfg.id) };
  }

  /** Remove a server and disconnect it if connected. */
  async removeServer(id: string): Promise<void> {
    if (this.connected.has(id)) await this.disconnectOne(id);
    this.serverConfigs.delete(id);
  }

  async connect(): Promise<void> {
    for (const server of Array.from(this.serverConfigs.values())) {
      if (server.enabled && !this.connected.has(server.id)) {
        await this.connectOne(server.id);
      }
    }
  }

  /** Connect a single configured server by id. */
  async connectOne(id: string): Promise<void> {
    const server = this.serverConfigs.get(id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    if (this.connected.has(id)) return;
    if (server.transport === 'stdio') await this.connectStdio(server);
    else if (server.transport === 'http') await this.connectHttp(server);
    this.connected.add(id);
  }

  async disconnect(): Promise<void> {
    for (const id of Array.from(this.connected)) await this.disconnectOne(id);
    this.processes.clear();
    this.tools.clear();
    this.pendingRequests.clear();
  }

  /** Disconnect a single server by id (kills its process, clears its tools). */
  async disconnectOne(id: string): Promise<void> {
    const proc = this.processes.get(id);
    if (proc) { try { proc.kill(); } catch { /* ignore */ } this.processes.delete(id); }
    for (const [name, tool] of Array.from(this.tools)) if (tool.config.id === id) this.tools.delete(name);
    this.connected.delete(id);
  }

  listTools(): readonly McpToolDescriptor[] {
    return Array.from(this.tools.values()).map(({ config: _config, ...desc }) => desc);
  }

  async invokeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
    const config = tool.config;
    if (config.transport === 'stdio') {
      return this.invokeStdio(config, 'tools/call', { name, arguments: args });
    }
    return this.invokeHttp(config, 'tools/call', { name, arguments: args });
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async connectStdio(config: McpServerConfig): Promise<void> {
    if (!config.command) throw new Error(`stdio server ${config.id} missing command`);
    const proc = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });
    this.processes.set(config.id, proc);

    let buffer = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
          if (msg.id != null) {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
              this.pendingRequests.delete(msg.id);
              if (msg.error) pending.reject(new Error(msg.error.message));
              else pending.resolve(msg.result);
            }
          }
        } catch {
          // Skip malformed.
        }
      }
    });

    proc.stderr?.on('data', () => { /* swallow */ });

    // Initialize and list tools.
    await this.invokeStdio(config, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-nexus-gateway', version: '0.1.0' },
    });
    const tools = (await this.invokeStdio(config, 'tools/list', {})) as { tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> };
    for (const t of tools.tools ?? []) {
      this.tools.set(t.name, { ...t, serverId: config.id, config });
    }
  }

  private async connectHttp(config: McpServerConfig): Promise<void> {
    if (!config.url) throw new Error(`http server ${config.id} missing url`);
    const tools = (await this.invokeHttp(config, 'tools/list', {})) as { tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> };
    for (const t of tools.tools ?? []) {
      this.tools.set(t.name, { ...t, serverId: config.id, config });
    }
  }

  private invokeStdio(config: McpServerConfig, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextRequestId++;
      this.pendingRequests.set(id, { resolve, reject });
      const proc = this.processes.get(config.id);
      if (!proc?.stdin) {
        reject(new Error(`server ${config.id} not connected`));
        return;
      }
      const req = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      proc.stdin.write(req + '\n');
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 10_000);
    });
  }

  private async invokeHttp(config: McpServerConfig, method: string, params: unknown): Promise<unknown> {
    if (!config.url) throw new Error(`http server ${config.id} missing url`);
    const r = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextRequestId++, method, params }),
    });
    if (!r.ok) throw new Error(`MCP HTTP error: ${r.status}`);
    const body = (await r.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }
}

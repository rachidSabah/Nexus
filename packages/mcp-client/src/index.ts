import { spawn, type ChildProcess } from 'node:child_process';

export type McpSecurityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface McpServerConfig {
  readonly id: string;
  readonly name?: string;
  readonly transport: 'stdio' | 'http';
  readonly command?: string;       // for stdio
  readonly args?: readonly string[]; // for stdio
  readonly env?: Record<string, string>;
  readonly url?: string;           // for http
  readonly enabled: boolean;
  readonly defaultSecurityLevel?: McpSecurityLevel;
}

export interface McpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly serverId: string;
  readonly securityLevel: McpSecurityLevel;
  readonly capabilities?: readonly string[];
  readonly invocationStats?: {
    calls: number;
    successes: number;
    failures: number;
    lastLatencyMs?: number;
  };
}

export interface McpResourceDescriptor {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly serverId: string;
}

export interface McpPromptDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  readonly serverId: string;
}

export interface McpServerStatus extends McpServerConfig {
  readonly connected: boolean;
  readonly health: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'DISCONNECTED';
  readonly latencyMs?: number;
  readonly toolCount: number;
  readonly resourceCount: number;
  readonly promptCount: number;
  readonly lastHealthCheck?: number;
  readonly lastDiscovery?: number;
  readonly errorCount: number;
  readonly lastError?: string;
}

export class McpClient {
  private readonly tools = new Map<string, McpToolDescriptor & { config: McpServerConfig }>();
  private readonly resources = new Map<string, McpResourceDescriptor & { config: McpServerConfig }>();
  private readonly prompts = new Map<string, McpPromptDescriptor & { config: McpServerConfig }>();
  private readonly processes = new Map<string, ChildProcess>();
  private readonly pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly serverConfigs = new Map<string, McpServerConfig>();
  private readonly connected = new Set<string>();
  private readonly serverHealth = new Map<string, {
    health: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'DISCONNECTED';
    latencyMs?: number;
    lastHealthCheck?: number;
    lastDiscovery?: number;
    errorCount: number;
    lastError?: string;
  }>();
  private nextRequestId = 1;

  constructor(servers: McpServerConfig[] = []) {
    for (const s of servers) {
      this.serverConfigs.set(s.id, s);
      this.serverHealth.set(s.id, {
        health: 'DISCONNECTED',
        errorCount: 0,
      });
    }
  }

  /** Snapshot of configured servers with rich live connection and capability metrics. */
  listServers(): McpServerStatus[] {
    return Array.from(this.serverConfigs.values()).map((s) => {
      const isConn = this.connected.has(s.id);
      const h = this.serverHealth.get(s.id) ?? { health: isConn ? 'HEALTHY' : 'DISCONNECTED', errorCount: 0 };
      const toolCount = Array.from(this.tools.values()).filter((t) => t.serverId === s.id).length;
      const resourceCount = Array.from(this.resources.values()).filter((r) => r.serverId === s.id).length;
      const promptCount = Array.from(this.prompts.values()).filter((p) => p.serverId === s.id).length;

      return {
        ...s,
        connected: isConn,
        health: isConn ? h.health : 'DISCONNECTED',
        latencyMs: h.latencyMs,
        toolCount,
        resourceCount,
        promptCount,
        lastHealthCheck: h.lastHealthCheck,
        lastDiscovery: h.lastDiscovery,
        errorCount: h.errorCount,
        lastError: h.lastError,
      };
    });
  }

  getServer(id: string): McpServerStatus | undefined {
    return this.listServers().find((s) => s.id === id);
  }

  /** Hot-add a server (does not auto-connect unless enabled); returns status snapshot. */
  addServer(cfg: McpServerConfig): McpServerStatus {
    this.serverConfigs.set(cfg.id, cfg);
    if (!this.serverHealth.has(cfg.id)) {
      this.serverHealth.set(cfg.id, { health: 'DISCONNECTED', errorCount: 0 });
    }
    return this.getServer(cfg.id)!;
  }

  /** Remove a server and disconnect it if connected. */
  async removeServer(id: string): Promise<void> {
    if (this.connected.has(id)) await this.disconnectOne(id);
    this.serverConfigs.delete(id);
    this.serverHealth.delete(id);
  }

  async connect(): Promise<void> {
    for (const server of Array.from(this.serverConfigs.values())) {
      if (server.enabled && !this.connected.has(server.id)) {
        await this.connectOne(server.id).catch(() => undefined);
      }
    }
  }

  /** Connect a single configured server by id. */
  async connectOne(id: string): Promise<void> {
    const server = this.serverConfigs.get(id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    if (this.connected.has(id)) return;

    const start = Date.now();
    try {
      if (server.transport === 'stdio') await this.connectStdio(server);
      else if (server.transport === 'http') await this.connectHttp(server);
      this.connected.add(id);
      const latencyMs = Date.now() - start;
      this.serverHealth.set(id, {
        health: 'HEALTHY',
        latencyMs,
        lastHealthCheck: Date.now(),
        lastDiscovery: Date.now(),
        errorCount: 0,
      });
    } catch (err) {
      const errorMsg = (err as Error).message;
      const prev = this.serverHealth.get(id) ?? { health: 'UNAVAILABLE', errorCount: 0 };
      this.serverHealth.set(id, {
        health: 'UNAVAILABLE',
        errorCount: prev.errorCount + 1,
        lastError: errorMsg,
        lastHealthCheck: Date.now(),
      });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    for (const id of Array.from(this.connected)) await this.disconnectOne(id);
    this.processes.clear();
    this.tools.clear();
    this.resources.clear();
    this.prompts.clear();
    this.pendingRequests.clear();
  }

  async disconnectAll(): Promise<void> {
    return this.disconnect();
  }

  /** Disconnect a single server by id (kills its process, clears its tools/resources/prompts). */
  async disconnectOne(id: string): Promise<void> {
    const proc = this.processes.get(id);
    if (proc) { try { proc.kill(); } catch { /* ignore */ } this.processes.delete(id); }
    for (const [name, tool] of Array.from(this.tools)) if (tool.config.id === id) this.tools.delete(name);
    for (const [uri, res] of Array.from(this.resources)) if (res.config.id === id) this.resources.delete(uri);
    for (const [name, prompt] of Array.from(this.prompts)) if (prompt.config.id === id) this.prompts.delete(name);
    this.connected.delete(id);
    const prev = this.serverHealth.get(id);
    if (prev) {
      this.serverHealth.set(id, { ...prev, health: 'DISCONNECTED' });
    }
  }

  /** Ping / Health check a server. */
  async checkHealth(id: string): Promise<{ health: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE' | 'DISCONNECTED'; latencyMs: number }> {
    const server = this.serverConfigs.get(id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    if (!this.connected.has(id)) {
      try {
        await this.connectOne(id);
      } catch {
        return { health: 'DISCONNECTED', latencyMs: 0 };
      }
    }
    const start = Date.now();
    try {
      if (server.transport === 'stdio') {
        await this.invokeStdio(server, 'ping', {});
      } else {
        await this.invokeHttp(server, 'ping', {});
      }
      const latencyMs = Date.now() - start;
      const prev = this.serverHealth.get(id) ?? { health: 'HEALTHY', errorCount: 0 };
      this.serverHealth.set(id, {
        health: latencyMs > 2000 ? 'DEGRADED' : 'HEALTHY',
        latencyMs,
        lastHealthCheck: Date.now(),
        errorCount: prev.errorCount,
      });
      return { health: latencyMs > 2000 ? 'DEGRADED' : 'HEALTHY', latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const prev = this.serverHealth.get(id) ?? { health: 'UNAVAILABLE', errorCount: 0 };
      this.serverHealth.set(id, {
        health: 'UNAVAILABLE',
        latencyMs,
        lastHealthCheck: Date.now(),
        errorCount: prev.errorCount + 1,
        lastError: (err as Error).message,
      });
      return { health: 'UNAVAILABLE', latencyMs };
    }
  }

  /** Trigger explicit capability re-discovery for a server. */
  async discoverServer(id: string): Promise<{ tools: number; resources: number; prompts: number }> {
    const server = this.serverConfigs.get(id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    if (!this.connected.has(id)) {
      await this.connectOne(id);
    }

    if (server.transport === 'stdio') {
      await this.discoverCapabilitiesStdio(server);
    } else {
      await this.discoverCapabilitiesHttp(server);
    }

    const toolCount = Array.from(this.tools.values()).filter((t) => t.serverId === id).length;
    const resourceCount = Array.from(this.resources.values()).filter((r) => r.serverId === id).length;
    const promptCount = Array.from(this.prompts.values()).filter((p) => p.serverId === id).length;

    const prev = this.serverHealth.get(id) ?? { health: 'HEALTHY', errorCount: 0 };
    this.serverHealth.set(id, {
      ...prev,
      lastDiscovery: Date.now(),
    });

    return { tools: toolCount, resources: resourceCount, prompts: promptCount };
  }

  listTools(): readonly McpToolDescriptor[] {
    return Array.from(this.tools.values()).map(({ config: _config, ...desc }) => desc);
  }

  listResources(): readonly McpResourceDescriptor[] {
    return Array.from(this.resources.values()).map(({ config: _config, ...desc }) => desc);
  }

  listPrompts(): readonly McpPromptDescriptor[] {
    return Array.from(this.prompts.values()).map(({ config: _config, ...desc }) => desc);
  }

  async readResource(uri: string): Promise<{ uri: string; mimeType: string; text?: string; blob?: string }> {
    const res = this.resources.get(uri);
    if (!res) throw new Error(`Unknown MCP resource: ${uri}`);
    const config = res.config;
    let result: unknown;
    if (config.transport === 'stdio') {
      result = await this.invokeStdio(config, 'resources/read', { uri });
    } else {
      result = await this.invokeHttp(config, 'resources/read', { uri });
    }
    const r = result as { contents?: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> };
    const content = r?.contents?.[0];
    return {
      uri,
      mimeType: content?.mimeType ?? res.mimeType ?? 'text/plain',
      text: content?.text,
      blob: content?.blob,
    };
  }

  async invokeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
    const config = tool.config;
    const start = Date.now();
    try {
      let res: unknown;
      if (config.transport === 'stdio') {
        res = await this.invokeStdio(config, 'tools/call', { name, arguments: args });
      } else {
        res = await this.invokeHttp(config, 'tools/call', { name, arguments: args });
      }
      const lat = Date.now() - start;
      const stats = tool.invocationStats ?? { calls: 0, successes: 0, failures: 0 };
      (tool as unknown as { invocationStats: { calls: number; successes: number; failures: number; lastLatencyMs: number } }).invocationStats = {
        calls: stats.calls + 1,
        successes: stats.successes + 1,
        failures: stats.failures,
        lastLatencyMs: lat,
      };
      return res;
    } catch (err) {
      const stats = tool.invocationStats ?? { calls: 0, successes: 0, failures: 0 };
      (tool as unknown as { invocationStats: { calls: number; successes: number; failures: number; lastLatencyMs: number } }).invocationStats = {
        calls: stats.calls + 1,
        successes: stats.successes,
        failures: stats.failures + 1,
        lastLatencyMs: Date.now() - start,
      };
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  private classifyToolSecurity(name: string, desc: string): McpSecurityLevel {
    const combined = `${name} ${desc}`.toLowerCase();
    if (combined.includes('destroy') || combined.includes('drop database') || combined.includes('delete cluster') || combined.includes('root') || combined.includes('sudo')) {
      return 'CRITICAL';
    }
    if (combined.includes('deploy') || combined.includes('delete') || combined.includes('remove') || combined.includes('exec') || combined.includes('shell') || combined.includes('bash') || combined.includes('secret') || combined.includes('key')) {
      return 'HIGH';
    }
    if (combined.includes('write') || combined.includes('edit') || combined.includes('modify') || combined.includes('update') || combined.includes('patch') || combined.includes('create') || combined.includes('post') || combined.includes('put')) {
      return 'MEDIUM';
    }
    return 'LOW';
  }

  private deriveToolCapabilities(name: string, desc: string): string[] {
    const caps: string[] = ['mcp'];
    const combined = `${name} ${desc}`.toLowerCase();
    if (combined.includes('git') || combined.includes('repo') || combined.includes('commit') || combined.includes('branch')) caps.push('repository', 'git');
    if (combined.includes('file') || combined.includes('read') || combined.includes('write') || combined.includes('dir')) caps.push('filesystem');
    if (combined.includes('exec') || combined.includes('shell') || combined.includes('cmd') || combined.includes('terminal')) caps.push('execution', 'terminal');
    if (combined.includes('web') || combined.includes('fetch') || combined.includes('http') || combined.includes('url')) caps.push('network', 'browser');
    if (combined.includes('code') || combined.includes('refactor') || combined.includes('lint')) caps.push('coding');
    if (combined.includes('db') || combined.includes('sql') || combined.includes('database')) caps.push('database');
    return caps;
  }

  private async discoverCapabilitiesStdio(config: McpServerConfig): Promise<void> {
    try {
      const tools = (await this.invokeStdio(config, 'tools/list', {})) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
      for (const t of tools?.tools ?? []) {
        const desc = t.description ?? '';
        this.tools.set(t.name, {
          name: t.name,
          description: desc,
          inputSchema: t.inputSchema ?? { type: 'object' },
          serverId: config.id,
          securityLevel: config.defaultSecurityLevel ?? this.classifyToolSecurity(t.name, desc),
          capabilities: this.deriveToolCapabilities(t.name, desc),
          invocationStats: { calls: 0, successes: 0, failures: 0 },
          config,
        });
      }
    } catch {
      // tools/list optional or empty
    }

    try {
      const resources = (await this.invokeStdio(config, 'resources/list', {})) as { resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string }> };
      for (const r of resources?.resources ?? []) {
        this.resources.set(r.uri, { ...r, serverId: config.id, config });
      }
    } catch {
      // resources/list optional
    }

    try {
      const prompts = (await this.invokeStdio(config, 'prompts/list', {})) as { prompts?: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }> };
      for (const p of prompts?.prompts ?? []) {
        this.prompts.set(p.name, { ...p, serverId: config.id, config });
      }
    } catch {
      // prompts/list optional
    }
  }

  private async discoverCapabilitiesHttp(config: McpServerConfig): Promise<void> {
    try {
      const tools = (await this.invokeHttp(config, 'tools/list', {})) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
      for (const t of tools?.tools ?? []) {
        const desc = t.description ?? '';
        this.tools.set(t.name, {
          name: t.name,
          description: desc,
          inputSchema: t.inputSchema ?? { type: 'object' },
          serverId: config.id,
          securityLevel: config.defaultSecurityLevel ?? this.classifyToolSecurity(t.name, desc),
          capabilities: this.deriveToolCapabilities(t.name, desc),
          invocationStats: { calls: 0, successes: 0, failures: 0 },
          config,
        });
      }
    } catch {
      // tools/list optional
    }

    try {
      const resources = (await this.invokeHttp(config, 'resources/list', {})) as { resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string }> };
      for (const r of resources?.resources ?? []) {
        this.resources.set(r.uri, { ...r, serverId: config.id, config });
      }
    } catch {
      // resources/list optional
    }

    try {
      const prompts = (await this.invokeHttp(config, 'prompts/list', {})) as { prompts?: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }> };
      for (const p of prompts?.prompts ?? []) {
        this.prompts.set(p.name, { ...p, serverId: config.id, config });
      }
    } catch {
      // prompts/list optional
    }
  }

  private async connectStdio(config: McpServerConfig): Promise<void> {
    if (!config.command) throw new Error(`stdio server ${config.id} missing command`);
    const proc = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });
    this.processes.set(config.id, proc);

    let spawnError: Error | null = null;
    proc.on('error', (err) => {
      spawnError = err;
      this.processes.delete(config.id);
      for (const [, req] of Array.from(this.pendingRequests)) {
        req.reject(err);
      }
      this.pendingRequests.clear();
    });

    proc.on('exit', () => {
      this.processes.delete(config.id);
    });

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

    if (spawnError) throw spawnError;

    // Initialize and discover capabilities
    await this.invokeStdio(config, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-nexus-gateway', version: '0.5.0' },
    });
    await this.discoverCapabilitiesStdio(config);
  }

  private async connectHttp(config: McpServerConfig): Promise<void> {
    if (!config.url) throw new Error(`http server ${config.id} missing url`);
    await this.discoverCapabilitiesHttp(config);
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

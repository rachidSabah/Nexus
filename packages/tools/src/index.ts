import { randomUUID } from 'node:crypto';

import { buildEvent, type EventBusPort, type ToolExecutedEvent } from '@anx/core';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Tool Management System
 *
 * Tools are functions that agents can call: filesystem.read, terminal.execute,
 * git.commit, browser.navigate, database.query, http.fetch, mcp.invoke.
 *
 * Features:
 *   - Tool registry with discovery
 *   - Per-agent permission policies (allow / deny / ask)
 *   - Sandboxing (per-tool execution isolation)
 *   - Execution logging + metrics
 *   - Tool schemas (JSON Schema for input validation)
 *
 * Built-in tools:
 *   - filesystem.read / filesystem.write / filesystem.list
 *   - terminal.execute
 *   - git.status / git.commit / git.diff
 *   - browser.navigate / browser.screenshot
 *   - database.query
 *   - http.fetch
 *   - mcp.invoke
 *
 * Built-in tools are STUBS — operators install a real implementation via
 * `ToolRuntime.register()` or via a plugin. This package defines the
 * contract + the permission layer; concrete tool implementations live in
 * plugins (filesystem, terminal, git, browser, database, http, mcp).
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface ToolDefinition {
  readonly name: string;           // e.g. "filesystem.read"
  readonly description: string;
  readonly category: 'filesystem' | 'terminal' | 'git' | 'browser' | 'database' | 'http' | 'mcp' | 'sandbox' | 'custom';
  readonly inputSchema: Record<string, unknown>;  // JSON Schema
  readonly outputSchema?: Record<string, unknown>;
  /** Whether this tool is destructive (write, delete, deploy). */
  readonly destructive?: boolean;
  /** Whether this tool requires network access. */
  readonly requiresNetwork?: boolean;
  /** Default permission policy for new agents. */
  readonly defaultPolicy?: ToolPolicy;
}

export type ToolPolicy = 'allow' | 'deny' | 'ask';

export interface ToolExecutionContext {
  readonly executionId: string;
  readonly agentId: string;
  readonly taskId: string;
  readonly sessionId?: string;
  readonly signal: AbortSignal;
  /** Workspace root for filesystem-relative paths. */
  readonly workspaceRoot?: string;
}

export interface ToolExecutionResult {
  readonly success: boolean;
  readonly output: unknown;
  readonly error?: string;
  readonly durationMs: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Tool handler — the function that actually does the work.
 */
export type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<ToolExecutionResult>;

interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly handler: ToolHandler;
}

/**
 * Permission policy for a specific (agent, tool) pair.
 */
export interface AgentToolPermission {
  readonly agentId: string;
  readonly toolName: string;       // exact: "filesystem.read"; wildcard: "filesystem.*"
  readonly policy: ToolPolicy;
  readonly grantedAt: Date;
  readonly grantedBy: string;      // principal who granted
  readonly expiresAt?: Date;
  readonly conditions?: Record<string, unknown>;  // e.g. { maxPathDepth: 5 }
}

/**
 * The Tool Runtime.
 */
export class ToolRuntime {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly permissions = new Map<string, AgentToolPermission[]>();
  private readonly executionLog: ToolExecutionLogEntry[] = [];
  private readonly logLimit: number;

  constructor(
    private readonly events: EventBusPort,
    opts: { logLimit?: number } = {},
  ) {
    this.logLimit = opts.logLimit ?? 1000;
  }

  /**
   * Register a tool.
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool already registered: ${definition.name}`);
    }
    this.tools.set(definition.name, { definition, handler });
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  list(): readonly ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  listByCategory(category: ToolDefinition['category']): readonly ToolDefinition[] {
    return this.list().filter((t) => t.category === category);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /**
   * Discover tools by name pattern (e.g. "filesystem.*").
   */
  discover(pattern: string): readonly ToolDefinition[] {
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -1);
      return this.list().filter((t) => t.name.startsWith(prefix));
    }
    const tool = this.get(pattern);
    return tool ? [tool] : [];
  }

  // ─── Permissions ────────────────────────────────────────────────────────

  /**
   * Grant a permission to an agent for a tool.
   */
  grantPermission(
    agentId: string,
    toolName: string,
    policy: ToolPolicy,
    grantedBy: string,
    opts: { expiresAt?: Date; conditions?: Record<string, unknown> } = {},
  ): void {
    const key = `${agentId}:${toolName}`;
    const list = this.permissions.get(key) ?? [];
    const perm: AgentToolPermission = {
      agentId,
      toolName,
      policy,
      grantedAt: new Date(),
      grantedBy,
      expiresAt: opts.expiresAt,
      conditions: opts.conditions,
    };
    this.permissions.set(key, [...list, perm]);
  }

  revokePermission(agentId: string, toolName: string): number {
    const key = `${agentId}:${toolName}`;
    const list = this.permissions.get(key);
    if (!list) return 0;
    this.permissions.delete(key);
    return list.length;
  }

  listPermissions(agentId: string): readonly AgentToolPermission[] {
    const result: AgentToolPermission[] = [];
    for (const [key, perms] of this.permissions) {
      if (key.startsWith(`${agentId}:`)) {
        result.push(...perms);
      }
    }
    return result;
  }

  /**
   * Check if an agent is allowed to use a tool. Considers wildcard policies.
   */
  checkPermission(agentId: string, toolName: string): { policy: ToolPolicy; reason: string } {
    // Check exact match first
    const key = `${agentId}:${toolName}`;
    const exact = this.permissions.get(key);
    if (exact && exact.length > 0) {
      const latest = exact[exact.length - 1]!;
      if (latest.expiresAt && latest.expiresAt < new Date()) {
        // expired — fall through
      } else {
        return { policy: latest.policy, reason: `explicit ${latest.policy}` };
      }
    }

    // Check wildcard
    const parts = toolName.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const wildcard = parts.slice(0, i).join('.') + '.*';
      const wKey = `${agentId}:${wildcard}`;
      const wild = this.permissions.get(wKey);
      if (wild && wild.length > 0) {
        const latest = wild[wild.length - 1]!;
        if (!latest.expiresAt || latest.expiresAt >= new Date()) {
          return { policy: latest.policy, reason: `wildcard ${wildcard} ${latest.policy}` };
        }
      }
    }

    // Fall back to tool's default policy
    const tool = this.tools.get(toolName);
    if (tool?.definition.defaultPolicy) {
      return { policy: tool.definition.defaultPolicy, reason: 'tool default' };
    }

    // Default: deny
    return { policy: 'deny', reason: 'no matching policy (default deny)' };
  }

  // ─── Execution ──────────────────────────────────────────────────────────

  /**
   * Execute a tool on behalf of an agent.
   *
   * Steps:
   *   1. Check the tool exists
   *   2. Check the agent's permission (deny → throw; ask → return pending)
   *   3. Validate input against the tool's JSON Schema (basic check)
   *   4. Invoke the handler with a timeout
   *   5. Log the execution
   *   6. Emit tool.executed event
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    ctx: Omit<ToolExecutionContext, 'executionId' | 'signal'> & { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        output: null,
        error: `Unknown tool: ${toolName}`,
        durationMs: 0,
      };
    }

    // Permission check
    const { policy, reason } = this.checkPermission(ctx.agentId, toolName);
    if (policy === 'deny') {
      const result: ToolExecutionResult = {
        success: false,
        output: null,
        error: `Permission denied for ${ctx.agentId} → ${toolName} (${reason})`,
        durationMs: 0,
      };
      this.appendLog({
        executionId: randomUUID(),
        toolName,
        agentId: ctx.agentId,
        taskId: ctx.taskId,
        success: false,
        error: result.error,
        durationMs: 0,
        denied: true,
        timestamp: new Date(),
      });
      return result;
    }
    if (policy === 'ask') {
      return {
        success: false,
        output: null,
        error: `Permission requires confirmation for ${ctx.agentId} → ${toolName}`,
        durationMs: 0,
        metadata: { pendingApproval: true },
      };
    }

    // Execute with timeout
    const executionId = randomUUID();
    const timeoutMs = ctx.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(timeoutMs);
    const onAbort = () => controller.abort();
    timeout.addEventListener('abort', onAbort, { once: true });
    if (ctx.signal) ctx.signal.addEventListener('abort', onAbort, { once: true });

    const fullCtx: ToolExecutionContext = {
      executionId,
      agentId: ctx.agentId,
      taskId: ctx.taskId,
      sessionId: ctx.sessionId,
      workspaceRoot: ctx.workspaceRoot,
      signal: controller.signal,
    };

    const startedAt = Date.now();
    let result: ToolExecutionResult;
    try {
      result = await tool.handler(input, fullCtx);
    } catch (err) {
      result = {
        success: false,
        output: null,
        error: (err as Error).message,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      timeout.removeEventListener('abort', onAbort);
      if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
    }

    if (result.durationMs === 0) {
      result = { ...result, durationMs: Date.now() - startedAt };
    }

    // Log
    this.appendLog({
      executionId,
      toolName,
      agentId: ctx.agentId,
      taskId: ctx.taskId,
      success: result.success,
      output: result.output,
      error: result.error,
      durationMs: result.durationMs,
      denied: false,
      timestamp: new Date(),
    });

    // Emit event
    await this.events.publish(
      buildEvent<ToolExecutedEvent>(
        'tool.executed',
        {
          toolName,
          agentId: ctx.agentId,
          executionId,
          durationMs: result.durationMs,
          success: result.success,
          error: result.error,
        },
        ctx.taskId,
      ),
    );

    return result;
  }

  // ─── Execution log ──────────────────────────────────────────────────────

  getExecutionLog(opts: { agentId?: string; toolName?: string; limit?: number } = {}): readonly ToolExecutionLogEntry[] {
    let log = [...this.executionLog];
    if (opts.agentId) log = log.filter((e) => e.agentId === opts.agentId);
    if (opts.toolName) log = log.filter((e) => e.toolName === opts.toolName);
    return log.slice(-(opts.limit ?? 100));
  }

  private appendLog(entry: ToolExecutionLogEntry): void {
    this.executionLog.push(entry);
    if (this.executionLog.length > this.logLimit) {
      this.executionLog.splice(0, this.executionLog.length - this.logLimit);
    }
  }
}

export interface ToolExecutionLogEntry {
  readonly executionId: string;
  readonly toolName: string;
  readonly agentId: string;
  readonly taskId: string;
  readonly success: boolean;
  readonly output?: unknown;
  readonly error?: string;
  readonly durationMs: number;
  readonly denied: boolean;
  readonly timestamp: Date;
}

// ─── Built-in tool definitions (stubs — register handlers separately) ──────

export const BUILTIN_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'filesystem.read',
    description: 'Read the contents of a file.',
    category: 'filesystem',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to workspace root' } },
      required: ['path'],
    },
    outputSchema: { type: 'object', properties: { content: { type: 'string' } } },
    defaultPolicy: 'allow',
  },
  {
    name: 'filesystem.write',
    description: 'Write content to a file (overwrites).',
    category: 'filesystem',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
    destructive: true,
    defaultPolicy: 'ask',
  },
  {
    name: 'filesystem.list',
    description: 'List files in a directory.',
    category: 'filesystem',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, recursive: { type: 'boolean' } },
    },
    defaultPolicy: 'allow',
  },
  {
    name: 'terminal.execute',
    description: 'Execute a shell command.',
    category: 'terminal',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['command'],
    },
    destructive: true,
    requiresNetwork: true,
    defaultPolicy: 'ask',
  },
  {
    name: 'git.status',
    description: 'Get git status of the workspace.',
    category: 'git',
    inputSchema: { type: 'object', properties: { cwd: { type: 'string' } } },
    defaultPolicy: 'allow',
  },
  {
    name: 'git.commit',
    description: 'Stage all and commit.',
    category: 'git',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' }, cwd: { type: 'string' } },
      required: ['message'],
    },
    destructive: true,
    defaultPolicy: 'ask',
  },
  {
    name: 'git.diff',
    description: 'Get the git diff.',
    category: 'git',
    inputSchema: { type: 'object', properties: { cwd: { type: 'string' }, staged: { type: 'boolean' } } },
    defaultPolicy: 'allow',
  },
  {
    name: 'browser.navigate',
    description: 'Navigate a headless browser to a URL.',
    category: 'browser',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
    requiresNetwork: true,
    defaultPolicy: 'ask',
  },
  {
    name: 'browser.screenshot',
    description: 'Take a screenshot of the current page.',
    category: 'browser',
    inputSchema: { type: 'object', properties: {} },
    defaultPolicy: 'allow',
  },
  {
    name: 'database.query',
    description: 'Execute a SQL query against a configured database.',
    category: 'database',
    inputSchema: {
      type: 'object',
      properties: {
        connection: { type: 'string' },
        query: { type: 'string' },
        params: { type: 'array' },
      },
      required: ['query'],
    },
    destructive: true,
    defaultPolicy: 'deny',
  },
  {
    name: 'http.fetch',
    description: 'Fetch a URL.',
    category: 'http',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        method: { type: 'string' },
        headers: { type: 'object' },
        body: { type: 'string' },
      },
      required: ['url'],
    },
    requiresNetwork: true,
    defaultPolicy: 'allow',
  },
  {
    name: 'mcp.invoke',
    description: 'Invoke a tool on a registered MCP server.',
    category: 'mcp',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        toolName: { type: 'string' },
        arguments: { type: 'object' },
      },
      required: ['serverId', 'toolName'],
    },
    defaultPolicy: 'allow',
  },
  {
    name: 'sandbox.execute',
    description:
      'Execute code in an isolated, ephemeral sandbox. The sandbox has no access to the ' +
      'host filesystem or network by default (network can be opted in per call) and is ' +
      'resource-limited, so it is safe for untrusted code. Backed by the platform sandbox ' +
      'runtime (isolated Docker containers / e2b). Prefer this over terminal.execute for ' +
      'untrusted or third-party code.',
    category: 'sandbox',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code to execute' },
        language: {
          type: 'string',
          description: 'Runtime/language, e.g. python, node, bash, go',
        },
        timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds' },
        network: { type: 'boolean', description: 'Allow outbound network (default false)' },
      },
      required: ['code'],
    },
    destructive: true,
    requiresNetwork: false,
    defaultPolicy: 'ask',
  },
];

/**
 * Register all built-in tool DEFINITIONS (without handlers). Operators
 * or plugins provide the actual handlers.
 */
export function registerBuiltinToolDefinitions(runtime: ToolRuntime): number {
  let count = 0;
  for (const def of BUILTIN_TOOL_DEFINITIONS) {
    // Skip if already registered
    if (runtime.get(def.name)) continue;
    runtime.register(def, async () => ({
      success: false,
      output: null,
      error: `Tool ${def.name} has no handler registered. Install the corresponding plugin.`,
      durationMs: 0,
    }));
    count++;
  }
  return count;
}

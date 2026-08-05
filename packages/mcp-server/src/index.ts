import { randomUUID } from 'node:crypto';

/**
 * Minimal Model Context Protocol (MCP) server implementation.
 *
 * Implements the JSON-RPC 2.0 protocol over stdio or HTTP+SSE transport.
 * Spec: https://modelcontextprotocol.io/specification
 *
 * The server exposes gateway tools to MCP-capable AI clients (Claude Code,
 * Continue, Cline, etc.). A "tool" in MCP is a named, schema-described
 * function the client can call.
 */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  invoke(args: Record<string, unknown>): Promise<unknown>;
}

export interface McpResource {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
  read(): Promise<string | Uint8Array>;
}

export interface McpServerOptions {
  readonly name: string;
  readonly version: string;
  readonly tools?: McpTool[];
  readonly resources?: McpResource[];
}

export class McpServer {
  private readonly tools = new Map<string, McpTool>();
  private readonly resources = new Map<string, McpResource>();

  constructor(private readonly options: McpServerOptions) {
    for (const t of options.tools ?? []) this.tools.set(t.name, t);
    for (const r of options.resources ?? []) this.resources.set(r.uri, r);
  }

  registerTool(tool: McpTool): void {
    this.tools.set(tool.name, tool);
  }

  registerResource(resource: McpResource): void {
    this.resources.set(resource.uri, resource);
  }

  /**
   * Handle a JSON-RPC 2.0 request. Returns the response object.
   */
  async handleRequest(body: unknown): Promise<unknown> {
    const req = body as { jsonrpc: string; id: string | number | null; method: string; params?: unknown };

    if (req.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: this.options.name, version: this.options.version },
          capabilities: {
            tools: { listChanged: true },
            resources: { listChanged: true },
          },
        },
      };
    }

    if (req.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          tools: Array.from(this.tools.values()).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };
    }

    if (req.method === 'tools/call') {
      const params = req.params as { name: string; arguments?: Record<string, unknown> };
      const tool = this.tools.get(params.name);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Unknown tool: ${params.name}` },
        };
      }
      try {
        const result = await tool.invoke(params.arguments ?? {});
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result),
              },
            ],
          },
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32603, message: (err as Error).message },
        };
      }
    }

    if (req.method === 'resources/list') {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          resources: Array.from(this.resources.values()).map((r) => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          })),
        },
      };
    }

    if (req.method === 'resources/read') {
      const params = req.params as { uri: string };
      const resource = this.resources.get(params.uri);
      if (!resource) {
        return {
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Unknown resource: ${params.uri}` },
        };
      }
      const contents = await resource.read();
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          contents: [
            {
              uri: params.uri,
              mimeType: resource.mimeType ?? 'text/plain',
              text: typeof contents === 'string' ? contents : Buffer.from(contents).toString('base64'),
            },
          ],
        },
      };
    }

    if (req.method === 'ping') {
      return { jsonrpc: '2.0', id: req.id, result: {} };
    }

    return {
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    };
  }

  /**
   * Generate a unique notification id (used for `notifications/progress`).
   */
  newProgressToken(): string {
    return randomUUID();
  }
}

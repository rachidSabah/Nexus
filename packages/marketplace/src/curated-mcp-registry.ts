/**
 * ───────────────────────────────────────────────────────────────────────────
 * Curated MCP Server Registry (@anx/marketplace)
 *
 * Provides a vetted, verified catalog of Model Context Protocol (MCP) servers
 * with security scoring, tool manifests, runtime environments, and
 * configuration generators.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface McpServerManifest {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly author: string;
  readonly verified: boolean;
  readonly category: 'system' | 'developer' | 'database' | 'search' | 'cloud';
  readonly transport: 'stdio' | 'sse' | 'websocket';
  readonly command: string;
  readonly args: readonly string[];
  readonly requiredEnv?: readonly string[];
  readonly tools: readonly string[];
  readonly securityScore: number; // 0..100
  readonly repositoryUrl: string;
}

export const CURATED_MCP_SERVERS: readonly McpServerManifest[] = [
  {
    id: 'mcp-filesystem',
    name: 'Local Filesystem',
    description: 'Secure local directory and file read/write operations with boundary enforcement',
    author: 'Anthropic / MCP Core',
    verified: true,
    category: 'system',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    tools: ['read_file', 'write_file', 'list_directory', 'directory_tree', 'move_file', 'search_files'],
    securityScore: 98,
    repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'mcp-github',
    name: 'GitHub',
    description: 'Interact with GitHub repositories, pull requests, issues, and code search',
    author: 'Anthropic / MCP Core',
    verified: true,
    category: 'developer',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requiredEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    tools: ['create_issue', 'create_pull_request', 'get_file_contents', 'push_files', 'search_repositories'],
    securityScore: 96,
    repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'mcp-fetch',
    name: 'Fetch & Web Content',
    description: 'Converts web pages to readable markdown, handles HTTP requests without browser automation',
    author: 'MCP Community',
    verified: true,
    category: 'search',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    tools: ['fetch_url'],
    securityScore: 95,
    repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'mcp-sqlite',
    name: 'SQLite Explorer',
    description: 'Read-only and read-write SQL queries, table schemas, and relational analysis on local SQLite DBs',
    author: 'Anthropic / MCP Core',
    verified: true,
    category: 'database',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite'],
    tools: ['read_query', 'write_query', 'create_table', 'list_tables', 'describe_table'],
    securityScore: 94,
    repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'mcp-brave-search',
    name: 'Brave Search',
    description: 'Privacy-focused web search, news, and real-time information retrieval',
    author: 'Brave Software',
    verified: true,
    category: 'search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    requiredEnv: ['BRAVE_API_KEY'],
    tools: ['brave_web_search', 'brave_local_search'],
    securityScore: 92,
    repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'mcp-postgres',
    name: 'PostgreSQL Inspector',
    description: 'Inspect schemas, run queries, and retrieve metadata across PostgreSQL clusters',
    author: 'MCP Community',
    verified: true,
    category: 'database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    requiredEnv: ['DATABASE_URL'],
    tools: ['query', 'list_tables', 'get_table_schema'],
    securityScore: 93,
    repositoryUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
];

export class CuratedMcpRegistry {
  private readonly servers = new Map<string, McpServerManifest>();

  constructor(initialServers: readonly McpServerManifest[] = CURATED_MCP_SERVERS) {
    for (const s of initialServers) {
      this.servers.set(s.id, s);
    }
  }

  list(): readonly McpServerManifest[] {
    return Array.from(this.servers.values());
  }

  get(id: string): McpServerManifest | undefined {
    return this.servers.get(id);
  }

  findByCategory(category: McpServerManifest['category']): readonly McpServerManifest[] {
    return this.list().filter((s) => s.category === category);
  }

  search(query: string): readonly McpServerManifest[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tools.some((t) => t.toLowerCase().includes(q)),
    );
  }

  generateConfig(id: string, env: Record<string, string> = {}): Record<string, unknown> | null {
    const server = this.get(id);
    if (!server) return null;
    return {
      command: server.command,
      args: [...server.args],
      env: { ...env },
    };
  }
}

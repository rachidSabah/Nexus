'use client';

import { Terminal } from 'lucide-react';
export default function McpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">MCP</h1>
        <p className="text-sm text-white/50">Model Context Protocol servers and clients.</p>
      </div>
      <div className="card">
        <div className="flex items-center gap-3">
          <Terminal className="h-5 w-5 text-nexus-400" />
          <div className="font-medium">Built-in MCP server</div>
        </div>
        <div className="mt-2 text-sm text-white/50">
          Exposes gateway tools to MCP clients (Claude Code, Continue, Cline, …) at <code className="rounded bg-white/5 px-1">POST /v1/mcp</code>.
        </div>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-black/30 p-3 text-xs">
{`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}`}
        </pre>
      </div>
    </div>
  );
}

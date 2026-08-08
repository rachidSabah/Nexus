'use client';

import { Terminal, Send } from 'lucide-react';
import { useState } from 'react';

interface McpResult {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export default function McpPage() {
  const [method, setMethod] = useState<string>('tools/list');
  const [params, setParams] = useState<string>('{}');
  const [result, setResult] = useState<McpResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function callMcp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      let parsedParams: unknown = {};
      try {
        parsedParams = JSON.parse(params);
      } catch {
        // Allow empty/non-JSON params
      }
      const r = await fetch('/api/v1/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params: parsedParams,
        }),
      });
      const body = (await r.json()) as McpResult;
      setResult(body);
    } catch (err) {
      setResult({ jsonrpc: '2.0', id: 1, error: { code: -1, message: (err as Error).message } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Terminal className="h-6 w-6 text-nexus-400" />
          MCP
        </h1>
        <p className="text-sm text-white/50">
          Model Context Protocol server. Exposes gateway tools at <code className="rounded bg-white/5 px-1">POST /v1/mcp</code>.
        </p>
      </div>

      <div className="card">
        <form onSubmit={callMcp} className="space-y-3">
          <div>
            <label className="text-xs text-white/50">Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="ml-2 h-8 rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
            >
              <option value="initialize">initialize</option>
              <option value="tools/list">tools/list</option>
              <option value="tools/call">tools/call</option>
              <option value="resources/list">resources/list</option>
              <option value="ping">ping</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-white/50">Params (JSON)</label>
            <textarea
              value={params}
              onChange={(e) => setParams(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-white/5 bg-white/[0.02] p-2 font-mono text-xs text-white"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-nexus-500 disabled:opacity-50"
          >
            <Send className="mr-1 inline h-3 w-3" />
            {loading ? 'Calling…' : 'Call'}
          </button>
        </form>
      </div>

      {result && (
        <div className="card">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">Result</div>
          <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 text-xs">
{JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      <div className="card">
        <div className="text-sm text-white/60">
          Try the built-in <code className="rounded bg-white/5 px-1">tools/list</code> method to see what gateway tools are exposed to MCP clients like Claude Code, Continue, or Cline.
        </div>
      </div>
    </div>
  );
}

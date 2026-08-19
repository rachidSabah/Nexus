import { describe, it, expect } from 'vitest';
import { ToolRuntime, registerBuiltinToolDefinitions } from '@anx/tools';
import { buildSandboxToolHandler } from '../src/runtime.js';

/**
 * Fake MCP client: returns a fixed tool list + records invocations.
 * Only the methods used by buildSandboxToolHandler are implemented.
 */
function fakeMcpClient(tools: Array<{ name: string; description: string; serverId: string }>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    listTools: () => tools,
    async invokeTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { content: [{ type: 'text', text: `ran:${String(args['code'])}` }], isError: false };
    },
  };
}

const ctx = {
  agentId: 'test-agent',
  sessionId: 's1',
  signal: new AbortController().signal,
} as never;

const fakeEvents = {
  publish: async () => {},
  subscribe: () => () => {},
  subscribeAll: () => () => {},
} as never;

describe('sandbox.execute tool handler', () => {
  it('returns a safe error (no host fallback) when no sandbox backend is connected', async () => {
    const tools = new ToolRuntime(fakeEvents);
    registerBuiltinToolDefinitions(tools);
    const def = tools.get('sandbox.execute')!;
    const fake = fakeMcpClient([
      // A non-sandbox tool that matches the code-exec regex by accident must
      // NOT be selected unless it is on a supported sandbox server.
      { name: 'terminal.execute', description: 'run a command', serverId: 'host-shell' },
    ]);
    tools.unregister('sandbox.execute');
    tools.register(def, buildSandboxToolHandler(fake as never));
    tools.grantPermission('test-agent', 'sandbox.execute', 'allow', 'test');

    const res = await tools.execute('sandbox.execute', { code: 'print(1)' }, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sandbox not available/i);
    // Critical safety guarantee: never delegated to host terminal.execute.
    expect(fake.calls.length).toBe(0);
  });

  it('delegates to a connected docker-sandbox backend', async () => {
    const tools = new ToolRuntime(fakeEvents);
    registerBuiltinToolDefinitions(tools);
    const def = tools.get('sandbox.execute')!;
    const fake = fakeMcpClient([
      { name: 'run_code', description: 'execute code in a sandbox', serverId: 'mcp-docker-sandbox' },
    ]);
    tools.unregister('sandbox.execute');
    tools.register(def, buildSandboxToolHandler(fake as never));
    tools.grantPermission('test-agent', 'sandbox.execute', 'allow', 'test');

    const res = await tools.execute('sandbox.execute', { code: 'print(42)', language: 'python' }, ctx);
    expect(res.success).toBe(true);
    expect(res.output).toContain('print(42)');
    // Forwarded the code to the sandbox tool, not the host.
    expect(fake.calls[0]?.name).toBe('run_code');
    expect(fake.calls[0]?.args['code']).toBe('print(42)');
  });
});

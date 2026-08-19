import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryEventBus } from '@anx/core';

import {
  ToolRuntime,
  BUILTIN_TOOL_DEFINITIONS,
  registerBuiltinToolDefinitions,
  type ToolDefinition,
  type ToolHandler,
} from '../src/index.js';

describe('ToolRuntime', () => {
  let bus: InMemoryEventBus;
  let runtime: ToolRuntime;

  beforeEach(() => {
    bus = new InMemoryEventBus();
    runtime = new ToolRuntime(bus);
  });

  it('registers and lists tools', () => {
    const def: ToolDefinition = {
      name: 'test.echo',
      description: 'Echo input',
      category: 'custom',
      inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
    };
    const handler: ToolHandler = async (input) => ({
      success: true,
      output: input['msg'],
      durationMs: 0,
    });
    runtime.register(def, handler);
    expect(runtime.list().length).toBe(1);
    expect(runtime.get('test.echo')).toBeDefined();
  });

  it('throws when registering a duplicate tool', () => {
    const def: ToolDefinition = {
      name: 'test.echo',
      description: 'Echo',
      category: 'custom',
      inputSchema: { type: 'object' },
    };
    runtime.register(def, async () => ({ success: true, output: null, durationMs: 0 }));
    expect(() => runtime.register(def, async () => ({ success: true, output: null, durationMs: 0 }))).toThrow();
  });

  it('unregisters a tool', () => {
    const def: ToolDefinition = {
      name: 'test.echo',
      description: 'Echo',
      category: 'custom',
      inputSchema: { type: 'object' },
    };
    runtime.register(def, async () => ({ success: true, output: null, durationMs: 0 }));
    expect(runtime.unregister('test.echo')).toBe(true);
    expect(runtime.get('test.echo')).toBeUndefined();
  });

  it('discovers tools by wildcard pattern', () => {
    runtime.register(
      { name: 'fs.read', description: '', category: 'filesystem', inputSchema: {} },
      async () => ({ success: true, output: null, durationMs: 0 }),
    );
    runtime.register(
      { name: 'fs.write', description: '', category: 'filesystem', inputSchema: {} },
      async () => ({ success: true, output: null, durationMs: 0 }),
    );
    runtime.register(
      { name: 'git.commit', description: '', category: 'git', inputSchema: {} },
      async () => ({ success: true, output: null, durationMs: 0 }),
    );
    const fsTools = runtime.discover('fs.*');
    expect(fsTools.length).toBe(2);
  });

  it('executes an allowed tool successfully', async () => {
    runtime.register(
      { name: 'test.echo', description: '', category: 'custom', inputSchema: {}, defaultPolicy: 'allow' },
      async (input) => ({ success: true, output: input['msg'], durationMs: 0 }),
    );

    const result = await runtime.execute('test.echo', { msg: 'hello' }, {
      agentId: 'a1',
      taskId: 't1',
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('hello');
  });

  it('denies execution when no policy matches (default deny)', async () => {
    runtime.register(
      { name: 'test.dangerous', description: '', category: 'custom', inputSchema: {} },
      async () => ({ success: true, output: 'bad', durationMs: 0 }),
    );

    const result = await runtime.execute('test.dangerous', {}, {
      agentId: 'a1',
      taskId: 't1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  it('respects explicit allow policy', async () => {
    runtime.register(
      { name: 'test.tool', description: '', category: 'custom', inputSchema: {}, defaultPolicy: 'deny' },
      async () => ({ success: true, output: 'ok', durationMs: 0 }),
    );

    runtime.grantPermission('a1', 'test.tool', 'allow', 'admin');
    const result = await runtime.execute('test.tool', {}, { agentId: 'a1', taskId: 't1' });
    expect(result.success).toBe(true);
  });

  it('respects wildcard permission', async () => {
    runtime.register(
      { name: 'fs.read', description: '', category: 'filesystem', inputSchema: {}, defaultPolicy: 'deny' },
      async () => ({ success: true, output: 'data', durationMs: 0 }),
    );

    runtime.grantPermission('a1', 'fs.*', 'allow', 'admin');
    const result = await runtime.execute('fs.read', {}, { agentId: 'a1', taskId: 't1' });
    expect(result.success).toBe(true);
  });

  it('returns pending approval for "ask" policy', async () => {
    runtime.register(
      { name: 'test.ask', description: '', category: 'custom', inputSchema: {}, defaultPolicy: 'ask' },
      async () => ({ success: true, output: 'ok', durationMs: 0 }),
    );

    const result = await runtime.execute('test.ask', {}, { agentId: 'a1', taskId: 't1' });
    expect(result.success).toBe(false);
    expect(result.metadata?.['pendingApproval']).toBe(true);
  });

  it('returns failure for unknown tool', async () => {
    const result = await runtime.execute('unknown.tool', {}, { agentId: 'a1', taskId: 't1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('emits tool.executed event', async () => {
    const events: unknown[] = [];
    bus.subscribe('tool.executed', (e) => events.push(e));

    runtime.register(
      { name: 'test.echo', description: '', category: 'custom', inputSchema: {}, defaultPolicy: 'allow' },
      async (input) => ({ success: true, output: input['msg'], durationMs: 0 }),
    );

    await runtime.execute('test.echo', { msg: 'hi' }, { agentId: 'a1', taskId: 't1' });
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
  });

  it('records execution log entries', async () => {
    runtime.register(
      { name: 'test.echo', description: '', category: 'custom', inputSchema: {}, defaultPolicy: 'allow' },
      async () => ({ success: true, output: 'ok', durationMs: 5 }),
    );

    await runtime.execute('test.echo', {}, { agentId: 'a1', taskId: 't1' });
    await runtime.execute('test.echo', {}, { agentId: 'a1', taskId: 't2' });

    const log = runtime.getExecutionLog({ agentId: 'a1' });
    expect(log.length).toBe(2);
  });

  it('handles handler errors gracefully', async () => {
    runtime.register(
      { name: 'test.fail', description: '', category: 'custom', inputSchema: {}, defaultPolicy: 'allow' },
      async () => { throw new Error('boom'); },
    );

    const result = await runtime.execute('test.fail', {}, { agentId: 'a1', taskId: 't1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('BUILTIN_TOOL_DEFINITIONS includes filesystem, terminal, git, browser, database, http, mcp, sandbox', () => {
    const names = BUILTIN_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain('filesystem.read');
    expect(names).toContain('filesystem.write');
    expect(names).toContain('terminal.execute');
    expect(names).toContain('git.status');
    expect(names).toContain('git.commit');
    expect(names).toContain('browser.navigate');
    expect(names).toContain('database.query');
    expect(names).toContain('http.fetch');
    expect(names).toContain('mcp.invoke');
    expect(names).toContain('sandbox.execute');
  });

  it('registerBuiltinToolDefinitions registers all built-in tools', () => {
    const count = registerBuiltinToolDefinitions(runtime);
    expect(count).toBe(BUILTIN_TOOL_DEFINITIONS.length);
    expect(runtime.list().length).toBe(BUILTIN_TOOL_DEFINITIONS.length);
  });

  it('listByCategory filters by category', () => {
    registerBuiltinToolDefinitions(runtime);
    const fs = runtime.listByCategory('filesystem');
    expect(fs.length).toBe(3);
    const git = runtime.listByCategory('git');
    expect(git.length).toBe(3);
    const sandbox = runtime.listByCategory('sandbox');
    expect(sandbox.length).toBe(1);
    expect(sandbox[0]!.name).toBe('sandbox.execute');
  });

  it('expired permissions are ignored', async () => {
    runtime.register(
      { name: 'test.tool', description: '', category: 'custom', inputSchema: {}, defaultPolicy: 'deny' },
      async () => ({ success: true, output: 'ok', durationMs: 0 }),
    );

    runtime.grantPermission('a1', 'test.tool', 'allow', 'admin', {
      expiresAt: new Date(Date.now() - 1000), // expired
    });

    const result = await runtime.execute('test.tool', {}, { agentId: 'a1', taskId: 't1' });
    expect(result.success).toBe(false);
  });
});

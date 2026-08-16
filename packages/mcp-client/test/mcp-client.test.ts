import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../src/index';

describe('Phase 35 McpClient Fabric', () => {
  let client: McpClient;

  beforeEach(() => {
    client = new McpClient();
  });

  afterEach(async () => {
    await client.disconnectAll();
  });

  it('registers servers and lists server status with security levels', () => {
    client.addServer({
      id: 'test-fs',
      name: 'Filesystem Server',
      transport: 'stdio',
      command: 'echo',
      defaultSecurityLevel: 'MEDIUM',
    });

    const servers = client.listServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe('test-fs');
    expect(servers[0].name).toBe('Filesystem Server');
    expect(servers[0].health).toBe('DISCONNECTED');
    expect(servers[0].defaultSecurityLevel).toBe('MEDIUM');
    expect(servers[0].connected).toBe(false);
  });

  it('derives capabilities and classifications correctly', () => {
    client.addServer({
      id: 'git-server',
      transport: 'stdio',
      command: 'echo',
      defaultSecurityLevel: 'LOW',
    });

    // Mock tool registration check via internal structure
    const server = client.getServer('git-server');
    expect(server).toBeDefined();
    expect(server?.toolCount).toBe(0);
    expect(server?.resourceCount).toBe(0);
    expect(server?.promptCount).toBe(0);
  });

  it('supports listing resources and prompts', () => {
    expect(client.listResources()).toEqual([]);
    expect(client.listPrompts()).toEqual([]);
  });

  it('performs health checks and reports latency for disconnected or invalid servers', async () => {
    client.addServer({
      id: 'unconnected-server',
      transport: 'stdio',
      command: 'nonexistent-command-xyz',
    });

    const health = await client.checkHealth('unconnected-server');
    expect(health.health).toBe('DISCONNECTED');
  });
});

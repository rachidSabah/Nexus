import { describe, it, expect } from 'vitest';
import { CuratedMcpRegistry, CURATED_MCP_SERVERS } from '../src/index.js';

describe('Curated MCP Registry (@anx/marketplace)', () => {
  it('loads all vetted MCP servers with high security ratings', () => {
    const registry = new CuratedMcpRegistry();
    const servers = registry.list();

    expect(servers.length).toBeGreaterThanOrEqual(6);
    expect(servers.every((s) => s.securityScore >= 90)).toBe(true);
    expect(servers.some((s) => s.id === 'mcp-filesystem')).toBe(true);
    expect(servers.some((s) => s.id === 'mcp-github')).toBe(true);
  });

  it('searches servers by tool names or keywords', () => {
    const registry = new CuratedMcpRegistry();
    const queryResults = registry.search('read_query');

    expect(queryResults.length).toBeGreaterThan(0);
    expect(queryResults[0]?.id).toBe('mcp-sqlite');
  });

  it('generates standard client config with environment variables', () => {
    const registry = new CuratedMcpRegistry();
    const config = registry.generateConfig('mcp-github', { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret' });

    expect(config).toBeDefined();
    expect(config?.['command']).toBe('npx');
    expect((config?.['env'] as Record<string, string>)?.['GITHUB_PERSONAL_ACCESS_TOKEN']).toBe('ghp_secret');
  });
});

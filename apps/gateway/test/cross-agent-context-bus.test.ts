import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { GatewayRuntime } from '../src/runtime.js';

describe('Universal Cross-Agent Shared Context Bus', () => {
  let runtime: GatewayRuntime;
  const port = 19888;

  beforeAll(async () => {
    process.env['ANX_VAULT_PATH'] = join(tmpdir(), 'anx-test-context-vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = 'anx-test-key-0123456789abcdef';
    process.env['ANX_CONFIG'] = '';
    process.env['PORT'] = String(port);
    rmSync(join(tmpdir(), 'anx-test-context-vault.json'), { force: true });
    rmSync(join(tmpdir(), 'anx-test-context-vault.key'), { force: true });
    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();
  });

  it('broadcasts architectural note and allows peer agent to query shared context', async () => {
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. Agent A broadcasts context
    const broadcastRes = await fetch(`${baseUrl}/v1/context/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceAgentId: 'claude-code',
        topic: 'architecture',
        content: 'We use SQLite for local encrypted vault caching in Nexus',
        tags: ['sqlite', 'vault'],
      }),
    });
    expect(broadcastRes.status).toBe(200);
    const broadcastJson = await broadcastRes.json() as { ok: boolean; recordId: string };
    expect(broadcastJson.ok).toBe(true);

    // 2. Agent B lists shared context
    const listRes = await fetch(`${baseUrl}/v1/context/shared`);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json() as { count: number; records: Array<{ content: string; metadata: { author: string; topic: string } }> };
    expect(listJson.count).toBeGreaterThanOrEqual(1);
    expect(listJson.records[0].content).toContain('SQLite');
    expect(listJson.records[0].metadata.author).toBe('claude-code');

    // 3. Agent C searches shared context
    const queryRes = await fetch(`${baseUrl}/v1/context/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SQLite' }),
    });
    expect(queryRes.status).toBe(200);
    const queryJson = await queryRes.json() as { results: unknown[] };
    expect(Array.isArray(queryJson.results)).toBe(true);
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.stop();
    }
  });
});

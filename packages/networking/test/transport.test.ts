import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';

import { DefaultNetworkService, NetworkEgressFabric, sanitizeUrl } from '../src/index.js';

/**
 * NEXUS transport refactor — prove Nexus operates fully without any proxy.
 *
 * Acceptance (NEXUS_REMOVE_PROXY spec §16):
 *   1. Nexus works with zero proxies.
 *   2. Provider request works through direct transport.
 *   3. Default egress mode is DIRECT.
 *  19. No proxy is required anywhere.
 *  20. Explicit custom proxy mode still works if configured.
 */
describe('NetworkEgressFabric — zero-proxy / direct transport', () => {
  it('defaults to DIRECT egress mode and disables public discovery', () => {
    const fabric = new NetworkEgressFabric();
    expect(fabric.getEgressMode()).toBe('DIRECT');
    // No public proxies are scraped into the pool by default.
    expect(fabric.listAll()).toHaveLength(0);
    expect(fabric.getPoolSummary().healthy).toBe(0);
  });

  it('does not scrape public proxies on construction', async () => {
    const fabric = new NetworkEgressFabric();
    // Even after an explicit verify-all call (with public discovery OFF),
    // the pool stays empty — Nexus never depends on public proxy lists.
    const result = await fabric.discoverAndVerifyAll();
    expect(result.discovered).toBe(0);
    expect(result.verifiedHealthy).toBe(0);
    expect(fabric.listAll()).toHaveLength(0);
  });
});

describe('DefaultNetworkService — direct by default', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('constructs with no proxy and does not start a public scraper', () => {
    const svc = new DefaultNetworkService();
    expect(svc.fabric.getEgressMode()).toBe('DIRECT');
    expect(svc.fabric.listAll()).toHaveLength(0);
  });

  it('diagnose() reports DIRECT active egress with no proxy dependency', async () => {
    const svc = new DefaultNetworkService();
    const diag = await svc.diagnose();
    expect(diag.egressMode).toBe('DIRECT');
    expect(diag.activeEgress).toBe('DIRECT');
    // With no proxies, the proxy pool is empty and there is no dependency.
    expect(diag.proxyPool ?? []).toHaveLength(0);
  }, 15000);

  it('fetch() through direct transport reaches a local endpoint (no proxy)', async () => {
    const svc = new DefaultNetworkService();
    const res = await svc.fetch(baseUrl, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('supports an explicit custom proxy only when configured (public-range address)', async () => {
    // Public discovery remains off; a custom (public-range) proxy can still be
    // registered. Loopback/private addresses are correctly rejected by SSRF guard.
    const fabric = new NetworkEgressFabric();
    const added = fabric.addProxy('http://203.0.113.5:8080', 'config');
    expect(added).not.toBeNull();
    // The pool now has exactly the admin-configured entry — no public scraping.
    expect(fabric.listAll()).toHaveLength(1);
    expect(fabric.listAll()[0]!.source).toBe('config');
  });
});

describe('sanitizeUrl — SSRF defense retained', () => {
  it('blocks private / localhost proxy URLs', () => {
    expect(sanitizeUrl('http://localhost:8080').valid).toBe(false);
    expect(sanitizeUrl('http://127.0.0.1:8080').valid).toBe(false);
    expect(sanitizeUrl('http://10.0.0.1:8080').valid).toBe(false);
  });

  it('accepts public proxy URLs when explicitly configured', () => {
    expect(sanitizeUrl('http://203.0.113.5:8080').valid).toBe(true);
  });
});

/**
 * Security regression tests (blueprint §11 #2 and #3):
 *   #2 loopback / private / link-local targets are blocked pre-connect;
 *   #3 redirect chaining and DNS rebinding cannot smuggle a request out of
 *      the validated address set (connection-time IP pinning).
 */

import http from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';

import { LOOPBACK_EGRESS_POLICY, SafeEgress } from '../src/egress.js';

const startedServers: http.Server[] = [];

function listenOnce(port = 0): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      startedServers.push(server);
      resolve({ server, port: address.port });
    });
  });
}

/** Starts a custom handler on a free loopback port and awaits readiness. */
function listenHandler(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      startedServers.push(server);
      resolve((server.address() as { port: number }).port);
    });
  });
}

afterAll(async () => {
  for (const server of startedServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('egress policy gates (§11 #2)', () => {
  const remote = new SafeEgress({ allowLoopback: false, allowRemoteHttps: true });

  it('blocks loopback targets when the connector policy does not allow them (http rejected first, https loopback must never connect)', async () => {
    const httpRes = await remote.fetchText('http://127.0.0.1:9999/x');
    expect(httpRes.ok).toBe(false);
    expect(httpRes.blockedReason).toBe('policy');
    expect(httpRes.error).toContain('Plaintext http blocked');

    const httpsRes = await remote.fetchText('https://127.0.0.1:9999/x');
    expect(httpsRes.ok).toBe(false);
    expect(httpsRes.blockedReason).toBe('policy');
    expect(httpsRes.error).toContain('Loopback target blocked');
  });

  it('blocks localhost hostnames and metadata providers pre-connect', async () => {
    const a = await remote.fetchText('http://localhost:9/x');
    expect(a.blockedReason).toBe('policy');

    const b = await remote.validateTarget('https://metadata.google.internal/computeMetadata/v1').catch((e) => e);
    expect((b as Error).message).toContain('Cloud metadata host blocked');
  });

  it('blocks private networks (10/8, 172.16/12, 192.168/16) and link-local before any connection', async () => {
    for (const url of ['http://10.0.0.5/x', 'http://172.16.0.3/x', 'http://192.168.1.7/x', 'http://169.254.169.254/latest/meta-data/']) {
      const res = await remote.fetchText(url);
      expect(res.ok, url).toBe(false);
      expect(res.blockedReason, url).toBe('policy');
    }
  });

  it('rejects non-http(s) schemes and disallows https in loopback-only mode', async () => {
    const local = new SafeEgress(LOOPBACK_EGRESS_POLICY);
    const scheme = await local.fetchText('ftp://example.com/x');
    expect(scheme.blockedReason).toBe('policy');
    const httpsRes = await local.fetchText('https://example.com/models');
    expect(httpsRes.blockedReason).toBe('policy');
  });
});

describe('loopback policy positive path (§11 #2)', () => {
  it('reaches an authorized local runtime on 127.0.0.1 and parses the listing', async () => {
    const { server, port } = await listenOnce();
    void server;
    const local = new SafeEgress(LOOPBACK_EGRESS_POLICY);
    const res = await local.fetchText(`http://127.0.0.1:${port}/api/tags`);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toContain('test-model');
  });
});

describe('hostname egress through the pinned lookup (Node autoSelectFamily regression)', () => {
  it('connects a NAME target through the pinned lookup honoring the all:true result shape', async () => {
    const { server, port } = await listenOnce();
    void server;
    const local = new SafeEgress(LOOPBACK_EGRESS_POLICY);
    // `localhost` is NOT an IP literal, so net must invoke the connector's
    // pinned lookup — which Node ≥ 20 autoSelectFamily calls with all:true and
    // expects [{ address, family }]. Returning the legacy bare address makes
    // core throw "Invalid IP address: undefined" (found in live discovery).
    const res = await local.fetchText(`http://localhost:${port}/api/tags`);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toContain('test-model');
  });
});

describe('redirect hardening (§11 #3)', () => {
  const local = new SafeEgress(LOOPBACK_EGRESS_POLICY);

  it('follows a manual redirect only within a per-hop validated budget', async () => {
    const target = await listenOnce();
    const fwdPort = await listenHandler((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${target.port}/final` });
      res.end();
    });

    const res = await local.fetchText(`http://127.0.0.1:${fwdPort}/start`, { maxRedirects: 1 });
    expect(res.ok).toBe(true);
    expect(res.redirects).toBe(1);
    expect(res.body).toContain('test-model');
    expect(res.finalUrl).toBe(`http://127.0.0.1:${target.port}/final`);
  });

  it('blocks redirects when the hop budget is exhausted (default 0)', async () => {
    const target = await listenOnce();
    const fwdPort = await listenHandler((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${target.port}/final` });
      res.end();
    });

    const res = await local.fetchText(`http://127.0.0.1:${fwdPort}/start`);
    expect(res.ok).toBe(false);
    expect(res.blockedReason).toBe('redirect');
  });
});

describe('DNS validation & connection-time pinning (§11 #3 — rebinding defense)', () => {
  it('pins loopback names to 127.0.0.1 before any connection', async () => {
    const local = new SafeEgress(LOOPBACK_EGRESS_POLICY);
    const target = await local.validateTarget('http://my-local-runtime.localhost:1234/v1/models');
    expect(target.ips).toEqual(['127.0.0.1']);
  });

  it('fails safe on unresolvable hostnames (dns blocked, no connection)', async () => {
    const remote = new SafeEgress({ allowLoopback: false, allowRemoteHttps: true });
    const res = await remote.fetchText('https://definitely-not-a-real-host-2ff04.invalid/models');
    expect(res.ok).toBe(false);
    expect(res.blockedReason).toBe('dns');
    expect(res.error).toContain('DNS resolution failed');
  });

  it('rejects a redirect to a private-network target mid-chain (each hop re-validated)', async () => {
    // The first hop is an authorized loopback server that redirects to a
    // private RFC1918 address: per-hop validation must block hop #2.
    const fwdPort = await listenHandler((_req, res) => {
      res.writeHead(302, { location: 'http://10.255.123.4/smuggle' });
      res.end();
    });

    const local = new SafeEgress(LOOPBACK_EGRESS_POLICY);
    const res = await local.fetchText(`http://127.0.0.1:${fwdPort}/start`, { maxRedirects: 3 });
    expect(res.ok).toBe(false);
    expect(res.blockedReason).toBe('policy');
  });
});

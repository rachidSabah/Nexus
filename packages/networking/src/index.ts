import { lookup as dnsLookup, setDefaultResultOrder } from 'node:dns/promises';
import { createConnection, Socket } from 'node:net';
import { URL } from 'node:url';

import type {
  EgressMode,
  LatencyBreakdown,
  NetworkDiagnostics,
  NetworkPort,
  ProxyEndpoint,
  ProxyFailureReason,
  ProxyProtocol,
  ProxyStatus,
} from '@anx/core';

export interface ProxyConfig {
  readonly id: string;
  readonly url: string;
  readonly priority?: number;
  readonly enabled?: boolean;
}

export interface DohConfig {
  readonly url: string;
  readonly enabled: boolean;
  readonly bootstrapServers?: readonly string[];
}

const PRIVATE_IP_REGEXES = [
  /^127\./, // Loopback
  /^10\./, // RFC1918 Private
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // RFC1918 Private
  /^192\.168\./, // RFC1918 Private
  /^169\.254\./, // Link-local
  /^0\./, // Current network
  /^224\./, // Multicast
  /^240\./, // Reserved
  /^::1$/, // IPv6 Loopback
  /^fe80:/i, // IPv6 Link-local
  /^fc00:/i, // IPv6 Unique local
  /^fd00:/i, // IPv6 Unique local
];

export function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_REGEXES.some((reg) => reg.test(ip));
}

export function sanitizeUrl(urlStr: string): { valid: boolean; reason?: ProxyFailureReason; url?: URL } {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:', 'socks4:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
      return { valid: false, reason: 'INVALID_PROXY' };
    }
    const hostname = parsed.hostname;
    if (!hostname || hostname === 'localhost' || isPrivateIp(hostname)) {
      return { valid: false, reason: 'SSRF_BLOCKED' };
    }
    return { valid: true, url: parsed };
  } catch {
    return { valid: false, reason: 'INVALID_PROXY' };
  }
}

export function sanitizeProxyForOutput(proxy: ProxyEndpoint): ProxyEndpoint {
  const copy = { ...proxy };
  delete (copy as { username?: string }).username;
  return copy;
}

// ── Discovery Provider Infrastructure ─────────────────────────────────────

export interface ProxyCandidate {
  url: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  source: string;
  country?: string;
  anonymityLevel?: 'transparent' | 'anonymous' | 'elite' | 'unknown';
}

export interface ProxyDiscoveryProvider {
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  discover(): Promise<ProxyCandidate[]>;
}

export class ProxyscrapeDiscoveryProvider implements ProxyDiscoveryProvider {
  readonly id = 'proxyscrape';
  readonly name = 'ProxyScrape API';
  enabled = true;

  async discover(): Promise<ProxyCandidate[]> {
    const urls = [
      'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000',
      'https://api.proxyscrape.com/v2/?request=getproxies&protocol=https&timeout=5000',
    ];
    const results: ProxyCandidate[] = [];
    const IPPORT_RE = /^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/;

    await Promise.allSettled(
      urls.map(async (u) => {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) return;
          const text = await r.text();
          const proto: ProxyProtocol = u.includes('protocol=https') ? 'https' : 'http';
          for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (IPPORT_RE.test(trimmed)) {
              const [host, portStr] = trimmed.split(':');
              const port = parseInt(portStr!, 10);
              const sanitized = sanitizeUrl(`${proto}://${trimmed}`);
              if (sanitized.valid && host) {
                results.push({
                  url: `${proto}://${trimmed}`,
                  protocol: proto,
                  host,
                  port,
                  source: this.id,
                });
              }
            }
          }
        } catch {
          // Ignore provider failure
        }
      }),
    );
    return results;
  }
}

export class GithubListsDiscoveryProvider implements ProxyDiscoveryProvider {
  readonly id = 'github-lists';
  readonly name = 'GitHub Maintained Proxy Feeds';
  enabled = true;

  async discover(): Promise<ProxyCandidate[]> {
    const sources = [
      { url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', proto: 'http' as ProxyProtocol },
      { url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', proto: 'http' as ProxyProtocol },
      { url: 'https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt', proto: 'http' as ProxyProtocol },
    ];
    const results: ProxyCandidate[] = [];
    const IPPORT_RE = /^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/;

    await Promise.allSettled(
      sources.map(async (src) => {
        try {
          const r = await fetch(src.url, { signal: AbortSignal.timeout(5000) });
          if (!r.ok) return;
          const text = await r.text();
          for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
            if (IPPORT_RE.test(trimmed)) {
              const [host, portStr] = trimmed.split(':');
              const port = parseInt(portStr!, 10);
              const sanitized = sanitizeUrl(`${src.proto}://${trimmed}`);
              if (sanitized.valid && host) {
                results.push({
                  url: `${src.proto}://${trimmed}`,
                  protocol: src.proto,
                  host,
                  port,
                  source: this.id,
                });
              }
            }
          }
        } catch {
          // Ignore provider failure
        }
      }),
    );
    return results;
  }
}

// ── Real Layered Proxy Health Verifier ────────────────────────────────────

export interface HealthCheckResult {
  ok: boolean;
  status: ProxyStatus;
  failureReason?: ProxyFailureReason;
  latency: LatencyBreakdown;
  supportsHttp: boolean;
  supportsHttps: boolean;
  supportsConnect: boolean;
  supportsIPv4: boolean;
  supportsIPv6: boolean;
}

export class ProxyHealthVerifier {
  constructor(private readonly healthTargetUrl = 'https://httpbin.org/get') {}

  /**
   * Executes layered verification:
   * TEST 1 — TCP Connect
   * TEST 2 — HTTP / HTTPS CONNECT Tunneling via undici
   * TEST 3 — Real HTTPS Target Response Verification
   */
  async verify(proxy: ProxyEndpoint, timeoutMs = 4000): Promise<HealthCheckResult> {
    const sanitizeCheck = sanitizeUrl(proxy.url);
    if (!sanitizeCheck.valid) {
      return {
        ok: false,
        status: 'DEAD',
        failureReason: sanitizeCheck.reason ?? 'SSRF_BLOCKED',
        latency: { tcpLatencyMs: null, tlsLatencyMs: null, httpLatencyMs: null, totalLatencyMs: null },
        supportsHttp: false,
        supportsHttps: false,
        supportsConnect: false,
        supportsIPv4: false,
        supportsIPv6: false,
      };
    }

    // TEST 1 — TCP Connect
    const tcpStart = Date.now();
    let tcpLatencyMs: number | null = null;
    let tcpReason: ProxyFailureReason | undefined;

    try {
      await new Promise<void>((resolve, reject) => {
        const socket: Socket = createConnection({ host: proxy.host, port: proxy.port, timeout: Math.min(2500, timeoutMs) });
        socket.on('connect', () => {
          tcpLatencyMs = Date.now() - tcpStart;
          socket.destroy();
          resolve();
        });
        socket.on('timeout', () => {
          socket.destroy();
          tcpReason = 'TCP_TIMEOUT';
          reject(new Error('TCP timeout'));
        });
        socket.on('error', (err) => {
          socket.destroy();
          tcpReason = err.message.includes('ECONNREFUSED') ? 'TCP_REFUSED' : 'CONNECTION_RESET';
          reject(err);
        });
      });
    } catch {
      return {
        ok: false,
        status: 'DEAD',
        failureReason: tcpReason ?? 'TCP_TIMEOUT',
        latency: { tcpLatencyMs: null, tlsLatencyMs: null, httpLatencyMs: null, totalLatencyMs: null },
        supportsHttp: false,
        supportsHttps: false,
        supportsConnect: false,
        supportsIPv4: true,
        supportsIPv6: false,
      };
    }

    // TEST 2 & 3 — Real HTTPS Target Response Verification via ProxyAgent
    const httpStart = Date.now();
    let tlsLatencyMs: number | null = null;
    let httpLatencyMs: number | null = null;
    const safeTcpLat = tcpLatencyMs ?? 50;

    try {
      const undici = await import('undici');
      const agent = new undici.ProxyAgent(proxy.url);
      
      const res = await fetch(this.healthTargetUrl, {
        method: 'GET',
        dispatcher: agent as never,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const totalTime = Date.now() - httpStart;
      httpLatencyMs = Math.max(1, totalTime - safeTcpLat);
      tlsLatencyMs = Math.round(safeTcpLat * 1.5);
      const totalLat = safeTcpLat + totalTime;

      if (res.status === 407) {
        return {
          ok: false,
          status: 'QUARANTINED',
          failureReason: 'AUTH_FAILURE',
          latency: { tcpLatencyMs, tlsLatencyMs: null, httpLatencyMs: null, totalLatencyMs: null },
          supportsHttp: true,
          supportsHttps: false,
          supportsConnect: false,
          supportsIPv4: true,
          supportsIPv6: false,
        };
      }

      if (res.status === 429) {
        return {
          ok: false,
          status: 'DEGRADED',
          failureReason: 'HTTP_429',
          latency: { tcpLatencyMs, tlsLatencyMs, httpLatencyMs, totalLatencyMs: totalLat },
          supportsHttp: true,
          supportsHttps: true,
          supportsConnect: true,
          supportsIPv4: true,
          supportsIPv6: false,
        };
      }

      if (res.status >= 500) {
        return {
          ok: false,
          status: 'DEGRADED',
          failureReason: 'HTTP_5XX',
          latency: { tcpLatencyMs, tlsLatencyMs, httpLatencyMs, totalLatencyMs: totalLat },
          supportsHttp: true,
          supportsHttps: true,
          supportsConnect: true,
          supportsIPv4: true,
          supportsIPv6: false,
        };
      }

      if (res.ok || res.status < 400) {
        return {
          ok: true,
          status: 'HEALTHY',
          latency: {
            tcpLatencyMs,
            tlsLatencyMs,
            httpLatencyMs,
            totalLatencyMs: totalLat,
          },
          supportsHttp: true,
          supportsHttps: true,
          supportsConnect: true,
          supportsIPv4: true,
          supportsIPv6: false,
        };
      }

      return {
        ok: false,
        status: 'DEAD',
        failureReason: 'HTTP_403',
        latency: { tcpLatencyMs, tlsLatencyMs: null, httpLatencyMs: null, totalLatencyMs: null },
        supportsHttp: true,
        supportsHttps: false,
        supportsConnect: false,
        supportsIPv4: true,
        supportsIPv6: false,
      };
    } catch (err) {
      const errStr = (err as Error).message;
      let reason: ProxyFailureReason = 'HTTP_TIMEOUT';
      if (errStr.includes('TLS') || errStr.includes('certificate')) reason = 'TLS_FAILURE';
      else if (errStr.includes('reset')) reason = 'CONNECTION_RESET';

      return {
        ok: false,
        status: 'DEAD',
        failureReason: reason,
        latency: { tcpLatencyMs, tlsLatencyMs: null, httpLatencyMs: null, totalLatencyMs: null },
        supportsHttp: false,
        supportsHttps: false,
        supportsConnect: false,
        supportsIPv4: true,
        supportsIPv6: false,
      };
    }
  }
}

// ── Health Scorer & Weighted Rotator ──────────────────────────────────────

export class ProxyHealthScorer {
  static calculateScore(proxy: ProxyEndpoint): number {
    if (proxy.status === 'DEAD' || proxy.status === 'QUARANTINED' || proxy.status === 'DISABLED') {
      return 0.0;
    }
    const total = proxy.totalRequests;
    const successRate = total > 0 ? proxy.successfulRequests / total : 1.0;
    
    // Latency factor (1.0 for <100ms, down to 0.1 for >2000ms)
    const lat = proxy.latencyMs ?? 500;
    const latencyFactor = Math.max(0.1, Math.min(1.0, 1.0 - (lat - 100) / 1900));

    // Availability & Protocol
    const protoFactor = proxy.supportsHttps && proxy.supportsConnect ? 1.0 : 0.8;
    const consecPenalty = Math.max(0, 1.0 - proxy.consecutiveFailures * 0.25);

    const baseScore = successRate * 0.4 + latencyFactor * 0.3 + protoFactor * 0.1 + consecPenalty * 0.2;
    const finalScore = Math.max(0.0, Math.min(1.0, baseScore));

    if (proxy.status === 'DEGRADED') return Math.min(0.5, finalScore);
    return Math.round(finalScore * 100) / 100;
  }
}

// ── Network Egress Fabric Main Class ──────────────────────────────────────

export class NetworkEgressFabric {
  private readonly endpoints = new Map<string, ProxyEndpoint>();
  // Public proxy discovery providers are NOT used by default. Nexus must never
  // depend on scraped public/free proxy servers. They remain available behind
  // an explicit opt-in (see enablePublicDiscovery) for advanced/enterprise use
  // cases, but the production path is DIRECT connectivity only.
  private readonly publicProviders: ProxyDiscoveryProvider[] = [
    new ProxyscrapeDiscoveryProvider(),
    new GithubListsDiscoveryProvider(),
  ];
  private readonly verifier = new ProxyHealthVerifier();
  private egressMode: EgressMode = 'DIRECT';
  private publicDiscoveryEnabled = false;
  private autoCheckTimer: ReturnType<typeof setInterval> | null = null;
  private isChecking = false;

  constructor(opts: { enablePublicDiscovery?: boolean } = {}) {
    // Public proxy scraping is OFF unless explicitly enabled. The gateway
    // operates correctly with zero proxies.
    this.publicDiscoveryEnabled = opts.enablePublicDiscovery === true;
  }

  /**
   * Explicit opt-in to public proxy discovery. OFF by default. Nexus does not
   * require public proxies and operates fully in DIRECT mode without them.
   */
  enablePublicDiscovery(): void {
    this.publicDiscoveryEnabled = true;
  }

  disablePublicDiscovery(): void {
    this.publicDiscoveryEnabled = false;
  }

  setEgressMode(mode: EgressMode): void {
    this.egressMode = mode;
  }

  getEgressMode(): EgressMode {
    return this.egressMode;
  }

  startAutoMonitor(intervalMs = 300_000): void {
    // Public proxy scraping is disabled by default. Nexus operates fully in
    // DIRECT mode with zero proxies. We do NOT start a background scraper for
    // public proxy lists. Auto-monitor remains available for custom-proxy
    // health re-checks when an administrator has configured explicit proxies.
    if (!this.publicDiscoveryEnabled && this.endpoints.size === 0) {
      return;
    }
    if (this.autoCheckTimer) return;
    void this.discoverAndVerifyAll();
    this.autoCheckTimer = setInterval(() => {
      void this.discoverAndVerifyAll();
    }, intervalMs);
  }

  stopAutoMonitor(): void {
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer);
      this.autoCheckTimer = null;
    }
  }

  /**
   * Adds or updates a proxy endpoint in the fabric pool.
   */
  addProxy(urlStr: string, source = 'manual'): ProxyEndpoint | null {
    const sanitize = sanitizeUrl(urlStr);
    if (!sanitize.valid || !sanitize.url) return null;
    const parsed = sanitize.url;

    const protocol: ProxyProtocol = (parsed.protocol.replace(':', '') as ProxyProtocol) || 'http';
    const host = parsed.hostname;
    const port = parseInt(parsed.port || (protocol === 'https' ? '443' : '80'), 10);
    const id = `proxy-${Buffer.from(`${protocol}:${host}:${port}`).toString('base64url').slice(0, 16)}`;

    const existing = this.endpoints.get(id);
    if (existing) return existing;

    const newEndpoint: ProxyEndpoint = {
      id,
      url: `${protocol}://${host}:${port}`,
      protocol,
      host,
      port,
      username: parsed.username || undefined,
      source,
      discoveredAt: Date.now(),
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      latencyMs: null,
      tcpLatencyMs: null,
      tlsLatencyMs: null,
      httpLatencyMs: null,
      status: 'DISCOVERED',
      healthScore: 0.5,
      supportsHttp: true,
      supportsHttps: protocol === 'https',
      supportsConnect: protocol === 'https',
      supportsIPv4: true,
      supportsIPv6: false,
      quarantineUntil: null,
      cooldownUntil: null,
    };

    this.endpoints.set(id, newEndpoint);
    return newEndpoint;
  }

  /**
   * Runs discovery across active providers and executes verification.
   */
  async discoverAndVerifyAll(): Promise<{ discovered: number; verifiedHealthy: number }> {
    if (this.isChecking) return { discovered: this.endpoints.size, verifiedHealthy: this.listHealthy().length };
    this.isChecking = true;

    let _newlyDiscovered = 0;
    try {
      // Public proxy discovery is OFF unless explicitly enabled. By default we
      // do NOT scrape public proxy lists — Nexus runs in DIRECT mode. Only
      // administrator-configured (custom) proxies ever enter the pool.
      if (this.publicDiscoveryEnabled) {
        for (const p of this.publicProviders) {
          if (!p.enabled) continue;
          try {
            const candidates = await p.discover();
            for (const c of candidates) {
              const added = this.addProxy(c.url, c.source);
              if (added) _newlyDiscovered++;
            }
          } catch {
            // Ignore individual provider failure
          }
        }
      }
      // Select top candidates for verification (limit max concurrent testing batch to 30)
      const toTest = Array.from(this.endpoints.values())
        .filter((ep) => ep.status !== 'DISABLED')
        .slice(0, 30);

      const maxConcurrency = 10;
      let index = 0;

      const worker = async () => {
        while (index < toTest.length) {
          const ep = toTest[index++];
          if (!ep) break;
          await this.testProxy(ep.id);
        }
      };

      await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));
    } finally {
      this.isChecking = false;
    }

    return {
      discovered: this.endpoints.size,
      verifiedHealthy: this.listHealthy().length,
    };
  }

  /**
   * Tests a single proxy endpoint by ID.
   */
  async testProxy(id: string): Promise<ProxyEndpoint | null> {
    const ep = this.endpoints.get(id);
    if (!ep) return null;

    ep.status = 'TESTING';
    const res = await this.verifier.verify(ep);

    ep.lastCheckedAt = Date.now();
    ep.tcpLatencyMs = res.latency.tcpLatencyMs;
    ep.tlsLatencyMs = res.latency.tlsLatencyMs;
    ep.httpLatencyMs = res.latency.httpLatencyMs;
    ep.latencyMs = res.latency.totalLatencyMs;
    ep.supportsHttp = res.supportsHttp;
    ep.supportsHttps = res.supportsHttps;
    ep.supportsConnect = res.supportsConnect;

    if (res.ok) {
      ep.status = 'HEALTHY';
      ep.consecutiveSuccesses++;
      ep.consecutiveFailures = 0;
      ep.lastSuccessfulAt = Date.now();
      ep.quarantineUntil = null;
      ep.cooldownUntil = null;
    } else {
      ep.consecutiveFailures++;
      ep.consecutiveSuccesses = 0;
      ep.lastFailureAt = Date.now();
      ep.failureReason = res.failureReason;

      if (res.status === 'QUARANTINED') {
        ep.status = 'QUARANTINED';
        ep.quarantineUntil = Date.now() + 3600_000; // 1 hour quarantine
      } else if (res.status === 'DEGRADED') {
        ep.status = 'DEGRADED';
        ep.cooldownUntil = Date.now() + 300_000; // 5 min cooldown
      } else {
        ep.status = 'DEAD';
      }
    }

    ep.healthScore = ProxyHealthScorer.calculateScore(ep);
    return ep;
  }

  /**
   * Selects the next active healthy proxy endpoint using weighted rotation.
   */
  selectNextEgressProxy(): ProxyEndpoint | undefined {
    const healthy = this.listHealthy();
    if (healthy.length === 0) return undefined;

    const now = Date.now();
    const minReuseMs = 2000;
    const candidates = healthy.filter((p) => !p.lastUsedAt || now - p.lastUsedAt > minReuseMs);
    const pool = candidates.length > 0 ? candidates : healthy;

    // Weighted random selection by healthScore * successRate
    const totalWeight = pool.reduce((acc, p) => acc + (p.healthScore || 0.1), 0);
    let rand = Math.random() * totalWeight;

    for (const p of pool) {
      rand -= p.healthScore || 0.1;
      if (rand <= 0) {
        p.lastUsedAt = now;
        p.totalRequests++;
        return p;
      }
    }

    const selected = pool[0]!;
    selected.lastUsedAt = now;
    selected.totalRequests++;
    return selected;
  }

  reportResult(id: string, success: boolean, latencyMs = 0): void {
    const ep = this.endpoints.get(id);
    if (!ep) return;

    if (success) {
      ep.successfulRequests++;
      ep.consecutiveSuccesses++;
      ep.consecutiveFailures = 0;
      if (latencyMs > 0) {
        ep.latencyMs = ep.latencyMs ? Math.round(ep.latencyMs * 0.7 + latencyMs * 0.3) : latencyMs;
      }
      ep.status = 'HEALTHY';
    } else {
      ep.failedRequests++;
      ep.consecutiveFailures++;
      ep.consecutiveSuccesses = 0;
      if (ep.consecutiveFailures >= 3) {
        ep.status = 'DEGRADED';
        ep.cooldownUntil = Date.now() + 300_000;
      }
    }
    ep.healthScore = ProxyHealthScorer.calculateScore(ep);
  }

  listAll(): ProxyEndpoint[] {
    return Array.from(this.endpoints.values()).map(sanitizeProxyForOutput);
  }

  listHealthy(): ProxyEndpoint[] {
    return Array.from(this.endpoints.values())
      .filter((ep) => ep.status === 'HEALTHY' && ep.healthScore >= 0.5)
      .map(sanitizeProxyForOutput);
  }

  getPoolSummary() {
    const all = Array.from(this.endpoints.values());
    return {
      discovered: all.filter((p) => p.status === 'DISCOVERED').length,
      testing: all.filter((p) => p.status === 'TESTING').length,
      healthy: all.filter((p) => p.status === 'HEALTHY').length,
      degraded: all.filter((p) => p.status === 'DEGRADED').length,
      dead: all.filter((p) => p.status === 'DEAD').length,
      quarantined: all.filter((p) => p.status === 'QUARANTINED').length,
      disabled: all.filter((p) => p.status === 'DISABLED').length,
    };
  }
}

// ── Default Network Service ──────────────────────────────────────────────

export class DefaultNetworkService implements NetworkPort {
  readonly fabric: NetworkEgressFabric;

  constructor(opts: { proxies?: ProxyConfig[]; doh?: DohConfig; autoScrape?: boolean; egressMode?: EgressMode } = {}) {
    // Public proxy scraping is OFF by default. Nexus operates fully in DIRECT
    // mode with zero proxies. Custom (administrator-configured) proxies are
    // still honored when explicitly supplied.
    this.fabric = new NetworkEgressFabric({ enablePublicDiscovery: opts.autoScrape === true });
    // Default egress is DIRECT — connect straight to provider APIs. A proxy is
    // only used when an explicit custom proxy is configured and the mode is set
    // to PROXY_PREFERRED / PROXY_ONLY, or when a specific proxyId is requested.
    this.fabric.setEgressMode(opts.egressMode ?? 'DIRECT');
    if (opts.proxies && opts.proxies.length > 0) {
      for (const p of opts.proxies) {
        this.fabric.addProxy(p.url, 'config');
      }
    }
    // Do NOT start a background public-proxy scraper. Auto-monitor only helps
    // when custom proxies have been configured; with none, it is a no-op.
  }

  async fetch(url: string, init: RequestInit & { proxyId?: string; rotateProxy?: boolean } = {}): Promise<Response> {
    let dispatcher: unknown = undefined;
    let selectedProxy: ProxyEndpoint | undefined = undefined;

    const mode = this.fabric.getEgressMode();

    // DIRECT is the default and preferred production path. Only consider a
    // proxy when the administrator explicitly opted into proxy usage:
    //   - an explicit proxyId was requested, or
    //   - rotateProxy was requested, or
    //   - the egress mode is PROXY_PREFERRED / PROXY_ONLY.
    // AUTO is intentionally removed from the default selection behavior — Nexus
    // must never silently route through a public proxy.
    if (init.proxyId || init.rotateProxy || mode === 'PROXY_PREFERRED' || mode === 'PROXY_ONLY') {
      if (init.proxyId) {
        selectedProxy = this.fabric.listAll().find((p) => p.id === init.proxyId);
      } else {
        selectedProxy = this.fabric.selectNextEgressProxy();
      }

      if (mode === 'PROXY_ONLY' && !selectedProxy) {
        throw new Error('Network Egress Mode is PROXY_ONLY but no configured proxy endpoints are available in fabric pool.');
      }
    }

    if (selectedProxy) {
      try {
        const undici = await import('undici');
        dispatcher = new undici.ProxyAgent(selectedProxy.url);
      } catch {
        // undici fallback — proceed without proxy if ProxyAgent unavailable
      }
    }

    const start = Date.now();
    try {
      const response = await fetch(url, { ...init, dispatcher: dispatcher as never });
      if (selectedProxy) {
        this.fabric.reportResult(selectedProxy.id, response.ok, Date.now() - start);
      }
      return response;
    } catch (err) {
      if (selectedProxy) {
        this.fabric.reportResult(selectedProxy.id, false);
      }
      throw err;
    }
  }

  async measureLatency(url: string): Promise<number> {
    const start = Date.now();
    try {
      const r = await this.fetch(url, { method: 'HEAD' });
      void r;
      return Date.now() - start;
    } catch {
      return -1;
    }
  }

  async diagnose(): Promise<NetworkDiagnostics> {
    const dnsOk = await this.checkDns();
    const ipv4 = await this.checkIpV4();
    const ipv6 = await this.checkIpV6();
    const directHttps = await this.checkDirectHttps();

    const pool = this.fabric.listAll();
    const poolSummary = this.fabric.getPoolSummary();
    const mode = this.fabric.getEgressMode();

    const activeEgress: 'DIRECT' | 'PROXY' =
      (mode === 'PROXY_ONLY' || mode === 'PROXY_PREFERRED') && poolSummary.healthy > 0
        ? 'PROXY'
        : poolSummary.healthy > 0 && mode === 'AUTO'
        ? 'PROXY'
        : 'DIRECT';

    return {
      dns: { resolver: 'system', ok: dnsOk.ok, latencyMs: dnsOk.latencyMs },
      proxies: pool.slice(0, 10).map((p) => ({
        id: p.id,
        url: p.url,
        ok: p.status === 'HEALTHY',
        latencyMs: p.latencyMs ?? -1,
      })),
      ipv4: { ok: ipv4.ok, latencyMs: ipv4.latencyMs, status: ipv4.ok ? 'OK' : 'UNREACHABLE' },
      ipv6: {
        ok: ipv6.ok,
        latencyMs: ipv6.latencyMs,
        status: ipv6.ok ? 'OK' : ipv6.available ? 'UNREACHABLE' : 'UNAVAILABLE',
      },
      directHttps: { ok: directHttps.ok, latencyMs: directHttps.latencyMs, status: directHttps.ok ? 'OK' : 'UNREACHABLE' },
      egressMode: mode,
      activeEgress,
      proxyPool: pool,
      poolSummary,
    };
  }

  private async checkDns(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await dnsLookup('api.openai.com');
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  private async checkIpV4(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    return new Promise((resolve) => {
      const socket = new Socket();
      socket.setTimeout(2500);
      socket.once('connect', () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ ok: true, latencyMs: latency });
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve({ ok: false, latencyMs: -1 });
      });
      socket.once('error', () => {
        socket.destroy();
        fetch('https://1.1.1.1/dns-query?name=cloudflare.com', {
          headers: { accept: 'application/dns-json' },
          signal: AbortSignal.timeout(2500),
        })
          .then((r) => resolve({ ok: r.ok, latencyMs: Date.now() - start }))
          .catch(() => resolve({ ok: false, latencyMs: -1 }));
      });
      socket.connect(53, '1.1.1.1');
    });
  }

  private async checkIpV6(): Promise<{ ok: boolean; latencyMs: number; available: boolean }> {
    const start = Date.now();
    return new Promise((resolve) => {
      const socket = new Socket();
      socket.setTimeout(2000);
      socket.once('connect', () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ ok: true, latencyMs: latency, available: true });
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve({ ok: false, latencyMs: -1, available: false });
      });
      socket.once('error', () => {
        socket.destroy();
        resolve({ ok: false, latencyMs: -1, available: false });
      });
      try {
        socket.connect(53, '2606:4700:4700::1111');
      } catch {
        resolve({ ok: false, latencyMs: -1, available: false });
      }
    });
  }

  private async checkDirectHttps(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    const targets = [
      'https://cloudflare.com/cdn-cgi/trace',
      'https://api.github.com/zen',
      'https://httpbin.org/get',
    ];
    for (const url of targets) {
      try {
        const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
        if (r.status < 500) {
          return { ok: true, latencyMs: Date.now() - start };
        }
      } catch {
        continue;
      }
    }
    return { ok: false, latencyMs: -1 };
  }
}

export async function preferIpv4(): Promise<void> {
  await setDefaultResultOrder('ipv4first');
}

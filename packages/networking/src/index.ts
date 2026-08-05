import { lookup as dnsLookup } from 'node:dns/promises';
import { setDefaultResultOrder } from 'node:dns/promises';

import type { NetworkDiagnostics, NetworkPort } from '@anx/core';

/**
 * Proxy descriptor. Supported schemes:
 *   - `http://` and `https://`  → HTTP CONNECT proxy
 *   - `socks5://` and `socks5h://` → SOCKS5 proxy (hostname resolution at proxy)
 *
 * Enterprise proxy auth: include credentials in the URL:
 *   `http://user:pass@proxy.corp:8080`
 */
export interface ProxyConfig {
  readonly id: string;
  readonly url: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly allowedHosts?: readonly string[]; // glob patterns
  readonly deniedHosts?: readonly string[];
}

/**
 * DNS-over-HTTPS resolver config.
 */
export interface DohConfig {
  readonly url: string; // e.g. https://cloudflare-dns.com/dns-query
  readonly enabled: boolean;
  readonly bootstrapServers?: readonly string[];
}

/**
 * Default networking implementation. Uses Node's fetch under the hood.
 *
 * NOTE: native Node fetch does not natively support HTTP/SOCKS5 proxies.
 * For full proxy support, install `undici` and pass a custom `dispatcher`.
 * This default implementation:
 *   - Honors `HTTPS_PROXY` / `HTTP_PROXY` env vars via undici's `ProxyAgent`
 *     if available.
 *   - Provides DoH lookup for diagnostics.
 *   - Provides latency measurement.
 *
 * The interface is stable — a future release will add native SOCKS5 support
 * without changing the API.
 */
export class DefaultNetworkService implements NetworkPort {
  private readonly proxies: ProxyConfig[];
  private readonly doh: DohConfig;

  constructor(opts: { proxies?: ProxyConfig[]; doh?: DohConfig } = {}) {
    this.proxies = opts.proxies ?? [];
    this.doh = opts.doh ?? {
      url: 'https://cloudflare-dns.com/dns-query',
      enabled: false,
    };
  }

  async fetch(url: string, init: RequestInit & { proxyId?: string } = {}): Promise<Response> {
    // Try undici ProxyAgent if installed; otherwise fall back to plain fetch.
    // We import lazily so the package doesn't hard-depend on undici.
    let dispatcher: unknown = undefined;
    try {
      const undici = await import('undici');
      const proxyUrl =
        init.proxyId != null
          ? this.proxies.find((p) => p.id === init.proxyId)?.url
          : process.env['HTTPS_PROXY'] ?? process.env['HTTP_PROXY'];
      if (proxyUrl) {
        dispatcher = new undici.ProxyAgent(proxyUrl);
      }
    } catch {
      // undici not installed — fall through.
    }
    return fetch(url, { ...init, dispatcher: dispatcher as never });
  }

  async measureLatency(url: string): Promise<number> {
    const start = Date.now();
    try {
      const r = await this.fetch(url, { method: 'HEAD' });
      // We don't care about the status — only that we got a response.
      void r;
      return Date.now() - start;
    } catch {
      return -1;
    }
  }

  async diagnose(): Promise<NetworkDiagnostics> {
    const dnsOk = await this.checkDns();
    const proxyChecks = await Promise.all(
      this.proxies.filter((p) => p.enabled).map(async (p) => ({
        id: p.id,
        url: p.url,
        ok: await this.checkProxy(p.url),
        latencyMs: await this.measureLatency('https://www.google.com'),
      })),
    );
    const ipv4 = await this.checkIp('https://1.1.1.1');
    const ipv6 = await this.checkIp('https://[2606:4700:4700::1111]');

    return {
      dns: { resolver: this.doh.enabled ? this.doh.url : 'system', ok: dnsOk.ok, latencyMs: dnsOk.latencyMs },
      proxies: proxyChecks,
      ipv4,
      ipv6,
    };
  }

  /**
   * Resolve a hostname using DoH (if enabled) or system DNS.
   */
  async resolveHost(hostname: string): Promise<string[]> {
    if (this.doh.enabled) {
      try {
        return await this.resolveViaDoh(hostname);
      } catch {
        // fall through to system DNS
      }
    }
    try {
      const records = await dnsLookup(hostname, { all: true });
      return records.map((r) => r.address);
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async checkDns(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.resolveHost('api.openai.com');
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  private async checkProxy(proxyUrl: string): Promise<boolean> {
    try {
      const undici = await import('undici');
      const agent = new undici.ProxyAgent(proxyUrl);
      const r = await fetch('https://api.openai.com', { dispatcher: agent as never, method: 'HEAD' });
      return r.status < 500;
    } catch {
      return false;
    }
  }

  private async checkIp(url: string): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const r = await fetch(url, { method: 'HEAD' });
      return { ok: r.status < 500, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: -1 };
    }
  }

  private async resolveViaDoh(hostname: string): Promise<string[]> {
    const url = `${this.doh.url}?name=${encodeURIComponent(hostname)}&type=A`;
    const r = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
    });
    if (!r.ok) throw new Error(`DoH lookup failed: ${r.status}`);
    const body = (await r.json()) as { Answer?: Array<{ data: string }> };
    return body.Answer?.map((a) => a.data) ?? [];
  }
}

/**
 * Configure Node's DNS resolver to prefer IPv4 (works around a common issue
 * where Node prefers AAAA records but the network only has IPv4).
 */
export async function preferIpv4(): Promise<void> {
  await setDefaultResultOrder('ipv4first');
}

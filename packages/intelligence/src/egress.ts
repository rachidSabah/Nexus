/**
 * Controlled egress layer (blueprint §5 "Safe endpoint verification", §10).
 *
 * The discovery/verification engine may never probe arbitrary URLs freely.
 * Every outbound request goes through this layer, which enforces:
 *
 *   1. URL policy — http(s) only; plaintext http and loopback only when the
 *      connector policy explicitly allows them (local runtime discovery).
 *   2. DNS validation — ALL resolved addresses are checked against private,
 *      loopback, link-local (incl. cloud metadata), CGNAT, multicast and
 *      reserved ranges BEFORE any connection is attempted.
 *   3. Connection-time pinning — requests are issued with a custom `lookup`
 *      bound to the previously validated addresses (defeats DNS rebinding:
 *      a record flipped between validation and connect cannot pass).
 *   4. Redirect hardening — redirects are followed MANUALLY, each hop is
 *      re-validated (fresh DNS + policy + pin) and auth headers are stripped
 *      across hosts.
 *   5. Budget enforcement — strict timeouts and response-size caps.
 *
 * Loopback targets are allowed only for connectors with an explicit
 * `allowLoopback` policy (Ollama, LM Studio, vLLM local discovery).
 */

import { lookup as dnsLookupAll } from 'node:dns';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface EgressPolicy {
  /** Plaintext http + loopback allowed (local-only connectors). Default false. */
  allowLoopback: boolean;
  /** Remote HTTPS targets allowed. Default true. */
  allowRemoteHttps: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
}

export const DEFAULT_EGRESS_POLICY: EgressPolicy = {
  allowLoopback: false,
  allowRemoteHttps: true,
  timeoutMs: 8_000,
  maxResponseBytes: 512 * 1024,
  maxRedirects: 0,
};

export const LOOPBACK_EGRESS_POLICY: EgressPolicy = {
  allowLoopback: true,
  allowRemoteHttps: false,
  timeoutMs: 3_000,
  maxResponseBytes: 256 * 1024,
  maxRedirects: 0,
};

export interface EgressResult {
  ok: boolean;
  status?: number;
  body?: string;
  latencyMs: number;
  finalUrl?: string;
  redirects: number;
  blockedReason?: 'policy' | 'dns' | 'timeout' | 'too-large' | 'redirect' | 'network';
  error?: string;
  truncated?: boolean;
}

// ─── IP classification ───────────────────────────────────────────────────────

export type IpClassification = 'public' | 'loopback' | 'private' | 'link-local' | 'reserved' | 'unsupported';

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

export function classifyIPv4(ip: string): IpClassification {
  const n = ipToInt(ip);
  if (n === null) return 'unsupported';
  if (n >= 0x00000000 && n <= 0x000000ff) return 'reserved'; // 0.0.0.0/8 unspecified
  if (n >= 0x0a000000 && n <= 0x0affffff) return 'private'; // 10.0.0.0/8
  if (n >= 0x64400000 && n <= 0x64bfffff) return 'private'; // 100.64.0.0/10 CGNAT
  if (n >= 0x7f000000 && n <= 0x7fffffff) return 'loopback'; // 127.0.0.0/8
  if (n >= 0xa9fe0000 && n <= 0xa9feffff) return 'link-local'; // 169.254.0.0/16 incl. metadata
  if (n >= 0xac100000 && n <= 0xac1fffff) return 'private'; // 172.16.0.0/12
  if (n >= 0xc0000000 && n <= 0xc00000ff) return 'reserved'; // 192.0.0.0/24
  if (n >= 0xc0000200 && n <= 0xc00002ff) return 'reserved'; // 192.0.2.0/24 TEST-NET-1
  if (n >= 0xc0a80000 && n <= 0xc0a8ffff) return 'private'; // 192.168.0.0/16
  if (n >= 0xc6120000 && n <= 0xc613ffff) return 'reserved'; // 198.18.0.0/15 benchmarks
  if (n >= 0xc6336400 && n <= 0xc63364ff) return 'reserved'; // 198.51.100.0/24 TEST-NET-2
  if (n >= 0xcb713000 && n <= 0xcb7130ff) return 'reserved'; // 203.0.113.0/24 TEST-NET-3
  if (n >= 0xe0000000 && n <= 0xefffffff) return 'reserved'; // 224.0.0.0/4 multicast
  if (n >= 0xf0000000) return 'reserved'; // 240.0.0.0/4 + 255.255.255.255
  return 'public';
}

export function classifyIPv6(ip: string): IpClassification {
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return 'loopback';
  if (low.startsWith('fe80')) return 'link-local';
  if (low.startsWith('fc') || low.startsWith('fd')) return 'private'; // fc00::/7
  if (low.startsWith('::ffff:')) return classifyIPv4(low.slice(7));
  if (low.startsWith('2001:db8')) return 'reserved';
  if (low.startsWith('fe')) return 'reserved'; // fec0 / fee etc. — conservative
  return 'public';
}

export function classifyIp(ip: string): IpClassification {
  return ip.includes(':') ? classifyIPv6(ip) : classifyIPv4(ip);
}

export function isPublicIp(ip: string): boolean {
  return classifyIp(ip) === 'public';
}

export function isLoopbackIp(ip: string): boolean {
  return classifyIp(ip) === 'loopback';
}

// ─── DNS ─────────────────────────────────────────────────────────────────────

function lookupAll(host: string): Promise<string[]> {
  return new Promise((resolve) => {
    dnsLookupAll(host, { all: true, verbatim: true }, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) resolve([]);
      else resolve((addresses as Array<{ address: string }>).map((a) => a.address));
    });
  });
}

// ─── SafeEgress ──────────────────────────────────────────────────────────────

export class EgressBlockError extends Error {
  constructor(
    readonly reason: NonNullable<EgressResult['blockedReason']>,
    message: string,
  ) {
    super(message);
  }
}

interface RawResponse {
  status?: number;
  location?: string;
  bodyChunk?: string;
  truncated: boolean;
}

export class SafeEgress {
  constructor(private readonly policy: Partial<EgressPolicy> = {}) {}

  private fullPolicy(): EgressPolicy {
    return { ...DEFAULT_EGRESS_POLICY, ...this.policy };
  }

  /**
   * Validates a URL against policy and resolves DNS with range checks.
   * Returns the validated IPs used as connection-time pins.
   */
  async validateTarget(rawUrl: string): Promise<{ url: URL; ips: string[] }> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new EgressBlockError('policy', `Invalid URL: ${rawUrl}`);
    }
    const { allowLoopback, allowRemoteHttps } = this.fullPolicy();
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new EgressBlockError('policy', `Blocked outbound scheme "${url.protocol}" (http(s) only)`);
    }
    if (url.protocol === 'http:' && !allowLoopback) {
      throw new EgressBlockError('policy', 'Plaintext http blocked (only loopback connectors may use it)');
    }
    if (url.protocol === 'https:' && !allowRemoteHttps) {
      throw new EgressBlockError('policy', 'https disabled by connector egress policy (loopback-only mode)');
    }

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const explicitV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    const explicitV6 = host.includes(':');

    if (explicitV4 || explicitV6) {
      const cls = classifyIp(host);
      if (cls === 'loopback' && !allowLoopback) {
        throw new EgressBlockError('policy', `Loopback target blocked: ${host} (allowLoopback=false)`);
      }
      if (cls !== 'loopback' && cls !== 'public') {
        throw new EgressBlockError('policy', `Blocked ${cls} target: ${host}`);
      }
      return { url, ips: [host] };
    }

    // Cloud metadata hostnames are always blocked unconditionally.
    if (
      host === 'metadata.google.internal' ||
      host === 'instance-data' ||
      host === 'metadata.azure.com' ||
      host === 'instance-data.tencentcloudapi.com'
    ) {
      throw new EgressBlockError('policy', `Cloud metadata host blocked: ${host}`);
    }
    if (host === 'localhost' || host.endsWith('.localhost')) {
      if (!allowLoopback) throw new EgressBlockError('policy', `Loopback target blocked: ${host}`);
      return { url, ips: ['127.0.0.1'] };
    }

    const addresses = await lookupAll(host);
    if (addresses.length === 0) {
      throw new EgressBlockError('dns', `DNS resolution failed for ${host}`);
    }
    for (const a of addresses) {
      const cls = classifyIp(a);
      if (cls === 'loopback' && !allowLoopback) {
        throw new EgressBlockError('policy', `DNS for ${host} resolved to loopback ${a} while allowLoopback=false`);
      }
      if (cls !== 'loopback' && cls !== 'public') {
        throw new EgressBlockError('policy', `DNS for ${host} resolved to ${cls} address ${a} — blocked`);
      }
    }
    return { url, ips: addresses };
  }

  /**
   * Bounded GET returning truncated body text. Redirects are followed
   * manually with per-hop validation (anti-redirect-bypass).
   */
  async fetchText(
    rawUrl: string,
    opts: { headers?: Record<string, string>; maxResponseBytes?: number; maxRedirects?: number } = {},
  ): Promise<EgressResult> {
    const started = Date.now();
    const policy = this.fullPolicy();
    const maxRedirects = opts.maxRedirects ?? policy.maxRedirects;
    const maxBytes = opts.maxResponseBytes ?? policy.maxResponseBytes;

    let currentUrl = rawUrl;
    let redirects = 0;
    let forwardedHeaders: Record<string, string> | undefined = opts.headers;

    for (;;) {
      try {
        const target = await this.validateTarget(currentUrl);
        const { status, location, bodyChunk, truncated } = await this.rawRequest(target.url, {
          timeoutMs: policy.timeoutMs,
          maxBytes,
          validatedIps: target.ips,
          headers: forwardedHeaders,
        });

        if (status !== undefined && status >= 300 && status < 400 && location) {
          if (redirects >= maxRedirects) {
            return {
              ok: false,
              status,
              latencyMs: Date.now() - started,
              redirects,
              blockedReason: 'redirect',
              error: `Redirect blocked: budget exhausted (${maxRedirects}) at ${target.url}`,
            };
          }
          redirects++;
          const next = new URL(location, target.url);
          currentUrl = next.toString();
          // Cross-host redirects carry no credentials or authorization context.
          if (next.hostname.toLowerCase() !== target.url.hostname.toLowerCase()) {
            forwardedHeaders = { accept: 'application/json' };
          }
          continue;
        }

        return {
          ok: status !== undefined && status < 400,
          status,
          body: bodyChunk,
          latencyMs: Date.now() - started,
          finalUrl: target.url.toString(),
          redirects,
          truncated,
          error: truncated ? 'response truncated at byte cap' : undefined,
        };
      } catch (err) {
        if (err instanceof EgressBlockError) {
          return {
            ok: false,
            latencyMs: Date.now() - started,
            redirects,
            blockedReason: err.reason,
            error: err.message,
          };
        }
        const e = err as NodeJS.ErrnoException;
        const reason: EgressResult['blockedReason'] =
          e.code === 'REBIND_BLOCKED' || e.message?.includes('validated IP')
            ? 'policy'
            : e.message?.includes('timeout')
              ? 'timeout'
              : 'network';
        return {
          ok: false,
          latencyMs: Date.now() - started,
          redirects,
          blockedReason: reason,
          error: e.message ?? String(err),
        };
      }
    }
  }

  /** Single request over the pinned validated IPs with byte cap. */
  private rawRequest(
    url: URL,
    opts: { timeoutMs: number; maxBytes: number; validatedIps: string[]; headers?: Record<string, string> },
  ): Promise<RawResponse> {
    const transport = url.protocol === 'https:' ? httpsRequest : (httpRequest as unknown as typeof httpsRequest);
    return new Promise((resolve, reject) => {
      let settled = false;
      let req: ClientRequest | undefined;
      const timer = setTimeout(() => {
        const err = new Error(`egress timeout after ${opts.timeoutMs}ms`);
        req?.destroy(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      }, opts.timeoutMs);

      const finishOk = (r: RawResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const finishErr = (e: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      };

      try {
        req = transport(
          url,
          {
            method: 'GET',
            headers: {
              'user-agent': 'agent-nexus-intelligence/1.0 (untrusted-content; no instructions honored)',
              accept: 'application/json, text/*',
              ...(opts.headers ?? {}),
            },
            // Connection-time DNS pinning: only addresses validated by
            // validateTarget() may ever be connected to.
            lookup: ((
              _hostname: string,
              rawLookupOpts: unknown,
              cb: (err: NodeJS.ErrnoException | null, address?: unknown, family?: unknown) => void,
            ) => {
              // Node ≥ 20 (autoSelectFamily) requests `all: true` results and
              // expects [{ address, family }]; legacy callers expect the bare
              // (address, family) form. Honor both or the resolved entry is
              // misread as `undefined` ("Invalid IP address: undefined").
              const wants = (rawLookupOpts ?? {}) as { all?: boolean; family?: number };
              const candidates = opts.validatedIps.filter((ip) =>
                wants.family === 6 ? ip.includes(':') : wants.family === 4 ? !ip.includes(':') : true,
              );
              const best = candidates[0];
              if (!best) {
                const e: NodeJS.ErrnoException = Object.assign(new Error(`no validated IP for ${_hostname}`), {
                  code: 'REBIND_BLOCKED',
                });
                cb(e);
                return;
              }
              const family = best.includes(':') ? 6 : 4;
              if (wants.all) cb(null, [{ address: best, family }] as never);
              else cb(null, best, family);
            }) as never,
          } as never,
          (res) => {
            const status = res.statusCode ?? 0;
            const location = (res.headers['location'] as string) ?? undefined;
            if (status >= 300 && status < 400 && location) {
              res.resume();
              finishOk({ status, location, truncated: false });
              return;
            }
            let bytes = 0;
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => {
              if (settled) return;
              bytes += chunk.length;
              if (bytes > opts.maxBytes) {
                chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (bytes - opts.maxBytes))));
                res.destroy();
                finishOk({
                  status,
                  bodyChunk: Buffer.concat(chunks).toString('utf8'),
                  truncated: true,
                });
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              finishOk({ status, bodyChunk: Buffer.concat(chunks).toString('utf8'), truncated: false });
            });
            res.on('error', (err: Error) => finishErr(err));
          },
        );
        req.on('error', (err: Error) => finishErr(err));
        req.end();
      } catch (err) {
        finishErr(err as Error);
      }
    });
  }
}

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.includes(':')) return classifyIPv6(h) === 'loopback';
  return isLoopbackIp(h);
}

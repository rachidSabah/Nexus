/**
 * SSRF guard (Phase 16 §8).
 *
 * Validates outbound provider/base URLs so Nexus cannot be used as an SSRF
 * relay to internal infrastructure. Nexus only ever connects to operator-
 * configured provider endpoints, but a poisoned config (or a future
 * user-supplied endpoint) must not reach:
 *   - loopback (127.0.0.0/8, ::1)
 *   - link-local (169.254.0.0/16 incl. cloud metadata 169.254.169.254)
 *   - private IPv4 (10/8, 172.16/12, 192.168/16)
 *   - unspecified (0.0.0.0)
 *
 * Public URLs are allowed. A configurable `allowPrivate` flag permits local
 * providers (Ollama) without weakening the default posture.
 */

export interface SsrfOptions {
  /** Allow link-local/private hosts (for local providers like Ollama). Default false. */
  allowPrivate?: boolean;
  /** Additional hostnames/IPs always permitted (e.g. "ollama"). */
  allowlist?: string[];
}

const METADATA_RANGES: Array<[number, number]> = [
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16 link-local + metadata (IMDS)
];

const PRIVATE_RANGES: Array<[number, number]> = [
  [0x7f000000, 0xff000000], // 127.0.0.0/8 loopback
  [0x0a000000, 0xff000000], // 10.0.0.0/8
  [0xac100000, 0xfff00000], // 172.16.0.0/12
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16
  [0x00000000, 0xff000000], // 0.0.0.0/8 unspecified
];

function ipv4ToInt(ip: string): number | null {
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

function isMetadataIp(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  for (const [net, mask] of METADATA_RANGES) {
    if (((n & mask) >>> 0) === net) return true;
  }
  return false;
}

function isPrivateIp(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // non-IPv4 (e.g. hostnames) handled by caller
  for (const [net, mask] of PRIVATE_RANGES) {
    if (((n & mask) >>> 0) === net) return true;
  }
  return false;
}

/** Parses a URL strictly; rejects non-http(s) schemes and missing hosts. */
export function isSsrfSafe(url: string, opts: SsrfOptions = {}): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;

  // Cloud metadata hosts are ALWAYS blocked unconditionally
  if (host === 'metadata.google.internal' || host === 'instance-data') return false;

  // IPv4 literals
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    // 169.254.0.0/16 (AWS/Azure/GCP metadata) is NEVER allowed under any circumstances
    if (isMetadataIp(host)) return false;
    if (isPrivateIp(host) && !opts.allowPrivate) return false;
    return true;
  }

  if (host === 'localhost' || host.endsWith('.localhost')) return !!opts.allowPrivate;
  if (host === '::1' || host === '0.0.0.0') return !!opts.allowPrivate;
  if (opts.allowlist?.includes(host)) return true;

  // IPv6 literal or hostname — defer to DNS at connection time; for explicit
  // IPv6 literals treat as private unless allowed
  if (host.includes(':')) return !!opts.allowPrivate;
  return true;
}

/** Throws if the URL is unsafe; used at config-load time. */
export function assertSsrfSafe(url: string, opts: SsrfOptions = {}): void {
  if (!isSsrfSafe(url, opts)) {
    throw new Error(`SSRF guard: refused outbound URL "${url}" (private/loopback/metadata target)`);
  }
}

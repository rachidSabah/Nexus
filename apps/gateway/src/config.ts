import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { McpServerConfig } from '@anx/mcp-client';
import type { ProxyConfig, DohConfig } from '@anx/networking';

/**
 * Gateway configuration shape. Loaded from `agent-nexus.config.json` (or
 * `.yaml` if you bring a YAML parser). Falls back to env vars for secrets.
 */
export interface GatewayConfig {
  readonly server: {
    readonly port: number;
    readonly host: string;
    readonly cors: { readonly origin: string | readonly string[]; readonly credentials: boolean };
    /** Optional version label advertised by the gateway (e.g. for the marketplace's compatibility checks). Defaults to the package version. */
    readonly versionLabel?: string;
  };
  readonly routing: {
    readonly strategy: string;
    readonly failureThreshold: number;
    readonly failureWindowMs: number;
    readonly cooldownMs: number;
    readonly maxFailovers: number;
  };
  readonly security: {
    readonly jwtSecret?: string;
    readonly vaultKey?: string;
    readonly vaultPath?: string;
    readonly principals?: Array<{ id: string; roles: string[]; apiKey?: string }>;
  };
  readonly network: {
    readonly proxies: ProxyConfig[];
    readonly doh: DohConfig;
  };
  readonly mcp: {
    readonly servers: McpServerConfig[];
  };
  readonly endpoints: Array<{
    readonly id: string;
    readonly providerId: string;
    readonly displayName: string;
    readonly baseUrl?: string;
    readonly apiKey?: string;
    readonly priority: number;
    readonly weight: number;
    readonly region?: string;
    readonly tags?: string[];
    readonly timeoutMs?: number;
    readonly maxRetries?: number;
    readonly concurrencyLimit?: number;
    readonly pricing?: { inputPer1K: number; outputPer1K: number; cachedInputPer1K?: number; currency: 'USD' | 'EUR' };
    readonly capabilities?: Record<string, unknown>;
  }>;
}

const DEFAULT_CONFIG: GatewayConfig = {
  server: {
    // Local-first security: default to loopback only. Set host to '0.0.0.0'
    // in agent-nexus.config.json (or via ANX_HOST env var) to expose the
    // gateway on the network.
    port: 8787,
    host: process.env['ANX_HOST'] ?? '127.0.0.1',
    cors: { origin: '*', credentials: false },
  },
  routing: {
    strategy: 'weighted',
    failureThreshold: 5,
    failureWindowMs: 60_000,
    cooldownMs: 30_000,
    maxFailovers: 3,
  },
  security: {
    principals: [
      { id: 'admin', roles: ['admin'], apiKey: process.env['ANX_ADMIN_API_KEY'] },
    ],
  },
  network: {
    proxies: [],
    doh: { url: 'https://cloudflare-dns.com/dns-query', enabled: false },
  },
  mcp: { servers: [] },
  endpoints: [],
};

export class ConfigLoader {
  static async load(path?: string): Promise<GatewayConfig> {
    const candidates = [
      path,
      process.env['ANX_CONFIG'],
      'agent-nexus.config.json',
      join(process.cwd(), 'agent-nexus.config.json'),
      '/etc/agent-nexus/config.json',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (!candidate || !existsSync(candidate)) continue;
      try {
        const raw = await readFile(candidate, 'utf8');
        const parsed = JSON.parse(raw) as Partial<GatewayConfig>;
        return mergeConfig(DEFAULT_CONFIG, parsed);
      } catch {
        continue;
      }
    }

    // No config file — use defaults, but allow env overrides.
    const envPort = process.env['PORT'] ? Number(process.env['PORT']) : undefined;
    if (envPort) {
      return mergeConfig(DEFAULT_CONFIG, { server: { ...DEFAULT_CONFIG.server, port: envPort } });
    }
    return DEFAULT_CONFIG;
  }
}

function mergeConfig(base: GatewayConfig, override: Partial<GatewayConfig>): GatewayConfig {
  return {
    server: { ...base.server, ...override.server },
    routing: { ...base.routing, ...override.routing },
    security: { ...base.security, ...override.security },
    network: { ...base.network, ...override.network },
    mcp: { ...base.mcp, ...override.mcp },
    endpoints: override.endpoints ?? base.endpoints,
  };
}

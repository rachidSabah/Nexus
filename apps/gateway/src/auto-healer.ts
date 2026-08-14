/**
 * AutoHealer — periodically re-probes provider endpoints and key health so the
 * gateway self-recovers from transient provider outages without operator action.
 *
 * It complements the KeyRegistry's per-request failure handling (429 → cooldown,
 * 401/403 → invalid) by *proactively recovering*:
 *   - Endpoints marked `unhealthy`/`circuit_open` are re-probed; if reachable
 *     again they are restored to `healthy` (circuit half-open recovery).
 *   - Keys in `cooldown` expire naturally (handled in KeyRegistry.select), but
 *     keys marked `invalid` (e.g. a 401 that may have been a transient auth
 *     blip or a key the operator just fixed) are re-probed against a reachable
 *     endpoint for their provider and reset to `active` when the endpoint is up
 *     and the key still resolves from the vault.
 *
 * This is the "auto healer for provider API" behaviour: sustained failures heal
 * on their own once the upstream recovers, and an operator-corrected key/credential
 * is picked back up without a restart.
 */

import type { RoutingEnginePort, KeyRegistry, ProviderEndpoint } from '@anx/core';

export interface AutoHealerOptions {
  /** Interval between heal passes, in ms. Default: 30_000. */
  intervalMs?: number;
  /** Base URL probe timeout, in ms. Default: 4_000. */
  probeTimeoutMs?: number;
}

export class AutoHealer {
  private readonly routing: RoutingEnginePort;
  private readonly keyRegistry: KeyRegistry;
  private readonly intervalMs: number;
  private readonly probeTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(routing: RoutingEnginePort, keyRegistry: KeyRegistry, opts: AutoHealerOptions = {}) {
    this.routing = routing;
    this.keyRegistry = keyRegistry;
    this.intervalMs = opts.intervalMs ?? 30_000;
    this.probeTimeoutMs = opts.probeTimeoutMs ?? 4_000;
  }

  /** Probes a base URL; any non-5xx response counts as reachable. */
  async probe(baseUrl: string): Promise<boolean> {
    if (!baseUrl) return false;
    try {
      const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        signal: AbortSignal.timeout(this.probeTimeoutMs),
      });
      return r.status < 500;
    } catch {
      return false;
    }
  }

  /** Runs a single heal pass over all endpoints and invalid keys. */
  async healOnce(): Promise<{ endpointsHealed: number; keysHealed: number }> {
    let endpointsHealed = 0;
    let keysHealed = 0;

    for (const endpoint of this.routing.listEndpoints() as readonly ProviderEndpoint[]) {
      if (endpoint.health === 'healthy') continue;
      const reachable = await this.probe(endpoint.baseUrl);
      if (reachable) {
        this.routing.updateEndpoint(endpoint.id, { health: 'healthy' });
        endpointsHealed++;
      }
    }

    for (const key of this.keyRegistry.listAll()) {
      if (key.status !== 'invalid') continue;
      // Only attempt recovery if a representative endpoint for the provider is up.
      const endpoint = (this.routing.listEndpoints() as readonly ProviderEndpoint[]).find(
        (e) => e.providerId === key.providerId,
      );
      if (!endpoint) continue;
      const reachable = await this.probe(endpoint.baseUrl);
      // If the endpoint is reachable and the key still resolves from the vault,
      // assume the credential is valid again and restore it to rotation.
      const plaintext = await this.keyRegistry.getPlaintext(key.id);
      if (reachable && plaintext) {
        this.keyRegistry.reset(key.id);
        keysHealed++;
      }
    }

    return { endpointsHealed, keysHealed };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.healOnce().catch(() => {
        /* swallow — next pass retries */
      });
    }, this.intervalMs);
    // Don't keep the event loop alive solely for the healer.
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

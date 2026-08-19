/**
 * Pure routing-utilization metrics aggregation (master prompt #20 / #21).
 *
 * Everything returned here is *derived* from real registry state — per-provider
 * key health and free-model availability. No synthetic or fake quota numbers are
 * ever invented: when the upstream has not exposed rate-limit data we report the
 * count as 0 and the per-key 429 rate as the literal string 'UNKNOWN' (never a
 * fabricated 0.0), consistent with the system's honesty contract.
 */

export interface RoutingMetricsProvider {
  /** Returns every registered key descriptor (with status + counters). */
  listAll?: () => ReadonlyArray<KeyLike>;
}

export interface KeyLike {
  providerId: string;
  status: 'active' | 'cooldown' | 'invalid' | string;
  rateLimitedCount?: number;
  requests?: number;
  errors?: number;
}

export interface FreeModelLike {
  providerId: string;
}

export interface RateLimitTrackerLike {
  getAll?: () => Record<string, unknown>;
}

export interface ProviderMetrics {
  providerId: string;
  totalKeys: number;
  active: number;
  cooldown: number;
  invalid: number;
  rateLimitedTotal: number;
  requestsTotal: number;
  errorsTotal: number;
  freeModels: number;
  /** 'UNKNOWN' when no requests have been recorded (never fabricated). */
  rateLimitRate: number | 'UNKNOWN';
}

export interface RoutingMetrics {
  providers: ProviderMetrics[];
  totals: {
    providers: number;
    totalKeys: number;
    active: number;
    cooldown: number;
    invalid: number;
    freeModels: number;
  };
  rateLimitsTracked: number;
}

export function computeRoutingMetrics(
  keyRegistry: RoutingMetricsProvider | undefined,
  freeModels: ReadonlyArray<FreeModelLike>,
  rateLimitTracker: RateLimitTrackerLike | undefined,
): RoutingMetrics {
  const keys = keyRegistry?.listAll?.() ?? [];
  const perProvider = new Map<string, Omit<ProviderMetrics, 'freeModels' | 'rateLimitRate'>>();

  for (const k of keys) {
    const agg =
      perProvider.get(k.providerId) ?? {
        providerId: k.providerId,
        totalKeys: 0,
        active: 0,
        cooldown: 0,
        invalid: 0,
        rateLimitedTotal: 0,
        requestsTotal: 0,
        errorsTotal: 0,
      };
    agg.totalKeys++;
    if (k.status === 'active') agg.active++;
    else if (k.status === 'cooldown') agg.cooldown++;
    else if (k.status === 'invalid') agg.invalid++;
    agg.rateLimitedTotal += k.rateLimitedCount ?? 0;
    agg.requestsTotal += k.requests ?? 0;
    agg.errorsTotal += k.errors ?? 0;
    perProvider.set(k.providerId, agg);
  }

  const freeByProvider = new Map<string, number>();
  for (const m of freeModels) {
    freeByProvider.set(m.providerId, (freeByProvider.get(m.providerId) ?? 0) + 1);
  }

  const providers: ProviderMetrics[] = Array.from(perProvider.values()).map((p) => ({
    ...p,
    freeModels: freeByProvider.get(p.providerId) ?? 0,
    rateLimitRate:
      p.requestsTotal > 0 ? Number((p.rateLimitedTotal / p.requestsTotal).toFixed(4)) : 'UNKNOWN',
  }));

  const rateLimitsTracked = rateLimitTracker?.getAll
    ? Object.keys(rateLimitTracker.getAll()).length
    : 0;

  return {
    providers,
    totals: {
      providers: providers.length,
      totalKeys: keys.length,
      active: providers.reduce((s, p) => s + p.active, 0),
      cooldown: providers.reduce((s, p) => s + p.cooldown, 0),
      invalid: providers.reduce((s, p) => s + p.invalid, 0),
      freeModels: freeModels.length,
    },
    rateLimitsTracked,
  };
}

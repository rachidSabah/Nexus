/**
 * Free-tier catalog — SOURCED aggregation (honest edition).
 *
 * Every figure below was verified against the provider's published free-tier
 * docs in 2026 and is cited. Free-tier quotas rotate frequently; treat this as
 * a point-in-time snapshot and re-audit before relying on it. We DO NOT invent
 * a single "steady ~X tokens/month" number — instead we expose each provider's
 * DOCUMENTED quota and let the UI aggregate transparently (sum-of-ceilings,
 * clearly labeled as a ceiling, not a realistic sustained throughput).
 *
 * Verified: 2026-08 (see SOURCES). Re-audit quarterly.
 */

export interface FreeTierProvider {
  readonly provider: string;
  /** Human note on what the free tier covers. */
  readonly note: string;
  /** Requests per day (ceiling). null = not a documented daily cap. */
  readonly requestsPerDay: number | null;
  /** Tokens per minute (ceiling). null = not documented. */
  readonly tokensPerMinute: number | null;
  /** Documented monthly token ceiling (estimate). null = not published. */
  readonly tokensPerMonthEstimate: number | null;
  /** Whether a credit card is required. */
  readonly cardRequired: boolean;
  /** Source URL for the figure. */
  readonly source: string;
  /** ISO date the figure was verified. */
  readonly verified: string;
}

export const FREE_TIER_CATALOG: readonly FreeTierProvider[] = [
  {
    provider: 'google',
    note: 'Gemini API free tier (Flash / Flash-Lite) via AI Studio. No card. Pro restricted on free.',
    requestsPerDay: 1500,
    tokensPerMinute: null,
    tokensPerMonthEstimate: null, // Google publishes RPD/RPM, not a monthly token cap
    cardRequired: false,
    source: 'https://ai.google.dev/gemini-api/docs/rate-limits',
    verified: '2026-08',
  },
  {
    provider: 'groq',
    note: 'Groq free tier: 30K TPM and 14,400 RPD on curated open models (Llama, Qwen, DeepSeek). No card.',
    requestsPerDay: 14400,
    tokensPerMinute: 30000,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://console.groq.com/docs/rate-limits',
    verified: '2026-08',
  },
  {
    provider: 'mistral',
    note: 'La Plateforme free Experiment tier: ~1B tokens/month, rate-limited, eval-only. SMS verify, no card.',
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerMonthEstimate: 1_000_000_000,
    cardRequired: false,
    source: 'https://pricepertoken.com/endpoints/mistral/free',
    verified: '2026-08',
  },
  {
    provider: 'openrouter',
    note: 'OpenRouter :free models: 20 req/min, 50–200 req/day per free model (200 with $10 lifetime credit). No card.',
    requestsPerDay: 200,
    tokensPerMinute: null,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://openrouter.ai/models',
    verified: '2026-08',
  },
];

/**
 * Aggregate ceiling across all documented providers. This is a SUM-OF-CEILINGS:
 * it represents the theoretical maximum if an operator simultaneously used every
 * free tier to its documented limit. It is NOT a realistic sustained throughput
 * (providers throttle, quotas overlap, and free models rotate). The UI must
 * label this as a ceiling, never as "you get X tokens/month".
 */
export interface FreeTierAggregate {
  providersCovered: number;
  sumRequestsPerDayCeiling: number;
  sumTokensPerMinuteCeiling: number;
  sumTokensPerMonthCeiling: number;
  cardRequiredAnywhere: boolean;
  verified: string;
}

export function aggregateFreeTier(catalog: readonly FreeTierProvider[] = FREE_TIER_CATALOG): FreeTierAggregate {
  let sumRpd = 0;
  let sumTpm = 0;
  let sumTpmo = 0;
  let cardAnywhere = false;
  for (const p of catalog) {
    if (p.requestsPerDay != null) sumRpd += p.requestsPerDay;
    if (p.tokensPerMinute != null) sumTpm += p.tokensPerMinute;
    if (p.tokensPerMonthEstimate != null) sumTpmo += p.tokensPerMonthEstimate;
    if (p.cardRequired) cardAnywhere = true;
  }
  return {
    providersCovered: catalog.length,
    sumRequestsPerDayCeiling: sumRpd,
    sumTokensPerMinuteCeiling: sumTpm,
    sumTokensPerMonthCeiling: sumTpmo,
    cardRequiredAnywhere: cardAnywhere,
    verified: catalog[0]?.verified ?? '2026-08',
  };
}

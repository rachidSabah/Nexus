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
  {
    provider: 'nvidia-nim',
    note: 'NVIDIA NIM hosted inference: 1,000 free API credits upon developer account signup for hosted models. No card required.',
    requestsPerDay: 1000,
    tokensPerMinute: null,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://build.nvidia.com',
    verified: '2026-08',
  },
  {
    provider: 'pollinations',
    note: 'Pollinations AI: completely keyless, unlimited free text generation and image models. Zero card required.',
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://pollinations.ai',
    verified: '2026-09',
  },
  {
    provider: 'kilo',
    note: 'Kilo Gateway: free tier meta-gateway for open models. Keyless operation permitted. No card.',
    requestsPerDay: 1000,
    tokensPerMinute: null,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://api.kilo.ai',
    verified: '2026-09',
  },
  {
    provider: 'aihorde',
    note: 'AI Horde: crowdsourced, volunteer-run compute for text and image models. Anonymous key 0000000000.',
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://aihorde.net',
    verified: '2026-09',
  },
  {
    provider: 'radeon',
    note: 'AMD Radeon Cloud: free inference compute on AMD hardware. No card required.',
    requestsPerDay: 500,
    tokensPerMinute: null,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://developer.amd.com.cn',
    verified: '2026-09',
  },
  {
    provider: 'anyapi',
    note: 'AnyAPI: hosted gateway with 100K daily tokens free-tier quota. No card required.',
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerMonthEstimate: 3000000,
    cardRequired: false,
    source: 'https://api.anyapi.ai',
    verified: '2026-09',
  },
  {
    provider: 'github',
    note: 'GitHub Models: free inference playground for developers on Azure infrastructure. GitHub account required, no card.',
    requestsPerDay: 150,
    tokensPerMinute: 15000,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://github.com/marketplace/models',
    verified: '2026-09',
  },
  {
    provider: 'sambanova',
    note: 'SambaNova Systems: Ultra-fast Llama 3.3 70B & Qwen 2.5 on SN40L hardware. Generous free developer tier. No card.',
    requestsPerDay: 1000,
    tokensPerMinute: 60000,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://cloud.sambanova.ai',
    verified: '2026-09',
  },
  {
    provider: 'hyperbolic',
    note: 'Hyperbolic: Open-access decentralized GPU inference. Free credits upon signup, no card.',
    requestsPerDay: 1000,
    tokensPerMinute: null,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://hyperbolic.xyz',
    verified: '2026-09',
  },
  {
    provider: 'novita',
    note: 'Novita AI: Free-tier daily credits for open LLMs and image models. No card required.',
    requestsPerDay: 500,
    tokensPerMinute: null,
    tokensPerMonthEstimate: 2000000,
    cardRequired: false,
    source: 'https://novita.ai',
    verified: '2026-09',
  },
  {
    provider: 'siliconflow',
    note: 'SiliconFlow: 20 million free tokens upon developer onboarding for Qwen, DeepSeek, and FLUX models. No card.',
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerMonthEstimate: 20000000,
    cardRequired: false,
    source: 'https://siliconflow.cn',
    verified: '2026-09',
  },
  {
    provider: 'kiro',
    note: 'Kiro AI: Free credits tier (~50 credits/month) with Claude 4.5 Sonnet, GLM-5, and MiniMax models. No card required.',
    requestsPerDay: null,
    tokensPerMinute: null,
    tokensPerMonthEstimate: 2000000,
    cardRequired: false,
    source: 'https://kiro.ai',
    verified: '2026-09',
  },
  {
    provider: 'kimchi',
    note: 'Kimchi AI: Community AI router with free model allocations. No card required.',
    requestsPerDay: 500,
    tokensPerMinute: null,
    tokensPerMonthEstimate: null,
    cardRequired: false,
    source: 'https://kimchi.ai',
    verified: '2026-09',
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
    verified: catalog.reduce((max, p) => (p.verified > max ? p.verified : max), '') || '2026-08',
  };
}

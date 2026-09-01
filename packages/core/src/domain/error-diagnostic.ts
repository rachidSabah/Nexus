/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Provider Error Diagnostic Domain Types & Deterministic Classifier
 * ───────────────────────────────────────────────────────────────────────────
 */

export type ErrorCategory =
  | 'AUTHENTICATION_FAILURE'
  | 'AUTHORIZATION_FAILURE'
  | 'MODEL_OR_ENDPOINT_NOT_FOUND'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'UPSTREAM_SERVER_ERROR'
  | 'NETWORK_FAILURE'
  | 'UPSTREAM_TIMEOUT'
  | 'INVALID_UPSTREAM_RESPONSE'
  | 'BILLING_QUOTA_EXHAUSTED'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'UNKNOWN_PROVIDER_ERROR';

export type ErrorScope =
  | 'KEY_FAILURE'
  | 'MODEL_FAILURE'
  | 'PROVIDER_FAILURE'
  | 'ROUTE_FAILURE';

export type ErrorTransience =
  | 'TRANSIENT_FAILURE'
  | 'PERMANENT_FAILURE';

export interface ProviderErrorDiagnostic {
  readonly id: string;
  readonly providerId: string;
  readonly providerDisplayName?: string;
  readonly modelId?: string;
  readonly keyId?: string;
  readonly maskedKey?: string;
  readonly category: ErrorCategory;
  readonly scope: ErrorScope;
  readonly transience: ErrorTransience;
  readonly httpStatus?: number;
  readonly upstreamCode?: string;
  readonly upstreamMessage?: string;
  readonly timestamp: number;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  occurrenceCount: number;
  consecutiveFailures: number;
  cooldownUntil?: number;
  circuitBreakerState?: 'closed' | 'open' | 'half_open';
  latencyMs?: number;
  requestId?: string;
  correlationId?: string;
  routeUsed?: string;
  fallbackRoute?: string;
  keyPoisonedSuspected: boolean;
  modelUnavailableSuspected: boolean;
  providerUnavailableSuspected: boolean;
  authFailure: boolean;
  rateLimitFailure: boolean;
  temporary: boolean;
  automaticRecoveryPossible: boolean;
  likelyCause: string;
  recommendedAction: string;
  resolved: boolean;
  resolvedAt?: number;
  resolutionAction?: string;
  lastVerificationResult?: {
    verified: boolean;
    timestamp: number;
    latencyMs?: number;
    message: string;
  };
}

export interface ClassifyErrorInput {
  providerId: string;
  providerDisplayName?: string;
  modelId?: string;
  keyId?: string;
  maskedKey?: string;
  error: unknown;
  status?: number;
  code?: string;
  latencyMs?: number;
  requestId?: string;
  correlationId?: string;
  routeUsed?: string;
  circuitBreakerState?: 'closed' | 'open' | 'half_open';
  cooldownUntil?: number;
  retryAfterMs?: number;
}

/**
 * Safely masks an API key string (e.g. "sk-example-key-placeholder" -> "••••lder" or "sk-••••••lder").
 * Never returns plaintext.
 */
export function maskKeyString(key?: string): string {
  if (!key) return '••••';
  const clean = key.trim();
  if (clean.length <= 4) return '••••';
  const lastFour = clean.slice(-4);
  if (clean.startsWith('sk-')) {
    return `sk-••••••${lastFour}`;
  }
  return `••••${lastFour}`;
}

/**
 * Deterministically classifies an error into a structured diagnostic object.
 */
export function classifyErrorDiagnostic(input: ClassifyErrorInput): ProviderErrorDiagnostic {
  const err = input.error;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const status =
    input.status ??
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;
  const code =
    input.code ??
    (err as { code?: string })?.code;

  const retryMs =
    input.retryAfterMs ??
    (err as { retryAfterMs?: number })?.retryAfterMs ??
    (typeof (err as { retryAfter?: unknown })?.retryAfter === 'number'
      ? (err as { retryAfter: number }).retryAfter * 1000
      : undefined);

  let category: ErrorCategory = 'UNKNOWN_PROVIDER_ERROR';
  let scope: ErrorScope = 'PROVIDER_FAILURE';
  let transience: ErrorTransience = 'TRANSIENT_FAILURE';
  let likelyCause = 'Unknown upstream provider error';
  let recommendedAction = 'Inspect provider logs and retry';
  let authFailure = false;
  let rateLimitFailure = false;
  let temporary = true;
  let automaticRecoveryPossible = true;

  // 1. Authentication failures (401)
  if (
    status === 401 ||
    code === 'invalid_api_key' ||
    code === 'INVALID_API_KEY' ||
    code === 'AUTH_ERROR' ||
    /invalid.*api[ _-]?key|unauthorized|incorrect api key|authentication failure/i.test(msg)
  ) {
    category = 'AUTHENTICATION_FAILURE';
    scope = input.keyId ? 'KEY_FAILURE' : 'PROVIDER_FAILURE';
    transience = 'PERMANENT_FAILURE';
    authFailure = true;
    temporary = false;
    likelyCause = 'Invalid, expired, or missing API credential for this provider.';
    recommendedAction = 'Rotate to a valid API key or update the credential in Key Vault.';
    automaticRecoveryPossible = true;
  }
  // 2. Authorization failures (403)
  else if (
    status === 403 ||
    code === 'forbidden' ||
    code === 'permission_denied' ||
    /forbidden|permission denied|access denied|not authorized/i.test(msg)
  ) {
    category = 'AUTHORIZATION_FAILURE';
    scope = input.keyId ? 'KEY_FAILURE' : 'PROVIDER_FAILURE';
    transience = 'PERMANENT_FAILURE';
    authFailure = true;
    temporary = false;
    likelyCause = 'API credential lacks permission to access the requested model or feature.';
    recommendedAction = 'Verify provider account permissions and plan tier.';
    automaticRecoveryPossible = true;
  }
  // 3. Model or Endpoint Not Found (404 / 410)
  else if (
    status === 404 ||
    status === 410 ||
    code === 'model_not_found' ||
    code === 'MODEL_UNAVAILABLE' ||
    /model.*not found|does not exist|invalid model|unsupported model|endpoint not found/i.test(msg)
  ) {
    category = 'MODEL_OR_ENDPOINT_NOT_FOUND';
    scope = input.modelId ? 'MODEL_FAILURE' : 'ROUTE_FAILURE';
    transience = 'PERMANENT_FAILURE';
    temporary = false;
    likelyCause = 'The requested model ID is not served by this provider endpoint or has been retired.';
    recommendedAction = 'Refresh model discovery catalog and rebind model alias.';
    automaticRecoveryPossible = true;
  }
  // 4. Rate Limits (429)
  else if (
    status === 429 ||
    code === 'rate_limit_exceeded' ||
    code === 'RATE_LIMIT' ||
    /rate limit|too many requests|quota exceeded|tpm limit|rpm limit/i.test(msg)
  ) {
    category = 'RATE_LIMIT';
    scope = input.keyId ? 'KEY_FAILURE' : 'PROVIDER_FAILURE';
    transience = 'TRANSIENT_FAILURE';
    rateLimitFailure = true;
    temporary = true;
    likelyCause = retryMs && retryMs > 0
      ? `Upstream provider rate limit exceeded. Retry-After cooldown active (${Math.ceil(retryMs / 1000)}s).`
      : 'Upstream provider rate limit (requests per minute or tokens per minute) exceeded.';
    recommendedAction = retryMs && retryMs > 0
      ? `Wait ${Math.ceil(retryMs / 1000)}s for Retry-After window to expire, or rotate to an alternate active key.`
      : 'Rotate to an alternate active key or backoff until cooldown expires.';
    automaticRecoveryPossible = true;
  }
  // 5. Billing / Quota Exhaustion (402)
  else if (
    status === 402 ||
    code === 'insufficient_quota' ||
    code === 'CREDITS_EXHAUSTED' ||
    /insufficient quota|credit balance|billing|payment required/i.test(msg)
  ) {
    category = 'BILLING_QUOTA_EXHAUSTED';
    scope = 'PROVIDER_FAILURE';
    transience = 'PERMANENT_FAILURE';
    temporary = false;
    likelyCause = 'Account balance or free quota for this provider account is depleted.';
    recommendedAction = 'Top up account credits or switch to an alternate free provider.';
    automaticRecoveryPossible = false;
  }
  // 6. Context Window Exceeded (413 / 400 context)
  else if (
    status === 413 ||
    code === 'context_length_exceeded' ||
    /context[_ ]?length|maximum context|token limit/i.test(msg)
  ) {
    category = 'CONTEXT_LENGTH_EXCEEDED';
    scope = 'MODEL_FAILURE';
    transience = 'TRANSIENT_FAILURE';
    temporary = true;
    likelyCause = 'Prompt token count exceeds the maximum context window supported by this model.';
    recommendedAction = 'Enable Nexus prompt compression or route to a larger-context model.';
    automaticRecoveryPossible = true;
  }
  // 7. Timeouts (408 / 504 / ETIMEDOUT)
  else if (
    status === 408 ||
    status === 504 ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    /timeout|timed out|abort/i.test(msg)
  ) {
    category = status === 408 ? 'TIMEOUT' : 'UPSTREAM_TIMEOUT';
    scope = 'PROVIDER_FAILURE';
    transience = 'TRANSIENT_FAILURE';
    temporary = true;
    likelyCause = 'Upstream provider did not respond within the configured request timeout.';
    recommendedAction = 'Verify provider endpoint latency and retry with backoff.';
    automaticRecoveryPossible = true;
  }
  // 8. Network Failures (ECONNREFUSED, ENOTFOUND, ECONNRESET)
  else if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'EAI_AGAIN' ||
    /fetch failed|network error|connection refused|dns/i.test(msg)
  ) {
    category = 'NETWORK_FAILURE';
    scope = 'PROVIDER_FAILURE';
    transience = 'TRANSIENT_FAILURE';
    temporary = true;
    likelyCause = 'Network connectivity issue or unresolvable endpoint host.';
    recommendedAction = 'Verify provider baseUrl, DNS, and local proxy configuration.';
    automaticRecoveryPossible = true;
  }
  // 9. Upstream Server Errors (500, 502, 503)
  else if (status && status >= 500 && status <= 599) {
    category = 'UPSTREAM_SERVER_ERROR';
    scope = 'PROVIDER_FAILURE';
    transience = 'TRANSIENT_FAILURE';
    temporary = true;
    likelyCause = `Upstream provider server error (HTTP ${status}).`;
    recommendedAction = 'Circuit breaker will isolate the endpoint until upstream stabilizes.';
    automaticRecoveryPossible = true;
  }
  // 10. Invalid Response
  else if (/non-json|unexpected token|malformed response/i.test(msg)) {
    category = 'INVALID_UPSTREAM_RESPONSE';
    scope = 'PROVIDER_FAILURE';
    transience = 'TRANSIENT_FAILURE';
    temporary = true;
    likelyCause = 'Upstream provider returned an invalid HTML or unparseable response.';
    recommendedAction = 'Verify provider endpoint URL and format compatibility.';
    automaticRecoveryPossible = true;
  }

  const now = Date.now();
  const id = `diag-${input.providerId}${input.keyId ? `-${input.keyId}` : ''}${input.modelId ? `-${input.modelId.replace(/[^a-zA-Z0-9_-]/g, '_')}` : ''}-${category.toLowerCase()}`;

  const computedCooldownUntil = input.cooldownUntil ?? (retryMs && retryMs > 0 ? now + retryMs : 0);

  return {
    id,
    providerId: input.providerId,
    providerDisplayName: input.providerDisplayName ?? input.providerId,
    modelId: input.modelId,
    keyId: input.keyId,
    maskedKey: input.maskedKey,
    category,
    scope,
    transience,
    httpStatus: status,
    upstreamCode: code,
    upstreamMessage: msg.slice(0, 500),
    timestamp: now,
    firstSeenAt: now,
    lastSeenAt: now,
    occurrenceCount: 1,
    consecutiveFailures: 1,
    cooldownUntil: computedCooldownUntil,
    circuitBreakerState: input.circuitBreakerState ?? 'closed',
    latencyMs: input.latencyMs,
    requestId: input.requestId,
    correlationId: input.correlationId,
    routeUsed: input.routeUsed,
    keyPoisonedSuspected: authFailure && Boolean(input.keyId),
    modelUnavailableSuspected: category === 'MODEL_OR_ENDPOINT_NOT_FOUND',
    providerUnavailableSuspected: category === 'BILLING_QUOTA_EXHAUSTED' || (category === 'UPSTREAM_SERVER_ERROR' && (status === 503 || status === 502)),
    authFailure,
    rateLimitFailure,
    temporary,
    automaticRecoveryPossible,
    likelyCause,
    recommendedAction,
    resolved: false,
  };
}

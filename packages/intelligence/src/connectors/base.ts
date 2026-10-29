/**
 * Connector base contract + shared plumbing (blueprint §3).
 * Every source is a versioned connector implementing the same interface:
 * discover (bounded), normalize (typed candidates), healthCheck, getCheckpoint.
 * Bounded request rates, timeouts and backoff are enforced ABOVE connectors by
 * the engine; connectors only declare context glue here.
 */

import { randomUUID, createHash } from 'node:crypto';

import { SafeEgress, type EgressPolicy } from '../egress.js';
import type {
  ConnectorCheckpoint,
  ConnectorHealth,
  ConnectorId,
  DiscoveryBatch,
  DiscoveryConnector,
  NormalizedCandidate,
  RawDiscoveryRecord,
  SubjectType,
} from '../types.js';

/** Simple budget limiter: minimum interval between requests + requests-per-run cap. */
export class RateLimiter {
  private lastAcquiredAt = 0;

  constructor(
    private readonly minIntervalMs: number,
    private readonly maxRequestsPerRun: number,
    private requestsInRun = 0,
  ) {}

  async acquire(): Promise<boolean> {
    if (this.requestsInRun >= this.maxRequestsPerRun) return false;
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastAcquiredAt);
    if (wait > 0) await sleep(Math.min(wait, 5_000));
    this.lastAcquiredAt = Date.now();
    this.requestsInRun++;
    return true;
  }

  beginRun(): void {
    this.requestsInRun = 0;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 30_000)));
}

export interface ConnectorContext {
  egress: SafeEgress;
  rateLimiter: RateLimiter;
  /** JSON endpoint used as the documented primary source for batch metadata. */
  sourceUrl: string;
}

export abstract class BaseConnector implements DiscoveryConnector {
  readonly abstract id: ConnectorId;
  readonly abstract version: string;
  readonly abstract authority: number;
  readonly abstract description: string;

  constructor(readonly ctx: ConnectorContext) {}

  /** Last valid cursor produced by discover(); surfaced through getCheckpoint(). */
  protected checkpoint?: ConnectorCheckpoint;

  abstract fetchPage(cursor?: ConnectorCheckpoint): Promise<DiscoveryBatch>;

  async discover(cursor?: ConnectorCheckpoint): Promise<DiscoveryBatch> {
    const batch = await this.fetchPage(cursor ?? this.checkpoint);
    if (batch?.checkpoint) this.checkpoint = batch.checkpoint;
    return batch;
  }

  async getCheckpoint(): Promise<ConnectorCheckpoint | undefined> {
    return this.checkpoint;
  }

  abstract normalize(record: RawDiscoveryRecord): Promise<NormalizedCandidate[]>;

  async healthCheck(): Promise<ConnectorHealth> {
    try {
      const res = await this.ctx.egress.fetchText(this.ctx.sourceUrl, { maxResponseBytes: 4096 });
      // The 4 KB probe is intentionally tiny: a multi-MB catalog (OpenRouter,
      // advisories pages) is *expected* to truncate. What proves reachability
      // is the HTTP 200 status itself, so truncation is not a failure here.
      const reachable = res.ok || (res.truncated && res.status === 200);
      return {
        id: this.id,
        status: reachable ? 'healthy' : 'degraded',
        authority: this.authority,
        consecutiveFailures: reachable ? 0 : 1,
        lastError: reachable ? undefined : (res.error ?? `HTTP ${res.status}`),
        description: this.description,
      };
    } catch (err) {
      return {
        id: this.id,
        status: 'unavailable',
        authority: this.authority,
        consecutiveFailures: 1,
        lastError: err instanceof Error ? err.message : String(err),
        description: this.description,
      };
    }
  }
}

/** sha256 helper (evidence content hashing + dedupe keys). */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Stable materialization of an untrusted payload for hashing (post-redaction). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort((a, b) => a.localeCompare(b)));
}

/**
 * Builds the deterministic dedupe key for an evidence record.
 * Idempotency: the same connector observation of the same claim on the same
 * subject yields the SAME key → INSERT OR IGNORE → no duplicate canonical rows.
 */
export function evidenceDedupeKey(parts: {
  connectorId: string;
  subjectType: SubjectType;
  subjectId: string;
  claimType: string;
  sourceUrl: string;
  observedAtDay: string;
}): string {
  return sha256(
    `${parts.connectorId}|${parts.subjectType}|${parts.subjectId}|${parts.claimType}|${parts.sourceUrl}|${parts.observedAtDay}`,
  );
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Parses a JSON body defensively; malformed JSON must not crash a job. */
export function safeParseJson(text: string | undefined): { ok: 1 | 0; value?: unknown } {
  if (text === undefined) return { ok: 0 };
  try {
    return { ok: 1, value: JSON.parse(text) };
  } catch {
    return { ok: 0 };
  }
}

export function makeEgress(policy?: Partial<EgressPolicy>, maxRequestsPerRun = 12, minIntervalMs = 1_000): ConnectorContext {
  return {
    egress: new SafeEgress(policy),
    rateLimiter: new RateLimiter(minIntervalMs, maxRequestsPerRun),
    sourceUrl: '',
  };
}

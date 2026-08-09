/**
 * ───────────────────────────────────────────────────────────────────────────
 * RequestTracer — records full request traces for inspection.
 *
 * Master prompt #30:
 * "Every request should have a trace ID.
 *  Request ID: req_123
 *  Agent: Claude Code
 *  Task: coding
 *  Requested model: local/coding
 *  Router:
 *    Candidate models: 12
 *    Selected:
 *      Provider: OpenRouter
 *      Model: xyz
 *      Key: key_03
 *    Latency: 742ms
 *    TTFT: 310ms
 *    Fallbacks: 0
 *    Status: SUCCESS
 *  Allow users to inspect the entire routing decision."
 *
 * The tracer is a simple ring buffer — keeps the last N request traces in
 * memory. Each trace records:
 *   - requestId (correlation id)
 *   - receivedAt / completedAt
 *   - requestedModel (what the client sent, possibly an alias)
 *   - resolvedModel (what the alias resolved to, if applicable)
 *   - aliasResolution (reason + candidateCount)
 *   - routingDecision (endpoint + alternatives)
 *   - attempts[] (per-attempt: endpoint, key, latency, status, error)
 *   - cacheHit / cacheMiss
 *   - totalLatencyMs, ttftMs (time-to-first-token, for streaming)
 *   - tokensUsed (input + output)
 *   - costUsd
 *   - status (success | failed | cached)
 *
 * Traces are queryable via:
 *   - GET /v1/traces        — list recent traces (with filters)
 *   - GET /v1/traces/:id    — full trace detail
 *
 * Privacy: trace content (messages, response) is NOT stored — only
 * operational metadata (model, endpoint, key id, latency, status). This
 * respects the privacy config from #31.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface TraceAttempt {
  /** Attempt number (0-indexed). */
  readonly attempt: number;
  /** Endpoint id that was tried. */
  readonly endpointId: string;
  /** Provider id of the endpoint. */
  readonly providerId: string;
  /** Key id used for this attempt (if multi-key enabled). */
  readonly keyId?: string;
  /** HTTP status code (0 for network errors). */
  readonly status: number;
  /** Latency of this attempt in ms. */
  readonly latencyMs: number;
  /** Error message if the attempt failed. */
  readonly error?: string;
  /** Failure classification reason (from classifyFailure). */
  readonly failureReason?: string;
}

export interface RequestTrace {
  readonly requestId: string;
  readonly receivedAt: number;
  completedAt?: number;
  /** What the client originally sent (may be an alias like 'local/coding'). */
  requestedModel: string;
  /** What the alias resolved to (if applicable). */
  resolvedModel?: string;
  /** Alias resolution details (reason + candidate count). */
  aliasResolution?: { reason: string; candidateCount: number };
  /** The routing decision (endpoint + alternatives). */
  routingDecision?: { endpointId: string; providerId: string; alternativesCount: number; strategy: string };
  /** Per-attempt details. */
  attempts: TraceAttempt[];
  /** Whether the cache served this request. */
  cacheHit: boolean;
  /** Whether the semantic cache served this request. */
  semanticCacheHit: boolean;
  /** Total request latency in ms. */
  totalLatencyMs: number;
  /** Time-to-first-token in ms (for streaming requests). */
  ttftMs?: number;
  /** Token usage. */
  tokensUsed?: { input: number; output: number; total: number };
  /** Estimated cost in USD. */
  costUsd?: number;
  /** Final status. */
  status: 'success' | 'failed' | 'cached';
  /** Error message (if failed). */
  error?: string;
}

export interface RequestTracerOptions {
  /** Max traces to keep in the ring buffer. Default: 1000. */
  maxTraces?: number;
}

export class RequestTracer {
  private readonly traces = new Map<string, RequestTrace>();
  private readonly order: string[] = [];
  private readonly maxTraces: number;

  constructor(opts: RequestTracerOptions = {}) {
    this.maxTraces = opts.maxTraces ?? 1000;
  }

  /** Starts a new trace. Returns the trace id (caller stores it on the request). */
  start(requestId: string, requestedModel: string): RequestTrace {
    const trace: RequestTrace = {
      requestId,
      receivedAt: Date.now(),
      requestedModel,
      attempts: [],
      cacheHit: false,
      semanticCacheHit: false,
      totalLatencyMs: 0,
      status: 'success',
    };
    this.traces.set(requestId, trace);
    this.order.push(requestId);
    // Evict oldest if over capacity.
    if (this.order.length > this.maxTraces) {
      const oldest = this.order.shift();
      if (oldest) this.traces.delete(oldest);
    }
    return trace;
  }

  /** Returns the in-flight trace by id, or undefined. */
  get(requestId: string): RequestTrace | undefined {
    return this.traces.get(requestId);
  }

  /** Records an alias resolution on the trace. */
  recordAliasResolution(requestId: string, resolvedModel: string, reason: string, candidateCount: number): void {
    const t = this.traces.get(requestId);
    if (!t) return;
    t.resolvedModel = resolvedModel;
    t.aliasResolution = { reason, candidateCount };
  }

  /** Records the routing decision on the trace. */
  recordRoutingDecision(requestId: string, endpointId: string, providerId: string, alternativesCount: number, strategy: string): void {
    const t = this.traces.get(requestId);
    if (!t) return;
    t.routingDecision = { endpointId, providerId, alternativesCount, strategy };
  }

  /** Records a cache hit on the trace. */
  recordCacheHit(requestId: string, semantic: boolean): void {
    const t = this.traces.get(requestId);
    if (!t) return;
    t.cacheHit = true;
    t.semanticCacheHit = semantic;
    t.status = 'cached';
  }

  /** Records an attempt on the trace. */
  recordAttempt(requestId: string, attempt: TraceAttempt): void {
    const t = this.traces.get(requestId);
    if (!t) return;
    t.attempts.push(attempt);
  }

  /** Records time-to-first-token (for streaming requests). */
  recordTTFT(requestId: string, ttftMs: number): void {
    const t = this.traces.get(requestId);
    if (!t) return;
    t.ttftMs = ttftMs;
  }

  /** Completes the trace with success. */
  recordSuccess(requestId: string, tokensUsed: { input: number; output: number; total: number }, costUsd: number): void {
    const t = this.traces.get(requestId);
    if (!t) return;
    t.completedAt = Date.now();
    t.totalLatencyMs = t.completedAt - t.receivedAt;
    t.tokensUsed = tokensUsed;
    t.costUsd = costUsd;
    t.status = 'success';
  }

  /** Completes the trace with failure. */
  recordFailure(requestId: string, error: string): void {
    const t = this.traces.get(requestId);
    if (!t) return;
    t.completedAt = Date.now();
    t.totalLatencyMs = t.completedAt - t.receivedAt;
    t.status = 'failed';
    t.error = error;
  }

  /** Lists recent traces (newest first). */
  list(filter?: { limit?: number; status?: string; model?: string }): readonly RequestTrace[] {
    let traces = Array.from(this.traces.values());
    if (filter?.status) {
      traces = traces.filter((t) => t.status === filter.status);
    }
    if (filter?.model) {
      traces = traces.filter((t) => t.requestedModel === filter.model || t.resolvedModel === filter.model);
    }
    // Sort newest first.
    traces.sort((a, b) => b.receivedAt - a.receivedAt);
    const limit = filter?.limit ?? 100;
    return traces.slice(0, limit);
  }

  /** Returns tracer stats. */
  stats(): {
    totalTraces: number;
    successCount: number;
    failedCount: number;
    cachedCount: number;
    avgLatencyMs: number;
    avgTtftMs: number;
    fallbackRate: number;
  } {
    const all = Array.from(this.traces.values());
    const successCount = all.filter((t) => t.status === 'success').length;
    const failedCount = all.filter((t) => t.status === 'failed').length;
    const cachedCount = all.filter((t) => t.status === 'cached').length;
    const withLatency = all.filter((t) => t.totalLatencyMs > 0);
    const withTtft = all.filter((t) => t.ttftMs !== undefined);
    const withFallbacks = all.filter((t) => t.attempts.length > 1);
    return {
      totalTraces: all.length,
      successCount,
      failedCount,
      cachedCount,
      avgLatencyMs: withLatency.length > 0
        ? Math.round(withLatency.reduce((s, t) => s + t.totalLatencyMs, 0) / withLatency.length)
        : 0,
      avgTtftMs: withTtft.length > 0
        ? Math.round(withTtft.reduce((s, t) => s + (t.ttftMs ?? 0), 0) / withTtft.length)
        : 0,
      fallbackRate: all.length > 0 ? withFallbacks.length / all.length : 0,
    };
  }

  /** Clears all traces. Mainly for tests. */
  clear(): void {
    this.traces.clear();
    this.order.length = 0;
  }
}

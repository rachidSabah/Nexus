/**
 * ProviderAdmissionController — coordinates per-model/provider request admission
 * with sliding-window rate limiting, concurrency bulkheads, and shared recovery
 * episodes to prevent thundering herd on provider recovery.
 *
 * Inspired by free-claude-code's ProviderAdmissionController pattern.
 */

import { randomUUID } from 'node:crypto';

export interface AdmissionOptions {
  /** Max concurrent requests per model. Default: 10 */
  maxConcurrencyPerModel?: number;
  /** Max requests per sliding window per model. Default: 100 */
  maxRequestsPerWindow?: number;
  /** Sliding window size in ms. Default: 60_000 (1 minute) */
  windowMs?: number;
  /** Max queue size per model. Default: 50 */
  maxQueueSize?: number;
  /** Max time a request waits in queue (ms). Default: 30_000 */
  queueTimeoutMs?: number;
  /** Base delay for recovery backoff (ms). Default: 2_000 */
  baseDelayMs?: number;
  /** Max delay for recovery backoff (ms). Default: 60_000 */
  maxDelayMs?: number;
  /** Jitter for recovery backoff (ms). Default: 1_000 */
  jitterMs?: number;
  /** Total transient attempts across all endpoints for a model. Default: 10 */
  totalTransientAttempts?: number;
}

export interface AdmissionResult {
  /** Whether the request was admitted immediately */
  admitted: boolean;
  /** If not admitted, the queue position (0 = not queued) */
  queuePosition: number;
  /** Unique admission ID for tracking */
  admissionId: string;
  /** Estimated wait time in ms if queued */
  estimatedWaitMs: number;
  /** Release function to call when request completes (success or failure) */
  release: () => void;
  /** Abort signal that fires if queue timeout expires */
  abortSignal: AbortSignal;
}

export interface RecoveryEpisode {
  modelId: string;
  providerId: string;
  startedAt: number;
  ownerExecutionId: string;
  probeCount: number;
  lastProbeAt: number;
  waiters: Set<string>; // admissionIds waiting for this episode
}

/**
 * ProviderAdmissionController manages admission control for upstream requests.
 *
 * Key features:
 * - Sliding window rate limiting per model
 * - Concurrency bulkheads per model
 * - Shared recovery episodes (coordinated retry to prevent thundering herd)
 * - Request queuing with timeout
 */
export class ProviderAdmissionController {
  private readonly maxConcurrencyPerModel: number;
  private readonly maxRequestsPerWindow: number;
  private readonly windowMs: number;
  private readonly maxQueueSize: number;
  private readonly queueTimeoutMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterMs: number;
  private readonly totalTransientAttempts: number;

  // Per-model state
  private readonly concurrency = new Map<string, number>();
  private readonly requestTimestamps = new Map<string, number[]>();
  private readonly queues = new Map<string, QueuedRequest[]>();
  private readonly recoveryEpisodes = new Map<string, RecoveryEpisode>();

  // Global attempt tracking per model (for transient failure budget)
  private readonly modelAttempts = new Map<string, number>();

  constructor(opts: AdmissionOptions = {}) {
    this.maxConcurrencyPerModel = opts.maxConcurrencyPerModel ?? 10;
    this.maxRequestsPerWindow = opts.maxRequestsPerWindow ?? 100;
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxQueueSize = opts.maxQueueSize ?? 50;
    this.queueTimeoutMs = opts.queueTimeoutMs ?? 30_000;
    this.baseDelayMs = opts.baseDelayMs ?? 2_000;
    this.maxDelayMs = opts.maxDelayMs ?? 60_000;
    this.jitterMs = opts.jitterMs ?? 1_000;
    this.totalTransientAttempts = opts.totalTransientAttempts ?? 10;
  }

  /**
   * Attempt to admit a request for a model.
   * Returns immediately with admission result (may be queued).
   */
  async admit(modelId: string, providerId: string): Promise<AdmissionResult> {
    const now = Date.now();
    const key = `${providerId}:${modelId}`;

    // Clean up expired timestamps
    this.cleanupWindow(key, now);

    // Check concurrency limit
    const currentConcurrency = this.concurrency.get(key) ?? 0;
    if (currentConcurrency >= this.maxConcurrencyPerModel) {
      return this.queueRequest(key, modelId, providerId, now);
    }

    // Check rate limit window
    const timestamps = this.requestTimestamps.get(key) ?? [];
    if (timestamps.length >= this.maxRequestsPerWindow) {
      return this.queueRequest(key, modelId, providerId, now);
    }

    // Admit immediately
    return this.doAdmit(key, modelId, providerId);
  }

  /**
   * Record a successful request completion.
   * Resets model attempt counter and clears recovery episode if this was the owner.
   */
  recordSuccess(modelId: string, providerId: string, executionId: string): void {
    const key = `${providerId}:${modelId}`;
    this.modelAttempts.delete(key);

    // If this execution owned the recovery episode, clear it
    const episode = this.recoveryEpisodes.get(key);
    if (episode && episode.ownerExecutionId === executionId) {
      this.resolveEpisode(key, true);
      this.recoveryEpisodes.delete(key);
    }
  }

  /**
   * Record a failed request.
   * Increments attempt counter; if transient and under budget, starts/joins recovery episode.
   */
  recordFailure(
    modelId: string,
    providerId: string,
    executionId: string,
    _error: Error,
    retryable: boolean,
    retryAfterMs?: number
  ): { shouldRetry: boolean; delayMs: number; joinEpisode: boolean } {
    const key = `${providerId}:${modelId}`;

    if (!retryable) {
      return { shouldRetry: false, delayMs: 0, joinEpisode: false };
    }

    const attempts = (this.modelAttempts.get(key) ?? 0) + 1;
    this.modelAttempts.set(key, attempts);

    // Check if we've exhausted transient attempt budget
    if (attempts > this.totalTransientAttempts) {
      this.modelAttempts.delete(key);
      return { shouldRetry: false, delayMs: 0, joinEpisode: false };
    }

    // Calculate backoff delay
    let delay = retryAfterMs ?? this.baseDelayMs * Math.pow(2, Math.min(attempts - 1, 4));
    delay = Math.min(delay, this.maxDelayMs);
    delay += Math.random() * this.jitterMs; // Add jitter

    // Check for existing recovery episode
    const existingEpisode = this.recoveryEpisodes.get(key);
    if (existingEpisode) {
      // Join existing episode
      existingEpisode.probeCount++;
      existingEpisode.lastProbeAt = Date.now();
      return { shouldRetry: true, delayMs: delay, joinEpisode: true };
    }

    // Start new recovery episode
    const episode: RecoveryEpisode = {
      modelId,
      providerId,
      startedAt: Date.now(),
      ownerExecutionId: executionId,
      probeCount: 1,
      lastProbeAt: Date.now(),
      waiters: new Set(),
    };
    this.recoveryEpisodes.set(key, episode);

    return { shouldRetry: true, delayMs: delay, joinEpisode: false };
  }

  /**
   * Release a request (called when request completes, whether success or failure).
   * Decrements concurrency and processes queue.
   */
  release(modelId: string, providerId: string): void {
    const key = `${providerId}:${modelId}`;
    const current = this.concurrency.get(key) ?? 0;
    if (current > 0) {
      this.concurrency.set(key, current - 1);
    }
    this.processQueue(key, modelId, providerId);
  }

  /**
   * Get current admission stats for a model.
   */
  getStats(modelId: string, providerId: string): {
    concurrency: number;
    queueLength: number;
    windowUsage: number;
    inRecovery: boolean;
    attemptsUsed: number;
  } {
    const key = `${providerId}:${modelId}`;
    const now = Date.now();
    this.cleanupWindow(key, now);

    return {
      concurrency: this.concurrency.get(key) ?? 0,
      queueLength: this.queues.get(key)?.length ?? 0,
      windowUsage: (this.requestTimestamps.get(key) ?? []).length,
      inRecovery: this.recoveryEpisodes.has(key),
      attemptsUsed: this.modelAttempts.get(key) ?? 0,
    };
  }

  // ─── Private methods ──────────────────────────────────────────────────────

  private cleanupWindow(key: string, now: number): void {
    const timestamps = this.requestTimestamps.get(key);
    if (!timestamps) return;
    const cutoff = now - this.windowMs;
    const valid = timestamps.filter((t) => t > cutoff);
    if (valid.length !== timestamps.length) {
      this.requestTimestamps.set(key, valid);
    }
  }

  private doAdmit(key: string, modelId: string, providerId: string): AdmissionResult {
    // Increment concurrency
    const current = this.concurrency.get(key) ?? 0;
    this.concurrency.set(key, current + 1);

    // Record timestamp for rate limiting
    const timestamps = this.requestTimestamps.get(key) ?? [];
    timestamps.push(Date.now());
    this.requestTimestamps.set(key, timestamps);

    const admissionId = randomUUID();
    const controller = new AbortController();

    return {
      admitted: true,
      queuePosition: 0,
      admissionId,
      estimatedWaitMs: 0,
      release: () => this.release(modelId, providerId),
      abortSignal: controller.signal,
    };
  }

  private queueRequest(
    key: string,
    modelId: string,
    providerId: string,
    now: number
  ): AdmissionResult {
    const queue = this.queues.get(key) ?? [];

    if (queue.length >= this.maxQueueSize) {
      // Queue full - reject immediately
      const controller = new AbortController();
      controller.abort(new Error('Admission queue full'));
      return {
        admitted: false,
        queuePosition: 0,
        admissionId: randomUUID(),
        estimatedWaitMs: 0,
        release: () => {},
        abortSignal: controller.signal,
      };
    }

    const admissionId = randomUUID();
    const controller = new AbortController();

    // Calculate estimated wait based on queue position and average processing time
    const estimatedWaitMs = queue.length * 1000; // Rough estimate: 1s per queued request

    // Set queue timeout
    const timeoutId = setTimeout(() => {
      controller.abort(new Error('Admission queue timeout'));
      // Remove from queue
      const idx = queue.findIndex((r) => r.admissionId === admissionId);
      if (idx >= 0) queue.splice(idx, 1);
    }, this.queueTimeoutMs);

    const queuedRequest: QueuedRequest = {
      admissionId,
      modelId,
      providerId,
      resolve: null as any, // Will be set below
      reject: null as any,
      controller,
      timeoutId,
      queuedAt: now,
    };

    // Store resolve/reject for later use when request is admitted
    queue.push(queuedRequest);
    this.queues.set(key, queue);

    return {
      admitted: false,
      queuePosition: queue.length,
      admissionId,
      estimatedWaitMs,
      release: () => {},
      abortSignal: controller.signal,
    };
  }

  private processQueue(key: string, modelId: string, providerId: string): void {
    const queue = this.queues.get(key);
    if (!queue || queue.length === 0) return;

    const now = Date.now();
    this.cleanupWindow(key, now);

    const currentConcurrency = this.concurrency.get(key) ?? 0;
    const timestamps = this.requestTimestamps.get(key) ?? [];

    // Process as many as we can admit
    while (queue.length > 0) {
      if (currentConcurrency >= this.maxConcurrencyPerModel) break;
      if (timestamps.length >= this.maxRequestsPerWindow) break;

      const request = queue.shift()!;
      clearTimeout(request.timeoutId);

      // Check if request was aborted while waiting
      if (request.controller.signal.aborted) {
        request.reject(new Error('Request aborted while queued'));
        continue;
      }

      // Admit the request
      const current = this.concurrency.get(key) ?? 0;
      this.concurrency.set(key, current + 1);
      timestamps.push(now);
      this.requestTimestamps.set(key, timestamps);

      request.resolve({
        admitted: true,
        queuePosition: 0,
        admissionId: request.admissionId,
        estimatedWaitMs: 0,
        release: () => this.release(modelId, providerId),
        abortSignal: request.controller.signal,
      });
    }

    // Update estimated wait times for remaining queued requests
    for (const request of queue) {
      request.controller.signal.addEventListener('abort', () => {
        const idx = queue.findIndex((r) => r.admissionId === request.admissionId);
        if (idx >= 0) queue.splice(idx, 1);
      });
    }
  }

  private resolveEpisode(key: string, _success: boolean): void {
    const episode = this.recoveryEpisodes.get(key);
    if (!episode) return;

    // Notify all waiters (in a real implementation, this would signal waiters)
    // For now, we just clear the episode
    episode.waiters.clear();
  }
}

interface QueuedRequest {
  admissionId: string;
  modelId: string;
  providerId: string;
  resolve: (value: AdmissionResult) => void;
  reject: (reason: Error) => void;
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
  queuedAt: number;
}

/**
 * Singleton instance for the application (can be overridden in tests)
 */
let globalAdmissionController: ProviderAdmissionController | null = null;

export function getAdmissionController(opts?: AdmissionOptions): ProviderAdmissionController {
  if (!globalAdmissionController) {
    globalAdmissionController = new ProviderAdmissionController(opts);
  }
  return globalAdmissionController;
}

export function setAdmissionController(controller: ProviderAdmissionController): void {
  globalAdmissionController = controller;
}
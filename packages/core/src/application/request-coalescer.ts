export interface CoalescerStats {
  inFlightCount: number;
  totalCoalesced: number;
  totalExecutions: number;
  savedLatencyMs: number;
}

export interface CoalesceOptions {
  signal?: AbortSignal;
  requestId?: string;
  model?: string;
}

export interface CoalesceResult<T> {
  result: T;
  coalesced: boolean;
  originalRequestId?: string;
  waitersCount: number;
  durationMs: number;
}

interface InFlightEntry<T> {
  promise: Promise<T>;
  requestId: string;
  model: string;
  startedAt: number;
  controller: AbortController;
  waitersCount: number;
  signals: Set<AbortSignal>;
}

/**
 * In-flight request deduplicator (request coalescing / singleflight).
 *
 * When multiple identical requests arrive concurrently while an earlier request
 * is still in flight, subsequent requests coalesce onto the same execution promise.
 *
 * This eliminates duplicate provider invocations, saving API costs and avoiding
 * provider rate limit exhaustion.
 */
export class RequestCoalescer {
  private inFlight = new Map<string, InFlightEntry<unknown>>();
  private totalCoalesced = 0;
  private totalExecutions = 0;
  private savedLatencyMs = 0;

  async coalesce<T>(
    key: string,
    task: (signal?: AbortSignal) => Promise<T>,
    options: CoalesceOptions = {},
  ): Promise<CoalesceResult<T>> {
    const startedAt = Date.now();
    const existing = this.inFlight.get(key) as InFlightEntry<T> | undefined;

    if (existing) {
      this.totalCoalesced += 1;
      existing.waitersCount += 1;
      const callerSignal = options.signal;

      if (callerSignal) {
        if (callerSignal.aborted) {
          throw callerSignal.reason ?? new Error('Request aborted before coalescing');
        }
        existing.signals.add(callerSignal);
      }

      try {
        const result = await (callerSignal
          ? this.raceSignal(existing.promise, callerSignal, existing)
          : existing.promise);

        const durationMs = Date.now() - startedAt;
        this.savedLatencyMs += durationMs;

        return {
          result,
          coalesced: true,
          originalRequestId: existing.requestId,
          waitersCount: existing.waitersCount,
          durationMs,
        };
      } finally {
        if (callerSignal) {
          existing.signals.delete(callerSignal);
        }
      }
    }

    // New in-flight request
    this.totalExecutions += 1;
    const controller = new AbortController();
    const signals = new Set<AbortSignal>();
    if (options.signal) {
      signals.add(options.signal);
    }

    // If caller aborts, check if all signals are aborted
    const checkAbort = () => {
      if (signals.size > 0 && Array.from(signals).every((s) => s.aborted)) {
        controller.abort();
      }
    };

    if (options.signal) {
      options.signal.addEventListener('abort', checkAbort, { once: true });
    }

    const taskPromise = task(controller.signal);

    const entry: InFlightEntry<T> = {
      promise: taskPromise,
      requestId: options.requestId ?? 'unknown',
      model: options.model ?? 'unknown',
      startedAt,
      controller,
      waitersCount: 1,
      signals,
    };

    this.inFlight.set(key, entry as InFlightEntry<unknown>);

    try {
      const result = await (options.signal
        ? this.raceSignal(taskPromise, options.signal, entry)
        : taskPromise);

      const durationMs = Date.now() - startedAt;
      return {
        result,
        coalesced: false,
        originalRequestId: entry.requestId,
        waitersCount: entry.waitersCount,
        durationMs,
      };
    } finally {
      if (options.signal) {
        options.signal.removeEventListener('abort', checkAbort);
      }
      this.inFlight.delete(key);
    }
  }

  private async raceSignal<T>(
    promise: Promise<T>,
    signal: AbortSignal,
    entry: InFlightEntry<T>,
  ): Promise<T> {
    if (signal.aborted) {
      throw signal.reason ?? new Error('Aborted');
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        entry.waitersCount = Math.max(1, entry.waitersCount - 1);
        reject(signal.reason ?? new Error('Aborted'));
      };

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };

      signal.addEventListener('abort', onAbort, { once: true });

      promise.then(
        (val) => {
          cleanup();
          resolve(val);
        },
        (err) => {
          cleanup();
          reject(err);
        },
      );
    });
  }

  getStats(): CoalescerStats {
    return {
      inFlightCount: this.inFlight.size,
      totalCoalesced: this.totalCoalesced,
      totalExecutions: this.totalExecutions,
      savedLatencyMs: this.savedLatencyMs,
    };
  }

  clear(): void {
    this.inFlight.clear();
  }
}

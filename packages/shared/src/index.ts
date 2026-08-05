/**
 * Shared utilities used across packages.
 */

/**
 * Sleep for `ms` milliseconds. Abortable.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }, { once: true });
  });
}

/**
 * Retry a function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    shouldRetry?: (error: Error) => boolean;
  } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const initialDelay = opts.initialDelayMs ?? 100;
  const maxDelay = opts.maxDelayMs ?? 10_000;
  const factor = opts.factor ?? 2;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt === retries || !shouldRetry(lastError)) throw lastError;
      const delay = Math.min(initialDelay * Math.pow(factor, attempt), maxDelay);
      await sleep(delay);
    }
  }
  throw lastError ?? new Error('retry failed: no error captured');
}

/**
 * Compute a deterministic hash of a string (FNV-1a, 32-bit).
 * Used for cache keys.
 */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Type-safe `Object.entries`.
 */
export function entries<T extends object>(obj: T): Array<[keyof T, T[keyof T]]> {
  return Object.entries(obj) as Array<[keyof T, T[keyof T]]>;
}

/**
 * Type-safe `Object.fromEntries`.
 */
export function fromEntries<K extends string, V>(entries: Array<[K, V]>): Record<K, V> {
  return Object.fromEntries(entries) as Record<K, V>;
}

/**
 * Convert a ReadableStream<Uint8Array> to a string.
 */
export async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

/**
 * Truncate a string to `n` characters, with an ellipsis.
 */
export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Format milliseconds as a human-readable duration.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

'use client';

/**
 * Phase 13 §11 — ETag/conditional-request aware fetcher for SWR.
 *
 * Maintains a module-level cache of the last successful (ETag, parsed body)
 * per URL. On each poll it sends `If-None-Match`. If the gateway answers 304
 * the cached body is returned, so unchanged catalog/model payloads cost ~0
 * bytes + 0 re-parse instead of re-shipping 300–600 KB every refresh.
 */

const cache = new Map<string, { etag: string; body: unknown }>();

export async function etagFetcher<T = unknown>(url: string): Promise<T> {
  const cached = cache.get(url);
  const headers: Record<string, string> = {};
  if (cached?.etag) headers['If-None-Match'] = cached.etag;

  const res = await fetch(url, { headers });
  if (res.status === 304 && cached) {
    return cached.body as T;
  }
  if (!res.ok) {
    // surface upstream errors to SWR (keeps last good data in cache)
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const etag = res.headers.get('etag');
  const body = (await res.json()) as T;
  if (etag) cache.set(url, { etag, body });
  else cache.set(url, { etag: '', body });
  return body;
}

/** Force the next poll to refetch (e.g. after a delta mutation). */
export function invalidateEtag(url: string): void {
  cache.delete(url);
}

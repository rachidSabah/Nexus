import type { ProviderEndpoint } from '@anx/core';
import { ProviderResponseError } from '@anx/core';

/**
 * Build the standard headers for a provider request. Adapters can extend
 * this with provider-specific headers (e.g. `anthropic-version`).
 */
export function buildHeaders(
  _endpoint: ProviderEndpoint,
  apiKey: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': 'agent-nexus-gateway/0.1.0',
    ...extra,
  };
}

/**
 * Issue a fetch and translate non-2xx responses into ProviderResponseError.
 * Honors `endpoint.timeoutMs` via AbortSignal.timeout.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  endpoint: ProviderEndpoint,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timeout = AbortSignal.timeout(endpoint.timeoutMs);
  const onAbort = () => controller.abort();
  timeout.addEventListener('abort', onAbort, { once: true });
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderResponseError(endpoint.id, response.status, body || response.statusText, {
        url,
        body,
      });
    }
    const text = await response.text().catch(() => '');
    if (!text) {
      throw new ProviderResponseError(endpoint.id, response.status, 'Empty response body', {
        url,
        body: '',
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch (_err) {
      // Some providers (e.g. opencode.ai/zen) return HTTP 200 with a plain-text
      // body like "Not Found" when the API key is invalid — surface that.
      throw new ProviderResponseError(
        endpoint.id,
        response.status,
        `Non-JSON response (HTTP ${response.status}): ${text.slice(0, 160)}`,
        { url, body: text.slice(0, 160) },
      );
    }
  } finally {
    timeout.removeEventListener('abort', onAbort);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Parse a Server-Sent Events stream from a ReadableStream<Uint8Array>.
 * Yields decoded event payloads as JSON-parsed objects.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const lines = raw.split('\n');
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length === 0) continue;
        const data = dataLines.join('\n');
        if (data === '[DONE]') return;
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          // Skip malformed events.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

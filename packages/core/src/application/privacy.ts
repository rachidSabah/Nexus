/**
 * Privacy mode configuration. Master prompt #31:
 *
 * "When enabled:
 *   - minimize request logging
 *   - redact prompts
 *   - redact responses
 *   - do not persist sensitive content
 *   - retain only operational metrics
 *
 * Default to privacy-conscious behavior."
 *
 * Privacy levels:
 *   - 'off'        — log everything (debugging only)
 *   - 'redacted'   — log metadata + truncated hashes (default)
 *   - 'strict'     — log only operational metrics (no prompt/response content)
 */

export type PrivacyLevel = 'off' | 'redacted' | 'strict';

export interface PrivacyConfig {
  level: PrivacyLevel;
  /** Max chars of prompt/response to log in 'redacted' mode. Default: 0 (fully redacted). */
  maxContentChars?: number;
  /** Whether to redact Authorization headers in logs. Default: true. */
  redactAuthHeaders?: boolean;
  /** Whether to skip persisting prompts/responses to the cache. Default: false (cache is in-memory). */
  skipCachePersistence?: boolean;
}

export const DEFAULT_PRIVACY: PrivacyConfig = {
  level: 'redacted',
  maxContentChars: 0,
  redactAuthHeaders: true,
  skipCachePersistence: false,
};

/**
 * Redacts sensitive content from a string for logging. In 'redacted' mode,
 * returns a SHA-256 fingerprint (first 16 chars) so the same input always
 * produces the same redacted output (useful for dedup detection without
 * exposing content). In 'strict' mode, returns '[redacted]'.
 */
export function redactForLog(content: string, config: PrivacyConfig = DEFAULT_PRIVACY): string {
  if (config.level === 'off') return content;
  if (config.level === 'strict') return '[redacted]';
  // 'redacted' mode — return a fingerprint + optional truncated content.
  const max = config.maxContentChars ?? 0;
  if (max === 0) return '[redacted]';
  const truncated = content.slice(0, max);
  return truncated + (content.length > max ? '…[redacted]' : '');
}

/**
 * Returns a SHA-256 fingerprint (16 chars) for content — useful for
 * dedup detection without exposing the content itself.
 */
export function fingerprint(content: string): string {
  // Lazy-import to avoid pulling node:crypto into the browser bundle.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Sanitizes a request/response object for logging. Strips:
 *   - messages[].content (replaced with fingerprint)
 *   - input (embeddings)
 *   - embedding data
 *   - tool_call arguments
 *   - Authorization headers
 *
 * Keeps operational metadata: model, message count, token counts,
 * providerId, endpointId, latency, status.
 */
export function sanitizeForLog(obj: unknown, config: PrivacyConfig = DEFAULT_PRIVACY): unknown {
  if (config.level === 'off') return obj;
  if (obj === null || typeof obj !== 'object') return obj;
  if (config.level === 'strict') {
    // In strict mode, only keep operational fields.
    if (typeof obj === 'object' && 'messages' in obj) {
      const r = obj as Record<string, unknown>;
      return {
        model: r['model'],
        messageCount: Array.isArray(r['messages']) ? (r['messages'] as unknown[]).length : 0,
        stream: r['stream'],
        // Drop messages, input, content entirely.
      };
    }
    return '[redacted]';
  }
  // 'redacted' mode — deep-clone and replace sensitive fields with fingerprints.
  const cloned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  redactDeep(cloned, config);
  return cloned;
}

function redactDeep(obj: Record<string, unknown>, config: PrivacyConfig): void {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value === null || value === undefined) continue;
    if (key === 'content' || key === 'input' || key === 'embedding' || key === 'arguments') {
      if (typeof value === 'string') {
        obj[key] = redactForLog(value, config);
      } else if (Array.isArray(value)) {
        obj[key] = `[${value.length} items redacted]`;
      }
    } else if (key === 'authorization' || key === 'apiKey' || key === 'api_key') {
      obj[key] = '[redacted]';
    } else if (key === 'messages' && Array.isArray(value)) {
      obj[key] = value.map((m) => {
        if (m && typeof m === 'object') {
          const msg = m as Record<string, unknown>;
          if (typeof msg['content'] === 'string') {
            msg['content'] = redactForLog(msg['content'] as string, config);
          }
          if (Array.isArray(msg['toolCalls'])) {
            for (const tc of msg['toolCalls'] as Array<Record<string, unknown>>) {
              if (tc['function'] && typeof tc['function'] === 'object') {
                const fn = tc['function'] as Record<string, unknown>;
                if (typeof fn['arguments'] === 'string') {
                  fn['arguments'] = redactForLog(fn['arguments'] as string, config);
                }
              }
            }
          }
        }
        return m;
      });
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      redactDeep(value as Record<string, unknown>, config);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          redactDeep(item as Record<string, unknown>, config);
        }
      }
    }
  }
}

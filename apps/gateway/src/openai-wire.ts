import type { ChatCompletionChunk, ChatCompletionResponse } from '@anx/core';

/**
 * OpenAI-compatible wire serialization boundary for `/v1/chat/completions`.
 *
 * Consolidation of the two independent fixes for
 * `session event "assistant/chunk" carries non-JSON-serializable data`:
 *
 * - `8daa1f9` (origin/main): `formatOpenAiStreamChunk` — JSON-safe chunk
 *   projection (undefined-key stripping, reasoning_content mirroring,
 *   finite usage normalization). Extracted here verbatim so it is unit
 *   testable; behavior preserved except where noted.
 * - Local forensic fix (`c596519`): detail preservation and hostile-input
 *   hardening, ported on top:
 *     · cache-read / reasoning token details are PRESERVED when known
 *       (from `prompt_tokens_details.cached_tokens`, `cachedTokens`,
 *       `prompt_cache_hit_tokens`, `completion_tokens_details.reasoning_tokens`,
 *       `reasoningTokens`) and omitted when unknown — the harness computes
 *       `inputTokens = prompt_tokens - cached_tokens`, so dropping the detail
 *       silently inflates input-token accounting (verified: 42 vs 34);
 *     · redundant camelCase aliases are NOT emitted on the wire (OpenAI
 *       `CompletionUsage` is snake_case; both dsh and lenient SDK consumers
 *       read the snake_case fields — dual keys were tolerated, not spec);
 *     · negative zero is normalized to zero (`snapshotJsonValue` rejects -0);
 *     · non-streaming responses get the identical usage treatment;
 *     · last-resort transport guard (`isJsonSafe` /
 *       `describeUnserializableChunk`): if a plugin hook injects an exotic
 *       value (BigInt/circular/function), the sink emits one structured,
 *       redacted error event and still terminates with `[DONE]` — the stream
 *       is never left half-open.
 *
 * The harness consumer contract enforced here (verbatim in
 * `test/harness-wire-usage.test.ts`): `dsh-llm-deepseek.mapUsage()` reads
 * `usage.prompt_tokens` / `usage.completion_tokens` and
 * `dsh-session.snapshotJsonValue()` rejects NaN/±Infinity/undefined/-0/
 * BigInt/function/symbol/circular/sparse/exotic objects when the agent loop
 * appends every chunk as a session event.
 */

/** OpenAI wire `CompletionUsage` (plus the detail objects the DeepSeek Harness reads). */
export interface WireCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number };
}

/** Finite coercion; negative zero normalizes to positive zero. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? (v === 0 ? 0 : v) : 0;
}

/** Known-finite passthrough; `undefined` means "unknown → omit the field". */
function knownNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? (v === 0 ? 0 : v) : undefined;
}

/** Read a count from either the internal camelCase or the wire snake_case shape. */
function pickCount(src: Record<string, unknown>, snake: string, camel: string): unknown {
  const snakeVal = src[snake];
  if (typeof snakeVal === 'number') return snakeVal;
  return src[camel] ?? snakeVal;
}

/**
 * Normalize any accepted usage shape (internal camelCase `TokenUsage`, upstream
 * snake_case `CompletionUsage`, or truthy-but-partial objects) into the OpenAI
 * wire `CompletionUsage`. Returns `undefined` for nullish/non-object usage so
 * callers can omit the field entirely (OpenAI spec: trailing chunk only).
 */
export function toWireUsage(usage: unknown): WireCompletionUsage | undefined {
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return undefined;
  const u = usage as Record<string, unknown>;

  const promptTokens = num(pickCount(u, 'prompt_tokens', 'promptTokens'));
  const completionTokens = num(pickCount(u, 'completion_tokens', 'completionTokens'));
  const totalTokens = num(pickCount(u, 'total_tokens', 'totalTokens')) || promptTokens + completionTokens;

  // Cache-read detail: OpenAI details object, internal cachedTokens, or
  // DeepSeek's native prompt_cache_hit_tokens. Omitted when unknown.
  const promptDetails = u['prompt_tokens_details'] as Record<string, unknown> | null | undefined;
  const cachedTokens = knownNum(
    promptDetails?.['cached_tokens'] ?? u['cachedTokens'] ?? u['prompt_cache_hit_tokens'],
  );
  // Reasoning detail: OpenAI completion details object or internal reasoningTokens.
  const completionDetails = u['completion_tokens_details'] as Record<string, unknown> | null | undefined;
  const reasoningTokens = knownNum(completionDetails?.['reasoning_tokens'] ?? u['reasoningTokens']);

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    ...(cachedTokens !== undefined ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {}),
    ...(reasoningTokens !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoningTokens } } : {}),
  };
}

/**
 * Normalizes an outbound ChatCompletionChunk to ensure 100% compliant, JSON-safe
 * SSE wire payloads for OpenAI-compatible consumers (like DeepSeek Harness dsh, Claude Code, Aider, etc.).
 */
export function formatOpenAiStreamChunk(chunk: ChatCompletionChunk): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    id: chunk.id,
    object: chunk.object ?? 'chat.completion.chunk',
    created: chunk.created ?? Math.floor(Date.now() / 1000),
    model: chunk.model,
    choices: (chunk.choices ?? []).map((c) => {
      const delta: Record<string, unknown> = {};
      if (c.delta) {
        for (const [k, v] of Object.entries(c.delta)) {
          if (v !== undefined) {
            delta[k] = v; // Rule 1: NEVER emit enumerable own keys with undefined values
          }
        }
        // Rule 2: Provide reasoning_content for DeepSeek / dsh compatibility
        if (delta['reasoning'] !== undefined && delta['reasoning_content'] === undefined) {
          delta['reasoning_content'] = delta['reasoning'];
        }
      }
      return {
        index: c.index ?? 0,
        delta,
        finish_reason: c.finish_reason ?? null,
      };
    }),
  };

  if (chunk.systemFingerprint !== undefined) {
    wire['system_fingerprint'] = chunk.systemFingerprint;
  }

  const wireUsage = toWireUsage(chunk.usage);
  if (wireUsage !== undefined) {
    wire['usage'] = wireUsage; // Rule 3: finite snake_case usage, details preserved when known
  }

  return wire;
}

/**
 * Non-streaming counterpart: projects a ChatCompletionResponse onto the OpenAI
 * wire shape. Usage is always present (zeros when unknown), matching OpenAI's
 * own non-streaming behavior — and never the internal camelCase TokenUsage.
 */
export function formatOpenAiResponse(response: ChatCompletionResponse): Record<string, unknown> {
  const wireUsage = toWireUsage(response.usage);
  const { usage: _internalUsage, ...rest } = response as ChatCompletionResponse & Record<string, unknown>;
  void _internalUsage;
  return {
    ...rest,
    usage: wireUsage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/** True when the object would survive `JSON.stringify` losslessly (no BigInt, circular, non-finite…). */
export function isJsonSafe(value: unknown, seen: Set<object>): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false; // undefined, function, symbol, BigInt
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  try {
    const entries = Array.isArray(value)
      ? value.entries()
      : Object.entries(value as Record<string, unknown>);
    for (const [, v] of entries) {
      if (!isJsonSafe(v, seen)) return false;
    }
  } catch {
    return false;
  }
  return true;
}

/**
 * Last-resort guard for the SSE transport: returns a redacted, structured
 * error payload when a chunk cannot be serialized at all (e.g. a plugin hook
 * injected an exotic object). The stream stays alive and the error identifies
 * the stage without leaking secrets.
 */
export function describeUnserializableChunk(chunk: unknown): Record<string, unknown> {
  const type =
    chunk !== null && typeof chunk === 'object' && typeof (chunk as Record<string, unknown>)['object'] === 'string'
      ? String((chunk as Record<string, unknown>)['object'])
      : 'unknown';
  const model =
    chunk !== null && typeof chunk === 'object' && typeof (chunk as Record<string, unknown>)['model'] === 'string'
      ? String((chunk as Record<string, unknown>)['model'])
      : undefined;
  return {
    error: {
      type: 'gateway_serialization_error',
      stage: 'openai_wire_chunk_serialization',
      event: type,
      ...(model !== undefined ? { model } : {}),
      message: 'stream chunk could not be serialized to JSON and was dropped; the conversation remains usable',
    },
  };
}

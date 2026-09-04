import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

import { formatOpenAiStreamChunk, formatOpenAiResponse, toWireUsage, isJsonSafe, describeUnserializableChunk } from '../src/openai-wire.js';

// ─────────────────────────────────────────────────────────────────────────────
// Verbatim DeepSeek Harness consumer simulator.
//
// The functions below are transcribed 1:1 from the harness packages that
// produced the production failure
//   `session event "assistant/chunk" carries non-JSON-serializable data`
//
// Provenance:
//  - `mapUsage`           → @deepseek-ai/dsh-llm-deepseek@0.1.1-rc.2 lib/index.js
//  - `walkJsonValue` (+ helpers) → @deepseek-ai/dsh-session@0.1.1-rc.2 lib/index.js
//    (`Session.append` throws the exact production error when
//     `snapshotJsonValue(data)` returns undefined)
//  - `translate`/append loop → @deepseek-ai/dsh-agent-loop@0.1.1-rc.2 lib/index.js
//    (`for await (const chunk of stream) session.append("assistant/chunk", {turn, step, chunk})`)
// They are used here as the executable specification of the wire contract the
// gateway MUST satisfy for every OpenAI-protocol consumer.
// ─────────────────────────────────────────────────────────────────────────────

function mapUsage(usage: Record<string, unknown>): Record<string, unknown> {
  const details = usage['prompt_tokens_details'] as Record<string, unknown> | undefined;
  const completionDetails = usage['completion_tokens_details'] as Record<string, unknown> | undefined;
  const cacheRead = details?.['cached_tokens'] ?? usage['prompt_cache_hit_tokens'];
  const reasoning = completionDetails?.['reasoning_tokens'];
  return {
    inputTokens: (usage['prompt_tokens'] as number) - ((cacheRead as number) ?? 0),
    outputTokens: usage['completion_tokens'],
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  };
}

function isIntrinsicObjectPrototype(prototype: object): boolean {
  return prototype === (Object.prototype as unknown);
}
function hasPlainObjectPrototype(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || (typeof prototype === 'object' && isIntrinsicObjectPrototype(prototype));
}
function hasPlainArrayPrototype(value: object): boolean {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}
function enumerableStringKeys(value: Record<string, unknown>): string[] | undefined {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key))) return undefined;
  return keys as string[];
}

/** Verbatim `walkJsonValue` (detach=true path) from dsh-session. */
function snapshotJsonValue(value: unknown): Record<string, unknown> | undefined | true {
  const ancestors = new Set<object>();
  type Dest = { kind: 'root' } | { kind: 'array'; target: unknown[]; index: number } | { kind: 'object'; target: Record<string, unknown>; key: string };
  let root: unknown;
  const assign = (destination: Dest | undefined, item: unknown) => {
    if (destination === undefined) return;
    if (destination.kind === 'root') root = item;
    else if (destination.kind === 'array') destination.target[destination.index] = item;
    else destination.target[destination.key] = item;
  };
  type Task =
    | { kind: 'leave'; source: object }
    | { kind: 'array-item'; source: unknown[]; index: number; target?: unknown[] }
    | { kind: 'object-property'; source: Record<string, unknown>; key: string; target?: Record<string, unknown> }
    | { kind: 'visit'; value: unknown; destination?: Dest };
  const tasks: Task[] = [{ kind: 'visit', value, destination: { kind: 'root' } }];
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === 'leave') {
      ancestors.delete(task.source);
      continue;
    }
    if (task.kind === 'array-item') {
      if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return undefined;
      tasks.push({
        kind: 'visit',
        value: task.source[task.index],
        ...(task.target === undefined ? {} : { destination: { kind: 'array' as const, target: task.target, index: task.index } }),
      });
      continue;
    }
    if (task.kind === 'object-property') {
      tasks.push({
        kind: 'visit',
        value: task.source[task.key],
        ...(task.target === undefined ? {} : { destination: { kind: 'object' as const, target: task.target, key: task.key } }),
      });
      continue;
    }
    const current = task.value;
    if (current === null) {
      assign(task.destination, null);
      continue;
    }
    if (typeof current === 'boolean' || typeof current === 'string') {
      assign(task.destination, current);
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) return undefined;
      assign(task.destination, current);
      continue;
    }
    if (typeof current !== 'object') return undefined;
    if (ancestors.has(current)) return undefined;
    if (Array.isArray(current)) {
      if (!hasPlainArrayPrototype(current)) return undefined;
      const length = current.length;
      if (Reflect.ownKeys(current).length !== length + 1) return undefined;
      const target: unknown[] = [];
      assign(task.destination, target);
      ancestors.add(current);
      tasks.push({ kind: 'leave', source: current });
      for (let index = length - 1; index >= 0; index--) tasks.push({ kind: 'array-item', source: current, index, target });
      continue;
    }
    if (!hasPlainObjectPrototype(current)) return undefined;
    const keys = enumerableStringKeys(current as Record<string, unknown>);
    if (keys === undefined) return undefined;
    const target: Record<string, unknown> = {};
    assign(task.destination, target);
    ancestors.add(current);
    tasks.push({ kind: 'leave', source: current });
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index] as string;
      tasks.push({ kind: 'object-property', source: current as Record<string, unknown>, key, target });
    }
  }
  return root as Record<string, unknown>;
}

/** Verbatim Session.append lossless-JSON guard (dsh-session). */
function harnessSessionAppendGuard(type: string, data: unknown): void {
  const dataSnapshot = snapshotJsonValue(data);
  if (dataSnapshot === undefined) {
    throw new Error(`session event "${type}" carries non-JSON-serializable data`);
  }
}

/** Verbatim `translate()` payload handling of dsh-llm-deepseek (usage path) + agent-loop append. */
function harnessConsumeSse(payloads: string[]): { appended: number; usage?: Record<string, unknown> } {
  let pendingUsage: Record<string, unknown> | undefined;
  let appended = 0;
  const append = (chunk: Record<string, unknown>) => {
    harnessSessionAppendGuard('assistant/chunk', { turn: 0, step: 0, chunk });
    appended++;
  };
  for (const payload of payloads) {
    if (payload === '[DONE]') {
      if (pendingUsage) append({ type: 'usage', usage: pendingUsage });
      append({ type: 'finish', reason: { kind: 'stop' } });
      return { appended, usage: pendingUsage };
    }
    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      throw new Error('malformed SSE payload: MALFORMED_RESPONSE');
    }
    for (const choice of (chunk['choices'] as Array<Record<string, unknown>> | undefined) ?? []) {
      // finish_reason is DEFERRED by the harness translate() — nothing appended here.
      void choice;
    }
    if (chunk['usage']) pendingUsage = mapUsage(chunk['usage'] as Record<string, unknown>);
  }
  throw new Error('SSE payload stream ended without [DONE]');
}

/** Split a raw SSE body the way EventSourceParserStream delivers `data` fields. */
function parseSseData(raw: string): string[] {
  const out: string[] = [];
  for (const frame of raw.split('\n\n')) {
    for (const line of frame.split('\n')) {
      if (line.startsWith('data:')) out.push(line.slice(5).trimStart());
    }
  }
  return out;
}

/** Assert a function throws EXACTLY the given error message. */
function expectExactThrow(fn: () => unknown, message: string): void {
  try {
    fn();
  } catch (error) {
    expect((error as Error).message).toBe(message);
    return;
  }
  throw new Error(`expected function to throw: ${message}`);
}

const baseChunk = {
  id: 'chatcmpl-test',
  object: 'chat.completion.chunk' as const,
  created: 1700000000,
  model: 'test-model',
  choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
};

describe('OpenAI wire usage boundary — harness consumer contract', () => {
  it('reproduces the production failure: camelCase (internal) usage poisons the harness session log', () => {
    // Exactly what antigravity-cli.ts emits on its final chunk.
    const poisonedChunk = { ...baseChunk, usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17, reasoningTokens: 3 } };
    const payloads = [JSON.stringify({ ...baseChunk, choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] }), JSON.stringify(poisonedChunk), '[DONE]'];
    expectExactThrow(() => harnessConsumeSse(payloads), 'session event "assistant/chunk" carries non-JSON-serializable data');
  });

  it('reproduces with truthy-but-partial usage objects ({} and details-only)', () => {
    for (const usage of [{}, { prompt_tokens_details: { cached_tokens: 4 } }]) {
      const payloads = [JSON.stringify({ ...baseChunk, usage }), '[DONE]'];
      expectExactThrow(() => harnessConsumeSse(payloads), 'session event "assistant/chunk" carries non-JSON-serializable data');
    }
  });

  it('toWireUsage maps the internal camelCase shape onto the wire with detail preservation', () => {
    expect(toWireUsage({ promptTokens: 12, completionTokens: 5, totalTokens: 17, cachedTokens: 4, reasoningTokens: 3 })).toEqual({
      prompt_tokens: 12,
      completion_tokens: 5,
      total_tokens: 17,
      prompt_tokens_details: { cached_tokens: 4 },
      completion_tokens_details: { reasoning_tokens: 3 },
    });
  });

  it('toWireUsage preserves upstream snake_case passthrough (including DeepSeek prompt_cache_hit_tokens)', () => {
    expect(
      toWireUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 64, completion_tokens_details: { reasoning_tokens: 7 } }),
    ).toEqual({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 64 },
      completion_tokens_details: { reasoning_tokens: 7 },
    });
  });

  it('toWireUsage coerces every hostile count to a finite wire-safe number (NaN/Infinity/-0/string/BigInt/objects)', () => {
    const wire = toWireUsage({
      promptTokens: Number.NaN,
      completionTokens: Number.POSITIVE_INFINITY,
      totalTokens: -0,
      cachedTokens: '12',
      reasoningTokens: 2n,
    })!;
    expect(Number.isFinite(wire.prompt_tokens)).toBe(true);
    expect(Number.isFinite(wire.completion_tokens)).toBe(true);
    expect(Number.isFinite(wire.total_tokens)).toBe(true);
    expect(Object.is(wire.total_tokens, -0)).toBe(false);
    expect(wire.prompt_tokens_details).toBeUndefined(); // '12' (string) is not a known number → omitted, never invented
    expect(wire.completion_tokens_details).toBeUndefined(); // 2n (BigInt) is not a known number → omitted
    // The coerced object itself must now pass the harness guard.
    harnessSessionAppendGuard('assistant/chunk', { type: 'usage', usage: { inputTokens: wire.prompt_tokens, outputTokens: wire.completion_tokens } });
  });

  it('toWireUsage omits unknown detail objects instead of inventing zeros (semantic preservation)', () => {
    const wire = toWireUsage({ prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 })!;
    expect(wire.prompt_tokens_details).toBeUndefined();
    expect(wire.completion_tokens_details).toBeUndefined();
  });

  it('toWireUsage returns undefined for nullish usage so the field is omitted (OpenAI spec: final chunk only)', () => {
    expect(toWireUsage(undefined)).toBeUndefined();
    expect(toWireUsage(null)).toBeUndefined();
    expect(toWireUsage('n/a')).toBeUndefined();
    expect(toWireUsage([1, 2])).toBeUndefined();
  });

  it('formatOpenAiStreamChunk strips undefined delta keys and mirrors reasoning_content for dsh', () => {
    const wire = formatOpenAiStreamChunk({
      ...baseChunk,
      choices: [{ index: 0, delta: { content: 'hi', reasoning: 'think' } as never, finish_reason: null }],
    } as never);
    const delta = (wire.choices as Array<{ delta: Record<string, unknown> }>)[0]!.delta;
    expect(delta['reasoning_content']).toBe('think');
    expect('reasoning' in delta).toBe(true);
    const wireNoReasoning = formatOpenAiStreamChunk({ ...baseChunk } as never);
    const deltaNoReasoning = (wireNoReasoning.choices as Array<{ delta: Record<string, unknown> }>)[0]!.delta;
    expect('reasoning' in deltaNoReasoning).toBe(false);
    expect('reasoning_content' in deltaNoReasoning).toBe(false);
  });

  it('formatOpenAiStreamChunk leaves tool-call deltas untouched (multi-turn tool continuation)', () => {
    const toolCallDelta = {
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'run', arguments: '{"a":1}' },
    };
    const wire = formatOpenAiStreamChunk({
      ...baseChunk,
      choices: [{ index: 0, delta: { tool_calls: [toolCallDelta] } as never, finish_reason: 'tool_calls' }],
    } as never);
    expect(JSON.stringify((wire.choices as Array<{ delta: Record<string, unknown> }>)[0]!.delta)).toBe(
      JSON.stringify({ tool_calls: [toolCallDelta] }),
    );
  });

  it('every normalized chunk passes the harness session-append guard end-to-end (hostile usage table)', () => {
    const hostile: unknown[] = [
      { promptTokens: 12, completionTokens: 5, totalTokens: 17, reasoningTokens: 3 },
      {},
      { prompt_tokens_details: { cached_tokens: 4 } },
      { prompt_tokens: '12', completion_tokens: null, total_tokens: undefined },
      new Date(),
      new Map([[1, 2]]),
      new Set([1]),
      new Uint8Array([1, 2, 3]),
      Buffer.from('x'),
      (() => {
        const c: Record<string, unknown> = {};
        c['self'] = c;
        return c;
      })(),
    ];
    for (const usage of hostile) {
      const wire = formatOpenAiStreamChunk({ ...baseChunk, usage } as never);
      const sse = [JSON.stringify(wire), '[DONE]'];
      const result = harnessConsumeSse(sse); // must NOT throw
      expect(result.appended).toBeGreaterThan(0);
      expect(Number.isFinite(result.usage?.['inputTokens'] as number)).toBe(true);
      expect(Number.isFinite(result.usage?.['outputTokens'] as number)).toBe(true);
    }
  });

  it('formatOpenAiResponse always emits snake_case usage on non-streaming responses', () => {
    const wire = formatOpenAiResponse({
      id: 'r1',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [],
      usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
      provider: 'p',
      endpoint: 'e',
      latencyMs: 5,
    } as never);
    expect(wire.usage).toEqual({ prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 });
  });

  it('isJsonSafe flags exotic graphs and describeUnserializableChunk yields a redacted structured error', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(isJsonSafe(circular, new Set())).toBe(false);
    expect(isJsonSafe({ a: Number.NaN }, new Set())).toBe(false);
    expect(isJsonSafe({ a: 1n }, new Set())).toBe(false);
    expect(isJsonSafe({ a: [1, 'x', { b: true }] }, new Set())).toBe(true);

    const described = describeUnserializableChunk({ object: 'chat.completion.chunk', model: 'secret-model', usage: circular });
    const serialized = JSON.stringify(described);
    expect(serialized).not.toContain('promptTokens');
    expect(serialized).not.toContain('self');
    expect((described.error as Record<string, unknown>)['stage']).toBe('openai_wire_chunk_serialization');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Full-stack: mock upstream streams the poisoned usage shape through the REAL
// gateway; the harness consumer must survive the whole session.
// ─────────────────────────────────────────────────────────────────────────────

describe('harness wire contract end-to-end through /v1/chat/completions', () => {
  let runtime: import('../src/runtime.js').GatewayRuntime;
  let mockUpstream: Server;
  const gatewayPort = 18973;
  const upstreamPort = 19873;
  const baseUrl = `http://127.0.0.1:${gatewayPort}`;
  const testDir = join(tmpdir(), `anx-wire-test-${Date.now()}`);

  beforeAll(async () => {
    // 1. Mock OpenAI-compatible upstream that emits the EXACT poisoned shapes:
    //    - plain content chunks (no usage) — the OpenAI passthrough shape
    //    - a tool_call delta chunk (tool continuation must stay intact)
    //    - the final include_usage chunk carrying INTERNAL camelCase usage —
    //      what the gateway previously forwarded verbatim, killing the turn.
    mockUpstream = createServer((req, res) => {
      if (req.url?.startsWith('/v1/models') || req.url?.startsWith('/models')) {
        if (req.headers['authorization'] !== 'Bearer mock-test-key') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid API key', code: 401 } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-deepseek-v3', object: 'model', created: 1700000000, owned_by: 'mock' }] }));
        return;
      }
      if (req.url?.includes('/chat/completions')) {
        let raw = '';
        req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
        req.on('end', () => {
          const body = JSON.parse(raw || '{}') as { stream?: boolean };
          const chunkId = 'chatcmpl-mock-1';
          const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
          if (!body.stream) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: chunkId,
                object: 'chat.completion',
                created: 1700000000,
                model: 'mock-deepseek-v3',
                choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
                usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9, cachedTokens: 3 },
              }),
            );
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          for (let i = 0; i < 40; i++) {
            send({
              id: chunkId,
              object: 'chat.completion.chunk',
              created: 1700000000,
              model: 'mock-deepseek-v3',
              choices: [{ index: 0, delta: { content: `chunk-${i} ` }, finish_reason: null }],
            });
          }
          send({
            id: chunkId,
            object: 'chat.completion.chunk',
            created: 1700000000,
            model: 'mock-deepseek-v3',
            choices: [
              { index: 0, delta: { tool_calls: [{ index: 0, id: 'call_x', type: 'function', function: { name: 'noop', arguments: '{}' } }] }, finish_reason: 'tool_calls' },
            ],
          });
          // THE POISON: internal camelCase usage on the trailing usage chunk.
          send({
            id: chunkId,
            object: 'chat.completion.chunk',
            created: 1700000000,
            model: 'mock-deepseek-v3',
            choices: [],
            usage: { promptTokens: 42, completionTokens: 11, totalTokens: 53, cachedTokens: 8, reasoningTokens: 2 },
          });
          res.write('data: [DONE]\n\n');
          res.end();
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
    });
    await new Promise<void>((resolve) => mockUpstream.listen(upstreamPort, resolve));

    // 2. Isolated gateway runtime.
    process.env['ANX_VAULT_PATH'] = join(testDir, 'vault.json');
    process.env['AGENT_NEXUS_VAULT_KEY'] = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env['PORT'] = String(gatewayPort);
    const { GatewayRuntime } = await import('../src/runtime.js');
    runtime = await GatewayRuntime.create(undefined);
    await runtime.start();

    // 3. Onboard the mock provider.
    const onboard = await fetch(`${baseUrl}/v1/providers/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'mock-ai',
        displayName: 'Mock AI',
        baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        apiKey: 'mock-test-key',
        priority: 90,
      }),
    });
    expect(onboard.status).toBe(201);
  }, 40000);

  afterAll(async () => {
    await runtime?.stop();
    await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }, 30000);

  it('streams the full session through the verbatim harness consumer without any serialization rejection', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({
        model: 'nexus/mock-ai/mock-deepseek-v3',
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'user', content: 'long agentic coding task' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const raw = await res.text();
    const payloads = parseSseData(raw);
    expect(payloads[payloads.length - 1]).toBe('[DONE]'); // SSE terminates with [DONE]

    // The verbatim harness consumer must survive EVERY appended chunk.
    const result = harnessConsumeSse(payloads);
    expect(result.usage).toBeDefined();
    expect(result.usage?.['inputTokens']).toBe(42 - 8); // prompt_tokens minus cache detail — detail PRESERVED
    expect(result.usage?.['outputTokens']).toBe(11);
    expect(result.usage?.['cacheReadTokens']).toBe(8);
    expect(result.usage?.['reasoningTokens']).toBe(2);

    // Tool-call deltas survive untouched (multi-turn tool continuation).
    expect(raw).toContain('"tool_calls"');
    expect(raw).toContain('"name":"noop"');

    // Wire conformance: the trailing usage chunk is snake_case on the wire.
    const usageFrame = payloads.map((p) => (p === '[DONE]' ? null : (JSON.parse(p) as Record<string, unknown>))).find((c) => c && c['usage']);
    expect(usageFrame).toBeDefined();
    const usage = usageFrame!['usage'] as Record<string, unknown>;
    expect(usage['prompt_tokens']).toBe(42);
    expect(usage['completion_tokens']).toBe(11);
    expect(usage['total_tokens']).toBe(53);
    expect(usage['prompt_tokens_details']).toEqual({ cached_tokens: 8 });
    expect(usage['completion_tokens_details']).toEqual({ reasoning_tokens: 2 });
    expect('promptTokens' in usage).toBe(false);
  }, 30000);

  it('non-streaming responses carry snake_case wire usage too', async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({
        model: 'nexus/mock-ai/mock-deepseek-v3',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { usage: Record<string, unknown> };
    expect(body.usage['prompt_tokens']).toBe(7);
    expect(body.usage['completion_tokens']).toBe(2);
    expect(body.usage['total_tokens']).toBe(9);
    expect(body.usage['prompt_tokens_details']).toEqual({ cached_tokens: 3 });
    expect('promptTokens' in body.usage).toBe(false);
  }, 30000);
});

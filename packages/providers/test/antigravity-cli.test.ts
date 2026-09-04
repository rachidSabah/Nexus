import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

import { AntigravityCliAdapter, buildAgySpawnArgs, buildAgyStdinMessage, parseAgyStreamEvents, mapAgyUsage, classifyAgyError } from "../src/adapters/antigravity-cli.js";
import type { ProviderEndpoint, ChatCompletionRequest, ChatCompletionResponse } from "@anx/core";

// ── child_process seam ──────────────────────────────────────────────────────
// The adapter spawns `agy`; tests inject a fake child to pin the documented
// headless wire protocol (argv + stdin payload + NDJSON stdout events).
const { execMock, spawnMock } = vi.hoisted(() => ({ execMock: vi.fn(), spawnMock: vi.fn() }));

vi.mock("node:child_process", async () => {
  // node's real `exec` carries a util.promisify.custom that resolves
  // { stdout, stderr }; a bare function promisified would resolve only the
  // first callback value and break `const { stdout } = await execAsync(...)`.
  // The mock must replicate that contract exactly.
  const { promisify } = await import("node:util");
  const execWithCustomPromisify = Object.assign(
    (...args: unknown[]) => execMock(...args),
    {
      [promisify.custom]: (...args: unknown[]) =>
        new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          execMock(...args, (err: unknown, stdout: string, stderr: string) => (err ? reject(err) : resolve({ stdout, stderr })));
        }),
    },
  );
  return { exec: execWithCustomPromisify, spawn: (...args: unknown[]) => spawnMock(...args) };
});

type FakeChild = EventEmitter & {
  pid: number;
  stdout: Readable;
  stderr: Readable;
  stdin: Writable & { writes: string[] };
  kill: () => boolean;
};

function makeFakeChild(opts: { stdoutLines?: string[]; stderrLines?: string[]; exitCode?: number } = {}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4242;
  child.stdout = Readable.from((opts.stdoutLines ?? []).map((l) => `${l}\n`));
  child.stderr = Readable.from((opts.stderrLines ?? []).map((l) => `${l}\n`));
  const writes: string[] = [];
  child.stdin = new Writable({
    write(chunk, _enc, cb) {
      writes.push(String(chunk));
      cb();
    },
  }) as Writable & { writes: string[] };
  child.stdin.writes = writes;
  child.kill = () => true;
  // chatCompletion resolves from the 'close' event; emit it once stdout ends
  // so accumulated stdout is complete (mirrors real process teardown).
  child.stdout.on("end", () => {
    queueMicrotask(() => child.emit("close", opts.exitCode ?? 0));
  });
  return child;
}

const endpoint = { id: "test-endpoint" } as unknown as ProviderEndpoint;

function makeRequest(prompt: string): ChatCompletionRequest {
  return {
    model: "gemini-3.7-flash-medium",
    messages: [{ role: "user", content: prompt }],
  } as unknown as ChatCompletionRequest;
}

// Mirrors the official docs example stream
// (https://antigravity.google/docs/cli/headless) with init abbreviated.
const DOCS_STYLE_SUCCESS_LINES = [
  JSON.stringify({ event: "init", conversation_id: "conv-docs", init: { cwd: "/w", tools: [], permission_mode: "request-review" } }),
  JSON.stringify({ event: "step_update", step_update: { conversation_id: "conv-docs", step_index: 0, state: "DONE", step_type: "user_input" } }),
  JSON.stringify({ event: "step_update", step_update: { conversation_id: "conv-docs", step_index: 2, state: "ACTIVE", step_type: "agent_response", text_delta: "Hello" } }),
  JSON.stringify({ event: "step_update", step_update: { conversation_id: "conv-docs", step_index: 2, state: "DONE", step_type: "agent_response", text_delta: " world", usage: { input_tokens: 30384, output_tokens: 4, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 30388 } } }),
  JSON.stringify({ event: "result", result: { conversation_id: "conv-docs", status: "SUCCESS", response: "Hello world\n", duration_seconds: 1.42, num_turns: 1, usage: { input_tokens: 30384, output_tokens: 4, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 30388 } } }),
];

describe("AntigravityCliAdapter", () => {
  const adapter = new AntigravityCliAdapter();

  beforeEach(() => {
    spawnMock.mockReset();
    execMock.mockReset();
    // Default exec behavior serving findExecutable/getVersion/discoverModels.
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: unknown, stdout: string, stderr: string) => void) => {
      if (typeof cb !== "function") return;
      if (cmd.includes("--version")) cb(null, "1.1.25\n", "");
      else if (cmd.includes("models")) cb(null, "", "");
      else cb(null, "/fake/agy\n", "");
    });
  });

  it("identifies providerId and displayName correctly", () => {
    expect(adapter.providerId).toBe("antigravity-cli");
    expect(adapter.displayName).toBe("Google Antigravity CLI");
  });

  it("resolves model aliases correctly", () => {
    expect(adapter.resolveModel("antigravity-cli/gemini-3.7-flash-medium")).toBe("gemini-3.7-flash-medium");
    expect(adapter.resolveModel("antigravity/gemini-3.7-flash-medium")).toBe("gemini-3.7-flash-medium");
    expect(adapter.resolveModel("other-model")).toBe("other-model");
  });

  it("parses agy models output correctly without crashing on banners", () => {
    const rawOutput = `Usage: agy.exe models [flags]

List available models

Flags:
  -h      Show help
  --help  Show help
Fetching available models...
gemini-3.8-flash-high	Gemini 3.8 Flash (High)
gemini-3.8-flash-medium	Gemini 3.8 Flash (Medium)
gemini-3.7-flash-high	Gemini 3.7 Flash (High)
gemini-3.7-flash-medium	Gemini 3.7 Flash (Medium)
claude-sonnet-4-6	Claude Sonnet 4.6 (Thinking)
claude-opus-4-6-thinking	Claude Opus 4.6 (Thinking)
gpt-oss-120b-medium	GPT-OSS 120B (Medium)
`;

    const descriptors = adapter.parseModelsOutput(rawOutput);
    expect(descriptors.length).toBe(7);

    const gemini = descriptors.find((d) => d.id === "gemini-3.7-flash-medium");
    expect(gemini).toBeDefined();
    expect(gemini?.displayName).toBe("Gemini 3.7 Flash (Medium)");
    expect(gemini?.providerId).toBe("antigravity-cli");
    expect(gemini?.capabilities?.streaming).toBe(true);
    expect(gemini?.capabilities?.toolCalling).toBe(true);
    expect(gemini?.capabilities?.reasoning).toBe(true);
    expect(gemini?.pricing?.isFree).toBe(true);

    const sonnet = descriptors.find((d) => d.id === "claude-sonnet-4-6");
    expect(sonnet).toBeDefined();
    expect(sonnet?.capabilities?.vision).toBe(true);
  });

  it("handles malformed or empty models output gracefully", () => {
    expect(adapter.parseModelsOutput("")).toEqual([]);
    expect(adapter.parseModelsOutput("Fetching available models...\n\nUsage: agy models")).toEqual([]);
    expect(adapter.parseModelsOutput("Invalid line without columns")).toEqual([]);
  });

  it("detects installed executable and parses version", async () => {
    const exe = await adapter.findExecutable();
    if (exe) {
      expect(typeof exe).toBe("string");
      const version = await adapter.getVersion(exe);
      if (version) {
        expect(version).toMatch(/\d+\.\d+\.\d+/);
      }
    }
  }, 15000);

  it("formats multi-turn tool calls and tool results with integrity", () => {
    const messages = [
      { role: "system" as const, content: "You are an agent" },
      { role: "user" as const, content: "Run tool" },
      {
        role: "assistant" as const,
        content: "Calling tool now",
        tool_calls: [
          { id: "call_abc", type: "function" as const, function: { name: "execute_cmd", arguments: '{"command":"ls"}' } }
        ]
      },
      { role: "tool" as const, tool_call_id: "call_abc", content: "file1.txt\nfile2.txt" },
      { role: "user" as const, content: "Summarize results" }
    ];
    const flattened = (adapter as any).flattenMessages(messages);
    expect(flattened).toContain("[System Instructions]");
    expect(flattened).toContain("[Tool Call: execute_cmd id: call_abc]");
    expect(flattened).toContain('Arguments: {"command":"ls"}');
    expect(flattened).toContain("[Tool Result (id: call_abc)]");
    expect(flattened).toContain("file1.txt");
    expect(flattened).toContain("Summarize results");
  });

  it("provides detailed health state", async () => {
    const health = await adapter.getDetailedHealth();
    expect(["READY", "NOT_INSTALLED", "INSTALLED_NOT_AUTHENTICATED", "DEGRADED", "ERROR"]).toContain(health.status);
    expect(health.lastCheck).toBeGreaterThan(0);
  }, 20000);
});

// ── Documented headless wire protocol (regression: "agents only greet") ─────
// Commit d634e61 switched the prompt to stdin using `agy -p -` + raw stdin
// text. The official headless docs (v1.1.25) say: `-p` takes the prompt as an
// argv VALUE; stdin prompts require `--input-format stream-json` NDJSON user
// events; in that mode "any prompt passed through a command-line flag is
// dropped". The broken invocation therefore started sessions with NO task —
// the upstream agent just booted, initialized its skills/settings, and
// greeted, which is exactly the "Hello! All permanent skills and settings
// have been initialized." report from every gatewayed agent.
describe("agy headless wire protocol", () => {
  const adapter = new AntigravityCliAdapter();

  beforeEach(() => {
    spawnMock.mockReset();
    execMock.mockReset();
    execMock.mockImplementation((_cmd: string, _opts: unknown, cb?: (err: unknown, stdout: string, stderr: string) => void) => {
      if (typeof cb === "function") cb(null, "/fake/agy\n", "");
    });
  });

  it("buildAgySpawnArgs uses the documented stream-json input pairing and never passes -p", () => {
    const args = buildAgySpawnArgs("gemini-3.7-flash-medium");
    expect(args).toEqual([
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "--print-timeout", "30m",
      "--model", "gemini-3.7-flash-medium",
    ]);
    expect(args).not.toContain("-p");
    expect(args).not.toContain("-");
  });

  it("buildAgyStdinMessage emits exactly one NDJSON user event preserving arbitrary prompt content", () => {
    const prompt = 'multi\nline "quoted" prompt with \\backslash and\ttabs';
    const line = buildAgyStdinMessage(prompt);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1).includes("\n")).toBe(false); // single line
    const parsed = JSON.parse(line) as { event: string; message: { content: string } };
    expect(parsed.event).toBe("user");
    expect(parsed.message.content).toBe(prompt);
  });

  it("parseAgyStreamEvents collects result events and text deltas from docs-style output", () => {
    const raw = DOCS_STYLE_SUCCESS_LINES.join("\n");
    const events = parseAgyStreamEvents(raw);
    expect(events.results).toHaveLength(1);
    expect(events.results[0]?.status).toBe("SUCCESS");
    expect(events.results[0]?.response).toBe("Hello world\n");
    expect(events.deltas).toEqual(["Hello", " world"]);
  });

  it("parseAgyStreamEvents tolerates non-JSON noise and legacy single envelopes", () => {
    const legacy = JSON.stringify({ conversation_id: "c9", status: "SUCCESS", response: "legacy", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    const events = parseAgyStreamEvents(["banner noise", "", legacy, "trailing noise"].join("\n"));
    expect(events.results).toHaveLength(1);
    expect(events.results[0]?.response).toBe("legacy");
    expect(events.deltas).toEqual([]);
  });

  it("mapAgyUsage maps snake_case counters onto internal TokenUsage incl. cache reads", () => {
    expect(
      mapAgyUsage({ input_tokens: 30384, output_tokens: 4, thinking_tokens: 7, cache_read_tokens: 30214, total_tokens: 30388 }),
    ).toEqual({
      promptTokens: 30384,
      completionTokens: 4,
      totalTokens: 30388,
      reasoningTokens: 7,
      cachedTokens: 30214,
    });
    expect(mapAgyUsage(undefined)).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0, cachedTokens: 0 });
  });

  it("classifyAgyError keeps the shared 429/400/500 taxonomy", () => {
    const quota = classifyAgyError("e1", "quota reached for your subscription");
    expect(quota.status).toBe(429);
    expect(quota.context.errorCode).toBe("UPSTREAM_429");
    expect(quota.context.retryable).toBe(false);

    const model = classifyAgyError("e1", 'invalid model selection: model x is not recognized as a known model');
    expect(model.status).toBe(400);
    expect(model.context.errorCode).toBe("INVALID_MODEL");
    expect(model.context.retryable).toBe(false);

    const other = classifyAgyError("e1", "workspace exploded");
    expect(other.status).toBe(500);
    expect(other.context.errorCode).toBe("AGY_ERROR");
    expect(other.context.retryable).toBe(true);
  });

  it("chatCompletion spawns the documented argv and feeds the prompt as one NDJSON user event", async () => {
    const child = makeFakeChild({ stdoutLines: DOCS_STYLE_SUCCESS_LINES, exitCode: 0 });
    spawnMock.mockReturnValue(child);

    const resp = await adapter.chatCompletion(endpoint, makeRequest("Fix the login bug"), new AbortController().signal);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [exe, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    expect(exe).toBe("/fake/agy");
    expect(args).toEqual(buildAgySpawnArgs("gemini-3.7-flash-medium"));
    expect(args).not.toContain("-p");

    expect(child.stdin.writes).toHaveLength(1);
    expect(child.stdin.writes[0]).toBe(buildAgyStdinMessage("Fix the login bug"));

    expect(resp.choices[0]?.message?.content).toBe("Hello world\n");
    expect(resp.id).toBe("chatcmpl-conv-docs");
    expect(resp.usage).toEqual(mapAgyUsage({ input_tokens: 30384, output_tokens: 4, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 30388 }));
  });

  it("chatCompletion carries the FULL prompt (300KB) with no argv length loss", async () => {
    const child = makeFakeChild({ stdoutLines: DOCS_STYLE_SUCCESS_LINES, exitCode: 0 });
    spawnMock.mockReturnValue(child);

    const marker = "END_MARKER_42";
    const hugePrompt = `${"x".repeat(300_000)} ${marker}`;
    await adapter.chatCompletion(endpoint, makeRequest(hugePrompt), new AbortController().signal);

    expect(child.stdin.writes).toHaveLength(1);
    expect(child.stdin.writes[0]).toContain(marker);
    expect(child.stdin.writes[0]).toBe(buildAgyStdinMessage(hugePrompt));
  });

  it("chatCompletion classifies structured ERROR results (quota → 429) even on exit 1", async () => {
    const errorLines = [
      JSON.stringify({ event: "init", conversation_id: "c", init: {} }),
      JSON.stringify({ event: "result", result: { conversation_id: "c", status: "ERROR", response: "", error: "quota reached for your subscription", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }),
    ];
    spawnMock.mockReturnValue(makeFakeChild({ stdoutLines: errorLines, stderrLines: ["some stderr"], exitCode: 1 }));

    await expect(adapter.chatCompletion(endpoint, makeRequest("task"), new AbortController().signal)).rejects.toMatchObject({
      status: 429,
      context: { errorCode: "UPSTREAM_429" },
    });
  });

  it("chatCompletion keeps stderr-based auth classification when no result event arrives", async () => {
    spawnMock.mockReturnValue(makeFakeChild({ stdoutLines: [], stderrLines: ["authentication required: run agy to log in"], exitCode: 1 }));

    await expect(adapter.chatCompletion(endpoint, makeRequest("task"), new AbortController().signal)).rejects.toMatchObject({
      status: 401,
      context: { errorCode: "NOT_AUTHENTICATED" },
    });
  });

  it("streamChatCompletion streams deltas, ignores init, and ends with clean camelCase usage", async () => {
    const child = makeFakeChild({ stdoutLines: DOCS_STYLE_SUCCESS_LINES, exitCode: 0 });
    spawnMock.mockReturnValue(child);

    const chunks: ChatCompletionResponse[] = [];
    for await (const chunk of adapter.streamChatCompletion(endpoint, makeRequest("Fix the login bug"), new AbortController().signal)) {
      chunks.push(chunk as unknown as ChatCompletionResponse);
    }

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0] as unknown as [string, string[]];
    expect(args).toEqual(buildAgySpawnArgs("gemini-3.7-flash-medium"));
    expect(args).not.toContain("-p");

    const texts = chunks.map((c) => (c.choices?.[0] as unknown as { delta?: { content?: string } })?.delta?.content);
    expect(texts[0]).toBe(""); // role chunk
    expect(texts.slice(1).filter((t) => t !== undefined)).toEqual(["Hello", " world"]);

    const final = chunks[chunks.length - 1] as unknown as { choices?: Array<{ finish_reason?: string }>; usage?: Record<string, unknown> };
    expect(final.choices?.[0]?.finish_reason).toBe("stop");
    expect(final.usage).toEqual(mapAgyUsage({ input_tokens: 30384, output_tokens: 4, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 30388 }));
    // The pre-V5 hybrid double-keyed usage (snake_case keys on the internal
    // TokenUsage) must stay gone — the gateway wire boundary owns egress.
    expect("prompt_tokens" in (final.usage ?? {})).toBe(false);
    expect("total_tokens" in (final.usage ?? {})).toBe(false);
  });

  it("streamChatCompletion surfaces structured ERROR results with the shared taxonomy", async () => {
    const errorLines = [
      JSON.stringify({ event: "init", conversation_id: "c", init: {} }),
      JSON.stringify({ event: "result", result: { conversation_id: "c", status: "ERROR", response: "", error: 'invalid model selection (--model "nope"): model nope is not recognized as a known model' } }),
    ];
    spawnMock.mockReturnValue(makeFakeChild({ stdoutLines: errorLines, exitCode: 1 }));

    await expect(async () => {
      for await (const _chunk of adapter.streamChatCompletion(endpoint, makeRequest("task"), new AbortController().signal)) {
        // drain until the error
      }
    }).rejects.toMatchObject({ status: 400, context: { errorCode: "INVALID_MODEL" } });
  });
});

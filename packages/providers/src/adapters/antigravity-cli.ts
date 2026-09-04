/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AntigravityCliAdapter — First-class CLI-native provider adapter for
 * Google Antigravity CLI (`agy`).
 *
 * Implements the standard `ProviderAdapter` port from `@anx/core`:
 *   - Non-interactive execution via the documented headless stdin protocol
 *   - Streaming execution via `--input-format stream-json --output-format stream-json`
 *   - Dynamic model discovery via `agy models`
 *   - Transparent session/auth inheritance (never extracts keys/tokens)
 *   - Safe process lifecycle, cancellation, and cross-platform process tree killing
 *
 * ⚠ Wire protocol (verified against https://antigravity.google/docs/cli/headless,
 *   Antigravity CLI v1.1.25):
 *   `-p` takes the prompt AS AN ARGV VALUE — there is no `-` (stdin) form.
 *   Prompts are fed via stdin ONLY as NDJSON user events
 *   (`{"event":"user","message":{"content":...}}`) with `--input-format
 *   stream-json`, which REQUIRES `--output-format stream-json`. In that mode
 *   "any prompt passed through a command-line flag is dropped" — so `-p` must
 *   NOT be passed at all. Piping raw prompt text to stdin (or `-p -`) yields a
 *   session with NO task: the agent just boots and greets.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { exec, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ModelDescriptor,
  ProviderAdapter,
  ProviderEndpoint,
  TokenUsage,
} from "@anx/core";
import { ProviderResponseError } from "@anx/core";

const execAsync = promisify(exec);

/** Official headless-mode reference for the wire protocol implemented below. */
export const AGY_HEADLESS_DOCS_URL = 'https://antigravity.google/docs/cli/headless';

/**
 * Builds the argv for a one-turn headless agy session.
 *
 * Per the official docs (`AGY_HEADLESS_DOCS_URL`):
 *   - `--input-format stream-json` reads NDJSON prompts on stdin and REQUIRES
 *     `--output-format stream-json` (any other pairing loses every turn but
 *     the last).
 *   - `-p` MUST be absent: streaming input mode drops CLI-flag prompts.
 *   - `--print-timeout` is raised from the 5m default so long agentic coding
 *     turns are not silently killed mid-flight.
 */
export function buildAgySpawnArgs(model?: string): string[] {
  const args: string[] = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--dangerously-skip-permissions',
    '--print-timeout',
    '30m',
  ];
  if (model) {
    args.push('--model', model);
  }
  return args;
}

/**
 * Serializes one prompt as the documented NDJSON user event (single line —
 * JSON.stringify never emits raw newlines, so the payload is always exactly
 * one stdin line regardless of embedded newlines in the prompt).
 */
export function buildAgyStdinMessage(prompt: string): string {
  return `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n`;
}

/** Usage counters of one completed agy turn (snake_case wire shape). */
export interface AgyUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}

/** The terminal `result` event of an agy headless session. */
export interface AgyResultEvent {
  conversation_id?: string;
  status?: 'SUCCESS' | 'ERROR' | 'CANCELED' | 'INTERRUPTED' | 'INVALID' | 'WAITING' | 'RUNNING';
  response?: string;
  error?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: AgyUsage;
}

/** Parsed view of one agy `--output-format stream-json` stdout stream. */
export interface AgyStreamParse {
  /** Every terminal `result` event, in arrival order. */
  results: AgyResultEvent[];
  /** Concatenated `step_update` agent text deltas (fallback text). */
  deltas: string[];
}

/**
 * Line-based parser for agy NDJSON event streams. Tolerates non-JSON lines
 * (banner/progress output goes to stderr per the docs, but older builds have
 * been known to leak text on stdout).
 */
export function parseAgyStreamEvents(raw: string): AgyStreamParse {
  const parse: AgyStreamParse = { results: [], deltas: [] };
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const evt = JSON.parse(trimmed) as {
        event?: string;
        step_update?: { text_delta?: string };
        result?: AgyResultEvent;
        status?: AgyResultEvent['status'];
        error?: string;
        usage?: AgyUsage;
        conversation_id?: string;
        response?: string;
      };
      if (evt.event === 'result' && evt.result) {
        parse.results.push(evt.result);
      } else if (evt.event === 'step_update' && typeof evt.step_update?.text_delta === 'string') {
        parse.deltas.push(evt.step_update.text_delta);
      } else if (!evt.event && (evt.status || evt.error || evt.usage)) {
        // Legacy single-envelope print mode (`--output-format json` without
        // stream input): treat it as a terminal result.
        parse.results.push({
          conversation_id: evt.conversation_id,
          status: evt.status,
          response: evt.response,
          error: evt.error,
          usage: evt.usage,
        });
      }
    } catch {
      // Non-JSON line — ignore here; callers keep the raw text for fallback.
    }
  }
  return parse;
}

/** Maps agy snake_case usage onto the internal camelCase TokenUsage. */
export function mapAgyUsage(usage?: AgyUsage): TokenUsage {
  return {
    promptTokens: usage?.input_tokens || 0,
    completionTokens: usage?.output_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
    reasoningTokens: usage?.thinking_tokens || 0,
    cachedTokens: usage?.cache_read_tokens || 0,
  };
}

/**
 * Classifies an agy ERROR payload into the shared ProviderResponseError
 * taxonomy used by both execution paths (quota → 429, model → 400, rest → 500).
 */
export function classifyAgyError(endpointId: string, agyError: string): ProviderResponseError {
  const errText = String(agyError);
  const isQuotaErr = /quota reached|quota exceeded|rate limit|upgrade your subscription/i.test(errText);
  const isModelErr = /invalid model selection|is not recognized as a known model/i.test(errText);
  return new ProviderResponseError(
    endpointId,
    isQuotaErr ? 429 : isModelErr ? 400 : 500,
    errText,
    {
      errorCode: isQuotaErr ? 'UPSTREAM_429' : isModelErr ? 'INVALID_MODEL' : 'AGY_ERROR',
      retryable: !isQuotaErr && !isModelErr,
    },
  );
}

export interface AntigravityModelMetadata {
  id: string;
  displayName: string;
  rawLine: string;
}

export interface AntigravityHealthInfo {
  status: "READY" | "INSTALLED_NOT_AUTHENTICATED" | "NOT_INSTALLED" | "DEGRADED" | "ERROR";
  executable?: string;
  version?: string;
  modelCount?: number;
  lastCheck: number;
  error?: string;
}

export class AntigravityCliAdapter implements ProviderAdapter {
  readonly providerId = "antigravity-cli";
  readonly displayName = "Google Antigravity CLI";

  private cachedExecutable: string | null | undefined = undefined;
  private cachedVersion: string | undefined = undefined;

  private readonly defaultBinaries = ["agy", "agy.exe"];
  private readonly wellKnownPaths = [
    join("AppData", "Local", "agy", "bin", "agy.exe"),
    join(".local", "bin", "agy"),
    join(".agy", "bin", "agy.exe"),
    "/usr/local/bin/agy",
    "/usr/bin/agy",
  ];

  /**
   * Resolves the executable path across PATH and well-known locations.
   */
  async findExecutable(): Promise<string | undefined> {
    if (this.cachedExecutable !== undefined) {
      return this.cachedExecutable === null ? undefined : this.cachedExecutable;
    }

    const isWin = platform() === "win32";
    const ext = isWin ? ".exe" : "";

    // 1. Check well-known installation paths
    const home = homedir();
    for (const relPath of this.wellKnownPaths) {
      const full = isAbsolute(relPath) ? relPath : join(home, relPath);
      try {
        await access(full, constants.X_OK);
        this.cachedExecutable = full;
        return full;
      } catch {
        // continue
      }
    }

    // 2. Check system PATH via where (Windows) or which (Unix)
    for (const bin of this.defaultBinaries) {
      const binName = isWin && !bin.endsWith(".exe") ? `${bin}${ext}` : bin;
      try {
        const cmd = isWin ? `where ${binName}` : `which ${binName}`;
        const { stdout } = await execAsync(cmd, { timeout: 2500 });
        const first = stdout.trim().split(/\r?\n/)[0]?.trim();
        if (first) {
          this.cachedExecutable = first;
          return first;
        }
      } catch {
        // continue
      }
    }

    this.cachedExecutable = null;
    return undefined;
  }

  /**
   * Retrieves the version of the installed CLI.
   */
  async getVersion(executablePath?: string): Promise<string | undefined> {
    if (this.cachedVersion) return this.cachedVersion;
    const exe = executablePath ?? (await this.findExecutable());
    if (!exe) return undefined;

    try {
      const { stdout } = await execAsync(`"${exe}" --version`, { timeout: 10000 });
      const match = stdout.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/);
      if (match) {
        this.cachedVersion = match[0];
        return this.cachedVersion;
      }
      const first = stdout.trim().split("\n")[0]?.trim();
      this.cachedVersion = first;
      return first;
    } catch {
      return undefined;
    }
  }

  /**
   * Lightweight health check conforming to ProviderAdapter interface.
   */
  async healthCheck(_endpoint: ProviderEndpoint, _signal: AbortSignal): Promise<boolean> {
    const exe = await this.findExecutable();
    if (!exe) return false;
    const version = await this.getVersion(exe);
    return Boolean(version);
  }

  /**
   * Rich health check returning granular diagnostic status.
   */
  async getDetailedHealth(): Promise<AntigravityHealthInfo> {
    const lastCheck = Date.now();
    const exe = await this.findExecutable();
    if (!exe) {
      return {
        status: "NOT_INSTALLED",
        lastCheck,
        error: "Google Antigravity CLI (agy) was not found in PATH or standard installation locations.",
      };
    }

    const version = await this.getVersion(exe);
    if (!version) {
      return {
        status: "ERROR",
        executable: exe,
        lastCheck,
        error: "Executable exists but failed to respond to --version.",
      };
    }

    try {
      const models = await this.discoverModels({} as ProviderEndpoint, AbortSignal.timeout(15000));
      if (models.length === 0) {
        return {
          status: "DEGRADED",
          executable: exe,
          version,
          modelCount: 0,
          lastCheck,
          error: "Executable runs but no models were discovered.",
        };
      }
      return {
        status: "READY",
        executable: exe,
        version,
        modelCount: models.length,
        lastCheck,
      };
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (/auth|unauthorized|login|credential/i.test(msg)) {
        return {
          status: "INSTALLED_NOT_AUTHENTICATED",
          executable: exe,
          version,
          lastCheck,
          error: "Antigravity CLI is installed but not authenticated. Run agy to authenticate.",
        };
      }
      return {
        status: "DEGRADED",
        executable: exe,
        version,
        lastCheck,
        error: msg,
      };
    }
  }

  /**
   * Dynamic model discovery via agy models.
   */
  async discoverModels(_endpoint: ProviderEndpoint, signal: AbortSignal): Promise<readonly ModelDescriptor[]> {
    const exe = await this.findExecutable();
    if (!exe) return [];

    try {
      const { stdout } = await execAsync(`"${exe}" models`, {
        timeout: 10000,
        signal,
      });

      return this.parseModelsOutput(stdout);
    } catch {
      return [];
    }
  }

  /**
   * Robust parser for agy models output.
   * Strips headers/progress and normalizes into ModelDescriptors.
   */
  parseModelsOutput(raw: string): ModelDescriptor[] {
    const lines = raw.split(/\r?\n/);
    const descriptors: ModelDescriptor[] = [];
    const now = Date.now();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (
        line.startsWith("Usage:") ||
        line.startsWith("Flags:") ||
        line.startsWith("List available") ||
        line.startsWith("Fetching") ||
        line.startsWith("-h") ||
        line.startsWith("--")
      ) {
        continue;
      }

      const parts = line.split(/\t+|\s{2,}/);
      const modelId = parts[0]?.trim();
      const displayName = parts[1]?.trim() || modelId;

      if (!modelId || modelId.includes(" ")) {
        continue;
      }

      const lower = modelId.toLowerCase();
      const isReasoning = lower.includes("high") || lower.includes("medium") || lower.includes("thinking") || lower.includes("opus");
      const isVision = lower.includes("gemini") || lower.includes("sonnet") || lower.includes("opus");

      descriptors.push({
        id: modelId,
        providerId: this.providerId,
        displayName,
        ownedBy: "google-antigravity",
        contextWindow: lower.includes("gemini") ? 1_000_000 : 200_000,
        maxOutputTokens: 8192,
        capabilities: {
          streaming: true,
          toolCalling: true,
          vision: isVision,
          audio: false,
          speech: false,
          embeddings: false,
          reasoning: isReasoning,
          jsonMode: true,
        },
        pricing: {
          inputPer1M: 0,
          outputPer1M: 0,
          isFree: true,
          freeTier: "FREE",
          source: "adapter_fallback",
          updatedAt: now,
        },
        discoveredAt: now,
      });
    }

    return descriptors;
  }

  /**
   * Non-streaming Chat Completion execution.
   */
  async chatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const exe = await this.findExecutable();
    if (!exe) {
      throw new ProviderResponseError(
        endpoint.id,
        503,
        "Antigravity CLI executable (agy) not found on system PATH",
        { errorCode: "CLI_NOT_FOUND", retryable: false },
      );
    }

    const prompt = this.flattenMessages(request.messages);
    // Strip provider prefix, uri schemes, and nexus virtual alias prefixes.
    const model = request.model
      .replace(/^antigravity-cli\//, '')
      .replace(/^antigravity\//, '')
      .replace(/^nexus\//, '')
      .replace(/^cli:\/\/[^/]+\//, '')  // cli://path/to/exe/modelname → modelname
      .replace(/^cli:\/\/.*/, '');      // bare cli://... with no model → empty
    // If after stripping we still have a path-like value or an empty string
    // (meaning the caller sent a generic/routing alias), refuse with a clear error.
    if (!model || model.includes('://') || model.includes('nexus/')) {
      throw new ProviderResponseError(
        endpoint.id,
        422,
        `AntigravityCliAdapter cannot execute model alias '${request.model}' — pass a concrete agy model id (e.g. gemini-3.7-flash-medium)`,
        { errorCode: 'MODEL_ALIAS_NOT_SUPPORTED', retryable: false },
      );
    }
    const cwd = (request.metadata?.['cwd'] as string) || (request.metadata?.['workspace'] as string) || process.cwd();

    const args = buildAgySpawnArgs(model || undefined);

    const startTime = Date.now();
    let stdoutAcc = "";
    let stderrAcc = "";

    return new Promise<ChatCompletionResponse>((resolvePromise, rejectPromise) => {
      const child = spawn(exe, args, {
        cwd,
        env: {
          ...process.env,
          NODE_ENV: "production",
        },
        shell: false,
        windowsHide: true,
      });

      // Feed the prompt via stdin as the documented NDJSON user event —
      // never as argv (`-p` is dropped in stream-input mode) and never as
      // raw stdin text. This also sidesteps the Windows ENAMETOOLONG argv
      // limit that motivated the original stdin switch (d634e61).
      child.stdin.on("error", () => {
        // The child died before consuming stdin (e.g. auth failure). The
        // close handler below classifies the failure from stderr/stdout.
      });
      child.stdin.write(buildAgyStdinMessage(prompt));
      child.stdin.end();

      const abortHandler = () => {
        this.killProcessTree(child);
        rejectPromise(new ProviderResponseError(endpoint.id, 499, "Request aborted", { errorCode: "PROCESS_CANCELLED", retryable: false }));
      };

      if (signal.aborted) {
        abortHandler();
        return;
      }
      signal.addEventListener("abort", abortHandler, { once: true });

      child.stdout.on("data", (d) => {
        stdoutAcc += d.toString("utf8");
      });

      child.stderr.on("data", (d) => {
        stderrAcc += d.toString("utf8");
      });

      child.on("error", (err) => {
        signal.removeEventListener("abort", abortHandler);
        rejectPromise(
          new ProviderResponseError(endpoint.id, 500, `Process error: ${err.message}`, { errorCode: "PROCESS_START_FAILED", retryable: false }),
        );
      });

      child.on('close', (code) => {
        signal.removeEventListener('abort', abortHandler);
        const latencyMs = Date.now() - startTime;

        // Prefer the structured terminal result (documented stream-json
        // protocol) over the exit code: agy reports ERROR results with
        // exit 1, and the result error text is the authoritative reason.
        const events = parseAgyStreamEvents(stdoutAcc);
        const lastResult = events.results[events.results.length - 1];

        if (lastResult?.status === 'ERROR' && lastResult.error) {
          rejectPromise(classifyAgyError(endpoint.id, lastResult.error));
          return;
        }

        if (code !== 0) {
          const errText = stderrAcc.trim() || stdoutAcc.trim() || `CLI exited with code ${code}`;
          if (/auth|login|unauthorized/i.test(errText)) {
            rejectPromise(new ProviderResponseError(endpoint.id, 401, errText, { errorCode: 'NOT_AUTHENTICATED', retryable: false }));
            return;
          }
          // Model not recognized / invalid selection — not retryable
          if (/invalid model selection|is not recognized as a known model/i.test(errText)) {
            rejectPromise(new ProviderResponseError(endpoint.id, 400, errText, { errorCode: 'INVALID_MODEL', retryable: false }));
            return;
          }
          if (/quota reached|quota exceeded|rate limit|upgrade your subscription/i.test(errText)) {
            rejectPromise(new ProviderResponseError(endpoint.id, 429, errText, { errorCode: 'UPSTREAM_429', retryable: false }));
            return;
          }
          rejectPromise(new ProviderResponseError(endpoint.id, 500, errText, { errorCode: 'CLI_EXIT_NONZERO', retryable: true }));
          return;
        }

        const textResponse = (lastResult?.response ?? events.deltas.join('')) || stdoutAcc.trim();

        resolvePromise({
          id: lastResult?.conversation_id ? `chatcmpl-${lastResult.conversation_id}` : `chatcmpl-${randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: model || "antigravity-cli",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: textResponse,
              },
              finish_reason: "stop",
            },
          ],
          usage: mapAgyUsage(lastResult?.usage),
          provider: this.providerId,
          endpoint: endpoint.id,
          latencyMs,
        });
      });
    });
  }

  /**
   * Streaming Chat Completion execution via agy -p ... --output-format stream-json.
   */
  async *streamChatCompletion(
    endpoint: ProviderEndpoint,
    request: ChatCompletionRequest,
    signal: AbortSignal,
  ): AsyncIterable<ChatCompletionChunk> {
    const exe = await this.findExecutable();
    if (!exe) {
      throw new ProviderResponseError(
        endpoint.id,
        503,
        "Antigravity CLI executable (agy) not found on system PATH",
        { errorCode: "CLI_NOT_FOUND", retryable: false },
      );
    }

    const prompt = this.flattenMessages(request.messages);
    const model = request.model
      .replace(/^antigravity-cli\//, '')
      .replace(/^antigravity\//, '')
      .replace(/^nexus\//, '')
      .replace(/^cli:\/\/[^/]+\//, '')
      .replace(/^cli:\/\/.*/, '');
    if (!model || model.includes('://') || model.includes('nexus/')) {
      throw new ProviderResponseError(
        endpoint.id,
        422,
        `AntigravityCliAdapter cannot execute model alias '${request.model}' — pass a concrete agy model id (e.g. gemini-3.7-flash-medium)`,
        { errorCode: 'MODEL_ALIAS_NOT_SUPPORTED', retryable: false },
      );
    }
    const cwd = (request.metadata?.['cwd'] as string) || (request.metadata?.['workspace'] as string) || process.cwd();

    const args = buildAgySpawnArgs(model || undefined);

    const child = spawn(exe, args, {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
      shell: false,
      windowsHide: true,
    });

    // Feed the prompt via stdin as the documented NDJSON user event (never
    // `-p`, which stream-input mode drops; never raw stdin text). One JSON
    // line, then close stdin — agy finishes the turn, emits its `result`
    // event, and exits 0.
    child.stdin.on("error", () => {
      // Child died before consuming stdin (e.g. auth failure). The reader
      // loop below ends and the generator surfaces whatever arrived.
    });
    child.stdin.write(buildAgyStdinMessage(prompt));
    child.stdin.end();

    const abortHandler = () => {
      this.killProcessTree(child);
    };

    if (signal.aborted) {
      abortHandler();
      return;
    }
    signal.addEventListener("abort", abortHandler, { once: true });

    const rl = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    const streamId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    yield {
      id: streamId,
      object: "chat.completion.chunk",
      created,
      model: model || "antigravity-cli",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
        },
      ],
    };

    try {
      for await (const line of rl) {
        if (signal.aborted) break;
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: {
          event?: string;
          step_update?: { text_delta?: unknown };
          status?: string;
          error?: unknown;
          result?: { status?: string; error?: unknown; usage?: Parameters<typeof mapAgyUsage>[0] };
        };
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // Non-JSON stdout line — preserve it as content (legacy behavior).
          yield {
            id: streamId,
            object: "chat.completion.chunk",
            created,
            model: model || "antigravity-cli",
            choices: [
              {
                index: 0,
                delta: { content: line + "\n" },
                finish_reason: null,
              },
            ],
          };
          continue;
        }

        if (parsed.event === "step_update" && typeof parsed.step_update?.text_delta === "string") {
          yield {
            id: streamId,
            object: "chat.completion.chunk",
            created,
            model: model || "antigravity-cli",
            choices: [
              {
                index: 0,
                delta: { content: parsed.step_update.text_delta },
                finish_reason: null,
              },
            ],
          };
        } else if (parsed.event === "result" && parsed.result) {
          if (parsed.result.status === "ERROR" && parsed.result.error) {
            throw classifyAgyError(endpoint.id, String(parsed.result.error));
          }
          // Clean internal camelCase usage — the gateway's single OpenAI wire
          // boundary (apps/gateway/src/openai-wire.ts) owns snake_case egress,
          // including prompt_tokens_details.cached_tokens from cache_read_tokens.
          yield {
            id: streamId,
            object: "chat.completion.chunk",
            created,
            model: model || "antigravity-cli",
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
            usage: parsed.result.usage ? mapAgyUsage(parsed.result.usage) : undefined,
          };
        } else if (!parsed.event && parsed.status === 'ERROR' && parsed.error) {
          // Legacy single-envelope error (print mode) — fail loudly.
          throw classifyAgyError(endpoint.id, String(parsed.error));
        }
        // `init` and unrecognized events carry no user-visible payload — ignore.
      }
    } finally {
      signal.removeEventListener("abort", abortHandler);
      this.killProcessTree(child);
    }
  }

  resolveModel(alias: string): string | undefined {
    if (alias.startsWith("antigravity-cli/")) {
      return alias.replace(/^antigravity-cli\//, "");
    }
    if (alias.startsWith("antigravity/")) {
      return alias.replace(/^antigravity\//, "");
    }
    return alias;
  }

  private flattenMessages(messages: readonly ChatMessage[]): string {
    if (!messages || messages.length === 0) return "";
    const parts: string[] = [];

    for (const m of messages) {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      const toolCalls = m.toolCalls ?? m.tool_calls;
      const toolCallId = m.toolCallId ?? m.tool_call_id;

      if (m.role === "system") {
        parts.push(`[System Instructions]\n${content}\n`);
      } else if (m.role === "user") {
        parts.push(content);
      } else if (m.role === "assistant") {
        let text = content ? `[Assistant]\n${content}\n` : `[Assistant]\n`;
        if (toolCalls && toolCalls.length > 0) {
          for (const tc of toolCalls) {
            text += `\n[Tool Call: ${tc.function?.name ?? 'unknown'} id: ${tc.id}]\nArguments: ${tc.function?.arguments ?? '{}'}\n`;
          }
        }
        parts.push(text.trim());
      } else if (m.role === "tool" || m.role === "function") {
        const idInfo = toolCallId ? ` (id: ${toolCallId})` : "";
        parts.push(`[Tool Result${idInfo}]\n${content}\n`);
      }
    }

    return parts.join("\n\n").trim();
  }

  protected killProcessTree(child: ChildProcess): void {
    if (!child.pid) return;
    if (platform() === "win32") {
      try {
        exec(`taskkill /pid ${child.pid} /T /F`);
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }
  }
}

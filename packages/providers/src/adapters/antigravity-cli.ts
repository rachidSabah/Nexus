/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AntigravityCliAdapter — First-class CLI-native provider adapter for
 * Google Antigravity CLI (`agy`).
 *
 * Implements the standard `ProviderAdapter` port from `@anx/core`:
 *   - Non-interactive execution via `agy -p <prompt> --output-format json`
 *   - Streaming execution via `agy -p <prompt> --output-format stream-json`
 *   - Dynamic model discovery via `agy models`
 *   - Transparent session/auth inheritance (never extracts keys/tokens)
 *   - Safe process lifecycle, cancellation, and cross-platform process tree killing
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
} from "@anx/core";
import { ProviderResponseError } from "@anx/core";

const execAsync = promisify(exec);

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

    const args: string[] = [
      '-p',
      '-',
      '--output-format',
      'json',
      '--dangerously-skip-permissions',
    ];

    if (model) {
      args.push('--model', model);
    }

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

      // Write prompt via stdin to avoid Windows command line length limit (ENAMETOOLONG)
      child.stdin.write(prompt);
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

        try {
          const parsed = JSON.parse(stdoutAcc.trim());
          // agy returns status: ERROR on exit 0 or non-zero for model/session/quota errors
          if (parsed.status === 'ERROR' && parsed.error) {
            const agy_err = String(parsed.error);
            const isModelErr = /invalid model selection|is not recognized as a known model/i.test(agy_err);
            const isQuotaErr = /quota reached|quota exceeded|rate limit|upgrade your subscription/i.test(agy_err);
            if (isQuotaErr) {
              rejectPromise(new ProviderResponseError(endpoint.id, 429, agy_err, { errorCode: 'UPSTREAM_429', retryable: false }));
              return;
            }
            rejectPromise(new ProviderResponseError(endpoint.id, isModelErr ? 400 : 500, agy_err, { errorCode: isModelErr ? 'INVALID_MODEL' : 'AGY_ERROR', retryable: !isModelErr }));
            return;
          }
          const textResponse = parsed.response ?? '';
          const usage = parsed.usage ?? {};

          resolvePromise({
            id: parsed.conversation_id ? `chatcmpl-${parsed.conversation_id}` : `chatcmpl-${randomUUID()}`,
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
            usage: {
              promptTokens: usage.input_tokens || 0,
              completionTokens: usage.output_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              reasoningTokens: usage.thinking_tokens || 0,
            },
            provider: this.providerId,
            endpoint: endpoint.id,
            latencyMs,
          });
        } catch {
          resolvePromise({
            id: `chatcmpl-${randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model || "antigravity-cli",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: stdoutAcc.trim(),
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
            },
            provider: this.providerId,
            endpoint: endpoint.id,
            latencyMs,
          });
        }
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

    const args: string[] = [
      '-p',
      '-',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
    ];

    if (model) {
      args.push('--model', model);
    }

    const child = spawn(exe, args, {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
      shell: false,
      windowsHide: true,
    });

    // Write prompt via stdin to avoid Windows command line length limit (ENAMETOOLONG)
    child.stdin.write(prompt);
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

        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.event === "step_update" && parsed.step_update?.text_delta) {
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
          } else if (parsed.status === 'ERROR' && parsed.error) {
            const agy_err = String(parsed.error);
            const isQuotaErr = /quota reached|quota exceeded|rate limit|upgrade your subscription/i.test(agy_err);
            const isModelErr = /invalid model selection|is not recognized as a known model/i.test(agy_err);
            throw new ProviderResponseError(
              endpoint.id,
              isQuotaErr ? 429 : (isModelErr ? 400 : 500),
              agy_err,
              { errorCode: isQuotaErr ? 'UPSTREAM_429' : (isModelErr ? 'INVALID_MODEL' : 'AGY_ERROR'), retryable: !isQuotaErr && !isModelErr }
            );
          } else if (parsed.event === "result") {
            if (parsed.result?.status === "ERROR" && parsed.result?.error) {
              const agy_err = String(parsed.result.error);
              const isQuotaErr = /quota reached|quota exceeded|rate limit|upgrade your subscription/i.test(agy_err);
              throw new ProviderResponseError(
                endpoint.id,
                isQuotaErr ? 429 : 500,
                agy_err,
                { errorCode: isQuotaErr ? 'UPSTREAM_429' : 'AGY_ERROR', retryable: !isQuotaErr }
              );
            }
            const usage = parsed.result?.usage;
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
              usage: usage
                ? {
                    promptTokens: usage.input_tokens || 0,
                    completionTokens: usage.output_tokens || 0,
                    totalTokens: usage.total_tokens || 0,
                    reasoningTokens: usage.thinking_tokens || 0,
                  }
                : undefined,
            };
          }
        } catch {
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
        }
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

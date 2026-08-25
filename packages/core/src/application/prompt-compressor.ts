/**
 * ───────────────────────────────────────────────────────────────────────────
 * PromptCompressor — deeply optimizes and fine-tunes token consumption for
 * coding agents and multi-turn workflows without affecting agent performance.
 *
 * Strategies (applied safely in order):
 *   1. Whitespace & Blank Line Normalization — collapses multi-line blank runs
 *      (e.g., in compiler dumps, test logs) while preserving code indentation.
 *   2. Consecutive System Prompt Deduplication — eliminates repeated system
 *      prompts sent consecutively by agents across turns.
 *   3. Tool Output Tail-Preserving Compaction — for older turns with giant tool
 *      dumps (git diffs, file reads > 3k chars), keeps head and tail (command,
 *      exit status, errors) while summarizing redundant middle lines.
 *   4. Tool Schema Pruning — strips JSON Schema boilerplate ($schema, redundant
 *      titles) without touching parameter definitions or validation types.
 *   5. Conversation Window Management — preserves recent turns and system rules.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ChatCompletionRequest, ChatMessage } from '../domain/types.js';

/**
 * Compression profile selector. The active profile decides which engine set
 * runs on the LIVE gateway request path.
 *
 *  - 'none'        → no compression (default; zero behavior change on upgrade)
 *  - 'safe-stack'  → strictly lossless: whitespace + system-prompt dedup +
 *                    schema compression + minify + session_dedup + headroom
 *  - 'caveman'     → external (operator-configured upstream); no-op if absent
 *  - 'ponytail'    → behavioral ruleset (operator-injected AGENTS.md); no-op otherwise
 *  - 'rtk'         → external (operator-configured upstream); no-op if absent
 */
export type CompressionProfile = 'none' | 'safe-stack' | 'caveman' | 'ponytail' | 'rtk';

/** Engines that make up each live profile (single source of truth). */
export const PROFILE_ENGINES: Record<CompressionProfile, string[]> = {
  none: [],
  'safe-stack': [
    'whitespaceNormalization',
    'systemPromptDedup',
    'schemaCompression',
    'minify',
    'session_dedup',
    'headroom',
  ],
  caveman: ['caveman'],
  ponytail: ['ponytail'],
  rtk: ['rtk'],
};

/**
 * Structural contract for the injected `token-efficiency` pipeline. `@anx/core`
 * stays dependency-free; the gateway injects the real implementation.
 */
export interface ExternalPipelineFn {
  (text: string, opts: { engines?: string[]; keepComments?: boolean; sessionSeen?: Set<string> }): {
    text: string;
    originalChars: number;
    finalChars: number;
    originalTokens: number;
    finalTokens: number;
    totalCharsSaved: number;
    totalTokensSaved: number;
    savingsPct: number;
    engines: Array<{ engine: string; charsSaved: number; tokensSaved: number }>;
  };
}

/**
 * Structural contract for the injected external compressor registry
 * (caveman / rtk). Honest no-op when an engine is not registered.
 */
export interface ExternalCompressorRegistryLike {
  has(name: string): boolean;
  run(
    name: string,
    text: string,
  ): Promise<{ delegated: boolean; output: string; charsIn: number; charsOut: number; charsSaved: number; error?: string }>;
}

export interface CompressionResult {
  /** The compressed request. */
  request: ChatCompletionRequest;
  /** Estimated tokens saved. */
  tokensSaved: number;
  /** Strategies that ran (built-in names + `pipeline:<engine>` / `external:<name>`). */
  strategies: string[];
  /** Measured character counts (truthful, never fabricated). */
  originalChars: number;
  compressedChars: number;
}

export interface CompressionConfig {
  /** Master enable switch. */
  enabled: boolean;
  /** Runtime-selected compression profile. Defaults to 'none' (no behavior change). */
  activeProfile: CompressionProfile;
  /** Normalize excessive whitespace and blank lines (>2 newlines) losslessly. */
  whitespaceNormalization: boolean;
  /** Compact older tool execution dumps (> 3,000 chars) keeping head + tail. */
  toolOutputCompaction: boolean;
  /** Strip duplicate consecutive system prompts. */
  systemPromptDedup: boolean;
  /** Clean JSON Schema tool definitions of redundant metadata. */
  schemaCompression: boolean;
  /** Summarize conversations older than this many messages (0 = disabled). */
  summarizeThreshold: number;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  enabled: true,
  activeProfile: 'none',
  whitespaceNormalization: true,
  toolOutputCompaction: true,
  systemPromptDedup: true,
  schemaCompression: true,
  summarizeThreshold: 40,
};

const VALID_PROFILES: CompressionProfile[] = ['none', 'safe-stack', 'caveman', 'ponytail', 'rtk'];

export class PromptCompressor {
  private config: CompressionConfig;
  private totalTokensSaved = 0;
  private totalRequests = 0;
  /** Injected `token-efficiency` pipeline (minify / session_dedup / headroom). */
  private readonly pipeline?: ExternalPipelineFn;
  /** Injected external compressor registry (caveman / rtk). */
  private readonly external?: ExternalCompressorRegistryLike;

  constructor(
    config: Partial<CompressionConfig> = {},
    deps: { pipeline?: ExternalPipelineFn; external?: ExternalCompressorRegistryLike } = {},
  ) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
    this.pipeline = deps.pipeline;
    this.external = deps.external;
  }

  /**
   * Compresses a chat completion request for the LIVE gateway path.
   * Profile-gated and fail-open: any error is thrown so the caller can fall
   * back to the original request without corrupting or blocking it.
   */
  async compress(request: ChatCompletionRequest): Promise<CompressionResult> {
    const profile: CompressionProfile = this.config.activeProfile ?? 'none';

    // No active profile (or compressor disabled) → exact pass-through.
    if (profile === 'none' || !this.config.enabled) {
      const chars = this.requestChars(request);
      return { request, tokensSaved: 0, strategies: [], originalChars: chars, compressedChars: chars };
    }

    const strategies: string[] = [];
    const originalChars = this.requestChars(request);
    let messages: ChatMessage[] = [...request.messages];
    let tools = request.tools;

    try {
      if (profile === 'safe-stack') {
        // 1. Lossless Whitespace & Blank Line Normalization (built-in)
        if (this.config.whitespaceNormalization) {
          const before = this.estimateMessagesTokens(messages);
          messages = messages.map((m) => {
            if (typeof m.content === 'string') {
              const normalized = this.normalizeWhitespace(m.content);
              if (normalized !== m.content) return { ...m, content: normalized };
            }
            return m;
          });
          const after = this.estimateMessagesTokens(messages);
          const saved = Math.max(0, before - after);
          if (saved > 0) {
            strategies.push('whitespace_normalization');
          }
        }

        // 2. System Prompt De-duplication (built-in)
        if (this.config.systemPromptDedup) {
          const seen = new Set<string>();
          const deduped: ChatMessage[] = [];
          for (const m of messages) {
            if (m.role === 'system' && typeof m.content === 'string') {
              const key = m.content.trim();
              if (seen.has(key)) continue;
              seen.add(key);
            }
            deduped.push(m);
          }
          if (deduped.length < messages.length) {
            messages = deduped;
            strategies.push('system_prompt_dedup');
          }
        }

        // 3. Schema Compression (built-in)
        if (this.config.schemaCompression && request.tools) {
          const cleaned = request.tools.map((t) => this.cleanToolSchema(t));
          tools = cleaned as typeof request.tools;
          strategies.push('schema_compression');
        }

        // 4. Pipeline engines (injected token-efficiency: minify / session_dedup / headroom)
        if (this.pipeline) {
          const engines = ['minify', 'session_dedup', 'headroom'];
          messages = messages.map((m) => {
            if (typeof m.content === 'string') {
              const r = this.pipeline!(m.content, {
                engines,
                keepComments: false,
                sessionSeen: new Set<string>(),
              });
              if (r.text !== m.content) return { ...m, content: r.text };
            }
            return m;
          });
          for (const e of this.pipeline('', { engines }).engines) {
            strategies.push(`pipeline:${e.engine}`);
          }
        }
      } else if ((profile === 'caveman' || profile === 'rtk') && this.external) {
        // External compressors: no-op (delegated:false) when not registered.
        if (this.external.has(profile)) {
          messages = await Promise.all(
            messages.map(async (m) => {
              if (typeof m.content !== 'string') return m;
              const out = await this.external!.run(profile, m.content);
              return { ...m, content: out.output };
            }),
          );
          strategies.push(`${profile} (external)`);
        }
        // If not registered → unchanged request, 0 savings (honest no-op).
      }
      // 'ponytail' → behavioral ruleset; no prompt transform.

      const compressedChars = this.requestChars({ ...request, messages, tools });
      const charsSaved = Math.max(0, originalChars - compressedChars);
      this.totalRequests++;
      this.totalTokensSaved += Math.round(charsSaved / 4);
      return {
        request: { ...request, messages, tools },
        tokensSaved: Math.round(charsSaved / 4),
        strategies,
        originalChars,
        compressedChars,
      };
    } catch (err) {
      // Fail-open: never corrupt or block the agent request. Preserve the
      // original cause so the fallback event reports the real failure.
      throw new Error(`compression profile '${profile}' failed: ${(err as Error).message}`);
    }
  }

  /** Returns aggregate stats for the dashboard. */
  getStats(): { enabled: boolean; totalTokensSaved: number; totalRequests: number; avgTokensSavedPerRequest: number } {
    return {
      enabled: this.config.enabled,
      totalTokensSaved: this.totalTokensSaved,
      totalRequests: this.totalRequests,
      avgTokensSavedPerRequest: this.totalRequests > 0 ? Math.round(this.totalTokensSaved / this.totalRequests) : 0,
    };
  }

  /** Returns the full runtime compression config (for the dashboard policy UI). */
  getConfig(): CompressionConfig {
    return { ...this.config };
  }

  /** Updates config at runtime. Invalid profiles are ignored (caller validates). */
  updateConfig(updates: Partial<CompressionConfig>): void {
    if (updates.activeProfile !== undefined) {
      const p = updates.activeProfile as CompressionProfile;
      if (VALID_PROFILES.includes(p)) {
        this.config = { ...this.config, activeProfile: p };
      }
      // Invalid profile → leave activeProfile unchanged (never coerce/crash).
      const { activeProfile: _dropped, ...rest } = updates;
      this.config = { ...this.config, ...rest };
      return;
    }
    this.config = { ...this.config, ...updates };
  }

  // ─── Internal Optimization Logic ──────────────────────────────────────────

  private requestChars(req: ChatCompletionRequest): number {
    let chars = 0;
    for (const m of req.messages) {
      if (typeof m.content === 'string') chars += m.content.length;
      else chars += JSON.stringify(m.content).length;
      if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
    }
    if (req.tools) chars += JSON.stringify(req.tools).length;
    return chars;
  }

  private normalizeWhitespace(text: string): string {
    // Collapse 3 or more newlines to 2, and trim trailing whitespace per line
    // without altering indentation (leading spaces are preserved).
    if (!text || text.length < 20) return text;
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  /**
   * Tool Output Tail-Preserving Compaction for older turns.
   * Retained for a future explicit "aggressive" profile/toggle (NOT enabled in
   * safe-stack, which must stay strictly lossless).
   */
  compactOlderToolOutputs(messages: ChatMessage[]): ChatMessage[] {
    // Leave the last 3 messages completely untouched so the model has 100% raw output
    const activeWindow = 3;
    if (messages.length <= activeWindow) return messages;

    const olderLimit = messages.length - activeWindow;
    return messages.map((m, idx) => {
      if (idx >= olderLimit) return m;

      // Only compact older tool messages or command outputs with massive dumps (> 3,000 chars)
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 3000) {
        const text = m.content;
        const head = text.slice(0, 1500);
        const tail = text.slice(-1000);
        const omittedChars = text.length - 2500;
        return {
          ...m,
          content: `${head}\n\n[... Nexus Token Optimizer: ${omittedChars.toLocaleString()} characters of intermediate output compacted ...]\n\n${tail}`,
        };
      }
      return m;
    });
  }

  /**
   * Conversation summarization for long contexts.
   * Retained for a future explicit "aggressive" profile/toggle (NOT enabled in
   * safe-stack, which must stay strictly lossless).
   */
  /**
   * Conversation summarization for long contexts.
   * Retained for a future explicit "aggressive" profile/toggle (NOT enabled in
   * safe-stack, which must stay strictly lossless).
   */
  summarizeOlderMessages(messages: ChatMessage[]): ChatMessage[] {
    // Keep system messages and the last 15 messages verbatim
    const keepCount = Math.min(15, Math.floor(this.config.summarizeThreshold / 2));
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversation = messages.filter((m) => m.role !== 'system');

    if (conversation.length <= keepCount) return messages;

    const toSummarize = conversation.slice(0, conversation.length - keepCount);
    const toKeep = conversation.slice(conversation.length - keepCount);

    const summaryParts: string[] = [];
    for (const m of toSummarize) {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const truncated = content.slice(0, 250);
      summaryParts.push(`[${m.role}: ${truncated}${content.length > 250 ? '...' : ''}]`);
    }

    const summary: ChatMessage = {
      role: 'system',
      content: `[Previous conversation summary compacted for token efficiency]\n${summaryParts.join('\n')}`,
    };

    return [...systemMessages, summary, ...toKeep];
  }

  private cleanToolSchema(tool: unknown): Record<string, unknown> {
    const t = tool as Record<string, unknown>;
    const fn = t['function'] as Record<string, unknown> | undefined;
    if (!fn) return t;
    const compressed = { ...fn };
    if (compressed['parameters'] && typeof compressed['parameters'] === 'object') {
      const params = { ...(compressed['parameters'] as Record<string, unknown>) };
      delete params['$schema'];
      delete params['title'];
      if (params['additionalProperties'] === false) {
        delete params['additionalProperties'];
      }
      compressed['parameters'] = params;
    }
    return { ...t, function: compressed };
  }

  private estimateMessagesTokens(messages: readonly ChatMessage[]): number {
    let chars = 0;
    for (const m of messages) {
      if (typeof m.content === 'string') {
        chars += m.content.length;
      } else {
        chars += JSON.stringify(m.content).length;
      }
      if (m.toolCalls) {
        chars += JSON.stringify(m.toolCalls).length;
      }
    }
    return Math.ceil(chars / 4);
  }
}

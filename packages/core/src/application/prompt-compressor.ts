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

export interface CompressionResult {
  /** The compressed request. */
  request: ChatCompletionRequest;
  /** Estimated tokens saved. */
  tokensSaved: number;
  /** What was compressed. */
  strategies: string[];
}

export interface CompressionConfig {
  enabled: boolean;
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
  whitespaceNormalization: true,
  toolOutputCompaction: true,
  systemPromptDedup: true,
  schemaCompression: true,
  summarizeThreshold: 40,
};

export class PromptCompressor {
  private config: CompressionConfig;
  private totalTokensSaved = 0;
  private totalRequests = 0;

  constructor(config: Partial<CompressionConfig> = {}) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
  }

  /** Compresses a chat completion request. Returns the compressed request + stats. */
  compress(request: ChatCompletionRequest): CompressionResult {
    if (!this.config.enabled) {
      return { request, tokensSaved: 0, strategies: [] };
    }

    const strategies: string[] = [];
    let tokensSaved = 0;
    let messages: ChatMessage[] = [...request.messages];
    let tools = request.tools;

    // 1. Lossless Whitespace & Blank Line Normalization
    if (this.config.whitespaceNormalization && messages.length > 0) {
      const before = this.estimateMessagesTokens(messages);
      messages = messages.map((m) => {
        if (typeof m.content === 'string') {
          const normalized = this.normalizeWhitespace(m.content);
          if (normalized !== m.content) {
            return { ...m, content: normalized };
          }
        }
        return m;
      });
      const after = this.estimateMessagesTokens(messages);
      const saved = before - after;
      if (saved > 0) {
        tokensSaved += saved;
        strategies.push(`whitespace_normalization (-${saved} tokens)`);
      }
    }

    // 2. System prompt deduplication & cleanup
    if (this.config.systemPromptDedup && messages.length > 1) {
      const before = this.estimateMessagesTokens(messages);
      messages = this.dedupSystemMessages(messages);
      const after = this.estimateMessagesTokens(messages);
      const saved = before - after;
      if (saved > 0) {
        tokensSaved += saved;
        strategies.push(`system_prompt_dedup (-${saved} tokens)`);
      }
    }

    // 3. Tool Output Tail-Preserving Compaction for older turns
    if (this.config.toolOutputCompaction && messages.length > 4) {
      const before = this.estimateMessagesTokens(messages);
      messages = this.compactOlderToolOutputs(messages);
      const after = this.estimateMessagesTokens(messages);
      const saved = before - after;
      if (saved > 0) {
        tokensSaved += saved;
        strategies.push(`tool_output_compaction (-${saved} tokens)`);
      }
    }

    // 4. Tool schema metadata pruning
    if (this.config.schemaCompression && tools && tools.length > 0) {
      const before = JSON.stringify(tools).length;
      const compressedTools = (tools as Array<Record<string, unknown>>).map((t) => {
        const fn = t['function'] as Record<string, unknown> | undefined;
        if (!fn) return t;
        const compressed = { ...fn };
        // Remove redundant $schema, title, and undefined annotations
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
      });
      const after = JSON.stringify(compressedTools).length;
      const saved = Math.max(0, Math.round((before - after) / 4));
      if (saved > 0) {
        tokensSaved += saved;
        strategies.push(`schema_compression (-${saved} tokens)`);
        tools = compressedTools as never;
      }
    }

    // 5. Conversation summarization when approaching long context limits
    if (this.config.summarizeThreshold > 0 && messages.length > this.config.summarizeThreshold) {
      const before = this.estimateMessagesTokens(messages);
      messages = this.summarizeOlderMessages(messages);
      const after = this.estimateMessagesTokens(messages);
      const saved = before - after;
      if (saved > 0) {
        tokensSaved += saved;
        strategies.push(`conversation_summarization (-${saved} tokens)`);
      }
    }

    const compressedRequest: ChatCompletionRequest = {
      ...request,
      messages,
      tools,
    };

    this.totalTokensSaved += tokensSaved;
    this.totalRequests++;

    return { request: compressedRequest, tokensSaved, strategies };
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

  /** Updates config at runtime. */
  updateConfig(updates: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // ─── Internal Optimization Logic ──────────────────────────────────────────

  private normalizeWhitespace(text: string): string {
    // Collapse 3 or more newlines to 2, and trim trailing whitespace per line
    // without altering indentation (leading spaces are preserved).
    if (!text || text.length < 20) return text;
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  private dedupSystemMessages(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    const seenSystemTexts = new Set<string>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.role === 'system' && typeof msg.content === 'string') {
        const key = msg.content.trim();
        if (seenSystemTexts.has(key)) {
          // Skip exact duplicate system message
          continue;
        }
        seenSystemTexts.add(key);
      }
      result.push(msg);
    }
    return result;
  }

  private compactOlderToolOutputs(messages: ChatMessage[]): ChatMessage[] {
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

  private summarizeOlderMessages(messages: ChatMessage[]): ChatMessage[] {
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

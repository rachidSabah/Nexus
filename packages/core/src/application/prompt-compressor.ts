/**
 * ───────────────────────────────────────────────────────────────────────────
 * PromptCompressor — reduces token count before sending to the provider.
 *
 * Strategies (applied in order):
 *   1. System prompt dedup — if the same system prompt appears in every
 *      request, strip the boilerplate (Claude Code's 2000-token system prompt
 *      is a prime candidate).
 *   2. Stop-word removal — remove filler words that don't affect model output.
 *   3. Tool schema compression — shorten verbose JSON Schema descriptions.
 *   4. Conversation summarization — if conversation > N messages, summarize
 *      older messages into a single condensed message.
 *
 * The compressor runs as a plugin hook (onRequest) and returns a modified
 * request. It records how many tokens were saved for the dashboard.
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
  /** Remove common English stop words from user messages. */
  stopWordRemoval: boolean;
  /** Shorten tool schema descriptions. */
  schemaCompression: boolean;
  /** Summarize conversations older than this many messages. */
  summarizeThreshold: number;
  /** Strip duplicate system prompt content. */
  systemPromptDedup: boolean;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  enabled: false,
  stopWordRemoval: true,
  schemaCompression: true,
  summarizeThreshold: 20,
  systemPromptDedup: true,
};

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'shall', 'need', 'ought',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'this', 'that',
  'these', 'those', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
  'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
  'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'also', 'now',
]);

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

    // 1. System prompt dedup — strip boilerplate that coding agents send
    // in every request (Claude Code's 2000-token system prompt, etc.)
    if (this.config.systemPromptDedup && messages.length > 0) {
      const before = this.estimateMessagesTokens(messages);
      messages = this.dedupSystemPrompt(messages);
      const after = this.estimateMessagesTokens(messages);
      const saved = before - after;
      if (saved > 0) {
        tokensSaved += saved;
        strategies.push(`system_prompt_dedup (-${saved} tokens)`);
      }
    }

    // 2. Stop-word removal from user messages
    if (this.config.stopWordRemoval) {
      const before = this.estimateMessagesTokens(messages);
      messages = messages.map((m) => {
        if (m.role === 'user' && typeof m.content === 'string') {
          return { ...m, content: this.removeStopWords(m.content) };
        }
        return m;
      });
      const after = this.estimateMessagesTokens(messages);
      const saved = before - after;
      if (saved > 0) {
        tokensSaved += saved;
        strategies.push(`stop_word_removal (-${saved} tokens)`);
      }
    }

    // 3. Tool schema compression
    if (this.config.schemaCompression && tools && tools.length > 0) {
      const before = JSON.stringify(tools).length;
      const compressedTools = (tools as Array<Record<string, unknown>>).map((t) => {
        const fn = t['function'] as Record<string, unknown> | undefined;
        if (!fn) return t;
        const compressed = { ...fn };
        // Shorten verbose descriptions
        if (typeof compressed['description'] === 'string' && compressed['description'].length > 100) {
          compressed['description'] = (compressed['description'] as string).slice(0, 100) + '...';
        }
        // Remove optional fields from parameters schema
        if (compressed['parameters'] && typeof compressed['parameters'] === 'object') {
          const params = compressed['parameters'] as Record<string, unknown>;
          if (params['description']) delete params['description'];
          if (params['$schema']) delete params['$schema'];
          if (params['additionalProperties'] !== undefined) {
            delete params['additionalProperties'];
          }
        }
        return { ...t, function: compressed };
      });
      const after = JSON.stringify(compressedTools).length;
      const saved = Math.round((before - after) / 4); // ~4 chars per token
      if (saved > 0) {
        tokensSaved += saved;
        strategies.push(`schema_compression (-${saved} tokens)`);
        tools = compressedTools as never;
      }
    }

    // 4. Conversation summarization — if too many messages, condense older ones
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

  /** Updates config at runtime. */
  updateConfig(updates: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private dedupSystemPrompt(messages: ChatMessage[]): ChatMessage[] {
    // If the first message is a system prompt > 200 tokens, check if it
    // contains boilerplate that can be trimmed.
    if (messages.length === 0) return messages;
    const first = messages[0]!;
    if (first.role !== 'system') return messages;
    const content = typeof first.content === 'string' ? first.content : '';
    if (content.length < 200) return messages;

    // Strip repeated whitespace and common boilerplate patterns.
    const trimmed = content
      .replace(/\n{3,}/g, '\n\n') // collapse multiple newlines
      .replace(/You are (a|an) (helpful|expert|professional) (AI )?assistant\.?\s*/gi, '')
      .replace(/Always (respond|answer|reply) (in|with|using) [^.]+\.?\s*/gi, '')
      .replace(/(Important|Note|Warning):[^.]+\.?\s*/gi, '')
      .trim();

    if (trimmed.length < content.length * 0.5) {
      return [{ ...first, content: trimmed }, ...messages.slice(1)];
    }
    return messages;
  }

  private removeStopWords(text: string): string {
    // Don't compress very short texts or code blocks.
    if (text.length < 50 || text.includes('```')) return text;
    const words = text.split(/\s+/);
    const kept = words.filter((w) => {
      const lower = w.toLowerCase().replace(/[^a-z]/g, '');
      return lower.length === 0 || !STOP_WORDS.has(lower);
    });
    return kept.join(' ');
  }

  private summarizeOlderMessages(messages: ChatMessage[]): ChatMessage[] {
    // Keep the system prompt + last N messages, summarize the rest.
    const keepCount = Math.min(10, Math.floor(this.config.summarizeThreshold / 2));
    const systemMessages = messages.filter((m) => m.role === 'system');
    const conversation = messages.filter((m) => m.role !== 'system');

    if (conversation.length <= keepCount) return messages;

    const toSummarize = conversation.slice(0, conversation.length - keepCount);
    const toKeep = conversation.slice(conversation.length - keepCount);

    // Build a summary message
    const summaryParts: string[] = [];
    for (const m of toSummarize) {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      const truncated = content.slice(0, 200);
      summaryParts.push(`[${m.role}: ${truncated}${content.length > 200 ? '...' : ''}]`);
    }

    const summary: ChatMessage = {
      role: 'system',
      content: `[Previous conversation summary]\n${summaryParts.join('\n')}`,
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
    return Math.ceil(chars / 4); // ~4 chars per token
  }
}

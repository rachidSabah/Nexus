/**
 * ───────────────────────────────────────────────────────────────────────────
 * ContextWindowManager — prevents "context length exceeded" (HTTP 413) errors
 * by estimating token count BEFORE routing and switching to a model with a
 * larger context window if needed.
 *
 * Also handles conversation trimming: if the estimated token count exceeds
 * the selected model's context window, older messages are summarized or
 * truncated to fit.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ChatCompletionRequest, ChatMessage } from '../domain/types.js';

export interface ContextCheckResult {
  /** Estimated input token count. */
  estimatedTokens: number;
  /** The model's context window, or undefined if unknown. */
  modelContextWindow?: number;
  /** True if the request fits within the model's context window. */
  fits: boolean;
  /** If false, the recommended action. */
  action: 'ok' | 'switch_model' | 'trim_conversation' | 'block';
  /** Recommended minimum context window for a model switch. */
  recommendedMinContextWindow?: number;
  /** If action is 'trim_conversation', the trimmed request. */
  trimmedRequest?: ChatCompletionRequest;
}

export interface ContextWindowConfig {
  /** If true, block requests that exceed any model's context window. */
  blockOversized: boolean;
  /** Max messages to keep when trimming. Default: 10. */
  maxMessagesWhenTrimming: number;
  /** If true, summarize trimmed messages instead of dropping them. */
  summarizeTrimmed: boolean;
}

export const DEFAULT_CONTEXT_CONFIG: ContextWindowConfig = {
  blockOversized: false,
  maxMessagesWhenTrimming: 10,
  summarizeTrimmed: true,
};

export class ContextWindowManager {
  private config: ContextWindowConfig;

  constructor(config: Partial<ContextWindowConfig> = {}) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
  }

  /**
   * Checks if a request fits within the model's context window.
   * Returns the result with a recommended action.
   */
  check(request: ChatCompletionRequest, modelContextWindow?: number): ContextCheckResult {
    const estimatedTokens = this.estimateTokens(request);

    if (!modelContextWindow) {
      // Unknown context window — can't check, assume OK.
      return { estimatedTokens, fits: true, action: 'ok' };
    }

    // Leave 10% headroom for the response.
    const effectiveLimit = Math.floor(modelContextWindow * 0.9);

    if (estimatedTokens <= effectiveLimit) {
      return { estimatedTokens, modelContextWindow, fits: true, action: 'ok' };
    }

    // Doesn't fit — determine the action.
    if (this.config.blockOversized) {
      return { estimatedTokens, modelContextWindow, fits: false, action: 'block' };
    }

    // Try trimming the conversation.
    const trimmedRequest = this.trimConversation(request);
    const trimmedTokens = this.estimateTokens(trimmedRequest);

    if (trimmedTokens <= effectiveLimit) {
      return {
        estimatedTokens,
        modelContextWindow,
        fits: false,
        action: 'trim_conversation',
        trimmedRequest,
      };
    }

    // Even trimmed doesn't fit — recommend switching to a model with a larger window.
    // Recommend 2x the current estimate, rounded up to the nearest common size.
    const recommendedMin = Math.max(
      estimatedTokens * 2,
      32768, // minimum reasonable context window
    );

    return {
      estimatedTokens,
      modelContextWindow,
      fits: false,
      action: 'switch_model',
      recommendedMinContextWindow: recommendedMin,
    };
  }

  /** Estimates the token count for a request (~4 chars per token). */
  estimateTokens(request: ChatCompletionRequest): number {
    let chars = 0;
    for (const m of request.messages) {
      if (typeof m.content === 'string') {
        chars += m.content.length;
      } else {
        chars += JSON.stringify(m.content).length;
      }
      if (m.toolCalls) {
        chars += JSON.stringify(m.toolCalls).length;
      }
    }
    if (request.tools) {
      chars += JSON.stringify(request.tools).length;
    }
    // Add overhead for system tokens (~50 per message for formatting).
    chars += request.messages.length * 50;
    return Math.ceil(chars / 4);
  }

  /** Trims the conversation to fit within the max messages limit. */
  trimConversation(request: ChatCompletionRequest): ChatCompletionRequest {
    const maxMsgs = this.config.maxMessagesWhenTrimming;
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const conversation = request.messages.filter((m) => m.role !== 'system');

    if (conversation.length <= maxMsgs) {
      return request; // Already short enough.
    }

    const toSummarize = conversation.slice(0, conversation.length - maxMsgs);
    const toKeep = conversation.slice(conversation.length - maxMsgs);

    let trimmedMessages: ChatMessage[];
    if (this.config.summarizeTrimmed) {
      // Summarize older messages into a single system message.
      const summaryParts: string[] = [];
      for (const m of toSummarize) {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        summaryParts.push(`[${m.role}: ${content.slice(0, 150)}${content.length > 150 ? '...' : ''}]`);
      }
      const summary: ChatMessage = {
        role: 'system',
        content: `[Earlier conversation summary]\n${summaryParts.join('\n')}`,
      };
      trimmedMessages = [...systemMessages, summary, ...toKeep];
    } else {
      // Just drop older messages.
      trimmedMessages = [...systemMessages, ...toKeep];
    }

    return { ...request, messages: trimmedMessages };
  }

  /** Updates config at runtime. */
  updateConfig(updates: Partial<ContextWindowConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): ContextWindowConfig {
    return this.config;
  }
}

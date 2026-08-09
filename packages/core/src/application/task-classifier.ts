/**
 * ───────────────────────────────────────────────────────────────────────────
 * TaskClassifier — inspects a chat completion request and classifies the
 * task type, enabling smarter model routing.
 *
 * Task types:
 *   - simple_completion: short user message, no tools, no code
 *   - code_generation: user asks to write/modify code
 *   - code_review: user asks to review/diff code
 *   - debugging: user reports an error/bug
 *   - architecture_reasoning: complex multi-step reasoning
 *   - documentation: user asks for docs/comments
 *   - tool_heavy: many tools provided, likely agentic
 *   - conversation: general chat
 *
 * The classifier uses keyword + pattern matching (fast, no LLM call).
 * The result feeds into the routing engine's model selection:
 *   - simple_completion → cheapest model
 *   - architecture_reasoning → premium model
 *   - code_generation → model with toolCalling capability
 *   - debugging → model with good reasoning
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ChatCompletionRequest } from '../domain/types.js';

export type TaskType =
  | 'simple_completion'
  | 'code_generation'
  | 'code_review'
  | 'debugging'
  | 'architecture_reasoning'
  | 'documentation'
  | 'tool_heavy'
  | 'conversation';

export interface TaskClassification {
  type: TaskType;
  /** Confidence score 0..1. */
  confidence: number;
  /** Keywords/patterns that matched. */
  matchedSignals: string[];
  /** Estimated complexity: 'low' | 'medium' | 'high'. */
  complexity: 'low' | 'medium' | 'high';
  /** Recommended model tier: 'free' | 'cheap' | 'standard' | 'premium'. */
  recommendedTier: 'free' | 'cheap' | 'standard' | 'premium';
}

export class TaskClassifier {
  /** Classifies a chat completion request into a task type. */
  classify(request: ChatCompletionRequest): TaskClassification {
    const signals: string[] = [];
    let type: TaskType = 'conversation';
    let confidence = 0.5;
    let complexity: 'low' | 'medium' | 'high' = 'medium';
    let recommendedTier: 'free' | 'cheap' | 'standard' | 'premium' = 'standard';

    // Check if many tools are provided → tool_heavy
    if (request.tools && request.tools.length >= 5) {
      type = 'tool_heavy';
      confidence = 0.9;
      complexity = 'high';
      recommendedTier = 'premium';
      signals.push(`tools=${request.tools.length}`);
      return { type, confidence, matchedSignals: signals, complexity, recommendedTier };
    }

    // Get the last user message for keyword analysis.
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) {
      return { type: 'conversation', confidence: 0.3, matchedSignals: [], complexity: 'low', recommendedTier: 'cheap' };
    }

    const text = typeof lastUserMsg.content === 'string'
      ? lastUserMsg.content.toLowerCase()
      : JSON.stringify(lastUserMsg.content).toLowerCase();

    const messageCount = request.messages.length;
    const textLength = text.length;

    // ─── Debugging ──────────────────────────────────────────────────
    if (/\b(error|bug|crash|stack trace|exception|traceback|fail(ed|ing)?|broken|not working|undefined is not|cannot read|typeerror)\b/.test(text)) {
      type = 'debugging';
      confidence = 0.85;
      complexity = 'high';
      recommendedTier = 'premium';
      signals.push('error/bug keywords');
    }
    // ─── Code review ─────────────────────────────────────────────────
    else if (/\b(review|diff|pull request|pr|refactor|clean up|improve|optimize|simplif)\b/.test(text)) {
      type = 'code_review';
      confidence = 0.8;
      complexity = 'medium';
      recommendedTier = 'standard';
      signals.push('review/refactor keywords');
    }
    // ─── Code generation ────────────────────────────────────────────
    else if (/\b(write|create|implement|build|generate|add|make|scaffold|boilerplate)\b.*\b(function|class|component|method|module|file|script|endpoint|api|test)\b/.test(text)
      || /\b(fix|update|modify|change|edit|patch)\b.*\b(code|function|component|method)\b/.test(text)) {
      type = 'code_generation';
      confidence = 0.8;
      complexity = 'medium';
      recommendedTier = 'standard';
      signals.push('code generation keywords');
    }
    // ─── Architecture reasoning ─────────────────────────────────────
    else if (/\b(architect|design|pattern|structure|strategy|plan|roadmap|trade.?off|compar(e|ison)|vs\.?)\b/.test(text)
      || (messageCount > 10 && textLength > 500)) {
      type = 'architecture_reasoning';
      confidence = 0.75;
      complexity = 'high';
      recommendedTier = 'premium';
      signals.push('architecture/long-conversation');
    }
    // ─── Documentation ───────────────────────────────────────────────
    else if (/\b(document|doc|comment|readme|javadoc|docstring|explain|describe)\b/.test(text)) {
      type = 'documentation';
      confidence = 0.7;
      complexity = 'low';
      recommendedTier = 'cheap';
      signals.push('documentation keywords');
    }
    // ─── Simple completion ──────────────────────────────────────────
    else if (textLength < 100 && messageCount <= 2 && (!request.tools || request.tools.length === 0)) {
      type = 'simple_completion';
      confidence = 0.9;
      complexity = 'low';
      recommendedTier = 'free';
      signals.push('short message, no tools, low message count');
    }

    // Adjust complexity based on conversation length.
    if (messageCount > 20) {
      complexity = 'high';
      signals.push(`long conversation (${messageCount} messages)`);
    } else if (messageCount > 5 && complexity === 'low') {
      complexity = 'medium';
    }

    // If tools are provided, bump recommended tier.
    if (request.tools && request.tools.length > 0 && recommendedTier === 'free') {
      recommendedTier = 'cheap';
      signals.push(`tools present (${request.tools.length})`);
    }

    return { type, confidence, matchedSignals: signals, complexity, recommendedTier };
  }

  /**
   * Returns the model capability requirements for a task type.
   * The routing engine uses this to filter eligible models.
   */
  getCapabilityRequirements(taskType: TaskType): {
    toolCalling?: boolean;
    vision?: boolean;
    reasoning?: boolean;
    jsonMode?: boolean;
    minContextWindow?: number;
  } {
    switch (taskType) {
      case 'code_generation':
        return { toolCalling: true, minContextWindow: 16000 };
      case 'code_review':
        return { toolCalling: true, minContextWindow: 32000 };
      case 'debugging':
        return { toolCalling: true, reasoning: true, minContextWindow: 32000 };
      case 'architecture_reasoning':
        return { reasoning: true, minContextWindow: 64000 };
      case 'documentation':
        return { minContextWindow: 8000 };
      case 'tool_heavy':
        return { toolCalling: true, minContextWindow: 32000 };
      case 'simple_completion':
        return {};
      case 'conversation':
      default:
        return {};
    }
  }
}

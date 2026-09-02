import type { ChatCompletionRequest, ChatMessage, ProviderEndpoint, ModelDescriptor } from '../domain/types.js';

/**
 * Fast token estimation (~3.8 chars per token for English & Code).
 */
export function estimateMessageTokens(message: ChatMessage): number {
  let len = 4; // structural per-message overhead
  if (typeof message.content === 'string') {
    len += Math.ceil(message.content.length / 3.8);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (typeof part === 'object' && part && 'text' in part && typeof part.text === 'string') {
        len += Math.ceil(part.text.length / 3.8);
      }
    }
  }
  if (message.name) len += Math.ceil(message.name.length / 3.8);
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      if (tc.function?.name) len += Math.ceil(tc.function.name.length / 3.8);
      if (tc.function?.arguments) len += Math.ceil(tc.function.arguments.length / 3.8);
    }
  }
  return Math.max(1, len);
}

/**
 * Clamps maxTokens and context window size to fit the provider's limits,
 * and sanitizes message structures (head+tail preservation on overflow).
 */
export function clampAndSanitizeContext(
  request: ChatCompletionRequest,
  endpoint: ProviderEndpoint,
  modelDescriptor?: ModelDescriptor,
): ChatCompletionRequest {
  const maxOutput = endpoint.capabilities?.maxOutputTokens ?? 8192;
  const maxInput = modelDescriptor?.contextWindow
    ? Math.max(4096, Math.floor(modelDescriptor.contextWindow * 0.9))
    : endpoint.capabilities?.maxInputTokens ?? 64000;

  let maxTokens = request.maxTokens;
  const rawSnakeMaxTokens = (request as { max_tokens?: number }).max_tokens;
  if (typeof maxTokens !== 'number' && typeof rawSnakeMaxTokens === 'number') {
    maxTokens = rawSnakeMaxTokens;
  }
  if (typeof maxTokens === 'number' && maxTokens > maxOutput) {
    maxTokens = maxOutput;
  }

  let maxOutputTokens = request.maxOutputTokens;
  if (typeof maxOutputTokens === 'number' && maxOutputTokens > maxOutput) {
    maxOutputTokens = maxOutput;
  }

  // 1. Sanitize messages
  const rawMessages = request.messages ?? [];
  if (rawMessages.length === 0) {
    return {
      ...request,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    };
  }

  const sanitized: ChatMessage[] = [];
  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i]!;
    const cleanMsg: ChatMessage = {
      ...msg,
      content: msg.content ?? '',
    };
    sanitized.push(cleanMsg);
  }

  // 2. Context Length Clamping with Head + Tail Preservation
  const totalTokens = sanitized.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  if (totalTokens <= maxInput || sanitized.length <= 2) {
    return {
      ...request,
      messages: sanitized,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    };
  }

  // Head: preserve system prompt / developer rules if present
  const hasSystem = sanitized[0]?.role === 'system';
  const systemMsg = hasSystem ? sanitized[0] : undefined;
  const systemTokens = systemMsg ? estimateMessageTokens(systemMsg) : 0;

  const budgetForTail = maxInput - systemTokens;
  const tailMessages: ChatMessage[] = [];
  let currentTailTokens = 0;

  // Walk backwards from latest message to preserve newest conversational context
  for (let i = sanitized.length - 1; i >= (hasSystem ? 1 : 0); i--) {
    const msg = sanitized[i]!;
    const msgTokens = estimateMessageTokens(msg);
    if (currentTailTokens + msgTokens > budgetForTail && tailMessages.length > 0) {
      break;
    }
    tailMessages.unshift(msg);
    currentTailTokens += msgTokens;
  }

  const clampedMessages: ChatMessage[] = [];
  if (systemMsg) clampedMessages.push(systemMsg);
  clampedMessages.push(...tailMessages);

  return {
    ...request,
    messages: clampedMessages,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  };
}

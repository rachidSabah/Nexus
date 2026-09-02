/**
 * Anthropic Messages API ↔ OpenAI Chat Completions translator.
 *
 * Exposes an Anthropic-compatible endpoint at POST /v1/messages so that
 * Claude Code (and other Anthropic-protocol agents) can use the gateway
 * natively without any client-side translation.
 *
 * The translator is intentionally minimal — it covers the common cases
 * (text messages, system prompt, streaming, tools, max_tokens) and falls
 * back gracefully for fields it doesn't understand. Full multimodal
 * content + multi-turn tool_use is already handled by the Anthropic
 * adapter's translateRequest on the outbound side; this file handles the
 * inbound translation from the *client's* Anthropic format to our
 * internal OpenAI-compatible shape.
 */

import { randomUUID } from 'node:crypto';

import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ToolCall,
} from '@anx/core';
import {
  healToolCallArguments,
  filterSpecialTokens,
  filterStreamChunk,
  newStreamClampingState,
  type StreamClampingState,
  type ToolDefinition,
} from '@anx/core';

// ─── Anthropic request shape (inbound from Claude Code) ────────────────────

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'tool_result'; tool_use_id: string; content: string | Array<{ type: 'text'; text: string }> }
    | { type: 'thinking'; thinking: string }
  >;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: 'text'; text: string }>;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  metadata?: { user_id?: string };
}

// ─── Anthropic response shape (outbound to Claude Code) ─────────────────────

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'thinking'; thinking: string }
  >;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
}

export interface AnthropicStreamEvent {
  type: string;
  [key: string]: unknown;
}

// ─── Request translation: Anthropic → internal ChatCompletionRequest ────────

export function translateAnthropicRequest(
  req: AnthropicRequest,
  opts: { targetSupportsReasoning?: boolean } = {},
): ChatCompletionRequest {
  // When the resolved target model/provider does NOT support reasoning,
  // we must NOT emit a `reasoning_content` field — providers like Mistral,
  // Cerebras, GLM and OpenAI reject it (HTTP 400/422). Reasoning-content is
  // only forwarded to reasoning-capable upstreams (e.g. DeepSeek-style
  // thinking mode) that require the prior thinking blocks to be replayed.
  const forwardReasoning = opts.targetSupportsReasoning === true;
  // System message: Anthropic accepts string OR array of text blocks.
  const systemText = typeof req.system === 'string'
    ? req.system
    : Array.isArray(req.system)
      ? req.system.map((s) => s.text).join('\n\n')
      : undefined;

  // Convert Anthropic messages to OpenAI-format ChatMessages.
  const messages: ChatMessage[] = [];
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      messages.push({
        role: m.role,
        content: m.content,
      });
      continue;
    }

    // Array content — translate each block.
    const textParts: string[] = [];
    const imageParts: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
    const toolCalls: ToolCall[] = [];
    const reasoningParts: string[] = [];
    let toolResultId: string | undefined;
    let toolResultContent: string | undefined;

    for (const block of m.content) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'image') {
        // Convert Anthropic's base64 source to OpenAI's data URL format.
        const dataUrl = `data:${block.source.media_type};base64,${block.source.data}`;
        imageParts.push({ type: 'image_url', image_url: { url: dataUrl } });
      } else if (block.type === 'thinking' && m.role === 'assistant') {
        // Preserve reasoning text so DeepSeek-style thinking-mode upstreams
        // can validate the conversation history (they REQUIRE the reasoning
        // content to be passed back on every turn).
        reasoningParts.push(block.thinking);
      } else if (block.type === 'tool_use' && m.role === 'assistant') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      } else if (block.type === 'tool_result') {
        toolResultId = block.tool_use_id;
        toolResultContent = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c) => c.text).join('\n')
            : '';
      }
    }

    // If this is a tool_result, emit as a 'tool' role message.
    if (toolResultId) {
      messages.push({
        role: 'tool',
        content: toolResultContent ?? '',
        toolCallId: toolResultId,
      });
      continue;
    }

    // Assistant with tool_calls.
    if (m.role === 'assistant' && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: textParts.join('\n'),
        toolCalls,
        ...(forwardReasoning && reasoningParts.length > 0 ? { reasoningContent: reasoningParts.join('\n') } : {}),
      });
      continue;
    }

    // User with text + images (multimodal).
    if (m.role === 'user' && imageParts.length > 0) {
      const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
      for (const t of textParts) content.push({ type: 'text', text: t });
      for (const img of imageParts) content.push(img);
      messages.push({ role: 'user', content } as never);
      continue;
    }

    // Plain text fallback.
    messages.push({
      role: m.role,
      content: textParts.join('\n'),
      ...(forwardReasoning && m.role === 'assistant' && reasoningParts.length > 0
        ? { reasoningContent: reasoningParts.join('\n') }
        : {}),
    });
  }

  // Convert tools.
  const tools = req.tools?.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  // Convert tool_choice.
  let toolChoice: unknown;
  if (req.tool_choice) {
    if (req.tool_choice.type === 'auto') toolChoice = 'auto';
    else if (req.tool_choice.type === 'any') toolChoice = 'required';
    else if (req.tool_choice.type === 'tool' && req.tool_choice.name) {
      toolChoice = { type: 'function', function: { name: req.tool_choice.name } };
    }
  }

  return {
    model: req.model,
    messages,
    temperature: req.temperature,
    topP: req.top_p,
    maxTokens: req.max_tokens,
    stop: req.stop_sequences,
    stream: req.stream,
    tools,
    toolChoice,
    user: req.metadata?.user_id,
  };
}

// ─── Response translation: internal ChatCompletionResponse → Anthropic ─────

export function translateToAnthropicResponse(
  response: ChatCompletionResponse,
  requestModel: string,
  rawTools?: readonly ToolDefinition[],
): AnthropicResponse {
  const choice = response.choices[0];
  const message = choice?.message;

  const content: AnthropicResponse['content'] = [];

  // Add a thinking block first if the upstream surfaced reasoning text —
  // Claude Code stores it and replays it in later turns, and the request
  // bridge maps it back to `reasoning_content` so reasoning-mode upstreams
  // never reject the conversation history.
  if (message?.reasoningContent) {
    const thinking = filterSpecialTokens(message.reasoningContent).cleaned;
    if (thinking) {
      content.push({ type: 'thinking', thinking });
    }
  }

  // Add text content if present. The message content can be a string OR an
  // array of content parts; we extract just the text parts for Anthropic's
  // `text` content block.
  if (message?.content) {
    let text = typeof message.content === 'string'
      ? message.content
      : (Array.isArray(message.content)
          ? message.content.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; text: string }).text).join('\n')
          : '');
    text = filterSpecialTokens(text).cleaned;
    if (text) {
      content.push({ type: 'text', text });
    }
  }

  // Add tool_use blocks if the assistant made tool calls.
  // Note: the internal ChatMessage uses `toolCalls` (camelCase).
  const toolCalls = (message as { toolCalls?: readonly ToolCall[] }).toolCalls
    ?? (message as { tool_calls?: readonly ToolCall[] }).tool_calls;
  if (toolCalls) {
    for (const tc of toolCalls) {
      const healed = healToolCallArguments(
        tc.function.name,
        tc.function.arguments,
        rawTools,
      );
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: healed.parsed,
      });
    }
  }

  // Map finish_reason → Anthropic stop_reason.
  const finishReason = choice?.finish_reason ?? 'stop';
  let stopReason: AnthropicResponse['stop_reason'];
  if (finishReason === 'stop') stopReason = 'end_turn';
  else if (finishReason === 'length') stopReason = 'max_tokens';
  else if (finishReason === 'tool_calls') stopReason = 'tool_use';
  else if (finishReason === 'stop_sequence') stopReason = 'stop_sequence';
  else stopReason = 'end_turn';

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: requestModel,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: response.usage.promptTokens,
      output_tokens: response.usage.completionTokens,
      cache_read_input_tokens: response.usage.cachedTokens,
    },
  };
}

// ─── Streaming translation: ChatCompletionChunk → Anthropic SSE events ──────

/**
 * Converts an OpenAI-format chunk into 0..N Anthropic stream events.
 *
 * Anthropic's streaming protocol uses these event types:
 *   - message_start: emitted once at the start with the message skeleton
 *   - content_block_start: emitted when a new content block (text or tool_use) starts
 *   - content_block_delta: emitted for each delta within a block
 *   - content_block_stop: emitted when a content block ends
 *   - message_delta: emitted with stop_reason + usage at the end
 *   - message_stop: emitted once at the very end
 *
 * We synthesize these from OpenAI chunks, which only have `delta.content`
 * and `delta.tool_calls`. Block boundaries are inferred: we treat each
 * contiguous text run as one text block, and each tool_call as its own
 * tool_use block.
 */
export function* translateChunkToAnthropicEvents(
  chunk: ChatCompletionChunk,
  state: {
    messageId: string;
    model: string;
    started: boolean;
    currentBlockType: 'text' | 'tool_use' | 'thinking' | null;
    currentBlockIndex: number;
    toolCallIds: Map<number, string>;
    clampingState: StreamClampingState;
  },
): Generator<AnthropicStreamEvent> {
  if (state.clampingState.terminated) {
    return;
  }

  if (!state.started) {
    state.started = true;
    yield {
      type: 'message_start',
      message: {
        id: state.messageId,
        type: 'message',
        role: 'assistant',
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
  }

  const delta = chunk.choices[0]?.delta;
  let finishReason = chunk.choices[0]?.finish_reason;
  let shouldTerminate = false;

  // Reasoning delta → thinking content block (DeepSeek-style upstreams
  // stream `reasoning_content` before the visible content).
  if (delta?.reasoning) {
    const filterRes = filterStreamChunk(delta.reasoning, state.clampingState);
    if (filterRes.shouldTerminate) shouldTerminate = true;
    if (filterRes.cleaned) {
      if (state.currentBlockType !== 'thinking') {
        if (state.currentBlockType === 'tool_use') {
          yield { type: 'content_block_stop', index: state.currentBlockIndex };
          state.currentBlockIndex++;
        }
        state.currentBlockType = 'thinking';
        yield {
          type: 'content_block_start',
          index: state.currentBlockIndex,
          content_block: { type: 'thinking', thinking: '' },
        };
      }
      yield {
        type: 'content_block_delta',
        index: state.currentBlockIndex,
        delta: { type: 'thinking_delta', thinking: filterRes.cleaned },
      };
    }
  }

  // Text delta.
  if (delta?.content) {
    const filterRes = filterStreamChunk(delta.content, state.clampingState);
    if (filterRes.shouldTerminate) shouldTerminate = true;
    if (filterRes.cleaned) {
      if (state.currentBlockType !== 'text') {
        // Close any open tool_use or thinking block.
        if (state.currentBlockType === 'tool_use' || state.currentBlockType === 'thinking') {
          yield { type: 'content_block_stop', index: state.currentBlockIndex };
          state.currentBlockIndex++;
        }
        // Start a new text block.
        state.currentBlockType = 'text';
        yield {
          type: 'content_block_start',
          index: state.currentBlockIndex,
          content_block: { type: 'text', text: '' },
        };
      }
      yield {
        type: 'content_block_delta',
        index: state.currentBlockIndex,
        delta: { type: 'text_delta', text: filterRes.cleaned },
      };
    }
  }

  // Tool call delta.
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      // OpenAI's SSE format includes an `index` field on tool_call deltas
      // to identify which tool_call this is a delta for.
      const tcWithIndex = tc as ToolCall & { index?: number };
      const idx = tcWithIndex.index ?? 0;
      // If this is a new tool_call (has an id), start a new tool_use block.
      if (tc.id) {
        // Close any open text or thinking block.
        if (state.currentBlockType === 'text' || state.currentBlockType === 'thinking') {
          yield { type: 'content_block_stop', index: state.currentBlockIndex };
          state.currentBlockIndex++;
        }
        state.currentBlockType = 'tool_use';
        state.toolCallIds.set(idx, tc.id);
        yield {
          type: 'content_block_start',
          index: state.currentBlockIndex,
          content_block: {
            type: 'tool_use',
            id: tc.id,
            name: tc.function?.name ?? '',
            input: {},
          },
        };
      }
      // Arguments delta.
      if (tc.function?.arguments) {
        const cleanedArgs = filterSpecialTokens(tc.function.arguments).cleaned;
        if (cleanedArgs) {
          yield {
            type: 'content_block_delta',
            index: state.currentBlockIndex,
            delta: { type: 'input_json_delta', partial_json: cleanedArgs },
          };
        }
      }
    }
  }

  if (shouldTerminate && !finishReason) {
    finishReason = 'length';
  }

  // Finish reason → message_delta + message_stop.
  if (finishReason) {
    // Close any open block.
    if (state.currentBlockType !== null) {
      yield { type: 'content_block_stop', index: state.currentBlockIndex };
      state.currentBlockIndex++;
      state.currentBlockType = null;
    }
    let stopReason: string;
    if (finishReason === 'stop') stopReason = 'end_turn';
    else if (finishReason === 'length') stopReason = 'max_tokens';
    else if (finishReason === 'tool_calls') stopReason = 'tool_use';
    else stopReason = 'end_turn';
    yield {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: chunk.usage ? {
        input_tokens: chunk.usage.promptTokens,
        output_tokens: chunk.usage.completionTokens,
      } : undefined,
    };
    yield { type: 'message_stop' };
  }
}

/** Returns a fresh state object for the streaming translator. */
export function newStreamState(model: string): {
  messageId: string;
  model: string;
  started: boolean;
  currentBlockType: 'text' | 'tool_use' | 'thinking' | null;
  currentBlockIndex: number;
  toolCallIds: Map<number, string>;
  clampingState: StreamClampingState;
  /** Bytes already written to the client SSE stream. Used by WS4-A mid-stream
   * failover: if the upstream dies before ANY content reaches the client, we
   * transparently fail over to the next endpoint on the same SSE response. */
  committedBytes: number;
  /** WS4-A: guards against re-execute loops on mid-stream failover. */
  midStreamRetried: boolean;
} {
  return {
    messageId: `msg_${randomUUID()}`,
    model,
    started: false,
    currentBlockType: null,
    currentBlockIndex: 0,
    toolCallIds: new Map(),
    clampingState: newStreamClampingState(),
    committedBytes: 0,
    midStreamRetried: false,
  };
}

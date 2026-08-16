/**
 * OpenAI Responses API (POST /v1/responses) compatibility layer.
 *
 * The OpenAI Codex CLI (and other modern OpenAI agents) speak the Responses
 * API natively (`wire_api = "responses"`). This module translates a Responses
 * request into the gateway's internal ChatCompletionRequest, and translates
 * both the non-streaming response and the streaming SSE event sequence back
 * into the Responses wire format:
 *
 *   response.created → response.in_progress
 *     → response.output_item.added (message) / (function_call)
 *     → response.content_part.added
 *     → response.output_text.delta + response.content_part.delta
 *     → response.function_call_arguments.delta
 *     → response.output_item.done / response.content_part.done
 *     → response.completed
 */
import { randomUUID } from 'node:crypto';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '@anx/core';

// ── Request translation ────────────────────────────────────────────────

export interface ResponsesRequest {
  model?: string;
  instructions?: string;
  input?: Array<string | Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: string | Record<string, unknown>;
  parallel_tool_calls?: boolean;
  stream?: boolean;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  reasoning?: Record<string, unknown>;
  store?: boolean;
  metadata?: Record<string, unknown>;
  user?: string;
  response_format?: Record<string, unknown>;
  previous_response_id?: string | null;
}

type CoreMessage = ChatCompletionRequest['messages'][number];

/** Translate an OpenAI Responses request into a ChatCompletionRequest. */
export function toChatRequest(body: ResponsesRequest): ChatCompletionRequest {
  const messages: CoreMessage[] = [];
  if (body.instructions) {
    messages.push({ role: 'system', content: body.instructions });
  }
  for (const item of body.input ?? []) {
    if (typeof item === 'string') {
      messages.push({ role: 'user', content: item });
      continue;
    }
    const it = item as Record<string, unknown>;
    switch (it.type) {
      case 'message': {
        const role = it.role as string;
        const content = it.content;
        let text = '';
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          text = (content as Array<Record<string, unknown>>)
            .map((p) => (typeof p.text === 'string' ? p.text : ''))
            .join('');
        }
        if (role === 'system' || role === 'developer') {
          messages.push({ role: 'system', content: text });
        } else {
          messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content: text });
        }
        break;
      }
      case 'function_call': {
        const callId = (it.call_id as string) ?? `call_${randomUUID().slice(0, 8)}`;
        const fn = {
          id: callId,
          type: 'function' as const,
          function: {
            name: (it.name as string) ?? '',
            arguments: (it.arguments as string) ?? '',
          },
        };
        const last = messages[messages.length - 1];
        const lastToolCalls = (last as { toolCalls?: unknown[] } | undefined)?.toolCalls;
        if (last && last.role === 'assistant' && Array.isArray(lastToolCalls)) {
          lastToolCalls.push(fn);
        } else {
          messages.push({ role: 'assistant', content: '', toolCalls: [fn] });
        }
        break;
      }
      case 'function_call_output': {
        messages.push({
          role: 'tool',
          toolCallId: (it.call_id as string) ?? '',
          content: String(it.output ?? ''),
        });
        break;
      }
      // reasoning / refusal / computer_call items carry no chat-equivalent —
      // skip them so the upstream never sees unsupported blocks.
      default:
        break;
    }
  }

  const tools = (body.tools ?? [])
    .filter((t) => (t as Record<string, unknown>).type === 'function')
    .map((t) => {
      const fn = (t as Record<string, unknown>).function as Record<string, unknown> | undefined;
      return {
        type: 'function',
        function: {
          name: (fn?.name as string) ?? (t as Record<string, unknown>).name as string,
          description: (fn?.description as string) ?? '',
          parameters: (fn?.parameters as Record<string, unknown>) ?? {},
        },
      };
    });

  return {
    model: body.model ?? 'claude-sonnet-4-5',
    messages,
    ...(tools.length > 0 ? { tools } : {}),
    ...(body.max_output_tokens != null
      ? {
          maxTokens: Math.min(body.max_output_tokens, 4096),
          max_tokens: Math.min(body.max_output_tokens, 4096),
        }
      : { maxTokens: 4096 }),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.top_p != null ? { top_p: body.top_p } : {}),
    stream: body.stream ?? false,
  } as ChatCompletionRequest;
}

// ── Response translation ───────────────────────────────────────────────

const now = (): number => Math.floor(Date.now() / 1000);
const rid = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 16)}`;

function toUsage(u: ChatCompletionResponse['usage'] | undefined) {
  const prompt = u?.promptTokens ?? 0;
  const completion = u?.completionTokens ?? 0;
  return {
    input_tokens: prompt,
    output_tokens: completion,
    total_tokens: u?.totalTokens ?? prompt + completion,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
}

/** Translate a non-streaming ChatCompletionResponse into a Responses object. */
export function toResponsesResponse(
  resp: ChatCompletionResponse,
  model: string,
): Record<string, unknown> {
  const msg = resp.choices?.[0]?.message ?? ({} as Record<string, unknown>);
  const output: unknown[] = [];

  for (const tc of (msg as { tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }).tool_calls ?? []) {
    const id = tc.id ?? rid('call');
    output.push({
      id: rid('fc'),
      type: 'function_call',
      call_id: id,
      name: tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? '',
      status: 'completed',
    });
  }

  const text = (msg.content as string) ?? '';
  if (text) {
    output.push({
      id: rid('msg'),
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    });
  }

  return {
    id: rid('resp'),
    object: 'response',
    created_at: now(),
    status: 'completed',
    model,
    output,
    parallel_tool_calls: true,
    tool_choice: 'auto',
    tools: [],
    usage: toUsage(resp.usage),
    error: null,
    metadata: {},
  };
}

// ── Streaming translation ──────────────────────────────────────────────

export interface ResponsesStreamState {
  responseId: string;
  preEmitted: boolean;
  messageItemId?: string;
  messageAdded: boolean;
  content: string;
  toolItems: Map<number, { itemId: string; name: string }>;
  toolArgs: Map<number, string>;
  usage?: Record<string, unknown>;
  model: string;
}

export function newResponsesStreamState(model: string): ResponsesStreamState {
  return {
    responseId: rid('resp'),
    preEmitted: false,
    messageAdded: false,
    content: '',
    toolItems: new Map(),
    toolArgs: new Map(),
    model,
  };
}

const responseMeta = (state: ResponsesStreamState, status: string) => ({
  id: state.responseId,
  object: 'response',
  created_at: now(),
  status,
  model: state.model,
  output: [],
  parallel_tool_calls: true,
  tool_choice: 'auto',
  tools: [],
  usage: null,
  error: null,
  metadata: {},
});

/** Translate one ChatCompletionChunk into Responses SSE events (generator). */
export function* translateChunkToResponsesEvents(
  chunk: ChatCompletionChunk,
  state: ResponsesStreamState,
): Generator<Record<string, unknown>> {
  if (!state.preEmitted) {
    state.preEmitted = true;
    yield { type: 'response.created', response: responseMeta(state, 'in_progress') };
    yield { type: 'response.in_progress', response: responseMeta(state, 'in_progress') };
  }

  const choice = chunk.choices?.[0];
  const delta = choice?.delta ?? ({} as Record<string, unknown>);

  // Tool calls first (they typically stream before or after text — handle both).
  const toolCalls = delta.tool_calls as
    | Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
    | undefined;
  if (toolCalls) {
    for (const tc of toolCalls) {
      const index = tc.index ?? 0;
      if (!state.toolItems.has(index)) {
        const itemId = rid('fc');
        const callId = tc.id ?? rid('call');
        state.toolItems.set(index, { itemId, name: tc.function?.name ?? '' });
        state.toolArgs.set(index, '');
        yield {
          type: 'response.output_item.added',
          output_index: index,
          item: {
            id: itemId,
            type: 'function_call',
            call_id: callId,
            name: tc.function?.name ?? '',
            arguments: '',
            status: 'in_progress',
          },
        };
      }
      const args = tc.function?.arguments;
      if (args) {
        state.toolArgs.set(index, (state.toolArgs.get(index) ?? '') + args);
        yield {
          type: 'response.function_call_arguments.delta',
          item_id: state.toolItems.get(index)?.itemId,
          output_index: index,
          delta: args,
        };
      }
    }
  }

  const content = delta.content as string | undefined;
  if (content) {
    if (!state.messageAdded) {
      state.messageAdded = true;
      state.messageItemId = rid('msg');
      yield {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          id: state.messageItemId,
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      };
      yield {
        type: 'response.content_part.added',
        item_id: state.messageItemId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      };
    }
    state.content += content;
    yield {
      type: 'response.output_text.delta',
      item_id: state.messageItemId,
      output_index: 0,
      content_index: 0,
      delta: content,
    };
    yield {
      type: 'response.content_part.delta',
      item_id: state.messageItemId,
      output_index: 0,
      content_index: 0,
      delta: { type: 'output_text', text: content, annotations: [] },
    };
  }

  if (chunk.usage) state.usage = chunk.usage as unknown as Record<string, unknown>;
}

/** Emit the terminal Responses events (output_item.done + response.completed). */
export function* finalizeResponsesEvents(
  state: ResponsesStreamState,
): Generator<Record<string, unknown>> {
  const output: unknown[] = [];

  for (const [index, { itemId, name }] of state.toolItems) {
    output.push({
      id: itemId,
      type: 'function_call',
      call_id: itemId,
      name,
      arguments: state.toolArgs.get(index) ?? '',
      status: 'completed',
    });
    yield {
      type: 'response.output_item.done',
      output_index: index,
      item: output[output.length - 1],
    };
  }

  if (state.messageAdded) {
    const messageItem = {
      id: state.messageItemId,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: state.content, annotations: [] }],
    };
    output.push(messageItem);
    yield {
      type: 'response.content_part.done',
      item_id: state.messageItemId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: state.content, annotations: [] },
    };
    yield { type: 'response.output_item.done', output_index: 0, item: messageItem };
  }

  const u = state.usage ?? {};
  yield {
    type: 'response.completed',
    response: {
      id: state.responseId,
      object: 'response',
      created_at: now(),
      status: 'completed',
      model: state.model,
      output,
      parallel_tool_calls: true,
      tool_choice: 'auto',
      tools: [],
      usage: {
        input_tokens: (u.promptTokens as number) ?? 0,
        output_tokens: (u.completionTokens as number) ?? 0,
        total_tokens: (u.totalTokens as number) ?? 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      error: null,
      metadata: {},
    },
  };
}

/** Emit terminal failure Responses events when upstream fails mid-stream. */
export function* failResponsesEvents(
  state: ResponsesStreamState,
  errorMessage: string,
): Generator<Record<string, unknown>> {
  yield {
    type: 'response.failed',
    response: {
      id: state.responseId,
      object: 'response',
      created_at: now(),
      status: 'failed',
      model: state.model,
      output: [],
      parallel_tool_calls: true,
      tool_choice: 'auto',
      tools: [],
      usage: null,
      error: {
        type: 'api_error',
        code: 'server_error',
        message: errorMessage,
      },
      metadata: {},
    },
  };
}


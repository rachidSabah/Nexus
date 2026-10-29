/**
 * StreamRecovery — handles mid-stream failover for streaming responses.
 *
 * Inspired by free-claude-code's stream recovery:
 * - Track committed bytes for mid-stream failover
 * - Allow failover only before first content byte emitted
 * - Preserve stream state across failover
 * - Handle partial responses gracefully
 */

import type { ChatCompletionChunk, ChatCompletionRequest } from '../domain/types.js';
import type { ProviderEndpoint } from '../domain/types.js';

export interface StreamState {
  /** Unique identifier for this stream */
  streamId: string;
  /** The original request */
  request: ChatCompletionRequest;
  /** Chunks that have been emitted to the client */
  emittedChunks: ChatCompletionChunk[];
  /** Whether any content bytes have been delivered */
  contentDelivered: boolean;
  /** The endpoint currently being used */
  currentEndpoint: ProviderEndpoint;
  /** Accumulated response for potential replay */
  accumulatedResponse: ChatCompletionChunk[];
  /** Timestamp when stream started */
  startedAt: number;
  /** Number of failover attempts */
  failoverCount: number;
}

export interface StreamRecoveryOptions {
  /** Max failover attempts for streaming. Default: 3 */
  maxStreamFailovers?: number;
  /** Whether to enable mid-stream failover. Default: true */
  enableMidStreamFailover?: boolean;
  /** Buffer size for accumulating chunks before content delivery. Default: 50 */
  preContentBufferSize?: number;
}

/**
 * StreamRecovery manages streaming failover state and logic.
 */
export class StreamRecovery {
  private readonly maxStreamFailovers: number;
  private readonly enableMidStreamFailover: boolean;
  private readonly preContentBufferSize: number;
  private streams = new Map<string, StreamState>();

  constructor(opts: StreamRecoveryOptions = {}) {
    this.maxStreamFailovers = opts.maxStreamFailovers ?? 3;
    this.enableMidStreamFailover = opts.enableMidStreamFailover ?? true;
    this.preContentBufferSize = opts.preContentBufferSize ?? 50;
  }

  /**
   * Initialize a new stream for tracking.
   */
  initStream(
    streamId: string,
    request: ChatCompletionRequest,
    endpoint: ProviderEndpoint
  ): StreamState {
    const state: StreamState = {
      streamId,
      request,
      emittedChunks: [],
      contentDelivered: false,
      currentEndpoint: endpoint,
      accumulatedResponse: [],
      startedAt: Date.now(),
      failoverCount: 0,
    };
    this.streams.set(streamId, state);
    return state;
  }

  /**
   * Record a chunk that was emitted to the client.
   * Returns whether this chunk contained actual content (not just headers/start).
   */
  recordEmission(streamId: string, chunk: ChatCompletionChunk): boolean {
    const state = this.streams.get(streamId);
    if (!state) return false;

    state.emittedChunks.push(chunk);
    state.accumulatedResponse.push(chunk);

    // Keep buffer size bounded before content delivery
    if (!state.contentDelivered && state.accumulatedResponse.length > this.preContentBufferSize) {
      state.accumulatedResponse.shift();
    }

    // Check if this chunk delivered actual content
    const hasContent = this.hasContent(chunk);
    if (hasContent && !state.contentDelivered) {
      state.contentDelivered = true;
    }

    return hasContent;
  }

  /**
   * Check if a chunk contains actual content (not just metadata/start).
   */
  hasContent(chunk: ChatCompletionChunk): boolean {
    return chunk.choices?.some(choice =>
      choice.delta?.content !== undefined &&
      choice.delta.content !== null &&
      choice.delta.content !== ''
    ) ?? false;
  }

  /**
   * Check if a chunk contains reasoning content.
   */
  hasReasoning(chunk: ChatCompletionChunk): boolean {
    return chunk.choices?.some(choice =>
      choice.delta?.reasoning !== undefined &&
      choice.delta.reasoning !== null &&
      choice.delta.reasoning !== ''
    ) ?? false;
  }

  /**
   * Check if a chunk contains tool calls.
   */
  hasToolCalls(chunk: ChatCompletionChunk): boolean {
    return chunk.choices?.some(choice =>
      choice.delta?.tool_calls !== undefined &&
      choice.delta.tool_calls !== null &&
      choice.delta.tool_calls.length > 0
    ) ?? false;
  }

  /**
   * Determine if mid-stream failover is allowed.
   * Only allowed if no content has been delivered yet (free-claude-code pattern).
   */
  canFailover(streamId: string): boolean {
    const state = this.streams.get(streamId);
    if (!state) return true; // No state = new stream, allow failover
    if (!this.enableMidStreamFailover) return false;
    if (state.failoverCount >= this.maxStreamFailovers) return false;
    return !state.contentDelivered;
  }

  /**
   * Prepare for failover by switching to a new endpoint.
   * Returns the chunks that should be replayed to the new endpoint.
   */
  prepareFailover(streamId: string, newEndpoint: ProviderEndpoint): {
    canFailover: boolean;
    replayChunks: ChatCompletionChunk[];
    newRequest: ChatCompletionRequest;
  } {
    const state = this.streams.get(streamId);
    if (!state) {
      return { canFailover: true, replayChunks: [], newRequest: {} as ChatCompletionRequest };
    }

    const canFailover = this.canFailover(streamId);
    if (!canFailover) {
      return {
        canFailover: false,
        replayChunks: [],
        newRequest: state.request,
      };
    }

    // Update state for failover
    state.currentEndpoint = newEndpoint;
    state.failoverCount++;

    // For replay, we need to send the original request again
    // The accumulated response before content delivery can be used for context
    const replayChunks = state.contentDelivered ? [] : [...state.accumulatedResponse];

    return {
      canFailover: true,
      replayChunks,
      newRequest: { ...state.request }, // Fresh request for new endpoint
    };
  }

  /**
   * Get the current stream state.
   */
  getState(streamId: string): StreamState | undefined {
    return this.streams.get(streamId);
  }

  /**
   * Clean up stream state after completion (success or failure).
   */
  completeStream(streamId: string): void {
    this.streams.delete(streamId);
  }

  /**
   * Get the accumulated response for a stream (useful for debugging/replay).
   */
  getAccumulatedResponse(streamId: string): ChatCompletionChunk[] {
    const state = this.streams.get(streamId);
    return state?.accumulatedResponse ?? [];
  }

  /**
   * Check if content has been delivered for a stream.
   */
  isContentDelivered(streamId: string): boolean {
    const state = this.streams.get(streamId);
    return state?.contentDelivered ?? false;
  }

  /**
   * Get failover count for a stream.
   */
  getFailoverCount(streamId: string): number {
    const state = this.streams.get(streamId);
    return state?.failoverCount ?? 0;
  }
}

/**
 * Create a StreamRecovery instance with default options matching free-claude-code
 */
export function createStreamRecovery(opts?: StreamRecoveryOptions): StreamRecovery {
  return new StreamRecovery({
    maxStreamFailovers: 3,
    enableMidStreamFailover: true,
    preContentBufferSize: 50,
    ...opts,
  });
}

/**
 * Default stream recovery instance for the application (can be overridden in tests)
 */
let globalStreamRecovery: StreamRecovery | null = null;

export function getStreamRecovery(opts?: StreamRecoveryOptions): StreamRecovery {
  if (!globalStreamRecovery) {
    globalStreamRecovery = createStreamRecovery(opts);
  }
  return globalStreamRecovery;
}

export function setStreamRecovery(recovery: StreamRecovery): void {
  globalStreamRecovery = recovery;
}
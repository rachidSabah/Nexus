import { describe, it, expect } from 'vitest';
import {
  newResponsesStreamState,
  translateChunkToResponsesEvents,
  finalizeResponsesEvents,
  failResponsesEvents,
} from '../src/responses-compat.js';
import type { ChatCompletionChunk } from '@anx/core';

describe('Codex Responses API Compatibility & Streaming Lifecycle', () => {
  it('maintains a constant responseId across all lifecycle events', () => {
    const state = newResponsesStreamState('nexus/auto');
    const chunk1: ChatCompletionChunk = {
      id: 'chunk-1',
      object: 'chat.completion.chunk',
      created: 123456789,
      model: 'nexus/auto',
      choices: [{ index: 0, delta: { content: 'Hello' } }],
    };
    const chunk2: ChatCompletionChunk = {
      id: 'chunk-2',
      object: 'chat.completion.chunk',
      created: 123456789,
      model: 'nexus/auto',
      choices: [{ index: 0, delta: { content: ' world' } }],
    };

    const events1 = Array.from(translateChunkToResponsesEvents(chunk1, state));
    const events2 = Array.from(translateChunkToResponsesEvents(chunk2, state));
    const termEvents = Array.from(finalizeResponsesEvents(state));

    const allEvents = [...events1, ...events2, ...termEvents];

    expect(allEvents.length).toBeGreaterThan(4);
    expect(allEvents[0].type).toBe('response.created');
    expect(allEvents[1].type).toBe('response.in_progress');

    const createdResp = (allEvents[0] as any).response;
    const inProgressResp = (allEvents[1] as any).response;
    const completedResp = (allEvents[allEvents.length - 1] as any).response;

    expect(createdResp.id).toBe(state.responseId);
    expect(inProgressResp.id).toBe(state.responseId);
    expect(completedResp.id).toBe(state.responseId);
    expect(completedResp.status).toBe('completed');
  });

  it('emits standard response.failed event upon upstream error', () => {
    const state = newResponsesStreamState('nexus/auto');
    const failEvents = Array.from(failResponsesEvents(state, 'Upstream provider error (HTTP 404)'));

    expect(failEvents.length).toBe(1);
    expect(failEvents[0].type).toBe('response.failed');
    const failResp = (failEvents[0] as any).response;
    expect(failResp.id).toBe(state.responseId);
    expect(failResp.status).toBe('failed');
    expect(failResp.error.message).toBe('Upstream provider error (HTTP 404)');
  });
});

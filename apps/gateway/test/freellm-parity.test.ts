import { describe, it, expect } from 'vitest';
import type { ChatCompletionResponse, ChatCompletionChunk } from '@anx/core';
import {
  X_ROUTED_VIA,
  isFusionModel,
  routedVia,
  parseAutoModel,
  autoAliasCandidates,
  completionsPromptText,
  completionsToChat,
  firstChoiceText,
  toSnakeUsage,
  chatResponseToCompletion,
  geminiToChat,
  chatResponseToGemini,
  estimateGeminiTokens,
  geminiModelsList,
  ollamaChatToInternal,
  ollamaGenerateToInternal,
  chatResponseToOllamaChat,
  chatResponseToOllamaGenerate,
  ollamaStreamLine,
  ollamaTags,
  ollamaShow,
  ollamaEmbeddingsInput,
  mediaNotAvailable,
  transcriptionsNotAvailable,
  FUSION_PANEL_SIZE,
  buildFusionJudgeMessages,
  fusionQuestion,
  OPENAPI_DOCS_HTML,
} from '../src/freellm-parity.js';

function chatResp(text: string): ChatCompletionResponse {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1700000000,
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    provider: 'groq',
    endpoint: 'auto-groq',
    latencyMs: 42,
  } as ChatCompletionResponse;
}

describe('X-Routed-Via', () => {
  it('exposes the header name constant', () => {
    expect(X_ROUTED_VIA).toBe('X-Routed-Via');
  });
  it('formats platform/model', () => {
    expect(routedVia('groq', 'llama-3.3-70b-versatile')).toBe('groq/llama-3.3-70b-versatile');
  });
  it('never emits blanks', () => {
    expect(routedVia('', '')).toBe('unknown/unknown');
    expect(routedVia('  ', 'm')).toBe('unknown/m');
  });
});

describe('fusion model id', () => {
  it('matches case-insensitively with surrounding space', () => {
    expect(isFusionModel('fusion')).toBe(true);
    expect(isFusionModel('Fusion')).toBe(true);
    expect(isFusionModel('  FUSION  ')).toBe(true);
  });
  it('rejects non-fusion ids', () => {
    expect(isFusionModel('fusion-plus')).toBe(false);
    expect(isFusionModel('auto')).toBe(false);
    expect(isFusionModel(undefined)).toBe(false);
    expect(isFusionModel(42)).toBe(false);
  });
});

describe('parseAutoModel', () => {
  it('parses bare auto', () => {
    expect(parseAutoModel('auto')).toEqual({ kind: 'auto', profile: 'default' });
    expect(parseAutoModel(' AUTO ')).toEqual({ kind: 'auto', profile: 'default' });
  });
  it('parses fast and smart profiles', () => {
    expect(parseAutoModel('auto:fast')).toEqual({ kind: 'auto', profile: 'fast' });
    expect(parseAutoModel('auto:smart')).toEqual({ kind: 'auto', profile: 'smart' });
    expect(parseAutoModel('AUTO:FAST')).toEqual({ kind: 'auto', profile: 'fast' });
  });
  it('parses named profiles, preserving case in the name', () => {
    expect(parseAutoModel('auto:coding')).toEqual({ kind: 'profile', name: 'coding' });
    expect(parseAutoModel('auto:Vision-2.0')).toEqual({ kind: 'profile', name: 'Vision-2.0' });
  });
  it('returns null for normal model ids and junk', () => {
    expect(parseAutoModel('gpt-4o')).toBeNull();
    expect(parseAutoModel('local/free')).toBeNull();
    expect(parseAutoModel('auto:')).toBeNull();
    expect(parseAutoModel('auto:two:parts')).toBeNull();
    expect(parseAutoModel('')).toBeNull();
    expect(parseAutoModel(undefined)).toBeNull();
  });
});

describe('autoAliasCandidates', () => {
  it('maps default/fast/smart to built-in aliases', () => {
    expect(autoAliasCandidates({ kind: 'auto', profile: 'default' })).toEqual(['local/auto']);
    expect(autoAliasCandidates({ kind: 'auto', profile: 'fast' })).toEqual(['local/fast']);
    expect(autoAliasCandidates({ kind: 'auto', profile: 'smart' })).toEqual(['local/best']);
  });
  it('offers custom-alias slots for named profiles', () => {
    expect(autoAliasCandidates({ kind: 'profile', name: 'coding' })).toEqual([
      'local/coding',
      'nexus/coding',
      'coding',
    ]);
  });
});

describe('legacy completions', () => {
  it('joins string and array prompts with suffix', () => {
    expect(completionsPromptText('hello', ' world')).toBe('hello world');
    expect(completionsPromptText(['a', 'b'])).toBe('a\nb');
    expect(completionsPromptText(['a', 1, null])).toBe('a');
    expect(completionsPromptText(undefined)).toBe('');
  });
  it('translates to a chat request with sampling passthrough', () => {
    const req = completionsToChat({ model: 'm', prompt: 'hi', temperature: 0.5, max_tokens: 16 });
    expect(req.model).toBe('m');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(req.temperature).toBe(0.5);
    expect(req.maxTokens).toBe(16);
  });
  it('defaults the model to auto', () => {
    expect(completionsToChat({ prompt: 'hi' }).model).toBe('auto');
  });
  it('translates a chat response to text_completion', () => {
    const out = chatResponseToCompletion(chatResp('Hello!'), 'my-model') as {
      object: string;
      model: string;
      choices: { text: string; finish_reason: string }[];
      usage: { prompt_tokens: number };
    };
    expect(out.object).toBe('text_completion');
    expect(out.model).toBe('my-model');
    expect(out.choices[0].text).toBe('Hello!');
    expect(out.choices[0].finish_reason).toBe('stop');
    expect(out.usage.prompt_tokens).toBe(10);
  });
});

describe('usage + text helpers', () => {
  it('maps camelCase usage to snake_case', () => {
    expect(toSnakeUsage({ promptTokens: 3, completionTokens: 4, totalTokens: 7 })).toEqual({
      prompt_tokens: 3,
      completion_tokens: 4,
      total_tokens: 7,
    });
  });
  it('derives totals and tolerates junk', () => {
    expect(toSnakeUsage({ prompt_tokens: 3, completion_tokens: 4 })).toMatchObject({ total_tokens: 7 });
    expect(toSnakeUsage(null)).toMatchObject({ total_tokens: 0 });
    expect(toSnakeUsage('x')).toMatchObject({ prompt_tokens: 0 });
  });
  it('reads array content parts', () => {
    const r = chatResp('ignored') as unknown as Record<string, unknown>;
    const withParts = {
      choices: [{ message: { role: 'assistant', content: [{ type: 'text', text: 'A' }, 'B'] }, finish_reason: 'stop' }],
    } as unknown as ChatCompletionResponse;
    expect(firstChoiceText(withParts)).toBe('AB');
    expect(firstChoiceText(r as ChatCompletionResponse)).toBe('ignored');
  });
});

describe('gemini v1beta', () => {
  it('translates contents + system instruction + generation config', () => {
    const req = geminiToChat('gemini-2.0-flash', {
      systemInstruction: { parts: [{ text: 'Be brief.' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello' }] },
        { role: 'user', parts: [{ text: 'Bye' }] },
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 64 },
    });
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(req.messages[0].content).toBe('Be brief.');
    expect(req.temperature).toBe(0.2);
    expect(req.maxTokens).toBe(64);
  });
  it('round-trips a chat response', () => {
    const out = chatResponseToGemini(chatResp('Yo'), 'gemini-2.0-flash') as {
      candidates: { content: { parts: { text: string }[] }; finishReason: string }[];
      usageMetadata: { totalTokenCount: number };
      modelVersion: string;
    };
    expect(out.candidates[0].content.parts[0].text).toBe('Yo');
    expect(out.candidates[0].finishReason).toBe('STOP');
    expect(out.usageMetadata.totalTokenCount).toBe(15);
    expect(out.modelVersion).toBe('gemini-2.0-flash');
  });
  it('estimates tokens at ~4 chars each, minimum 1', () => {
    expect(estimateGeminiTokens({ contents: [{ parts: [{ text: 'abcdefgh' }] }] })).toBe(2);
    expect(estimateGeminiTokens({})).toBe(1);
  });
  it('projects a models list with gemini resource names', () => {
    const out = geminiModelsList([{ id: 'a', providerId: 'p' }]) as {
      models: { name: string; displayName: string }[];
    };
    expect(out.models[0].name).toBe('models/a');
    expect(out.models[0].displayName).toBe('a');
  });
});

describe('ollama emulation', () => {
  it('translates chat requests incl. options', () => {
    const req = ollamaChatToInternal({
      model: 'llama3',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'q' },
        { role: 'weird', content: 'w' },
      ],
      options: { temperature: 0.3, num_predict: 32 },
    });
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    expect(req.temperature).toBe(0.3);
    expect(req.maxTokens).toBe(32);
  });
  it('translates generate requests with system prompt', () => {
    const req = ollamaGenerateToInternal({ model: 'llama3', prompt: 'p', system: 's' });
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });
  it('shapes chat + generate responses', () => {
    const c = chatResponseToOllamaChat(chatResp('Hi'), 'llama3') as { done: boolean; message: { content: string } };
    expect(c.done).toBe(true);
    expect(c.message.content).toBe('Hi');
    const g = chatResponseToOllamaGenerate(chatResp('Hi'), 'llama3') as { response: string; done_reason: string };
    expect(g.response).toBe('Hi');
    expect(g.done_reason).toBe('stop');
  });
  it('emits NDJSON stream lines for both kinds', () => {
    const chunk = {
      id: 'c',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model: 'm',
      choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }],
    } as unknown as ChatCompletionChunk;
    const chatLine = JSON.parse(ollamaStreamLine('chat', 'llama3', chunk, false)) as {
      message: { content: string };
      done: boolean;
    };
    expect(chatLine.message.content).toBe('x');
    expect(chatLine.done).toBe(false);
    const genLine = JSON.parse(ollamaStreamLine('generate', 'llama3', chunk, true)) as {
      response: string;
      done: boolean;
    };
    expect(genLine.response).toBe('x');
    expect(genLine.done).toBe(true);
  });
  it('projects tags and show, null for unknown', () => {
    const tags = ollamaTags([{ id: 'm', providerId: 'p' }]) as { models: { name: string }[] };
    expect(tags.models[0].name).toBe('m:latest');
    const shown = ollamaShow({ id: 'm', providerId: 'p' }) as { capabilities: string[] };
    expect(shown.capabilities).toContain('completion');
    expect(ollamaShow(undefined)).toBeNull();
  });
  it('normalizes embeddings input', () => {
    expect(ollamaEmbeddingsInput({ input: ['a', 1, 'b'] })).toEqual(['a', 'b']);
    expect(ollamaEmbeddingsInput({ prompt: 'p' })).toEqual(['p']);
    expect(ollamaEmbeddingsInput({})).toEqual([]);
  });
});

describe('media shapes', () => {
  it('returns an honest 501 listing configured providers', () => {
    const r = mediaNotAvailable(['openai', 'ollama']);
    expect(r.status).toBe(501);
    expect(JSON.stringify(r.body)).toContain('openai');
    expect(JSON.stringify(r.body)).toContain('MEDIA_NOT_SUPPORTED');
  });
  it('names the transcriptions gap explicitly', () => {
    const r = transcriptionsNotAvailable();
    expect(r.status).toBe(501);
    expect(JSON.stringify(r.body)).toContain('TRANSCRIPTION_MULTIPART_UNSUPPORTED');
  });
});

describe('fusion helpers', () => {
  it('panel size is a small bounded constant', () => {
    expect(FUSION_PANEL_SIZE).toBe(3);
  });
  it('builds judge messages containing every draft', () => {
    const msgs = buildFusionJudgeMessages('Q?', [
      { model: 'a', text: 'draft-a' },
      { model: 'b', text: 'draft-b' },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    const body = String(msgs[1].content);
    expect(body).toContain('Q?');
    expect(body).toContain('draft-a');
    expect(body).toContain('draft-b');
  });
  it('picks the last user message as the question', () => {
    expect(
      fusionQuestion([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ]),
    ).toBe('second');
    expect(fusionQuestion([])).toBe('');
  });
});

describe('docs viewer', () => {
  it('is a self-contained page fetching the live spec', () => {
    expect(OPENAPI_DOCS_HTML).toContain('<!DOCTYPE html>');
    expect(OPENAPI_DOCS_HTML).toContain('/v1/openapi.json');
    expect(OPENAPI_DOCS_HTML).not.toContain('src="http');
    expect(OPENAPI_DOCS_HTML).not.toContain('href="http');
  });
});

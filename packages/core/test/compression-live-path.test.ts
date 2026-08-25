import { describe, it, expect } from 'vitest';
import { ChatCompletionUseCase } from '../src/application/chat-completion.usecase.js';
import { PromptCompressor } from '../src/application/prompt-compressor.js';
import type {
  ExternalPipelineFn,
  ExternalCompressorRegistryLike,
} from '../src/application/prompt-compressor.js';
import { InMemoryEventBus } from '../src/application/event-bus.js';
import { RoutingEngine } from '../src/application/routing-engine.js';
import { DefaultFailover } from '../src/application/failover.js';
import { DefaultCostCalculator } from '../src/application/cost-calculator.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ProviderEndpoint,
} from '../src/domain/types.js';
import type { ProviderAdapter } from '../src/application/ports.js';

// ── Test doubles ────────────────────────────────────────────────────────────

class RecordingAdapter implements ProviderAdapter {
  readonly providerId = 'openai';
  public receivedRequest: ChatCompletionRequest | null = null;
  public nextResponse: ChatCompletionResponse | null = null;

  async chatCompletion(
    _ep: ProviderEndpoint,
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    this.receivedRequest = request; // capture what actually reached the upstream
    return this.nextResponse!;
  }
  async *streamChatCompletion() {
    /* unused */
  }
  async healthCheck() {
    return true;
  }
}

function makeEndpoint(): ProviderEndpoint {
  return {
    id: 'ep-openai',
    providerId: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://example.com',
    capabilities: {
      streaming: true,
      toolCalling: true,
      vision: false,
      audio: false,
      speech: false,
      embeddings: false,
      reasoning: false,
      jsonMode: true,
      maxOutputTokens: 4096,
      maxInputTokens: 32768,
      supportedModalities: ['text'],
    },
    pricing: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
    priority: 1,
    weight: 1,
    region: 'us-east',
    tags: ['default'],
    timeoutMs: 30_000,
    maxRetries: 2,
    concurrencyLimit: 10,
    health: 'healthy',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * A real, lossless pipeline stub: collapses 3+ blank lines to 2. This is the
 * structural contract the gateway satisfies with @anx/token-efficiency's
 * compressPipeline. It returns MEASURED (not fabricated) savings.
 */
const testPipeline: ExternalPipelineFn = (text) => {
  const out = text.replace(/\n{3,}/g, '\n\n');
  return {
    text: out,
    originalChars: text.length,
    finalChars: out.length,
    originalTokens: Math.ceil(text.length / 4),
    finalTokens: Math.ceil(out.length / 4),
    totalCharsSaved: Math.max(0, text.length - out.length),
    totalTokensSaved: Math.max(0, Math.ceil((text.length - out.length) / 4)),
    savingsPct:
      text.length > 0
        ? Math.round((Math.max(0, text.length - out.length) / text.length) * 1000) / 10
        : 0,
    engines:
      out !== text
        ? [{ engine: 'minify', charsSaved: text.length - out.length, tokensSaved: 0 }]
        : [],
  };
};

// External registry with NO caveman/rtk registered → must be a safe no-op.
const emptyExternal: ExternalCompressorRegistryLike = {
  has: () => false,
  run: async () => ({ delegated: false, output: '', charsIn: 0, charsOut: 0, charsSaved: 0 }),
};

const okResponse: ChatCompletionResponse = {
  id: 'resp-1',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-4',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  provider: 'openai',
  endpoint: 'ep-openai',
  latencyMs: 0,
};

function makeUsecase(compressor?: PromptCompressor) {
  const bus = new InMemoryEventBus();
  const engine = new RoutingEngine(bus);
  const adapter = new RecordingAdapter();
  adapter.nextResponse = okResponse;
  engine.registerEndpoint(makeEndpoint());
  const usecase = new ChatCompletionUseCase(
    engine,
    new DefaultFailover(),
    new Map([['openai', adapter]]),
    bus,
    new DefaultCostCalculator(),
    3,
    { promptCompressor: compressor },
  );
  return { bus, adapter, usecase };
}

const verboseRequest: ChatCompletionRequest = {
  model: 'gpt-4',
  messages: [
    { role: 'system', content: 'You are an expert coding assistant.' },
    { role: 'system', content: 'You are an expert coding assistant.' },
    { role: 'user', content: 'Build a Next.js app\n\n\n\n\nwith routes and a dashboard' },
  ],
};

describe('Live request compression integration (single pass, fail-open)', () => {
  it('safe-stack: compresses exactly once, emits compression.completed with measured metrics, upstream receives compressed content', async () => {
    const compressor = new PromptCompressor(
      { enabled: true, activeProfile: 'safe-stack' },
      { pipeline: testPipeline, external: emptyExternal },
    );
    const { bus, adapter, usecase } = makeUsecase(compressor);

    const published: any[] = [];
    const origPublish = (bus as any).publish.bind(bus);
    (bus as any).publish = async (e: any) => {
      published.push(e);
      return origPublish(e);
    };

    const response = await usecase.execute(verboseRequest);
    expect(response.choices[0]?.message.content).toBe('Hello!');

    const completed = published.find((e) => e.type === 'compression.completed');
    expect(completed, 'compression.completed event must fire').toBeTruthy();
    expect(completed.payload.profile).toBe('safe-stack');
    expect(completed.payload.originalChars).toBeGreaterThan(0);
    expect(completed.payload.charsSaved).toBeGreaterThanOrEqual(0);
    expect(completed.payload.compressedChars).toBeLessThanOrEqual(completed.payload.originalChars);

    // Exactly one compression event (no double compression).
    const allCompression = published.filter(
      (e) => e.type === 'compression.completed' || e.type === 'compression.fallback',
    );
    expect(allCompression.length).toBe(1);

    // The upstream adapter received the COMPRESSED request (blank-run collapsed + dedup).
    const upstreamContent = adapter.receivedRequest!.messages.find((m) => m.role === 'user')!
      .content as string;
    expect(upstreamContent).not.toContain('\n\n\n\n\n');
    // Duplicate system prompt removed.
    const systemCount = adapter.receivedRequest!.messages.filter((m) => m.role === 'system').length;
    expect(systemCount).toBe(1);
  });

  it('none profile: NO compression event, upstream receives the original request unchanged', async () => {
    const compressor = new PromptCompressor({ enabled: true, activeProfile: 'none' });
    const { bus, adapter, usecase } = makeUsecase(compressor);
    const published: any[] = [];
    const origPublish = (bus as any).publish.bind(bus);
    (bus as any).publish = async (e: any) => {
      published.push(e);
      return origPublish(e);
    };

    await usecase.execute(verboseRequest);

    const compressionEvents = published.filter((e) => e.type.startsWith('compression.'));
    expect(compressionEvents.length).toBe(0);
    // Original verbatim: blank run preserved, both system prompts present.
    const upstreamContent = adapter.receivedRequest!.messages.find((m) => m.role === 'user')!
      .content as string;
    expect(upstreamContent).toContain('\n\n\n\n\n');
    expect(adapter.receivedRequest!.messages.filter((m) => m.role === 'system').length).toBe(2);
  });

  it('fail-open: pipeline throws → compression.fallback emitted, upstream receives ORIGINAL (never corrupted)', async () => {
    const throwingPipeline: ExternalPipelineFn = () => {
      throw new Error('simulated pipeline crash');
    };
    const compressor = new PromptCompressor(
      { enabled: true, activeProfile: 'safe-stack' },
      { pipeline: throwingPipeline, external: emptyExternal },
    );
    const { bus, adapter, usecase } = makeUsecase(compressor);
    const published: any[] = [];
    const origPublish = (bus as any).publish.bind(bus);
    (bus as any).publish = async (e: any) => {
      published.push(e);
      return origPublish(e);
    };

    // Must still succeed — compression is an optimization, not a dependency.
    const response = await usecase.execute(verboseRequest);
    expect(response.choices[0]?.message.content).toBe('Hello!');

    const fallback = published.find((e) => e.type === 'compression.fallback');
    expect(fallback, 'compression.fallback must fire on error').toBeTruthy();
    expect(fallback.payload.preservedOriginal).toBe(true);
    expect(fallback.payload.reason).toContain('simulated pipeline crash');

    // Upstream got the ORIGINAL (uncompressed) content — not a corrupted/partial transform.
    const upstreamContent = adapter.receivedRequest!.messages.find((m) => m.role === 'user')!
      .content as string;
    expect(upstreamContent).toBe(verboseRequest.messages[2]!.content);
  });
});

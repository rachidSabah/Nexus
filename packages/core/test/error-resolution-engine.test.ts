import { describe, it, expect, beforeEach } from 'vitest';

import {
  classifyErrorDiagnostic,
  ErrorDiagnosticRegistry,
  InMemoryEventBus,
  KeyRegistry,
  LiveErrorResolver,
  maskKeyString,
  ModelRegistry,
  RoutingEngine,
  type ProviderAdapter,
  type ProviderEndpoint,
} from '../src/index.js';

class FakeVault {
  private store = new Map<string, string>();
  async get(id: string): Promise<string | undefined> { return this.store.get(id); }
  async set(id: string, secret: string): Promise<void> { this.store.set(id, secret); }
  async delete(id: string): Promise<void> { this.store.delete(id); }
  async list(): Promise<readonly string[]> { return Array.from(this.store.keys()); }
}

describe('Live Provider Error Resolution Engine', () => {
  describe('Deterministic Error Classification & Secret Masking', () => {
    it('masks key strings safely without exposing plaintext', () => {
      expect(maskKeyString('sk-proj-1234567890abcdef')).toBe('sk-••••••cdef');
      expect(maskKeyString('gsk_abcdef123456')).toBe('••••3456');
      expect(maskKeyString('123')).toBe('••••');
      expect(maskKeyString('')).toBe('••••');
      expect(maskKeyString(undefined)).toBe('••••');
    });

    it('classifies 401 authentication failures accurately', () => {
      const diag = classifyErrorDiagnostic({
        providerId: 'openai',
        keyId: 'key-1',
        maskedKey: '••••1234',
        error: new Error('Incorrect API key provided: sk-invalid'),
        status: 401,
      });

      expect(diag.category).toBe('AUTHENTICATION_FAILURE');
      expect(diag.scope).toBe('KEY_FAILURE');
      expect(diag.transience).toBe('PERMANENT_FAILURE');
      expect(diag.authFailure).toBe(true);
      expect(diag.temporary).toBe(false);
      expect(diag.likelyCause).toContain('API credential');
      expect(diag.resolved).toBe(false);
    });

    it('classifies 429 rate limits as transient failures', () => {
      const diag = classifyErrorDiagnostic({
        providerId: 'anthropic',
        keyId: 'key-ant-1',
        error: new Error('Rate limit exceeded: 5 requests per minute limit reached'),
        status: 429,
        cooldownUntil: Date.now() + 60_000,
      });

      expect(diag.category).toBe('RATE_LIMIT');
      expect(diag.scope).toBe('KEY_FAILURE');
      expect(diag.transience).toBe('TRANSIENT_FAILURE');
      expect(diag.rateLimitFailure).toBe(true);
      expect(diag.temporary).toBe(true);
      expect(diag.cooldownUntil).toBeGreaterThan(0);
    });

    it('classifies 404 model not found without classifying as whole provider dead', () => {
      const diag = classifyErrorDiagnostic({
        providerId: 'deepseek',
        modelId: 'deepseek-retired-model',
        error: new Error('The model `deepseek-retired-model` does not exist or you do not have access to it.'),
        status: 404,
      });

      expect(diag.category).toBe('MODEL_OR_ENDPOINT_NOT_FOUND');
      expect(diag.scope).toBe('MODEL_FAILURE');
      expect(diag.modelUnavailableSuspected).toBe(true);
      expect(diag.providerUnavailableSuspected).toBe(false);
    });
  });

  describe('Error Diagnostic Registry', () => {
    let registry: ErrorDiagnosticRegistry;

    beforeEach(() => {
      registry = new ErrorDiagnosticRegistry();
    });

    it('records error diagnostics and increments counters on repeated failures', () => {
      const d1 = registry.recordError({
        providerId: 'groq',
        keyId: 'groq-key-1',
        error: new Error('Rate limit exceeded'),
        status: 429,
      });

      expect(d1.occurrenceCount).toBe(1);
      expect(d1.consecutiveFailures).toBe(1);

      const d2 = registry.recordError({
        providerId: 'groq',
        keyId: 'groq-key-1',
        error: new Error('Rate limit exceeded again'),
        status: 429,
      });

      expect(d2.id).toBe(d1.id);
      expect(d2.occurrenceCount).toBe(2);
      expect(d2.consecutiveFailures).toBe(2);
      expect(registry.listActive('groq').length).toBe(1);
    });

    it('resets consecutive failures and marks errors resolved on success', () => {
      registry.recordError({
        providerId: 'groq',
        keyId: 'groq-key-1',
        error: new Error('Rate limit'),
        status: 429,
      });

      expect(registry.listActive('groq').length).toBe(1);

      registry.recordSuccess('groq', 'groq-key-1');

      expect(registry.listActive('groq').length).toBe(0);
      const all = registry.list({ providerId: 'groq' });
      expect(all[0]?.resolved).toBe(true);
      expect(all[0]?.consecutiveFailures).toBe(0);
    });
  });

  describe('Live Remediation Engine (DIAGNOSE -> REMEDIATE -> VERIFY -> RECOVER)', () => {
    let vault: FakeVault;
    let keyRegistry: KeyRegistry;
    let routing: RoutingEngine;
    let modelRegistry: ModelRegistry;
    let errorRegistry: ErrorDiagnosticRegistry;
    let events: InMemoryEventBus;
    let adapters: Map<string, ProviderAdapter>;
    let resolver: LiveErrorResolver;

    const endpoint: ProviderEndpoint = {
      id: 'openai-ep',
      providerId: 'openai',
      displayName: 'OpenAI Production',
      baseUrl: 'https://api.openai.com/v1',
      capabilities: { streaming: true, toolCalling: true, vision: true },
      pricing: { inputPer1K: 0.0015, outputPer1K: 0.002 },
      priority: 1,
      weight: 1,
      region: 'us-east',
      tags: ['gpt-4o-mini'],
      timeoutMs: 15_000,
      maxRetries: 2,
      concurrencyLimit: 10,
      health: 'circuit_open',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(async () => {
      vault = new FakeVault();
      keyRegistry = new KeyRegistry(vault as never, { cooldownMs: 100 });
      events = new InMemoryEventBus();
      routing = new RoutingEngine(events);
      routing.registerEndpoint(endpoint);
      modelRegistry = new ModelRegistry({ routingEngine: routing });
      errorRegistry = new ErrorDiagnosticRegistry();
      adapters = new Map<string, ProviderAdapter>();

      resolver = new LiveErrorResolver({
        routing,
        keyRegistry,
        modelRegistry,
        errorRegistry,
        adapters,
        events,
      });
    });

    it('recovers provider by rotating from invalid key to healthy reserve key with live verification', async () => {
      // 1. Register invalid key (sk-bad)
      await keyRegistry.register({ id: 'key-bad', providerId: 'openai', plaintext: 'sk-bad', label: 'Primary' });
      keyRegistry.recordFailure('key-bad', 401, false);

      // 2. Register valid reserve key (sk-good)
      await keyRegistry.register({ id: 'key-good', providerId: 'openai', plaintext: 'sk-good', label: 'Backup' });

      // Record initial diagnostic error
      errorRegistry.recordError({
        providerId: 'openai',
        keyId: 'key-bad',
        error: new Error('Incorrect API key provided: sk-bad'),
        status: 401,
      });

      // 3. Mock provider adapter: succeeds only when key === 'sk-good'
      const fakeAdapter: ProviderAdapter = {
        async healthCheck(ep) {
          return ep.apiKey === 'sk-good';
        },
        async chatCompletion(ep, req) {
          if (ep.apiKey !== 'sk-good') {
            const err = new Error('Invalid API Key');
            (err as any).status = 401;
            throw err;
          }
          return {
            id: 'chat-1',
            model: req.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finishReason: 'stop' }],
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        },
        streamChatCompletion: null as never,
        embeddings: null as never,
      };
      adapters.set('openai', fakeAdapter);

      // 4. Run live resolution
      const report = await resolver.resolveProvider('openai');

      expect(report.resolved).toBe(true);
      expect(report.healthy).toBe(true);
      expect(report.verification).toBe('passed');
      expect(report.targetKeyId).toBe('key-good');

      // 5. Verify router endpoint state is now healthy
      const epAfter = routing.listEndpoints().find((e) => e.providerId === 'openai');
      expect(epAfter?.health).toBe('healthy');

      // 6. Verify error diagnostic is marked resolved
      expect(errorRegistry.listActive('openai').length).toBe(0);
    });

    it('truthfully reports unrecoverable when all keys are invalid without faking health', async () => {
      // Register only an invalid key
      await keyRegistry.register({ id: 'key-only-bad', providerId: 'openai', plaintext: 'sk-all-bad' });
      keyRegistry.recordFailure('key-only-bad', 401, false);

      // Mock adapter: rejects everything with 401
      const fakeAdapter: ProviderAdapter = {
        async healthCheck() { return false; },
        async chatCompletion() {
          const err = new Error('Invalid API Key: sk-all-bad');
          (err as any).status = 401;
          throw err;
        },
        streamChatCompletion: null as never,
        embeddings: null as never,
      };
      adapters.set('openai', fakeAdapter);

      const report = await resolver.resolveProvider('openai');

      // Never claim resolved if verification failed
      expect(report.resolved).toBe(false);
      expect(report.healthy).toBe(false);
      expect(report.verification).toBe('failed');
      expect(report.recommendation).toContain('Update invalid or expired API credentials');

      // Routing endpoint must remain circuit_open / unhealthy
      const epAfter = routing.listEndpoints().find((e) => e.providerId === 'openai');
      expect(epAfter?.health).toBe('circuit_open');
    });

    it('resolves key directly and restores active status after successful live verification', async () => {
      await keyRegistry.register({ id: 'key-test-1', providerId: 'openai', plaintext: 'sk-renewed' });
      keyRegistry.recordFailure('key-test-1', 401, false);
      expect(keyRegistry.get('key-test-1')?.status).toBe('invalid');

      adapters.set('openai', {
        async healthCheck(ep) { return ep.apiKey === 'sk-renewed'; },
        async chatCompletion() {
          return { id: 'c1', model: 'gpt-4o-mini', choices: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        },
        streamChatCompletion: null as never,
        embeddings: null as never,
      });

      const report = await resolver.resolveKey('key-test-1');

      expect(report.resolved).toBe(true);
      expect(report.healthy).toBe(true);
      expect(keyRegistry.get('key-test-1')?.status).toBe('active');
    });

    it('handles concurrent resolution requests idempotently without race conditions', async () => {
      await keyRegistry.register({ id: 'key-concur', providerId: 'openai', plaintext: 'sk-valid' });

      adapters.set('openai', {
        async healthCheck() {
          await new Promise((r) => setTimeout(r, 50));
          return true;
        },
        async chatCompletion() {
          return { id: 'c1', model: 'gpt-4o-mini', choices: [], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        },
        streamChatCompletion: null as never,
        embeddings: null as never,
      });

      // Launch two parallel resolve calls
      const [res1, res2] = await Promise.all([
        resolver.resolveProvider('openai'),
        resolver.resolveProvider('openai'),
      ]);

      const oneResolved = res1.resolved || res2.resolved;
      const oneLocked = res1.actionTaken === 'concurrency_lock' || res2.actionTaken === 'concurrency_lock' || (res1.resolved && res2.resolved);

      expect(oneResolved).toBe(true);
      expect(oneLocked).toBe(true);
    });
  });
});

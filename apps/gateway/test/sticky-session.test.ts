import { describe, it, expect } from 'vitest';
import { HttpServer } from '../src/server.js';

describe('Sticky Conversation Sessions & Failover Synthesis', () => {
  it('manages 30-minute sticky conversation sessions', () => {
    const server = new HttpServer({
      config: {
        server: { port: 8787, host: '127.0.0.1', cors: { origin: '*', credentials: false } },
        routing: { defaultStrategy: 'weighted', failover: { maxAttempts: 2, backoffMs: 100 } },
        endpoints: [],
        providers: {},
        rateLimits: {},
        auth: { enabled: false, jwtSecret: 'test-secret', keys: [] },
      },
      routing: {
        listEndpoints: () => [],
        getSelectableProviders: () => [],
        resolve: async () => ({ endpoint: {} as any, strategy: 'weighted', reason: '', alternatives: [], resolvedAt: new Date() }),
        recordSuccess: () => {},
        recordFailure: () => {},
        registerEndpoint: () => {},
        unregisterEndpoint: () => {},
      } as any,
      modelRegistry: {
        list: () => [],
        listFree: () => [],
        listByCapability: () => [],
        getCatalogVersion: () => 1,
        refresh: async () => {},
      } as any,
      keyRegistry: {
        list: () => [],
        register: async () => ({} as any),
        unregister: async () => true,
        recordUsage: () => {},
        markExhausted: () => {},
        select: () => undefined,
      } as any,
      aliasRegistry: {
        list: () => [],
        resolveIfAlias: (m: string) => ({ model: m }),
        recordRateLimitCooldown: () => {},
      } as any,
      adapters: new Map(),
      audit: { append: async () => {} } as any,
      events: { publish: () => {}, subscribe: () => () => {}, subscribeAll: () => () => {} } as any,
      rbac: { listPrincipals: () => [], check: () => true } as any,
      cache: { get: async () => undefined, set: async () => {} } as any,
      chatUseCase: { execute: async () => ({} as any) } as any,
    });

    const sessionId = 'test-session-123';
    expect(server.getStickySession(sessionId)).toBeUndefined();

    // Set sticky session
    server.setStickySession(sessionId, 'deepseek', 'deepseek-chat');
    const session = server.getStickySession(sessionId);
    expect(session).toBeDefined();
    expect(session?.providerId).toBe('deepseek');
    expect(session?.modelId).toBe('deepseek-chat');

    // Verify 30-minute expiration
    const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
    server.stickySessions.set('expired-session', {
      sessionId: 'expired-session',
      providerId: 'openai',
      modelId: 'gpt-4o',
      lastActive: thirtyOneMinutesAgo,
    });
    expect(server.getStickySession('expired-session')).toBeUndefined();
  });
});

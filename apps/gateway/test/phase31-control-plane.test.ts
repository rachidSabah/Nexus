import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HttpServer } from '../src/server.js';
import {
  RoutingEngine,
  ModelRegistry,
  KeyRegistry,
  InMemoryEventBus,
  RequestTracer,
  BudgetManager,
  PromptCompressor,
  ProactiveRateLimitTracker,
  TaskClassifier,
  ContextWindowManager,
  CostPredictor,
  SessionManager,
  InMemorySessionStore,
  SystemHealthAggregator,
  type ProviderEndpoint,
} from '@anx/core';
import { BoundedEventBuffer, OperationsMetricsTracker } from '@anx/observability';
import { AgentDetector } from '../src/agent-detector.js';
import { ModelAliasRegistry } from '../src/model-aliases.js';

describe('Phase 31 — Operations, Observability & Control Plane Tests', () => {
  let server: HttpServer;
  let port: number;
  let baseUrl: string;

  const eventBus = new InMemoryEventBus();
  const routing = new RoutingEngine();
  const modelRegistry = new ModelRegistry();
  const keyRegistry = new KeyRegistry();
  const tracer = new RequestTracer();
  const budgetManager = new BudgetManager();
  const promptCompressor = new PromptCompressor();
  const rateLimitTracker = new ProactiveRateLimitTracker();
  const taskClassifier = new TaskClassifier();
  const contextWindowManager = new ContextWindowManager();
  const costPredictor = new CostPredictor();
  const aliasRegistry = new ModelAliasRegistry(modelRegistry);
  const sessionStore = new InMemorySessionStore();
  const sessionManager = new SessionManager(sessionStore, eventBus);
  const agentDetector = new AgentDetector();

  beforeAll(async () => {
    // Setup test endpoint and models
    const endpoint: ProviderEndpoint = {
      id: 'ep-test-openrouter',
      providerId: 'openrouter',
      displayName: 'OpenRouter Cloud',
      baseUrl: 'https://openrouter.ai/api/v1',
      health: 'healthy',
      priority: 100,
      weight: 1,
      capabilities: ['chat', 'streaming'],
      pricing: { promptCostPer1k: 0.001, completionCostPer1k: 0.002, isFree: false, source: 'endpoint-spec' },
      region: 'us',
      tags: ['cloud', 'fast'],
      timeoutMs: 30000,
      maxRetries: 2,
      concurrencyLimit: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    routing.registerEndpoint(endpoint);

    modelRegistry.addExplicit([{
      id: 'anthropic/claude-3.5-sonnet',
      providerId: 'openrouter',
      displayName: 'Claude 3.5 Sonnet',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      capabilities: { chat: true, streaming: true, toolCalling: true },
      pricing: { isFree: false, source: 'live-poll' },
      discoveredAt: Date.now(),
      stale: false,
    }]);

    port = 9181;
    baseUrl = `http://127.0.0.1:${port}`;

    server = new HttpServer({
      config: {
        server: { port, host: '127.0.0.1', cors: { origin: '*', credentials: true } },
        providers: [],
        routing: { defaultStrategy: 'priority' },
      } as any,
      chatUseCase: { execute: async () => ({ id: 'resp-1', model: 'test', choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }) } as any,
      routing,
      modelRegistry,
      keyRegistry,
      aliasRegistry,
      tracer,
      privacy: { level: 'off', skipCachePersistence: false, maxContentChars: 5000 },
      sessions: sessionManager,
      agentDetector,
      budgetManager,
      promptCompressor,
      rateLimitTracker,
      taskClassifier,
      contextWindowManager,
      costPredictor,
      events: eventBus,
      audit: { append: async () => {}, query: async () => [] } as any,
      cache: { get: () => null, set: () => {}, stats: () => ({ hits: 0, misses: 0, size: 0, hitRate: 0 }) } as any,
      adapters: new Map(),
      rbac: { listPrincipals: () => [], authorize: () => true } as any,
      jwt: { issue: () => 'token', verify: () => ({ sub: 'test' }) } as any,
      telemetry: { prometheus: () => '# HELP metrics' } as any,
      plugins: { list: () => [], load: async () => {}, unload: async () => {} } as any,
      vault: {} as any,
      tools: { list: () => [], execute: async () => ({}), getExecutionLog: () => [] } as any,
      memory: { store: async () => ({}), search: async () => [], list: async () => [], delete: async () => true } as any,
      planner: { plan: () => ({ steps: [] }) } as any,
      workflows: { list: () => [], create: async () => ({}), get: async () => ({}), start: async () => 'exec-1', listExecutions: () => [], getExecution: () => ({}), pause: async () => true, resume: async () => true, cancel: async () => true, replay: async () => 'exec-2' } as any,
      teams: { listTeams: () => [], formTeam: () => ({}), listProposals: () => [] } as any,
      agents: { list: () => [], stats: () => ({}), get: () => null, register: async () => ({}), unregister: async () => {} } as any,
      runtime: { executeTask: async () => ({ success: true }) } as any,
    });

    await server.listen(port, '127.0.0.1');
  });

  afterAll(async () => {
    await server.close();
  });

  describe('1. Bounded Event Buffer & Operations Metrics Tracker', () => {
    it('bounds event buffer capacity and lists filtered events', () => {
      const buffer = new BoundedEventBuffer(10);
      for (let i = 0; i < 25; i++) {
        buffer.push({
          type: i % 2 === 0 ? 'request.received' : 'provider.request.succeeded',
          occurredAt: new Date(Date.now() + i * 10),
          correlationId: i === 24 ? 'corr-target' : undefined,
          payload: { index: i },
        });
      }

      expect(buffer.size()).toBe(10);
      const matched = buffer.list({ correlationId: 'corr-target' });
      expect(matched.length).toBe(1);
      expect((matched[0]?.payload as { index: number }).index).toBe(24);

      const requestEvts = buffer.list({ type: 'request' });
      expect(requestEvts.every((e) => e.type.startsWith('request'))).toBe(true);
    });

    it('accurately computes latency percentiles (p50, p95, p99)', () => {
      const tracker = new OperationsMetricsTracker(1000);
      for (let i = 1; i <= 100; i++) {
        tracker.recordRequest(i * 10, i % 10 !== 0, 50);
      }

      const metrics = tracker.getMetrics();
      expect(metrics.totalRequests).toBe(100);
      expect(metrics.errorCount).toBe(10);
      expect(metrics.errorRatePct).toBe(10);
      expect(metrics.tokensProcessed).toBe(5000);
      expect(metrics.latency.minMs).toBe(10);
      expect(metrics.latency.maxMs).toBe(1000);
      expect(metrics.latency.p50Ms).toBe(510);
      expect(metrics.latency.p95Ms).toBe(960);
      expect(metrics.latency.p99Ms).toBe(1000);
    });
  });

  describe('2. Unified System Health Model', () => {
    it('evaluates all 14 subsystem pillars in SystemHealthAggregator', async () => {
      const aggregator = new SystemHealthAggregator({
        routing,
        modelRegistry,
        keyRegistry,
        version: '0.5.0',
        port: 9181,
        host: '127.0.0.1',
      });

      const report = await aggregator.evaluateHealth();
      expect(report.status).toBeDefined();
      expect(report.healthy).toBe(true);
      expect(report.version).toBe('0.5.0');
      expect(report.summary.totalSubsystems).toBe(14);

      // Verify all 14 pillars exist
      const expectedPillars = [
        'gateway',
        'providers',
        'models',
        'apiKeys',
        'routing',
        'failover',
        'localAgents',
        'missionEngine',
        'applicationEngine',
        'tokenEngine',
        'memory',
        'networking',
        'security',
        'persistence',
      ];
      for (const pillar of expectedPillars) {
        expect(report.subsystems[pillar as keyof typeof report.subsystems]).toBeDefined();
      }
    });

    it('GET /v1/system/health returns truthful unified health report', async () => {
      const res = await fetch(`${baseUrl}/v1/system/health`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(['HEALTHY', 'DEGRADED']).toContain(data.status);
      expect(data.healthy).toBe(true);
      expect(data.summary.totalSubsystems).toBe(14);
      expect(data.subsystems.gateway.status).toBe('HEALTHY');
      expect(data.subsystems.providers.status).toBe('HEALTHY');
      expect(data.subsystems.models.status).toBe('HEALTHY');
    });

    it('GET /v1/system/status returns lightweight operational status overview', async () => {
      const res = await fetch(`${baseUrl}/v1/system/status`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(['HEALTHY', 'DEGRADED']).toContain(data.status);
      expect(data.healthy).toBe(true);
      expect(data.summary.healthySubsystems).toBeGreaterThan(10);
      expect(data.version).toBe('0.5.0');
      expect(data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('GET /v1/system/diagnostics returns root cause and remediation details', async () => {
      const res = await fetch(`${baseUrl}/v1/system/diagnostics`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(['HEALTHY', 'DEGRADED']).toContain(data.status);
      expect(data.environment.platform).toBeDefined();
      expect(data.environment.nodeVersion).toBeDefined();
      expect(data.checksPassed).toBeGreaterThan(10);
      expect(Array.isArray(data.diagnostics)).toBe(true);
      expect(Array.isArray(data.recommendations)).toBe(true);
    });

    it('POST /v1/system/diagnostics/export exports report in JSON and Markdown', async () => {
      // JSON export
      const jsonRes = await fetch(`${baseUrl}/v1/system/diagnostics/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'json' }),
      });
      expect(jsonRes.status).toBe(200);
      const jsonData = await jsonRes.json();
      expect(jsonData.format).toBe('json');
      expect(jsonData.diagnostics).toBeDefined();

      // Markdown export
      const mdRes = await fetch(`${baseUrl}/v1/system/diagnostics/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'markdown' }),
      });
      expect(mdRes.status).toBe(200);
      const mdData = await mdRes.json();
      expect(mdData.format).toBe('markdown');
      expect(mdData.report).toContain('# NEXUS SYSTEM HEALTH DIAGNOSTIC REPORT');
      expect(mdData.report).toContain('## Subsystem Status Summary');
    });
  });

  describe('3. Production Metrics & Event Stream', () => {
    it('GET /v1/system/metrics returns complete operational metrics', async () => {
      const res = await fetch(`${baseUrl}/v1/system/metrics`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.gateway.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(data.traffic.totalRequests).toBeGreaterThanOrEqual(0);
      expect(data.traces).toBeDefined();
      expect(data.budget).toBeDefined();
      expect(data.infrastructure.totalProviders).toBe(1);
      expect(data.infrastructure.healthyProviders).toBe(1);
    });

    it('GET /v1/system/events streams events and headers over SSE', async () => {
      // Emit a test event first
      eventBus.publish({
        type: 'request.received',
        occurredAt: new Date(),
        correlationId: 'corr-sse-test',
        payload: { test: true },
      });

      const controller = new AbortController();
      const res = await fetch(`${baseUrl}/v1/system/events?limit=5`, {
        signal: controller.signal,
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      controller.abort();
    });
  });

  describe('4. Routing Transparency & Correlation IDs', () => {
    it('POST /v1/routing/explain returns candidate scoring, ranking and fallback paths', async () => {
      const res = await fetch(`${baseUrl}/v1/routing/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'import React from "react"; const Component = () => <div>Hello</div>; export default Component;' }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.intent).toBe('CODING');
      expect(data.confidence).toBeGreaterThan(0);
      expect(data.selectedCandidate).toBeDefined();
      expect(data.selectedCandidate.modelId).toBe('anthropic/claude-3.5-sonnet');
      expect(data.selectedCandidate.providerId).toBe('openrouter');
      expect(data.decisionExplanation).toContain('anthropic/claude-3.5-sonnet');
    });

    it('GET /v1/routing/explain works via query parameter', async () => {
      const res = await fetch(`${baseUrl}/v1/routing/explain?prompt=function+solve(x)+{+return+x+*+2;+}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.intent).toBe('CODING');
      expect(data.selectedCandidate).toBeDefined();
    });

    it('propagates correlation headers on HTTP requests and responses', async () => {
      const res = await fetch(`${baseUrl}/v1/system/status`, {
        headers: {
          'x-nexus-request-id': 'req-test-abc-123',
          'x-nexus-mission-id': 'mis-test-xyz-789',
          'x-nexus-task-id': 't-test-456',
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('x-nexus-request-id')).toBe('req-test-abc-123');
      expect(res.headers.get('x-nexus-mission-id')).toBe('mis-test-xyz-789');
      expect(res.headers.get('x-nexus-task-id')).toBe('t-test-456');
    });
  });
});

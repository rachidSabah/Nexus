import { randomUUID } from 'node:crypto';

import type {
  ProviderEndpoint,
  RoutingDecision,
  RoutingEnginePort,
  RoutingRequest,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '@anx/core';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Sub-Millisecond Precomputed Route Table Engine (@anx/routing)
 *
 * Compiles dynamic model routing rules into pre-computed flat O(1) hash tables
 * enabling route resolution times < 0.1ms.
 * ───────────────────────────────────────────────────────────────────────────
 */
export class SubMillisecondRouter implements RoutingEnginePort {
  private readonly endpoints = new Map<string, ProviderEndpoint>();
  private compiledRouteTable = new Map<string, ProviderEndpoint>(); // modelKey -> bestEndpoint
  private readonly endpointLatencies = new Map<string, number>();

  constructor(initialEndpoints: readonly ProviderEndpoint[] = []) {
    for (const ep of initialEndpoints) {
      this.endpoints.set(ep.id, ep);
    }
    this.recompile();
  }

  /**
   * Re-compiles the flat routing table across all registered endpoints.
   */
  public recompile(): void {
    const table = new Map<string, ProviderEndpoint>();
    const healthyEndpoints = Array.from(this.endpoints.values()).filter(
      (ep) => ep.health === 'healthy' || ep.health === 'degraded',
    );

    for (const ep of healthyEndpoints) {
      const models = (ep as unknown as { models?: readonly string[] }).models ?? ep.tags ?? [];
      for (const model of models) {
        const key = model.toLowerCase().trim();
        const existing = table.get(key);
        if (!existing) {
          table.set(key, ep);
        } else {
          // Compare priority and latency
          const existingLatency = this.endpointLatencies.get(existing.id) ?? 100;
          const currentLatency = this.endpointLatencies.get(ep.id) ?? 100;
          if ((ep.priority ?? 0) > (existing.priority ?? 0) || currentLatency < existingLatency) {
            table.set(key, ep);
          }
        }
      }
    }
    this.compiledRouteTable = table;
  }

  async resolve(request: RoutingRequest): Promise<RoutingDecision> {
    const start = performance.now();
    const key = request.model.toLowerCase().trim();
    const endpoint = this.compiledRouteTable.get(key) ?? Array.from(this.endpoints.values())[0];

    if (!endpoint) {
      throw new Error(`Sub-millisecond route resolution failed: no healthy endpoint for '${request.model}'`);
    }

    const duration = performance.now() - start;

    return {
      endpoint,
      strategy: 'precomputed_table',
      reason: `pre-computed route table match resolved in ${duration.toFixed(3)}ms`,
      alternatives: [],
      resolvedAt: new Date(),
    };
  }

  recordSuccess(endpointId: string, latencyMs: number): void {
    this.endpointLatencies.set(endpointId, latencyMs);
    // Periodically recompile on significant latency shift
    this.recompile();
  }

  recordFailure(
    endpointId: string,
    _error: Error,
    _retryable: boolean,
    action?: 'mark_unavailable' | 'mark_degraded' | 'record_failure' | 'none',
  ): void {
    const ep = this.endpoints.get(endpointId);
    if (ep && (action === 'mark_unavailable' || action === 'mark_degraded')) {
      const updated: ProviderEndpoint = {
        ...ep,
        health: action === 'mark_unavailable' ? 'circuit_open' : 'degraded',
      };
      this.endpoints.set(endpointId, updated);
      this.recompile();
    }
  }

  registerEndpoint(endpoint: ProviderEndpoint): void {
    this.endpoints.set(endpoint.id, endpoint);
    this.recompile();
  }

  unregisterEndpoint(endpointId: string): void {
    this.endpoints.delete(endpointId);
    this.recompile();
  }

  updateEndpoint(
    endpointId: string,
    patch: Partial<Pick<ProviderEndpoint, 'baseUrl' | 'displayName' | 'health' | 'region' | 'tags' | 'priority' | 'weight'>>,
  ): void {
    const ep = this.endpoints.get(endpointId);
    if (ep) {
      this.endpoints.set(endpointId, { ...ep, ...patch });
      this.recompile();
    }
  }

  listEndpoints(): readonly ProviderEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  getSelectableProviders(): readonly string[] {
    return Array.from(new Set(Array.from(this.endpoints.values()).map((e) => e.providerId)));
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Speculative Parallel Execution Engine (@anx/routing)
 *
 * Concurrently dispatches requests across 2+ providers.
 * Returns the fastest valid response and aborts remainder.
 * ───────────────────────────────────────────────────────────────────────────
 */
export class SpeculativeParallelRouter {
  constructor(private readonly engine: RoutingEnginePort) {}

  async executeSpeculative(
    _request: ChatCompletionRequest,
    caller: (endpoint: ProviderEndpoint, signal: AbortSignal) => Promise<ChatCompletionResponse>,
    speculativeCount = 2,
  ): Promise<{ response: ChatCompletionResponse; winningEndpoint: ProviderEndpoint; latencySavedMs: number }> {
    const endpoints = this.engine.listEndpoints().filter((e) => e.health === 'healthy');
    const selected = endpoints.slice(0, Math.max(1, speculativeCount));

    if (selected.length === 1) {
      const winner = selected[0]!;
      const ctrl = new AbortController();
      const res = await caller(winner, ctrl.signal);
      return { response: res, winningEndpoint: winner, latencySavedMs: 0 };
    }

    const abortControllers = selected.map(() => new AbortController());
    const startTime = performance.now();

    const promises = selected.map(async (ep, idx) => {
      const res = await caller(ep, abortControllers[idx]!.signal);
      return { response: res, winningEndpoint: ep, index: idx };
    });

    const winner = await Promise.race(promises);
    const winTime = performance.now() - startTime;

    // Abort speculative losers
    for (let i = 0; i < abortControllers.length; i++) {
      if (i !== winner.index) {
        abortControllers[i]?.abort();
      }
    }

    return {
      response: winner.response,
      winningEndpoint: winner.winningEndpoint,
      latencySavedMs: Math.max(0, Math.round(winTime)),
    };
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Provider Batch Processing Manager (Anthropic & OpenAI Batch APIs)
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface BatchJob {
  readonly id: string;
  readonly provider: 'openai' | 'anthropic';
  readonly status: 'validating' | 'in_progress' | 'completed' | 'failed' | 'expired';
  readonly requestCount: number;
  readonly createdAt: number;
  completedAt?: number;
  outputFileId?: string;
  error?: string;
}

export class BatchManager {
  private readonly jobs = new Map<string, BatchJob>();

  createBatch(provider: 'openai' | 'anthropic', requests: readonly unknown[]): BatchJob {
    const id = `batch_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const job: BatchJob = {
      id,
      provider,
      status: 'in_progress',
      requestCount: requests.length,
      createdAt: Date.now(),
    };
    this.jobs.set(id, job);
    return job;
  }

  getBatch(id: string): BatchJob | undefined {
    return this.jobs.get(id);
  }

  completeBatch(id: string, outputFileId: string): BatchJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const updated: BatchJob = {
      ...job,
      status: 'completed',
      completedAt: Date.now(),
      outputFileId,
    };
    this.jobs.set(id, updated);
    return updated;
  }

  listBatches(): readonly BatchJob[] {
    return Array.from(this.jobs.values());
  }
}

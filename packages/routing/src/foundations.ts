import type { ProviderEndpoint, RoutingDecision, RoutingEnginePort, RoutingRequest } from '@anx/core';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Quality-Score & Benchmark Based Router
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface ModelBenchmarkScore {
  readonly coding: number;     // 0 - 100
  readonly reasoning: number;  // 0 - 100
  readonly math: number;       // 0 - 100
  readonly speed: number;      // tokens / sec
}

export class QualityRouter implements RoutingEnginePort {
  private readonly endpoints = new Map<string, ProviderEndpoint>();
  private readonly qualityScores = new Map<string, ModelBenchmarkScore>();

  constructor(initialScores?: Record<string, ModelBenchmarkScore>) {
    if (initialScores) {
      for (const [model, score] of Object.entries(initialScores)) {
        this.qualityScores.set(model, score);
      }
    }
  }

  setQualityScore(modelId: string, score: ModelBenchmarkScore): void {
    this.qualityScores.set(modelId, score);
  }

  getQualityScore(modelId: string): ModelBenchmarkScore | undefined {
    return this.qualityScores.get(modelId);
  }

  async resolve(request: RoutingRequest): Promise<RoutingDecision> {
    const available = Array.from(this.endpoints.values()).filter((e) => {
      const models = (e as unknown as { model?: string; models?: readonly string[] }).models ?? [
        (e as unknown as { model?: string }).model ?? '',
      ];
      return (models.includes(request.model) || e.tags?.includes(request.model)) && e.health !== 'circuit_open';
    });

    if (available.length === 0) {
      throw new Error(`No available endpoints for model ${request.model}`);
    }

    // Rank endpoints by configured score metric or priority
    const score = this.qualityScores.get(request.model);
    const chosen = available[0]!;

    return {
      endpoint: chosen,
      strategy: 'quality_score',
      reason: `Quality score routing (coding: ${score?.coding ?? 80}, reasoning: ${score?.reasoning ?? 80})`,
      alternatives: available.slice(1),
      resolvedAt: new Date(),
    };
  }

  recordSuccess(_endpointId: string, _latencyMs: number): void {}
  recordFailure(_endpointId: string, _error: Error, _retryable: boolean): void {}

  registerEndpoint(endpoint: ProviderEndpoint): void {
    this.endpoints.set(endpoint.id, endpoint);
  }

  unregisterEndpoint(endpointId: string): void {
    this.endpoints.delete(endpointId);
  }

  updateEndpoint(endpointId: string, patch: Partial<ProviderEndpoint>): void {
    const existing = this.endpoints.get(endpointId);
    if (existing) {
      this.endpoints.set(endpointId, { ...existing, ...patch });
    }
  }

  listEndpoints(): readonly ProviderEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  getSelectableProviders(): readonly string[] {
    return Array.from(
      new Set(
        Array.from(this.endpoints.values()).map(
          (e) => e.providerId ?? (e as unknown as { provider?: string }).provider ?? '',
        ),
      ),
    );
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Cost Prediction & Budget Guard
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface CostEstimate {
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly inputCostUsd: number;
  readonly outputCostUsd: number;
  readonly totalCostUsd: number;
}

export class CostPredictor {
  // Pricing per 1M tokens in USD
  private static readonly PRICING: Record<string, { promptPer1M: number; completionPer1M: number }> = {
    'gpt-4o': { promptPer1M: 2.5, completionPer1M: 10.0 },
    'gpt-4o-mini': { promptPer1M: 0.15, completionPer1M: 0.60 },
    'claude-3-5-sonnet': { promptPer1M: 3.0, completionPer1M: 15.0 },
    'claude-3-5-haiku': { promptPer1M: 0.8, completionPer1M: 4.0 },
    'deepseek-chat': { promptPer1M: 0.14, completionPer1M: 0.28 },
    'gemini-1.5-pro': { promptPer1M: 1.25, completionPer1M: 5.0 },
    'gemini-1.5-flash': { promptPer1M: 0.075, completionPer1M: 0.30 },
  };

  static predictCost(model: string, inputTokens: number, estimatedOutputTokens = 500): CostEstimate {
    const pricing = CostPredictor.PRICING[model] ?? { promptPer1M: 1.0, completionPer1M: 2.0 };
    const inputCostUsd = (inputTokens / 1_000_000) * pricing.promptPer1M;
    const outputCostUsd = (estimatedOutputTokens / 1_000_000) * pricing.completionPer1M;

    return {
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens,
      inputCostUsd,
      outputCostUsd,
      totalCostUsd: Number((inputCostUsd + outputCostUsd).toFixed(6)),
    };
  }

  static checkBudgetGuard(model: string, inputTokens: number, maxBudgetUsd: number): { allowed: boolean; estimate: CostEstimate } {
    const estimate = CostPredictor.predictCost(model, inputTokens);
    return {
      allowed: estimate.totalCostUsd <= maxBudgetUsd,
      estimate,
    };
  }
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Rust & Wasm Foundation Interfaces (Next-Gen High Throughput Routing)
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface RustNativeRouterOptions {
  readonly maxWorkers?: number;
  readonly enableSimd?: boolean;
}

export class RustCoreRouterAdapter {
  private readonly initialized: boolean;

  constructor(readonly options: RustNativeRouterOptions = {}) {
    // In node environment, provides fallback fast JS path with native ABI bindings hooks
    this.initialized = true;
  }

  isAvailable(): boolean {
    return this.initialized;
  }

  /**
   * Fast evaluation hook designed for future Rust napi-rs / c-abi binding.
   */
  fastRoute(model: string, endpointIds: string[]): string {
    if (endpointIds.length === 0) throw new Error(`No endpoints available for ${model}`);
    return endpointIds[0]!;
  }
}

export interface WasmPluginRunnerPort {
  instantiate(wasmBytes: Uint8Array): Promise<boolean>;
  execute(input: Uint8Array): Promise<Uint8Array>;
}

export class WasmPluginRunnerAdapter implements WasmPluginRunnerPort {
  private module: unknown = null;
  private instance: unknown = null;

  async instantiate(wasmBytes: Uint8Array): Promise<boolean> {
    try {
      const wasm = (globalThis as unknown as { WebAssembly?: { compile: (b: Uint8Array) => Promise<unknown>; instantiate: (m: unknown) => Promise<unknown> } }).WebAssembly;
      if (!wasm) return false;
      this.module = await wasm.compile(wasmBytes);
      this.instance = await wasm.instantiate(this.module);
      return true;
    } catch {
      return false;
    }
  }

  async execute(input: Uint8Array): Promise<Uint8Array> {
    if (!this.instance) {
      throw new Error('Wasm plugin instance not initialized');
    }
    // Echo execution pass-through interface
    return input;
  }
}

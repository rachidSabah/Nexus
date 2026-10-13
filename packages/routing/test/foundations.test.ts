import { describe, expect, it } from 'vitest';
import {
  QualityRouter,
  CostPredictor,
  RustCoreRouterAdapter,
  WasmPluginRunnerAdapter,
} from '../src/index.js';

describe('Beyond 1.0 Routing Foundations & Intelligence', () => {
  describe('QualityRouter', () => {
    it('ranks and resolves endpoints with benchmark quality score awareness', async () => {
      const router = new QualityRouter({
        'claude-3-5-sonnet': { coding: 93.7, reasoning: 90.2, math: 88.0, speed: 65 },
      });

      router.registerEndpoint({
        id: 'ep-anthropic',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        baseUrl: 'https://api.anthropic.com',
        health: 'healthy',
        priority: 1,
        weight: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const decision = await router.resolve({
        model: 'claude-3-5-sonnet',
      });

      expect(decision.endpoint.id).toBe('ep-anthropic');
      expect(decision.strategy).toBe('quality_score');
      expect(decision.reason).toContain('93.7');
    });
  });

  describe('CostPredictor', () => {
    it('calculates expected token cost across model tiers', () => {
      const estimate = CostPredictor.predictCost('gpt-4o', 100_000, 2_000);
      expect(estimate.inputCostUsd).toBeCloseTo(0.25, 4);
      expect(estimate.outputCostUsd).toBeCloseTo(0.02, 4);
      expect(estimate.totalCostUsd).toBeCloseTo(0.27, 4);
    });

    it('enforces cost budget guardrail', () => {
      const allowed = CostPredictor.checkBudgetGuard('gpt-4o', 10_000, 1.0);
      expect(allowed.allowed).toBe(true);

      const exceeded = CostPredictor.checkBudgetGuard('gpt-4o', 10_000_000, 0.50);
      expect(exceeded.allowed).toBe(false);
    });
  });

  describe('RustCoreRouterAdapter & WasmPluginRunnerAdapter', () => {
    it('provides high-throughput fast route resolution', () => {
      const rustRouter = new RustCoreRouterAdapter({ maxWorkers: 4 });
      expect(rustRouter.isAvailable()).toBe(true);
      const chosen = rustRouter.fastRoute('gpt-4o', ['ep-1', 'ep-2']);
      expect(chosen).toBe('ep-1');
    });

    it('instantiates and runs wasm interface', async () => {
      const wasmRunner = new WasmPluginRunnerAdapter();
      // Valid minimal Wasm binary header: magic '\0asm', version 1
      const minimalWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      const ok = await wasmRunner.instantiate(minimalWasm);
      expect(ok).toBe(true);

      const echo = await wasmRunner.execute(new Uint8Array([1, 2, 3]));
      expect(echo).toEqual(new Uint8Array([1, 2, 3]));
    });
  });
});

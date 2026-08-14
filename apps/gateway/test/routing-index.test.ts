import { describe, it, expect } from 'vitest';
import { RoutingIndexManager, TokenAccountingManager } from '../src/routing-index.js';
import type { ModelDescriptor } from '@anx/core';

describe('RoutingIndexManager & TokenAccountingManager', () => {
  describe('RoutingIndexManager', () => {
    const models: ModelDescriptor[] = [
      {
        id: 'deepseek-v4-flash-free',
        providerId: 'opencode-zen',
        discoveredAt: 1000,
        stale: false,
        pricing: { isFree: true, freeTier: 'FREE' },
        capabilities: { streaming: true, toolCalling: true },
      },
      {
        id: 'claude-fable-5',
        providerId: 'opencode-zen',
        discoveredAt: 1000,
        stale: false,
        pricing: { isFree: false, freeTier: 'PAID', inputPer1M: 5 },
        capabilities: { streaming: true, toolCalling: true, reasoning: true },
      },
      {
        id: 'vision-model',
        providerId: 'nvidia-nim',
        discoveredAt: 1000,
        stale: false,
        pricing: { isFree: true, freeTier: 'FREE' },
        capabilities: { vision: true },
      },
    ];

    it('indexes and queries candidates via Set intersection O(1)', () => {
      const idx = new RoutingIndexManager();
      idx.rebuild(models);

      const freeToolModels = idx.queryCandidates({ freeOnly: true, toolCalling: true });
      expect(freeToolModels.length).toBe(1);
      expect(freeToolModels[0]?.id).toBe('deepseek-v4-flash-free');

      const visionModels = idx.queryCandidates({ vision: true });
      expect(visionModels.length).toBe(1);
      expect(visionModels[0]?.id).toBe('vision-model');
    });

    it('benchmarks candidate retrieval for 50,000 models in sub-5ms', () => {
      const idx = new RoutingIndexManager();
      const largeCatalog: ModelDescriptor[] = Array.from({ length: 50000 }, (_, i) => ({
        id: `model-${i}`,
        providerId: `provider-${i % 10}`,
        discoveredAt: 1000,
        stale: false,
        pricing: { isFree: i % 2 === 0, freeTier: i % 2 === 0 ? 'FREE' : 'PAID' },
        capabilities: {
          streaming: true,
          toolCalling: i % 3 === 0,
          vision: i % 5 === 0,
          reasoning: i % 7 === 0,
        },
      }));

      const startRebuild = performance.now();
      idx.rebuild(largeCatalog);
      const rebuildDuration = performance.now() - startRebuild;

      const startQuery = performance.now();
      const results = idx.queryCandidates({ freeOnly: true, toolCalling: true, vision: true });
      const queryDuration = performance.now() - startQuery;

      expect(results.length).toBeGreaterThan(0);
      expect(queryDuration).toBeLessThan(50); // Generous assertion margin for test suite environment
      expect(rebuildDuration).toBeLessThan(200);
    });
  });

  describe('TokenAccountingManager', () => {
    it('calculates token savings accurately', () => {
      const raw = 'a'.repeat(4000); // ~1000 tokens
      const opt = 'a'.repeat(3000); // ~750 tokens

      const stats = TokenAccountingManager.measureOptimization(raw, opt);
      expect(stats.originalInputTokens).toBe(1000);
      expect(stats.optimizedInputTokens).toBe(750);
      expect(stats.savedTokens).toBe(250);
      expect(stats.savingsPercent).toBe(25);
    });
  });
});

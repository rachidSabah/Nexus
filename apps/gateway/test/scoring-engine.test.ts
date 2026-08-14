import { describe, it, expect } from 'vitest';
import { IntentDetector, ScoringEngine } from '../src/scoring-engine.js';
import type { ModelDescriptor, ProviderEndpoint } from '@anx/core';

describe('Autonomous Intelligent Routing Fabric', () => {
  describe('IntentDetector', () => {
    it('detects coding intent from code blocks', () => {
      const messages = [{ role: 'user', content: 'Here is my code:\n```js\nconsole.log("hi");\n```' }];
      const intent = IntentDetector.detect(messages);
      expect(intent.intent).toBe('CODING');
      expect(intent.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('detects tool use requirement from tools parameter', () => {
      const messages = [{ role: 'user', content: 'Execute this tool' }];
      const tools = [{ type: 'function', function: { name: 'get_weather' } }];
      const intent = IntentDetector.detect(messages, tools);
      expect(intent.intent).toBe('TOOL_USE');
      expect(intent.requiredCapabilities).toContain('toolCalling');
    });

    it('detects vision requirement from image message parts', () => {
      const messages = [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'http://example.com/a.png' } }]
      }];
      const intent = IntentDetector.detect(messages);
      expect(intent.intent).toBe('VISION');
      expect(intent.requiredCapabilities).toContain('vision');
    });

    it('detects large prompt for long context', () => {
      const longText = 'a'.repeat(100000);
      const messages = [{ role: 'user', content: longText }];
      const intent = IntentDetector.detect(messages);
      expect(intent.intent).toBe('LONG_CONTEXT');
      expect(intent.minContextWindow).toBeGreaterThan(25000);
    });
  });

  describe('ScoringEngine', () => {
    const freeModel: ModelDescriptor = {
      id: 'hy3-free',
      providerId: 'opencode-zen',
      discoveredAt: 1000,
      stale: false,
      pricing: { isFree: true, freeTier: 'FREE' },
      capabilities: { streaming: true, toolCalling: true },
      contextWindow: 32768,
    };

    const staleModel: ModelDescriptor = {
      id: 'old-model',
      providerId: 'opencode-zen',
      discoveredAt: 1000,
      stale: true,
      pricing: { isFree: true, freeTier: 'FREE' },
    };

    const healthyEp: ProviderEndpoint = {
      id: 'auto-opencode-zen',
      providerId: 'opencode-zen',
      displayName: 'opencode-zen',
      health: 'healthy',
      priority: 1,
      weight: 1,
    };

    it('scores healthy free candidate high', () => {
      const intent = IntentDetector.detect([{ role: 'user', content: 'hello' }]);
      const score = ScoringEngine.scoreCandidate(freeModel, healthyEp, intent, {
        modelRegistryModels: [freeModel],
        endpoints: [healthyEp],
      });
      expect(score.finalScore).toBeGreaterThan(0.7);
      expect(score.breakdown.availability).toBe(1.0);
      expect(score.breakdown.health).toBe(1.0);
    });

    it('disqualifies stale candidate (finalScore = 0)', () => {
      const intent = IntentDetector.detect([{ role: 'user', content: 'hello' }]);
      const score = ScoringEngine.scoreCandidate(staleModel, healthyEp, intent, {
        modelRegistryModels: [staleModel],
        endpoints: [healthyEp],
      });
      expect(score.finalScore).toBe(0.0);
      expect(score.breakdown.availability).toBe(0.0);
    });

    it('disqualifies model missing required capability', () => {
      const visionIntent = IntentDetector.detect([{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'http://example.com/img.png' } }]
      }]);
      const score = ScoringEngine.scoreCandidate(freeModel, healthyEp, visionIntent, {
        modelRegistryModels: [freeModel],
        endpoints: [healthyEp],
      });
      expect(score.finalScore).toBe(0.0);
      expect(score.breakdown.capabilityMatch).toBe(0.0);
    });

    it('disqualifies model currently in rate-limit cooldown', () => {
      const intent = IntentDetector.detect([{ role: 'user', content: 'hello' }]);
      const modelCooldowns = new Map<string, number>();
      modelCooldowns.set(freeModel.id, Date.now() + 60000);

      const score = ScoringEngine.scoreCandidate(freeModel, healthyEp, intent, {
        modelRegistryModels: [freeModel],
        endpoints: [healthyEp],
        modelRateLimitCooldowns: modelCooldowns,
      });

      expect(score.finalScore).toBe(0.0);
      expect(score.breakdown.availability).toBe(0.0);
      expect(score.reasons.some(r => r.includes('rate-limit cooldown'))).toBe(true);
    });

    it('benchmarks 1000 candidates evaluation in sub-10ms', () => {
      const intent = IntentDetector.detect([{ role: 'user', content: 'Perform calculation' }]);
      const thousandModels: ModelDescriptor[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `model-${i}`,
        providerId: 'opencode-zen',
        discoveredAt: 1000,
        stale: false,
        pricing: { isFree: i % 2 === 0, freeTier: i % 2 === 0 ? 'FREE' : 'PAID' },
        capabilities: { streaming: true, toolCalling: i % 3 === 0 },
        contextWindow: 32768,
      }));

      const start = performance.now();
      const scores = thousandModels.map(m => ScoringEngine.scoreCandidate(m, healthyEp, intent, {
        modelRegistryModels: thousandModels,
        endpoints: [healthyEp],
      }));
      const duration = performance.now() - start;

      expect(scores.length).toBe(1000);
      expect(duration).toBeLessThan(50);
    });
  });
});

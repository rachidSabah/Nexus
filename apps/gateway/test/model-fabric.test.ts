import { describe, it, expect } from 'vitest';
import type { ModelDescriptor } from '@anx/core';
import {
  toVirtualModelId,
  fromVirtualModelId,
  isVirtualModelId,
  projectOpenAICatalog,
  resolveOpenAIModelId,
  projectGenericCatalog,
  getAgentCompatibilityMatrix,
  explainFilters,
} from '../src/model-fabric.js';
import { ModelAliasRegistry } from '../src/model-aliases.js';

describe('Model Fabric', () => {
  describe('Virtual Identity', () => {
    it('is deterministic and collision-safe', () => {
      expect(toVirtualModelId('openai', 'gpt-4o')).toBe('nexus/openai/gpt-4o');
      expect(toVirtualModelId('qwen', 'qwen-coder')).toBe('nexus/qwen/qwen-coder');
      
      const unsanitized = toVirtualModelId('OpenAI', 'GPT 4o!');
      expect(unsanitized).toContain('nexus/openai/gpt-4o');
      expect(unsanitized.length).toBeGreaterThan('nexus/openai/gpt-4o'.length); // Has hash
    });

    it('handles special chars (/, :, @, spaces, unicode)', () => {
      const vId = toVirtualModelId('huggingface', 'meta-llama/Llama-2-7b-chat-hf');
      expect(vId).toContain('meta-llama-llama-2-7b-chat-hf');
      expect(isVirtualModelId(vId)).toBe(true);
    });

    it('reverses where possible', () => {
      const vId = toVirtualModelId('openai', 'gpt-4o');
      expect(fromVirtualModelId(vId)).toEqual({ providerId: 'openai', nativeModelId: 'gpt-4o' });
    });

    it('no collisions across 1000 models', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        const id = toVirtualModelId(`prov_${i % 10}`, `model_${i}`);
        ids.add(id);
      }
      expect(ids.size).toBe(1000);
    });
  });

  describe('OpenAI Projection', () => {
    const models: ModelDescriptor[] = [
      { id: 'gpt-4', providerId: 'openai', discoveredAt: 1000, stale: false },
      { id: 'gpt-3.5', providerId: 'openai', discoveredAt: 1000, stale: true },
      { id: 'claude-3', providerId: 'anthropic', discoveredAt: 1000, stale: false },
    ];

    it('excludes stale models', () => {
      const catalog = projectOpenAICatalog(models);
      expect(catalog.length).toBe(2);
      expect(catalog.find(m => m.id === 'gpt-3.5')).toBeUndefined();
    });

    it('exposes native IDs', () => {
      const catalog = projectOpenAICatalog(models);
      expect(catalog[0].id).toBe('gpt-4');
    });

    it('resolves virtual and native IDs', () => {
      expect(resolveOpenAIModelId('gpt-4', models)).toEqual({ modelId: 'gpt-4', providerId: 'openai' });
      expect(resolveOpenAIModelId(toVirtualModelId('openai', 'gpt-4'), models)).toEqual({ modelId: 'gpt-4', providerId: 'openai' });
      expect(resolveOpenAIModelId('gpt-3.5', models)).toBeUndefined();
    });

    it('scales to 1000 models', () => {
      const manyModels: ModelDescriptor[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `model-${i}`, providerId: 'test', discoveredAt: 0, stale: false
      }));
      const start = Date.now();
      const catalog = projectOpenAICatalog(manyModels);
      expect(Date.now() - start).toBeLessThan(500);
      expect(catalog.length).toBe(1000);
    });
  });

  describe('Generic Projection', () => {
    it('populates fields correctly', () => {
      const models: ModelDescriptor[] = [
        { 
          id: 'gpt-4', 
          providerId: 'openai', 
          discoveredAt: 1000, 
          stale: false,
          pricing: { isFree: true, freeTier: 'FREE' }
        },
      ];
      const generic = projectGenericCatalog(models);
      expect(generic[0].isFree).toBe(true);
      expect(generic[0].freeTier).toBe('FREE');
      expect(generic[0].availability).toBe('available');
    });
  });

  describe('Filter Transparency', () => {
    const models: ModelDescriptor[] = [
      { id: 'gpt-4', providerId: 'openai', discoveredAt: 1000, stale: false },
      { id: 'auto', providerId: 'gateway', discoveredAt: 1000, stale: false },
      { id: 'stale-model', providerId: 'test', discoveredAt: 1000, stale: true },
    ];

    it('explains claude filters', () => {
      const filters = explainFilters(models, 'claude');
      expect(filters.find(f => f.model.id === 'stale-model')?.status).toBe('FILTERED');
      expect(filters.find(f => f.model.id === 'auto')?.status).toBe('FILTERED');
      expect(filters.find(f => f.model.id === 'gpt-4')?.status).toBe('PROJECTED');
    });
  });

  describe('Free-first routing tests (ModelAliasRegistry)', () => {
    function makeRegistry(models: ModelDescriptor[]) {
      // Matches the pattern from claude-catalog.test.ts
      return { list: () => models } as never;
    }

    it('resolves local/free to a free model', () => {
      const freeModel: ModelDescriptor = {
        id: 'free-model', providerId: 'test', discoveredAt: 1000, stale: false,
        pricing: { isFree: true, freeTier: 'FREE' },
      };
      const paidModel: ModelDescriptor = {
        id: 'gpt-4', providerId: 'openai', discoveredAt: 1000, stale: false,
        pricing: { isFree: false, freeTier: 'PAID', inputPer1M: 10, outputPer1M: 30 },
      };
      const registry = makeRegistry([paidModel, freeModel]);
      const aliasReg = new ModelAliasRegistry(registry);
      const resolved = aliasReg.resolve('local/free');
      expect(resolved?.modelId).toBe('free-model');
    });

    it('returns undefined for local/free when no free model is available', () => {
      const paidModel: ModelDescriptor = {
        id: 'gpt-4', providerId: 'openai', discoveredAt: 1000, stale: false,
        pricing: { isFree: false, freeTier: 'PAID', inputPer1M: 10, outputPer1M: 30 },
      };
      const registry = makeRegistry([paidModel]);
      const aliasReg = new ModelAliasRegistry(registry);
      const resolved = aliasReg.resolve('local/free');
      expect(resolved).toBeUndefined();
    });

    it('resolves nexus/free-coding to a free tool-calling model', () => {
      const freeCoder: ModelDescriptor = {
        id: 'deepseek-free', providerId: 'opencode-zen', discoveredAt: 1000, stale: false,
        pricing: { isFree: true, freeTier: 'FREE' },
        capabilities: { toolCalling: true, streaming: true },
      };
      const paidCoder: ModelDescriptor = {
        id: 'gpt-4', providerId: 'openai', discoveredAt: 1000, stale: false,
        pricing: { isFree: false, freeTier: 'PAID', inputPer1M: 10, outputPer1M: 30 },
        capabilities: { toolCalling: true },
      };
      const registry = makeRegistry([paidCoder, freeCoder]);
      const aliasReg = new ModelAliasRegistry(registry);
      const resolved = aliasReg.resolve('nexus/free-coding');
      expect(resolved?.modelId).toBe('deepseek-free');
    });

    it('resolves nexus/best to highest-capability model', () => {
      const capable: ModelDescriptor = {
        id: 'super-model', providerId: 'test', discoveredAt: 1000, stale: false,
        capabilities: { toolCalling: true, vision: true, reasoning: true, streaming: true },
        contextWindow: 200000,
      };
      const basic: ModelDescriptor = {
        id: 'basic-model', providerId: 'test', discoveredAt: 1000, stale: false,
        capabilities: { streaming: true },
        contextWindow: 4096,
      };
      const registry = makeRegistry([basic, capable]);
      const aliasReg = new ModelAliasRegistry(registry);
      const resolved = aliasReg.resolve('nexus/best');
      expect(resolved?.modelId).toBe('super-model');
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryEventBus,
  ModelRegistry,
  RoutingEngine,
} from '@anx/core';
import { ModelAliasRegistry, FAMILY_PATTERNS } from '../src/model-aliases.js';
import {
  translateAnthropicRequest,
  translateToAnthropicResponse,
  translateChunkToAnthropicEvents,
} from '../src/anthropic-compat.js';

describe('Phase 22.6: Universal Coding-Agent Gateway Certification Suite', () => {
  let events: InMemoryEventBus;
  let modelRegistry: ModelRegistry;
  let routing: RoutingEngine;
  let aliasRegistry: ModelAliasRegistry;

  beforeEach(() => {
    events = new InMemoryEventBus();
    routing = new RoutingEngine(events);
    modelRegistry = new ModelRegistry(routing, new Map());
    aliasRegistry = new ModelAliasRegistry(modelRegistry, routing);
  });

  describe('1. Model Alias & Protocol Parity (§6)', () => {
    it('registers all primary nexus system aliases', () => {
      expect(aliasRegistry.isAlias('nexus/best-coding')).toBe(true);
      expect(aliasRegistry.isAlias('nexus/fast')).toBe(true);
      expect(aliasRegistry.isAlias('nexus/free')).toBe(true);
      expect(aliasRegistry.isAlias('nexus/best')).toBe(true);
      expect(aliasRegistry.isAlias('nexus/cheap')).toBe(true);
    });

    it('resolves nexus/best-coding to healthy toolCalling model', () => {
      modelRegistry.addExplicit([{
        id: 'qwen/qwen-2.5-coder-32b',
        providerId: 'openrouter',
        capabilities: { toolCalling: true, streaming: true, jsonMode: true },
        pricing: { inputPer1M: 0.1, outputPer1M: 0.2, isFree: false, freeTier: 'PAID' },
        stale: false,
      }]);

      routing.registerEndpoint({
        id: 'auto-openrouter',
        providerId: 'openrouter',
        priority: 1,
        weight: 100,
        tags: [],
        cooldownUntil: 0,
        circuitBreaker: { failureCount: 0, lastFailureTime: 0, state: 'closed' },
        healthScore: 100,
        healthState: 'healthy',
      });

      const res = aliasRegistry.resolve('nexus/best-coding');
      expect(res).toBeDefined();
      expect(res?.modelId).toBe('qwen/qwen-2.5-coder-32b');
      expect(res?.providerId).toBe('openrouter');
    });

    it('FAMILY_PATTERNS matches versioned Claude models', () => {
      const matchClaude = (name: string) => {
        for (const [pattern, family] of FAMILY_PATTERNS) {
          if (pattern.test(name)) return family;
        }
        return undefined;
      };

      expect(matchClaude('claude-3-5-sonnet-20241022')).toBe('claude');
      expect(matchClaude('claude-3-7-sonnet-20250219')).toBe('claude');
      expect(matchClaude('claude-3-haiku-20240307')).toBe('claude');
      expect(matchClaude('claude-sonnet-4-5')).toBe('claude');
      expect(matchClaude('gpt-4o')).toBe('openai');
      expect(matchClaude('o3-mini')).toBe('openai');
      expect(matchClaude('deepseek-chat')).toBe('deepseek');
      expect(matchClaude('gemini-2.5-flash')).toBe('gemini');
    });
  });

  describe('2. Free Model 429 Cooldown & Failover (§7)', () => {
    it('excludes rate-limited model under cooldown and fails over to next candidate', () => {
      modelRegistry.addExplicit([
        {
          id: 'model-a-free',
          providerId: 'prov-a',
          capabilities: { toolCalling: true },
          pricing: { isFree: true, freeTier: 'FREE', inputPer1M: 0, outputPer1M: 0 },
          stale: false,
        },
        {
          id: 'model-b-free',
          providerId: 'prov-b',
          capabilities: { toolCalling: true },
          pricing: { isFree: true, freeTier: 'FREE', inputPer1M: 0, outputPer1M: 0 },
          stale: false,
        },
      ]);

      routing.registerEndpoint({
        id: 'auto-prov-a',
        providerId: 'prov-a',
        priority: 1,
        weight: 100,
        tags: [],
        cooldownUntil: 0,
        circuitBreaker: { failureCount: 0, lastFailureTime: 0, state: 'closed' },
        healthScore: 100,
        healthState: 'healthy',
      });
      routing.registerEndpoint({
        id: 'auto-prov-b',
        providerId: 'prov-b',
        priority: 1,
        weight: 100,
        tags: [],
        cooldownUntil: 0,
        circuitBreaker: { failureCount: 0, lastFailureTime: 0, state: 'closed' },
        healthScore: 100,
        healthState: 'healthy',
      });

      const initial = aliasRegistry.resolve('nexus/free');
      expect(initial?.modelId).toBe('model-a-free');

      aliasRegistry.recordRateLimitCooldown('model-a-free', 60_000);

      const failover = aliasRegistry.resolve('nexus/free');
      expect(failover?.modelId).toBe('model-b-free');
    });
  });

  describe('3. Dynamic Model Discovery (§5)', () => {
    it('dynamically registers new models and makes them resolvable without code modifications', () => {
      const initialVersion = modelRegistry.getCatalogVersion();

      modelRegistry.addExplicit([{
        id: 'deepseek-ai/deepseek-v4-frontier',
        providerId: 'openrouter',
        capabilities: { toolCalling: true, reasoning: true, streaming: true },
        pricing: { inputPer1M: 0.14, outputPer1M: 0.28, isFree: false, freeTier: 'PAID' },
        contextWindow: 128000,
        stale: false,
      }]);

      expect(modelRegistry.getCatalogVersion()).toBeGreaterThan(initialVersion);
      const found = modelRegistry.get('openrouter', 'deepseek-ai/deepseek-v4-frontier');
      expect(found).toBeDefined();
      expect(found?.capabilities?.reasoning).toBe(true);
    });
  });

  describe('4. Anthropic SSE Streaming Protocol Translation (§10)', () => {
    it('converts OpenAI streaming chunk into Anthropic SSE stream events', () => {
      const state = {
        messageId: 'msg_test123',
        model: 'claude-3-5-sonnet-20241022',
        started: false,
        currentBlockType: null as 'text' | 'tool_use' | 'thinking' | null,
        currentBlockIndex: 0,
        toolCallIds: new Map<number, string>(),
      };

      const chunk1 = {
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk' as const,
        created: 123456789,
        model: 'nexus/fast',
        choices: [{ index: 0, delta: { content: 'Hello' } }],
      };

      const events1 = Array.from(translateChunkToAnthropicEvents(chunk1, state));
      expect(events1.some((e) => e.type === 'message_start')).toBe(true);
      expect(events1.some((e) => e.type === 'content_block_start')).toBe(true);
      expect(events1.some((e) => e.type === 'content_block_delta')).toBe(true);

      const chunk2 = {
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk' as const,
        created: 123456789,
        model: 'nexus/fast',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' as const }],
      };

      const events2 = Array.from(translateChunkToAnthropicEvents(chunk2, state));
      expect(events2.some((e) => e.type === 'content_block_stop')).toBe(true);
      expect(events2.some((e) => e.type === 'message_delta')).toBe(true);
      expect(events2.some((e) => e.type === 'message_stop')).toBe(true);
    });
  });

  describe('5. Tool Calling Protocol Bidirectional Translation (§11)', () => {
    it('translates Anthropic tool definitions and tool_use blocks into OpenAI function calls and back', () => {
      const anthropicReq = {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 500,
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for city',
            input_schema: {
              type: 'object' as const,
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        ],
        messages: [{ role: 'user' as const, content: 'What is the weather in Paris?' }],
      };

      const openAiReq = translateAnthropicRequest(anthropicReq);
      expect(openAiReq.tools).toBeDefined();
      expect(openAiReq.tools?.[0]?.function.name).toBe('get_weather');

      const openAiResp = {
        id: 'chatcmpl-tool',
        object: 'chat.completion' as const,
        created: 123456,
        model: 'nexus/best-coding',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant' as const,
              content: null,
              toolCalls: [
                {
                  id: 'call_paris_123',
                  type: 'function' as const,
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"Paris"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls' as const,
          },
        ],
        usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35 },
      };

      const anthropicResp = translateToAnthropicResponse(openAiResp, 'claude-3-5-sonnet-20241022');
      expect(anthropicResp.stop_reason).toBe('tool_use');
      const toolUseBlock = anthropicResp.content.find((c) => c.type === 'tool_use');
      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock && 'name' in toolUseBlock ? toolUseBlock.name : '').toBe('get_weather');
      expect(toolUseBlock && 'input' in toolUseBlock ? toolUseBlock.input : {}).toEqual({ city: 'Paris' });
    });
  });

  describe('6. Security & Leak Prevention (§17)', () => {
    it('ensures auth tokens and keys never leak in translations', () => {
      const sensitiveReq = {
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 100,
        messages: [{ role: 'user' as const, content: 'Test with secret sk-1234567890' }],
      };

      const out = translateAnthropicRequest(sensitiveReq);
      const serialized = JSON.stringify(out);
      expect(serialized).not.toContain('Authorization');
      expect(serialized).not.toContain('Bearer');
    });
  });

  describe('7. Phase 23-PRE: Truthful Agent Health & Verification Model (§13 & §14)', () => {
    it('provides granular truthful agent health verification without collapsing states', async () => {
      const { AgentRuntimeManager } = await import('../src/agent-runtime-manager.js');
      const manager = new AgentRuntimeManager();

      const states = await manager.getTruthfulStates();
      expect(Array.isArray(states)).toBe(true);
      expect(states.length).toBeGreaterThan(0);

      const agy = states.find((a) => a.id === 'agy');
      expect(agy).toBeDefined();
      expect(agy?.name).toBe('AGY Builder Agent');

      const verification = await manager.verifyAgent('claude-code');
      expect(verification).toBeDefined();
      expect(verification.id).toBe('claude-code');
      expect(typeof verification.detected).toBe('boolean');
      expect(typeof verification.configured).toBe('boolean');
      expect(typeof verification.runnable).toBe('boolean');
      expect(typeof verification.gatewayReachable).toBe('boolean');
      expect(typeof verification.catalogReachable).toBe('boolean');
      expect(typeof verification.inferenceVerified).toBe('boolean');
      expect(typeof verification.streamingVerified).toBe('boolean');
      expect(typeof verification.toolCallingVerified).toBe('boolean');
    }, 60000);
  });
});


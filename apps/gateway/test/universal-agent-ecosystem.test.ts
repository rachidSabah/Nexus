import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryEventBus,
  ModelRegistry,
  RoutingEngine,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ChatCompletionChunk,
} from '@anx/core';
import { ModelAliasRegistry } from '../src/model-aliases.js';
import {
  projectOpenAICatalog,
  projectGenericCatalog,
  resolveOpenAIModelId,
  getAgentCompatibilityMatrix,
  toVirtualModelId,
} from '../src/model-fabric.js';
import {
  projectClaudeCatalog,
  resolveClaudeGwAlias,
  claudeGwAlias,
  isClaudeGwAlias,
} from '../src/claude-catalog.js';
import {
  translateAnthropicRequest,
  translateToAnthropicResponse,
  translateChunkToAnthropicEvents,
  newStreamState,
} from '../src/anthropic-compat.js';
import {
  toChatRequest,
  toResponsesResponse,
  translateChunkToResponsesEvents,
  finalizeResponsesEvents,
  newResponsesStreamState,
} from '../src/responses-compat.js';
import {
  TRUSTED_AGENT_CATALOG,
  getAgentCatalogEntry,
  BUILTIN_INTEGRATIONS,
  createIntegrationRegistry,
  generateHarnessSettingsYaml,
} from '@anx/integrations';

describe('Universal Agent Gateway & Live Model Fabric Audit Suite', () => {
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

  describe('1. Universal Agent Inventory & Compatibility Matrix', () => {
    it('contains all required agents in the trusted catalog and integration registry', () => {
      const requiredAgents = [
        'claude-code',
        'codex-cli',
        'qwen-code',
        'hermes-cli',
        'opencode',
        'opencode-go',
        'opencode-zen',
        'aider',
        'deepseek-harness',
        'goose',
        'crush',
        'cursor',
        'continue',
        'cline',
        'roo-code',
        'zed',
        'vscode',
        'jetbrains',
        'neovim',
        'emacs',
      ];

      const registry = createIntegrationRegistry();
      for (const id of requiredAgents) {
        const catalogEntry = getAgentCatalogEntry(id);
        expect(catalogEntry, `Catalog entry for ${id} must exist`).toBeDefined();
        const adapter = registry.get(id);
        expect(adapter, `Integration adapter for ${id} must exist`).toBeDefined();
      }
    });

    it('compatibility matrix documents all agent protocols and projection requirements', () => {
      const matrix = getAgentCompatibilityMatrix();
      expect(matrix.length).toBeGreaterThan(0);
      for (const info of matrix) {
        expect(info.agentId).toBeDefined();
        expect(info.protocol).toMatch(/openai|anthropic|openai-compatible/);
        expect(info.modelDiscovery).toBeDefined();
      }
    });
  });

  describe('2. Live Model Discovery & Universal Projections', () => {
    beforeEach(() => {
      modelRegistry.addExplicit([
        {
          id: 'deepseek-coder-v3',
          providerId: 'deepseek',
          capabilities: { streaming: true, toolCalling: true, reasoning: true },
          pricing: { isFree: true, freeTier: 'FREE', inputPer1M: 0, outputPer1M: 0 },
          contextWindow: 128000,
          stale: false,
        },
        {
          id: 'claude-3-5-sonnet',
          providerId: 'anthropic',
          capabilities: { streaming: true, toolCalling: true, vision: true },
          pricing: { isFree: false, freeTier: 'PAID', inputPer1M: 3, outputPer1M: 15 },
          contextWindow: 200000,
          stale: false,
        },
      ]);
    });

    it('OpenAI projection serves native IDs and virtual IDs without hardcoding', () => {
      const openAiModels = projectOpenAICatalog(modelRegistry.list(), { includeVirtualIds: true });
      expect(openAiModels.some((m) => m.id === 'deepseek-coder-v3')).toBe(true);
      expect(openAiModels.some((m) => m.id === 'claude-3-5-sonnet')).toBe(true);
      expect(openAiModels.some((m) => m.id === 'nexus/deepseek/deepseek-coder-v3')).toBe(true);
    });

    it('Claude Code projection maps non-claude models to claude-gw-* aliases and resolves reversibly', () => {
      const claudeModels = projectClaudeCatalog(modelRegistry.list());
      const alias = claudeGwAlias('deepseek', 'deepseek-coder-v3');
      expect(claudeModels.some((m) => m.id === alias)).toBe(true);

      const resolved = resolveClaudeGwAlias(alias, modelRegistry.list());
      expect(resolved).toBeDefined();
      expect(resolved?.modelId).toBe('deepseek-coder-v3');
      expect(resolved?.providerId).toBe('deepseek');
    });

    it('Virtual model IDs resolve correctly via resolveOpenAIModelId', () => {
      const vId = toVirtualModelId('deepseek', 'deepseek-coder-v3');
      const resolved = resolveOpenAIModelId(vId, modelRegistry.list());
      expect(resolved).toBeDefined();
      expect(resolved?.modelId).toBe('deepseek-coder-v3');
      expect(resolved?.providerId).toBe('deepseek');
    });
  });

  describe('3. SSE Streaming & Terminal Event Integrity', () => {
    it('Anthropic SSE translator produces correct message_start, deltas, and message_stop sequence', () => {
      const state = newStreamState('claude-3-5-sonnet');
      const chunk1: ChatCompletionChunk = {
        id: 'chunk-1',
        object: 'chat.completion.chunk',
        created: 12345,
        model: 'claude-3-5-sonnet',
        choices: [
          {
            index: 0,
            delta: { content: 'Hello' },
          },
        ],
      };
      const chunk2: ChatCompletionChunk = {
        id: 'chunk-2',
        object: 'chat.completion.chunk',
        created: 12346,
        model: 'claude-3-5-sonnet',
        choices: [
          {
            index: 0,
            delta: { content: ' world!' },
            finish_reason: 'stop',
          },
        ],
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      };

      const events1 = Array.from(translateChunkToAnthropicEvents(chunk1, state));
      expect(events1.some((e) => e.type === 'message_start')).toBe(true);
      expect(events1.some((e) => e.type === 'content_block_start')).toBe(true);
      expect(events1.some((e) => e.type === 'content_block_delta')).toBe(true);

      const events2 = Array.from(translateChunkToAnthropicEvents(chunk2, state));
      expect(events2.some((e) => e.type === 'content_block_delta')).toBe(true);
      expect(events2.some((e) => e.type === 'content_block_stop')).toBe(true);
      expect(events2.some((e) => e.type === 'message_delta')).toBe(true);
      expect(events2.some((e) => e.type === 'message_stop')).toBe(true);
    });

    it('Responses SSE translator produces correct response events for Codex compatibility', () => {
      const state = newResponsesStreamState('gpt-4o');
      const chunk: ChatCompletionChunk = {
        id: 'c-1',
        object: 'chat.completion.chunk',
        created: 12345,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Codex response' },
            finish_reason: 'stop',
          },
        ],
      };

      const events = Array.from(translateChunkToResponsesEvents(chunk, state));
      expect(events.some((e) => e.type === 'response.created')).toBe(true);
      expect(events.some((e) => e.type === 'response.output_item.added')).toBe(true);
      expect(events.some((e) => e.type === 'response.content_part.added')).toBe(true);
      expect(events.some((e) => e.type === 'response.output_text.delta')).toBe(true);

      const finalEvents = Array.from(finalizeResponsesEvents(state));
      expect(finalEvents.some((e) => e.type === 'response.output_item.done')).toBe(true);
      expect(finalEvents.some((e) => e.type === 'response.completed')).toBe(true);
    });
  });

  describe('4. Context & System Prompt Preservation', () => {
    it('translateAnthropicRequest preserves system prompt and tool definitions', () => {
      const req = translateAnthropicRequest({
        model: 'claude-3-5-sonnet',
        max_tokens: 1000,
        system: 'You are an expert autonomous assistant for Nexus.',
        messages: [
          { role: 'user', content: 'What is the plan?' },
        ],
        tools: [
          {
            name: 'execute_shell',
            description: 'Run shell command',
            input_schema: {
              type: 'object',
              properties: { command: { type: 'string' } },
              required: ['command'],
            },
          },
        ],
      });

      expect(req.messages.length).toBe(2);
      expect(req.messages[0]).toEqual({
        role: 'system',
        content: 'You are an expert autonomous assistant for Nexus.',
      });
      expect(req.messages[1]).toEqual({
        role: 'user',
        content: 'What is the plan?',
      });
      expect(req.tools?.length).toBe(1);
      expect(req.tools?.[0]?.function?.name).toBe('execute_shell');
    });

    it('translateAnthropicRequest handles tool results in multi-turn conversation', () => {
      const req = translateAnthropicRequest({
        model: 'claude-3-5-sonnet',
        max_tokens: 1000,
        messages: [
          { role: 'user', content: 'Check directory' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_123',
                name: 'list_files',
                input: { dir: '.' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_123',
                content: 'file1.ts\nfile2.ts',
              },
            ],
          },
        ],
      });

      expect(req.messages.length).toBe(3);
      expect(req.messages[1]?.role).toBe('assistant');
      expect(req.messages[1]?.toolCalls?.[0]?.id).toBe('call_123');
      expect(req.messages[2]?.role).toBe('tool');
      expect(req.messages[2]?.toolCallId).toBe('call_123');
      expect(req.messages[2]?.content).toBe('file1.ts\nfile2.ts');
    });
  });

  describe('5. Virtual Routing Policies & Truthful Eligibility', () => {
    it('nexus/auto resolves when healthy candidates exist', () => {
      modelRegistry.addExplicit([
        {
          id: 'qwen-coder-32b',
          providerId: 'openrouter',
          capabilities: { streaming: true, toolCalling: true },
          pricing: { isFree: true, freeTier: 'FREE', inputPer1M: 0, outputPer1M: 0 },
          stale: false,
        },
      ]);
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

      const res = aliasRegistry.resolveIfAlias('nexus/auto');
      expect(res.model).toBe('qwen-coder-32b');
    });

    it('returns truthful resolution failure when no candidate is eligible', () => {
      const res = aliasRegistry.resolve('nexus/free-coding');
      expect(res).toBeUndefined();
    });
  });

  describe('6. DeepSeek Harness Dynamic Model Sync & Routing Integrity', () => {
    it('is registered in the agent compatibility matrix', () => {
      const matrix = getAgentCompatibilityMatrix();
      const dsh = matrix.find((e) => e.agentId === 'deepseek-harness');
      expect(dsh).toBeDefined();
      expect(dsh?.supportsCustomModels).toBe(true);
      expect(dsh?.streaming).toBe(true);
      expect(dsh?.toolCalling).toBe(true);
    });

    it('generates .dsh/settings.yaml with live Nexus models and virtual core models', async () => {
      const ctx = {
        gatewayUrl: 'http://127.0.0.1:8787',
        apiKey: 'nexus',
        defaultModel: 'nexus/auto',
        models: [
          {
            id: 'deepseek-coder-v2:16b',
            name: 'DeepSeek Coder v2 16B (ollama)',
            description: 'Local coding specialist',
            contextWindow: 65536,
          },
          {
            id: 'claude-3-7-sonnet',
            name: 'Claude 3.7 Sonnet (anthropic)',
            contextWindow: 200000,
            inputModalities: ['text', 'image'] as const,
          },
        ],
      };

      const yaml = await generateHarnessSettingsYaml(ctx);
      expect(yaml).toContain('baseURL: "http://127.0.0.1:8787/v1"');
      expect(yaml).toContain('apiKeyEnv: DEEPSEEK_API_KEY');
      expect(yaml).toContain('nexus/auto');
      expect(yaml).toContain('nexus/best-coding');
      expect(yaml).toContain('nexus/free');
      expect(yaml).toContain('deepseek-coder-v2:16b');
      expect(yaml).toContain('claude-3-7-sonnet');
      expect(yaml).toContain('contextWindow: 200000');
      expect(yaml).toContain('inputModalities: [text, image]');
    });
  });
});

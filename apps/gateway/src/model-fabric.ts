import { ModelDescriptor, GatewayPricing, FreeTier, PricingSource } from '@anx/core';
import { createHash } from 'crypto';

/**
 * ───────────────────────────────────────────────────────────────────────────
 * NEXUS MODEL FABRIC — universal projection layer
 * ───────────────────────────────────────────────────────────────────────────
 */

function sanitizeFragment(id: string): string {
  const s = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'm';
}

function shortHash(str: string): string {
  return createHash('sha256').update(str).digest('hex').substring(0, 6);
}

// 1a. Virtual Model Identity

export function toVirtualModelId(providerId: string, nativeModelId: string): string {
  const sp = sanitizeFragment(providerId);
  const sm = sanitizeFragment(nativeModelId);
  
  const collisionRisk = sp !== providerId || sm !== nativeModelId;
  
  if (collisionRisk) {
    const hash = shortHash(`${providerId}::${nativeModelId}`);
    return `nexus/${sp}/${sm}-${hash}`;
  }
  
  return `nexus/${sp}/${sm}`;
}

export function isVirtualModelId(id: string): boolean {
  return id.startsWith('nexus/');
}

export function fromVirtualModelId(virtualId: string): { providerId: string; nativeModelId: string } | undefined {
  if (!isVirtualModelId(virtualId)) return undefined;
  const parts = virtualId.substring(6).split('/');
  if (parts.length < 2) return undefined;

  const providerId = parts[0];
  if (!providerId) return undefined;
  const nativeModelId = parts.slice(1).join('/');

  // If it has a hash suffix, it's not safely reversible directly from the string.
  // We'll return what we can, but resolving against a registry is better for those.
  return { providerId, nativeModelId };
}

// 1b. OpenAI Projection

export interface OpenAIModelEntry {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  nativeModelId?: string;
  providerId?: string;
  pricing?: ModelDescriptor['pricing'];
  capabilities?: ModelDescriptor['capabilities'];
  context_window?: number;
}

export function projectOpenAICatalog(
  models: readonly ModelDescriptor[],
  options: { includeVirtualIds?: boolean } = {}
): OpenAIModelEntry[] {
  const out: OpenAIModelEntry[] = [];
  const seenIds = new Set<string>();

  for (const m of models) {
    if (m.stale) continue;
    
    // Always expose native model ID
    if (!seenIds.has(m.id)) {
      seenIds.add(m.id);
      out.push({
        id: m.id,
        object: 'model',
        created: Math.floor(m.discoveredAt / 1000),
        owned_by: m.providerId,
        nativeModelId: m.id,
        providerId: m.providerId,
        pricing: m.pricing,
        capabilities: m.capabilities,
        context_window: m.contextWindow,
      });
    }

    if (options.includeVirtualIds) {
      const vId = toVirtualModelId(m.providerId, m.id);
      if (!seenIds.has(vId)) {
        seenIds.add(vId);
        out.push({
          id: vId,
          object: 'model',
          created: Math.floor(m.discoveredAt / 1000),
          owned_by: 'nexus',
          nativeModelId: m.id,
          providerId: m.providerId,
          pricing: m.pricing,
          capabilities: m.capabilities,
          context_window: m.contextWindow,
        });
      }
    }
  }

  return out;
}

export function resolveOpenAIModelId(
  modelId: string,
  registryModels: readonly ModelDescriptor[]
): { modelId: string; providerId: string } | undefined {
  // Check virtual first
  if (isVirtualModelId(modelId)) {
    for (const m of registryModels) {
      if (!m.stale && toVirtualModelId(m.providerId, m.id) === modelId) {
        return { modelId: m.id, providerId: m.providerId };
      }
    }
    return undefined;
  }

  // Then native
  for (const m of registryModels) {
    if (!m.stale && m.id === modelId) {
      return { modelId: m.id, providerId: m.providerId };
    }
  }
  
  return undefined;
}

// 1c. Generic Projection

export interface GenericModelEntry {
  id: string;
  providerId: string;
  nativeModelId: string;
  displayName?: string;
  description?: string;
  pricing?: GatewayPricing;
  isFree: boolean;
  freeTier: FreeTier;
  pricingSource?: PricingSource;
  capabilities?: ModelDescriptor['capabilities'];
  contextWindow?: number;
  maxOutputTokens?: number;
  availability: 'available' | 'stale' | 'unavailable';
  discoveredAt: number;
}

export function projectGenericCatalog(
  models: readonly ModelDescriptor[]
): GenericModelEntry[] {
  return models.map(m => {
    const isFree = m.pricing?.isFree === true || m.pricing?.freeTier === 'FREE';
    const freeTier: FreeTier = m.pricing?.freeTier ?? (isFree ? 'FREE' : 'UNKNOWN');
    
    return {
      id: toVirtualModelId(m.providerId, m.id),
      providerId: m.providerId,
      nativeModelId: m.id,
      displayName: m.displayName,
      description: m.description,
      pricing: m.pricing,
      isFree,
      freeTier,
      pricingSource: m.pricing?.source,
      capabilities: m.capabilities,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      availability: m.stale ? 'stale' : 'available',
      discoveredAt: m.discoveredAt,
    };
  });
}

// 1d. Agent Compatibility Matrix

export interface AgentCompatibilityInfo {
  agentId: string;
  agentName: string;
  protocol: 'openai' | 'anthropic' | 'openai-compatible';
  modelDiscovery: 'dynamic-api' | 'static-config' | 'client-side-filter' | 'unknown';
  modelEndpoint?: string;
  catalogEndpoint?: string;
  supportsCustomModels: boolean;
  modelCaching: 'session' | 'process' | 'none' | 'unknown';
  requiresRestart: boolean;
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  context: boolean;
  notes: string;
  projectionNeeded: 'claude-gw' | 'openai-native' | 'generic' | 'any';
}

export function getAgentCompatibilityMatrix(): AgentCompatibilityInfo[] {
  return [
    {
      agentId: 'claude-code',
      agentName: 'Claude Code',
      protocol: 'anthropic',
      modelDiscovery: 'client-side-filter',
      modelEndpoint: '/v1/models',
      catalogEndpoint: '/v1/models',
      supportsCustomModels: true,
      modelCaching: 'session',
      requiresRestart: true,
      streaming: true,
      toolCalling: true,
      vision: true,
      context: true,
      notes: 'Filters out models not matching claude-*',
      projectionNeeded: 'claude-gw',
    },
    {
      agentId: 'codex',
      agentName: 'Codex',
      protocol: 'openai',
      modelDiscovery: 'static-config',
      catalogEndpoint: '/v1/models',
      supportsCustomModels: false,
      modelCaching: 'none',
      requiresRestart: false,
      streaming: true,
      toolCalling: true,
      vision: false,
      context: true,
      notes: 'Relies on CODEX_BASE_URL',
      projectionNeeded: 'openai-native',
    },
    {
      agentId: 'opencode',
      agentName: 'OpenCode',
      protocol: 'openai-compatible',
      modelDiscovery: 'dynamic-api',
      modelEndpoint: '/v1/models',
      catalogEndpoint: '/v1/models',
      supportsCustomModels: true,
      modelCaching: 'unknown',
      requiresRestart: false,
      streaming: true,
      toolCalling: true,
      vision: true,
      context: true,
      notes: 'Reads /v1/models dynamically',
      projectionNeeded: 'openai-native',
    },
    {
      agentId: 'kimi-code',
      agentName: 'Kimi Code',
      protocol: 'openai-compatible',
      modelDiscovery: 'dynamic-api',
      modelEndpoint: '/v1/models',
      catalogEndpoint: '/v1/models',
      supportsCustomModels: true,
      modelCaching: 'unknown',
      requiresRestart: false,
      streaming: true,
      toolCalling: true,
      vision: false,
      context: true,
      notes: 'Reads /v1/models',
      projectionNeeded: 'openai-native',
    },
    {
      agentId: 'qwen-code',
      agentName: 'Qwen Code',
      protocol: 'openai-compatible',
      modelDiscovery: 'dynamic-api',
      modelEndpoint: '/v1/models',
      catalogEndpoint: '/v1/models',
      supportsCustomModels: true,
      modelCaching: 'unknown',
      requiresRestart: false,
      streaming: true,
      toolCalling: true,
      vision: false,
      context: true,
      notes: 'Reads /v1/models',
      projectionNeeded: 'openai-native',
    },
    {
      agentId: 'gemini-cli',
      agentName: 'Gemini CLI',
      protocol: 'openai-compatible',
      modelDiscovery: 'dynamic-api',
      modelEndpoint: '/v1/models',
      catalogEndpoint: '/v1/models',
      supportsCustomModels: true,
      modelCaching: 'unknown',
      requiresRestart: false,
      streaming: true,
      toolCalling: true,
      vision: true,
      context: true,
      notes: 'via --base-url, reads /v1/models',
      projectionNeeded: 'openai-native',
    },
    {
      agentId: 'aider',
      agentName: 'Aider',
      protocol: 'openai-compatible',
      modelDiscovery: 'dynamic-api',
      modelEndpoint: '/v1/models',
      catalogEndpoint: '/v1/models',
      supportsCustomModels: true,
      modelCaching: 'unknown',
      requiresRestart: false,
      streaming: true,
      toolCalling: true,
      vision: true,
      context: true,
      notes: 'Reads /v1/models or static config',
      projectionNeeded: 'openai-native',
    },
    {
      agentId: 'cline',
      agentName: 'Cline',
      protocol: 'openai-compatible',
      modelDiscovery: 'dynamic-api',
      modelEndpoint: '/v1/models',
      catalogEndpoint: '/v1/models',
      supportsCustomModels: true,
      modelCaching: 'unknown',
      requiresRestart: false,
      streaming: true,
      toolCalling: true,
      vision: true,
      context: true,
      notes: 'Reads /v1/models',
      projectionNeeded: 'openai-native',
    },
    {
      agentId: 'roo-code',
      agentName: 'Roo Code',
      protocol: 'openai-compatible',
      modelDiscovery: 'dynamic-api',
      modelEndpoint: '/v1/models',
      catalogEndpoint: '/v1/models',
      supportsCustomModels: true,
      modelCaching: 'unknown',
      requiresRestart: false,
      streaming: true,
      toolCalling: true,
      vision: true,
      context: true,
      notes: 'Reads /v1/models',
      projectionNeeded: 'openai-native',
    }
  ];
}

// 1e. Filter Transparency

export interface FilterResult {
  model: ModelDescriptor;
  status: 'PROJECTED' | 'FILTERED';
  reason?: string;
  projectedAs?: string;
  agent?: string;
}

export function explainFilters(
  models: readonly ModelDescriptor[],
  agent: 'claude' | 'openai' | 'generic'
): FilterResult[] {
  const results: FilterResult[] = [];
  
  if (agent === 'claude') {
    for (const m of models) {
      if (m.stale) {
        results.push({ model: m, status: 'FILTERED', reason: 'Model is stale', agent });
        continue;
      }
      if (m.id === 'auto' || m.id.startsWith('auto-')) {
        results.push({ model: m, status: 'FILTERED', reason: 'Routing alias', agent });
        continue;
      }
      
      const isClaude = m.id.startsWith('claude-') || m.id.startsWith('anthropic/');
      const alias = isClaude ? m.id : `claude-gw-${sanitizeFragment(m.providerId)}-${sanitizeFragment(m.id)}`;
      results.push({ model: m, status: 'PROJECTED', projectedAs: alias, agent });
    }
  } else if (agent === 'openai') {
    for (const m of models) {
      if (m.stale) {
        results.push({ model: m, status: 'FILTERED', reason: 'Model is stale', agent });
        continue;
      }
      results.push({ model: m, status: 'PROJECTED', projectedAs: m.id, agent });
    }
  } else {
    for (const m of models) {
      results.push({ model: m, status: 'PROJECTED', projectedAs: toVirtualModelId(m.providerId, m.id), agent });
    }
  }
  
  return results;
}
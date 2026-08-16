import { ModelDescriptor, ProviderEndpoint, KeyDescriptor } from '@anx/core';

export type RequestIntent =
  | 'CODING'
  | 'REASONING'
  | 'GENERAL'
  | 'FAST'
  | 'LONG_CONTEXT'
  | 'VISION'
  | 'TOOL_USE'
  | 'CHEAP'
  | 'FREE';

export interface IntentClassification {
  intent: RequestIntent;
  confidence: number;
  signals: string[];
  requiredCapabilities: string[];
  minContextWindow?: number;
}

export interface CandidateScore {
  modelId: string;
  providerId: string;
  endpointId?: string;
  keyId?: string;
  finalScore: number;
  breakdown: {
    availability: number;
    health: number;
    capabilityMatch: number;
    taskMatch: number;
    contextFit: number;
    latency: number;
    cost: number;
    freePriority: number;
    providerReliability: number;
    keyHealth: number;
  };
  reasons: string[];
  explainability?: {
    whySelected?: string;
    whyRejected?: string;
    whyDeprioritized?: string;
    whyRecovered?: string;
  };
}

export interface ScoringContext {
  modelRegistryModels: readonly ModelDescriptor[];
  endpoints: readonly ProviderEndpoint[];
  keys?: readonly KeyDescriptor[];
  keyLatencies?: Map<string, number>;
  endpointLatencies?: Map<string, number>;
  endpointFailures?: Map<string, number>;
  modelRateLimitCooldowns?: Map<string, number>; // modelId -> timestamp until cooled down
  deprioritizedProviders?: Set<string>; // Phase 34: runtime intelligence deprioritization
}

export class IntentDetector {
  static detect(messages: any[], tools?: any[], modelRequested?: string): IntentClassification {
    const signals: string[] = [];
    const requiredCaps: string[] = [];
    let intent: RequestIntent = 'GENERAL';
    let confidence = 0.8;

    // 1. Explicit tool definitions strictly set TOOL_USE intent & toolCalling capability
    if (tools && Array.isArray(tools) && tools.length > 0) {
      signals.push('tool_definitions_present');
      requiredCaps.push('toolCalling');
      intent = 'TOOL_USE';
    }

    // Inspect message content
    let totalChars = 0;
    let hasCode = false;
    let hasImage = false;
    let hasMathOrReasoning = false;

    for (const msg of messages) {
      if (!msg) continue;
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
        if (msg.content.includes('```') || msg.content.match(/\b(function|const|let|var|class|import|def|return|public|private)\b/)) {
          hasCode = true;
        }
        if (msg.content.match(/\b(solve|proof|step-by-step|derive|math|equation|calculate|reason)\b/i)) {
          hasMathOrReasoning = true;
        }
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image_url' || part.type === 'image') {
            hasImage = true;
            signals.push('image_input_detected');
            requiredCaps.push('vision');
          }
          if (part.type === 'text' && typeof part.text === 'string') {
            totalChars += part.text.length;
            if (part.text.includes('```') || part.text.match(/\b(function|const|let|var|class|import|def|return)\b/)) {
              hasCode = true;
            }
          }
        }
      }
    }

    if (hasImage) {
      intent = 'VISION';
      confidence = 0.99;
    } else if (intent !== 'TOOL_USE' && hasCode) {
      intent = 'CODING';
      signals.push('code_syntax_detected');
      confidence = 0.95;
      // Note: CODING intent does NOT automatically mandate toolCalling unless tools are present
    } else if (intent !== 'TOOL_USE' && hasMathOrReasoning) {
      intent = 'REASONING';
      signals.push('reasoning_keywords_detected');
      confidence = 0.9;
    }

    const estimatedTokens = Math.ceil(totalChars / 4);
    if (estimatedTokens > 24000) {
      signals.push(`large_prompt_${estimatedTokens}_tokens`);
      intent = 'LONG_CONTEXT';
    }

    if (modelRequested) {
      if (modelRequested.includes('free')) {
        signals.push('requested_free');
        if (intent === 'GENERAL') intent = 'FREE';
      }
      if (modelRequested.includes('fast')) {
        signals.push('requested_fast');
        if (intent === 'GENERAL') intent = 'FAST';
      }
    }

    return {
      intent,
      confidence,
      signals,
      requiredCapabilities: requiredCaps,
      minContextWindow: estimatedTokens + 4096,
    };
  }
}

export class ScoringEngine {
  static scoreCandidate(
    model: ModelDescriptor,
    endpoint: ProviderEndpoint | undefined,
    intent: IntentClassification,
    ctx: ScoringContext
  ): CandidateScore {
    const reasons: string[] = [];
    const now = Date.now();

    // 1. Availability & Rate Limit Cooldown Check
    let availability = model.stale ? 0.0 : 1.0;
    if (model.stale) {
      reasons.push('Model marked stale');
    }

    // Model-level rate limit cooldown
    const cooldownUntil = ctx.modelRateLimitCooldowns?.get(model.id);
    if (cooldownUntil && now < cooldownUntil) {
      availability = 0.0;
      reasons.push(`Model in rate-limit cooldown for ${Math.round((cooldownUntil - now) / 1000)}s`);
    }

    // 2. Health
    let health = 1.0;
    if (endpoint) {
      if (endpoint.health === 'circuit_open') health = 0.0;
      else if (endpoint.health === 'degraded') health = 0.5;
    }

    // 3. Capability Match (HARD CONSTRAINT)
    let capabilityMatch = 1.0;
    for (const reqCap of intent.requiredCapabilities) {
      if (!model.capabilities?.[reqCap as keyof typeof model.capabilities]) {
        capabilityMatch = 0.0;
        reasons.push(`Missing required capability: ${reqCap}`);
      }
    }

    // 4. Task Match
    let taskMatch = 0.8;
    if (intent.intent === 'CODING') {
      taskMatch = model.capabilities?.toolCalling ? 1.0 : 0.9;
    } else if (intent.intent === 'REASONING' && model.capabilities?.reasoning) {
      taskMatch = 1.0;
    } else if (intent.intent === 'VISION' && model.capabilities?.vision) {
      taskMatch = 1.0;
    }

    // 5. Context Fit (HARD CONSTRAINT)
    let contextFit = 1.0;
    const reqCtx = intent.minContextWindow ?? 4096;
    const modelCtx = model.contextWindow ?? 32768;
    if (modelCtx < reqCtx) {
      contextFit = 0.0;
      reasons.push(`Context window ${modelCtx} insufficient for estimated requirement ${reqCtx}`);
    }

    // 6. Latency Score
    const ewmaLatency = endpoint ? (ctx.endpointLatencies?.get(endpoint.id) ?? 500) : 500;
    const latency = Math.max(0.1, Math.min(1.0, 1.0 - (ewmaLatency / 3000)));

    // 7. Cost Score
    // Pricing classification check
    const isFree = model.pricing?.isFree === true || model.pricing?.freeTier === 'FREE' || model.id.endsWith('-free');
    const isUnknown = model.pricing?.freeTier === 'UNKNOWN' || !model.pricing?.source || model.pricing.source === 'unknown';
    
    let cost = 0.5;
    if (isFree) {
      cost = 1.0;
    } else if (isUnknown) {
      cost = 0.4; // UNKNOWN pricing rated conservatively below explicitly free
    } else {
      const inputCost = model.pricing?.inputPer1M ?? 0;
      cost = Math.max(0.1, Math.min(1.0, 1.0 - (inputCost / 20)));
    }

    // 9. Provider Reliability & Runtime Intelligence Deprioritization
    let failures = endpoint ? (ctx.endpointFailures?.get(endpoint.id) ?? 0) : 0;
    const isDeprioritized = ctx.deprioritizedProviders?.has(model.providerId) || (endpoint && ctx.deprioritizedProviders?.has(endpoint.id));
    if (isDeprioritized) {
      failures += 5;
      reasons.push(`Provider [${model.providerId}] deprioritized by Runtime Intelligence self-healing`);
    }
    const providerReliability = Math.max(0.05, 1.0 - failures * 0.2);

    // 10. Free Priority & Key Health
    const freePriority = isFree ? 1.0 : (isUnknown ? 0.4 : 0.2);
    const keyHealth = 1.0;

    // Weighted final normalized score
    let finalScore = (
      availability * 0.15 +
      health * 0.20 +
      capabilityMatch * 0.20 +
      contextFit * 0.15 +
      taskMatch * 0.10 +
      cost * 0.10 +
      latency * 0.10
    );

    // Apply provider reliability multiplier
    finalScore = finalScore * providerReliability;

    // Hard disqualifiers
    if (capabilityMatch === 0 || contextFit === 0 || health === 0 || availability === 0) {
      finalScore = 0.0;
    }

    const whySelected = finalScore > 0.6 ? `High overall score (${Math.round(finalScore * 100)}%), capable, and healthy` : undefined;
    const whyRejected = finalScore === 0.0 ? reasons.join('; ') : undefined;
    const whyDeprioritized = isDeprioritized ? `Provider [${model.providerId}] temporarily degraded/rate-limited` : undefined;
    const whyRecovered = (!isDeprioritized && endpoint?.health === 'healthy' && failures === 0) ? `Verified healthy with active key rotation` : undefined;

    return {
      modelId: model.id,
      providerId: model.providerId,
      endpointId: endpoint?.id,
      finalScore: Math.round(finalScore * 100) / 100,
      breakdown: {
        availability,
        health,
        capabilityMatch,
        taskMatch,
        contextFit,
        latency: Math.round(latency * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        freePriority,
        providerReliability,
        keyHealth,
      },
      reasons,
      explainability: {
        whySelected,
        whyRejected,
        whyDeprioritized,
        whyRecovered,
      },
    };
  }
}

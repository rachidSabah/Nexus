/**
 * ───────────────────────────────────────────────────────────────────────────
 * ModelAliasRegistry — smart model aliasing + virtual model routes.
 *
 * Master prompt #19 (smart model aliasing) + #20 (virtual model routes):
 *
 * Users configure their coding agent to use a stable model name like
 * `local/free` or `local/coding`. The gateway resolves these aliases at
 * request time to the best currently-available concrete model, based on:
 *   - The ModelRegistry's discovered models (dynamic, refreshed hourly)
 *   - Health state from the routing engine
 *   - The alias's filter criteria (free / capability / context window)
 *   - The alias's ranking strategy (cheapest / fastest / highest quality)
 *
 * This means:
 *   - When a provider publishes a new free model, `local/free` automatically
 *     starts using it on the next refresh — no config change needed.
 *   - When a model goes down, `local/coding` automatically fails over to
 *     the next-best candidate.
 *   - When a better model appears, `local/best` upgrades to it.
 *
 * Built-in aliases:
 *   local/free       — cheapest free model with required capabilities
 *   local/coding     — best model with toolCalling capability, prefers free
 *   local/reasoning  — best model with reasoning capability
 *   local/vision      — best model with vision capability
 *   local/long-context — model with largest context window
 *   local/best       — highest-quality model (by priority + capability count)
 *   local/auto        — alias for local/best (convenience)
 *   local/cheap       — lowest-cost model (free preferred, then cheapest paid)
 *   local/fast        — model with lowest latency (from KeyRegistry stats)
 *
 * Users can register custom aliases via the API:
 *   POST /v1/aliases { alias: 'local/my-coding', filter: { capability: 'toolCalling' }, ranking: 'cheapest' }
 *
 * The resolved model id replaces the alias in the ChatCompletionRequest
 * before the routing engine sees it. The routing engine then resolves it
 * to a specific endpoint as usual.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ModelDescriptor, ModelRegistry, ProviderEndpoint, RoutingEnginePort, KeyRegistry } from '@anx/core';
import { isSelectable } from '@anx/core';
import { resolveClaudeGwAlias } from './claude-catalog.js';
import { resolveOpenAIModelId, isVirtualModelId } from './model-fabric.js';

export type AliasRankingStrategy =
  | 'cheapest'     // lowest inputPer1M + outputPer1M (free first)
  | 'cheapest_capable' // WS3: free-first, then lowest combined cost (capability already filtered)
  | 'fastest'      // lowest latency (requires KeyRegistry stats — falls back to cheapest)
  | 'highest_quality' // most capabilities + largest context window
  | 'largest_context' // biggest contextWindow
  | 'most_capabilities'; // highest count of true capability flags

export interface AliasFilter {
  /** Only include models with this capability set to true. */
  capability?: 'streaming' | 'toolCalling' | 'vision' | 'audio' | 'speech' | 'embeddings' | 'reasoning' | 'jsonMode';
  /**
   * WS3: require ALL of these capabilities. Supersedes `capability` when
   * present (a single capability is just the one-element form). Lets an alias
   * express e.g. "cheapest model with toolCalling AND vision AND jsonMode".
   */
  capabilities?: readonly ('streaming' | 'toolCalling' | 'vision' | 'audio' | 'speech' | 'embeddings' | 'reasoning' | 'jsonMode')[];
  /** Only include free-tier models. */
  freeOnly?: boolean;
  /** Minimum context window in tokens. */
  minContextWindow?: number;
  /** Restrict to these provider ids. */
  providers?: readonly string[];
}

/**
 * Family routing (Free Claude Code parity, generalized to all coding agents).
 *
 * Coding agents natively request provider-specific model names:
 *   - Claude Code / Cline / Continue: claude-sonnet-4-5, claude-fable-5, ...
 *   - OpenAI Codex:                   gpt-5-codex, gpt-5-mini, o4-mini, ...
 *   - DeepSeek Code:                  deepseek-chat, deepseek-reasoner, ...
 *   - Gemini CLI / OpenCode / other:  gemini-3.6-flash, grok-4, qwen-3, ...
 * The gateway rewrites any family-matched model name to the family's
 * configured target model (env: GATEWAY_MODEL_<FAMILY> / GATEWAY_MODEL_DEFAULT),
 * or -- when unset -- to the best currently-available free tool-calling model
 * (dynamic, like the local/* aliases). Concrete free models (`*-free`) and
 * registered aliases are never treated as family requests.
 */
export type FamilyId =
  | 'claude' | 'openai' | 'deepseek' | 'gemini' | 'grok'
  | 'meta' | 'qwen' | 'mistral' | 'minimax' | 'zhipu' | 'moonshot' | 'default';

export const FAMILY_PATTERNS: ReadonlyArray<readonly [RegExp, FamilyId]> = [
  [/^claude(?:[-._]|$)/i, 'claude'],
  [/^(gpt-[0-9]|gpt-4[.o-]|gpt-4$)/i, 'openai'],
  [/^o[1-4](?:[-._]|$)/i, 'openai'],
  [/^codex/i, 'openai'],
  [/^deepseek/i, 'deepseek'],
  [/^gemini/i, 'gemini'],
  [/^grok/i, 'grok'],
  [/^llama/i, 'meta'],
  [/^qwen/i, 'qwen'],
  [/^(?:ministral|mistral)/i, 'mistral'],
  [/^minimax/i, 'minimax'],
  [/^glm-/i, 'zhipu'],
  [/^kimi/i, 'moonshot'],
  [/^(?:gateway|gateway-routed|default|auto|agent|nexus|custom)/i, 'default'],
];

export interface FamilyDefaults {
  /** Fallback target for any unhandled family model (env GATEWAY_MODEL_DEFAULT). */
  readonly default?: string;
  readonly claude?: string;
  readonly openai?: string;
  readonly deepseek?: string;
  readonly gemini?: string;
  readonly grok?: string;
  readonly meta?: string;
  readonly qwen?: string;
  readonly mistral?: string;
  readonly minimax?: string;
  readonly zhipu?: string;
  readonly moonshot?: string;
  /** Claude sub-family overrides (FCC parity: model_fable / model_opus / ...). */
  readonly fable?: string;
  readonly opus?: string;
  readonly sonnet?: string;
  readonly haiku?: string;
}

/** Matches a requested model name to a model family, if any. */
export function matchFamily(model: string): FamilyId | undefined {
  const low = model.toLowerCase();
  // Concrete free-tier ids (deepseek-v4-flash-free, ...) are real models,
  // not family requests -- never rewrite them.
  if (low.endsWith('-free')) return undefined;
  for (const [re, family] of FAMILY_PATTERNS) {
    if (re.test(low)) return family;
  }
  if (low === 'claude' || low.startsWith('claude-')) return 'claude';
  return undefined;
}

export interface ModelAlias {
  /** The alias name users put in their model field (e.g. 'local/free'). */
  readonly alias: string;
  /** Human-readable description. */
  readonly description: string;
  /** Filter criteria for candidate selection. */
  readonly filter: AliasFilter;
  /** How to rank the filtered candidates. */
  readonly ranking: AliasRankingStrategy;
  /** Whether this alias is user-defined (true) or built-in (false). */
  readonly builtin: boolean;
}

/**
 * Resolution result — what the alias resolved to, with reasoning for
 * the request trace / dashboard.
 */
export interface AliasResolution {
  /** The concrete model id (e.g. 'meta-llama/llama-3.1-8b-instruct:free'). */
  readonly modelId: string;
  /** The provider that exposes this model. */
  readonly providerId: string;
  /** Why this model was selected (for the request trace). */
  readonly reason: string;
  /** How many candidates were considered. */
  readonly candidateCount: number;
}

export class ModelAliasRegistry {
  private readonly aliases = new Map<string, ModelAlias>();
  private readonly modelRegistry: ModelRegistry;
  private readonly routing?: RoutingEnginePort;
  private readonly familyDefaults: FamilyDefaults;
  private readonly keyRegistry?: KeyRegistry;

  private readonly modelCooldowns = new Map<string, number>();

  constructor(modelRegistry: ModelRegistry, routing?: RoutingEnginePort, familyDefaults: FamilyDefaults = {}, keyRegistry?: KeyRegistry) {
    this.modelRegistry = modelRegistry;
    this.routing = routing;
    this.familyDefaults = familyDefaults;
    this.keyRegistry = keyRegistry;
    this.registerBuiltins();
  }

  /** Marks a model as temporarily rate-limited for cooldownMs. */
  recordRateLimitCooldown(modelId: string, cooldownMs = 60_000): void {
    this.modelCooldowns.set(modelId, Date.now() + cooldownMs);
  }

  private registerBuiltins(): void {
    const builtins: ModelAlias[] = [
      {
        alias: 'local/free',
        description: 'Cheapest free-tier model with required capabilities',
        filter: { freeOnly: true },
        ranking: 'cheapest',
        builtin: true,
      },
      {
        alias: 'local/coding',
        description: 'Best model with tool calling (free preferred)',
        filter: { capability: 'toolCalling' },
        ranking: 'cheapest', // cheapest = free first, then cheapest paid
        builtin: true,
      },
      {
        alias: 'local/reasoning',
        description: 'Best model with reasoning capability',
        filter: { capability: 'reasoning' },
        ranking: 'highest_quality',
        builtin: true,
      },
      {
        alias: 'local/vision',
        description: 'Best model with vision capability',
        filter: { capability: 'vision' },
        ranking: 'highest_quality',
        builtin: true,
      },
      {
        alias: 'local/long-context',
        description: 'Model with the largest context window',
        filter: {},
        ranking: 'largest_context',
        builtin: true,
      },
      {
        alias: 'local/best',
        description: 'Highest-quality model (most capabilities + largest context)',
        filter: {},
        ranking: 'most_capabilities',
        builtin: true,
      },
      {
        alias: 'local/auto',
        description: 'Alias for local/best',
        filter: {},
        ranking: 'most_capabilities',
        builtin: true,
      },
      {
        alias: 'local/cheap',
        description: 'Lowest-cost model (free preferred, then cheapest paid)',
        filter: {},
        ranking: 'cheapest',
        builtin: true,
      },
      {
        alias: 'local/fast',
        description: 'Model with lowest latency (falls back to cheapest)',
        filter: {},
        ranking: 'fastest',
        builtin: true,
      },
      // ── nexus/* namespace (Model Fabric §26) ────────────────────────────
      // Same dynamic engines as local/*, under the nexus/ prefix the fabric
      // spec mandates. Resolved identically at request time.
      {
        alias: 'nexus/auto',
        description: 'Alias for nexus/best (highest-quality model)',
        filter: {},
        ranking: 'most_capabilities',
        builtin: true,
      },
      {
        alias: 'nexus/best',
        description: 'Highest-quality model (most capabilities + largest context)',
        filter: {},
        ranking: 'most_capabilities',
        builtin: true,
      },
      {
        alias: 'nexus/free',
        description: 'Cheapest free-tier model with required capabilities',
        filter: { freeOnly: true },
        ranking: 'cheapest',
        builtin: true,
      },
      {
        alias: 'nexus/cheap',
        description: 'Lowest-cost model (free preferred, then cheapest paid)',
        filter: {},
        ranking: 'cheapest',
        builtin: true,
      },
      {
        alias: 'nexus/free-coding',
        description: 'Best healthy FREE tool-calling coding model',
        filter: { freeOnly: true, capability: 'toolCalling' },
        ranking: 'highest_quality',
        builtin: true,
      },
      {
        alias: 'nexus/best-coding',
        description: 'Best healthy coding model (tool calling)',
        filter: { capability: 'toolCalling' },
        ranking: 'highest_quality',
        builtin: true,
      },
      {
        alias: 'nexus/fast',
        description: 'Model with lowest latency (falls back to cheapest)',
        filter: {},
        ranking: 'fastest',
        builtin: true,
      },
      {
        alias: 'nexus/reasoning',
        description: 'Best model with reasoning capability',
        filter: { capability: 'reasoning' },
        ranking: 'highest_quality',
        builtin: true,
      },
      {
        alias: 'nexus/free-reasoning',
        description: 'Best healthy FREE model with reasoning capability',
        filter: { freeOnly: true, capability: 'reasoning' },
        ranking: 'highest_quality',
        builtin: true,
      },
      {
        alias: 'nexus/vision',
        description: 'Best model with vision capability',
        filter: { capability: 'vision' },
        ranking: 'highest_quality',
        builtin: true,
      },
      {
        alias: 'nexus/free-vision',
        description: 'Best healthy FREE model with vision capability',
        filter: { freeOnly: true, capability: 'vision' },
        ranking: 'highest_quality',
        builtin: true,
      },
      {
        alias: 'nexus/free-fast',
        description: 'Lowest latency FREE-tier model',
        filter: { freeOnly: true },
        ranking: 'fastest',
        builtin: true,
      },
      {
        alias: 'nexus/long-context',
        description: 'Model with the largest context window',
        filter: {},
        ranking: 'largest_context',
        builtin: true,
      },
      {
        alias: 'nexus/free-long-context',
        description: 'FREE-tier model with the largest context window',
        filter: { freeOnly: true },
        ranking: 'largest_context',
        builtin: true,
      },
      {
        alias: 'nexus/cheapest-capable',
        description: 'WS3: cheapest model (free-first) that satisfies ALL required capabilities (toolCalling + vision + jsonMode)',
        filter: { capabilities: ['toolCalling', 'vision', 'jsonMode'] },
        ranking: 'cheapest_capable',
        builtin: true,
      },
    ];
    for (const a of builtins) {
      this.aliases.set(a.alias, a);
    }
  }

  /** Registers a custom alias. Throws if the alias name is already taken. */
  register(alias: ModelAlias): void {
    if (this.aliases.has(alias.alias) && this.aliases.get(alias.alias)!.builtin) {
      throw new Error(`Cannot override built-in alias '${alias.alias}'`);
    }
    this.aliases.set(alias.alias, alias);
  }

  /** Removes a custom alias. Returns true if it existed. */
  unregister(aliasName: string): boolean {
    const existing = this.aliases.get(aliasName);
    if (!existing) return false;
    if (existing.builtin) return false;
    return this.aliases.delete(aliasName);
  }

  /** Returns all registered aliases (built-in + custom). */
  list(): readonly ModelAlias[] {
    return Array.from(this.aliases.values());
  }

  /** Returns true if the given model name is a registered alias. */
  isAlias(model: string): boolean {
    if (this.aliases.has(model)) return true;
    return matchFamily(model) !== undefined;
  }

  /**
   * Returns true when `model` names a registered FREE-ONLY alias that
   * currently resolves to nothing — i.e. free-tier exhaustion
   * (no free model is available/healthy right now). Callers should surface
   * a 503 NO_ELIGIBLE_PROVIDER instead of letting the request fall through
   * as an unresolvable literal model.
   */
  isExhaustedFreeOnlyAlias(model: string): boolean {
    const alias = this.aliases.get(model);
    if (!alias) return false;
    if (alias.filter.freeOnly !== true) return false;
    return this.resolve(model) === undefined;
  }

  /**
   * Resolves an alias to a concrete model id. Returns undefined if no
   * candidate matches the filter criteria.
   *
   * The resolution process:
   *   1. Get all non-stale models from the ModelRegistry
   *   2. Apply the alias's filter (capability, freeOnly, minContextWindow, providers)
   *   3. Rank the candidates per the alias's ranking strategy
   *   4. Return the top candidate
   */
  resolve(aliasName: string): AliasResolution | undefined {
    const alias = this.aliases.get(aliasName);
    if (!alias) return undefined;

    const now = Date.now();
    const registeredEndpoints: readonly ProviderEndpoint[] = this.routing ? this.routing.listEndpoints() : [];
    let candidates = this.modelRegistry.list().filter((m) => {
      if (m.stale) return false;
      // Embedding-only models cannot perform chat completions / responses
      if (m.capabilities?.embeddings && !m.capabilities?.streaming && !m.capabilities?.toolCalling && !m.capabilities?.reasoning && !m.capabilities?.vision) {
        return false;
      }
      const cooldownUntil = this.modelCooldowns.get(m.id);
      if (cooldownUntil && now < cooldownUntil) return false;
      const ep = registeredEndpoints.find((e: ProviderEndpoint) => e.providerId === m.providerId || e.id === `auto-${m.providerId}`);
      if (ep && (ep.health === 'unhealthy' || ep.health === 'circuit_open')) return false;
      if (this.keyRegistry && this.keyRegistry.listByProvider(m.providerId).length > 0 && !this.keyRegistry.select(m.providerId)) return false;
      return true;
    });

    // If we have candidates from fully healthy endpoints, prefer them over degraded ones.
    const healthyCandidates = candidates.filter((m) => {
      const ep = registeredEndpoints.find((e: ProviderEndpoint) => e.providerId === m.providerId || e.id === `auto-${m.providerId}`);
      return ep && ep.health === 'healthy';
    });
    if (healthyCandidates.length > 0) {
      candidates = healthyCandidates;
    }

    // Fallback: if no models have been discovered yet (e.g. cold start,
    // Ollama not running, discovery still in flight), derive candidates
    // from the registered routing endpoints. This keeps aliases resolvable
    // as soon as an endpoint -- or an API key that auto-registered an
    // endpoint -- exists, even before provider /models discovery succeeds.
    if (candidates.length === 0 && this.routing) {
      candidates = this.endpointCandidates();
    }

    // Apply filters.
    if (alias.filter.freeOnly) {
      candidates = candidates.filter((m) => m.pricing?.isFree === true || m.pricing?.freeTier === 'FREE' || m.id.endsWith('-free'));
    }
    if (alias.filter.capability) {
      candidates = candidates.filter((m) => m.capabilities?.[alias.filter.capability!] === true);
    }
    // WS3: require ALL listed capabilities (multi-cap matching). When both
    // `capability` and `capabilities` are present, `capabilities` wins.
    const requiredCaps = alias.filter.capabilities?.length
      ? alias.filter.capabilities
      : alias.filter.capability
        ? [alias.filter.capability]
        : undefined;
    if (requiredCaps && requiredCaps.length > 0) {
      candidates = candidates.filter((m) =>
        requiredCaps.every((c) => m.capabilities?.[c] === true),
      );
    }
    if (alias.filter.minContextWindow) {
      candidates = candidates.filter((m) => (m.contextWindow ?? 0) >= alias.filter.minContextWindow!);
    }
    if (alias.filter.providers && alias.filter.providers.length > 0) {
      candidates = candidates.filter((m) => alias.filter.providers!.includes(m.providerId));
    }

    if (candidates.length === 0) return undefined;

    // Rank candidates.
    const ranked = this.rank(candidates, alias.ranking);
    const winner = ranked[0];
    if (!winner) return undefined;

    return {
      modelId: winner.id,
      providerId: winner.providerId,
      reason: `Selected from ${candidates.length} candidates via '${alias.ranking}' ranking` +
        (alias.filter.capability ? ` (filtered by capability=${alias.filter.capability})` : '') +
        (alias.filter.freeOnly ? ' (free-tier only)' : ''),
      candidateCount: candidates.length,
    };
  }

  /**
   * Resolves an alias if `model` is an alias; otherwise returns the model
   * unchanged. This is the convenience method the ChatCompletionUseCase
   * calls before routing.
   */
  resolveIfAlias(model: string): { model: string; resolution?: AliasResolution } {
    if (model.startsWith('claude-gw-')) {
      const projected = resolveClaudeGwAlias(model, this.modelRegistry.list());
      if (projected) {
        return {
          model: projected.modelId,
          resolution: {
            modelId: projected.modelId,
            providerId: projected.providerId,
            reason: `Claude Code gateway projection '${model}' -> '${projected.modelId}'`,
            candidateCount: 1,
          },
        };
      }
      const fallback = this.resolve('nexus/best-coding') ?? this.resolve('local/coding') ?? this.resolve('local/free');
      if (fallback) {
        return {
          model: fallback.modelId,
          resolution: {
            modelId: fallback.modelId,
            providerId: fallback.providerId,
            reason: `Claude Code gateway projection '${model}' (stale) -> fallback '${fallback.modelId}'`,
            candidateCount: fallback.candidateCount,
          },
        };
      }
    }
    // Support virtual model identity (nexus/<provider>/<nativeModel>) resolution
    const virtualResolved = resolveOpenAIModelId(model, this.modelRegistry.list());
    if (virtualResolved && isVirtualModelId(model)) {
      return {
        model: virtualResolved.modelId,
        resolution: {
          modelId: virtualResolved.modelId,
          providerId: virtualResolved.providerId,
          reason: `Virtual model identity '${model}' -> '${virtualResolved.modelId}'`,
          candidateCount: 1,
        },
      };
    }
    // Exact (custom-registered) aliases always win — a user can pin an
    // exact override for e.g. `claude-sonnet-4-5` via POST /v1/aliases.
    const registered = this.aliases.get(model);
    if (registered) {
      const resolution = this.resolve(model);
      return resolution
        ? { model: resolution.modelId, resolution }
        : { model };
    }

    // Direct discovered model match — if a provider actually serves this exact model name, route directly!
    const directModel = this.modelRegistry.list().find((m) => !m.stale && (m.id === model || m.id.toLowerCase() === model.toLowerCase()));
    if (directModel) {
      return {
        model: directModel.id,
        resolution: {
          modelId: directModel.id,
          providerId: directModel.providerId,
          reason: `Direct model match '${directModel.id}' on provider '${directModel.providerId}'`,
          candidateCount: 1,
        },
      };
    }

    const family = matchFamily(model);
    if (family) return this.resolveClaudeFamily(model, family);

    const fallback = this.resolve('nexus/best-coding') ?? this.resolve('nexus/best') ?? this.resolve('nexus/auto') ?? this.resolve('local/coding') ?? this.resolve('local/best');
    if (fallback) {
      return {
        model: fallback.modelId,
        resolution: {
          modelId: fallback.modelId,
          providerId: fallback.providerId,
          reason: `Unmatched model name '${model}' -> fallback '${fallback.modelId}' on provider '${fallback.providerId}'`,
          candidateCount: fallback.candidateCount,
        },
      };
    }

    return { model };
  }

  /**
   * FCC-style Claude-family routing: rewrite `claude-*` model names to the
   * family's configured target model, or to the best available tool-calling
   * model when no explicit target is set.
   */
  private resolveClaudeFamily(model: string, family: FamilyId): { model: string; resolution?: AliasResolution } {
    // Claude sub-family overrides (GATEWAY_MODEL_SONNET etc.) take precedence
    // over the family-wide target, which itself beats the default fallback.
    const sub = family === 'claude'
      ? (/(?:fable|opus|sonnet|haiku)/i.exec(model.toLowerCase())?.[0])
      : undefined;
    const target = this.familyDefaults[(sub ?? family) as keyof FamilyDefaults] ?? this.familyDefaults[family] ?? this.familyDefaults.default;
    if (target) {
      const explicit = this.findExplicitModel(target);
      if (explicit) {
        return {
          model: explicit.modelId,
          resolution: {
            modelId: explicit.modelId,
            providerId: explicit.providerId,
            reason: `Claude family '${family}' -> configured target '${target}'`,
            candidateCount: 1,
          },
        };
      }
    }
    // If an alias like nexus/best-coding, nexus/best, or local/coding resolves to a healthy model, use it
    const bestCoding = this.resolve('nexus/best-coding') ?? this.resolve('nexus/best') ?? this.resolve('nexus/auto') ?? this.resolve('local/coding') ?? this.resolve('local/best');
    if (bestCoding) {
      return {
        model: bestCoding.modelId,
        resolution: {
          modelId: bestCoding.modelId,
          providerId: bestCoding.providerId,
          reason: `Model family '${family}' (${model}) -> ${bestCoding.reason}`,
          candidateCount: bestCoding.candidateCount,
        },
      };
    }

    const freeCandidates = this.candidatesFor({ capability: 'toolCalling', freeOnly: true })
      .filter((m) => m.id.toLowerCase() !== model.toLowerCase());
    const candidates = (freeCandidates.length > 0 ? freeCandidates : this.candidatesFor({ capability: 'toolCalling' }))
      .filter((m) => m.id.toLowerCase() !== model.toLowerCase());
    const finalCandidates = candidates.length > 0 ? candidates : this.candidatesFor({}).filter((m) => m.id.toLowerCase() !== model.toLowerCase());
    if (finalCandidates.length > 0) {
      const winners = this.rank(finalCandidates, 'highest_quality');
      const winner = winners[0]!;
      return {
        model: winner.id,
        resolution: {
          modelId: winner.id,
          providerId: winner.providerId,
          reason: `Model family '${family}' (${model}) -> dynamic best model '${winner.id}' on provider '${winner.providerId}'`,
          candidateCount: finalCandidates.length,
        },
      };
    }
    // Nothing to rewrite to — let the routing engine fail honestly.
    return { model };
  }

  /** Finds a model whose id matches a configured target (provider/model or bare model). */
  private findExplicitModel(target: string): { modelId: string; providerId: string } | undefined {
    const norm = (id: string): string => id.toLowerCase().split('/').pop() ?? id.toLowerCase();
    const t = target.toLowerCase();
    const tNorm = norm(t);
    const models = this.modelRegistry.list().filter((m) => !m.stale);
    // Exact / provider-prefixed / bare-name matches against discovered models.
    for (const m of models) {
      if (m.id.toLowerCase() === t || m.id.toLowerCase() === `auto-${t}` || norm(m.id) === tNorm) {
        return { modelId: m.id, providerId: m.providerId };
      }
    }
    // Fall back to registered endpoints (cold start before discovery).
    if (this.routing) {
      for (const e of this.routing.listEndpoints()) {
        if (!isSelectable(e)) continue;
        const eid = e.id.toLowerCase();
        if (eid === t || eid === `auto-${t}` || norm(eid) === tNorm || e.providerId.toLowerCase() === t.split('/')[0]) {
          return { modelId: e.id, providerId: e.providerId };
        }
      }
    }
    return undefined;
  }

  private candidatesFor(filter: AliasFilter): ModelDescriptor[] {
    const now = Date.now();
    let candidates = this.modelRegistry.list().filter((m) => {
      if (m.stale) return false;
      // Embedding-only models cannot perform chat completions / responses
      if (m.capabilities?.embeddings && !m.capabilities?.streaming && !m.capabilities?.toolCalling && !m.capabilities?.reasoning && !m.capabilities?.vision) {
        return false;
      }
      const cooldownUntil = this.modelCooldowns.get(m.id);
      if (cooldownUntil && now < cooldownUntil) return false;
      if (this.keyRegistry && this.keyRegistry.listByProvider(m.providerId).length > 0 && !this.keyRegistry.select(m.providerId)) return false;
      return true;
    });

    // Prefer models whose provider endpoints are currently healthy and selectable
    if (this.routing) {
      const endpoints = this.routing.listEndpoints();
      const healthyProviders = new Set(
        endpoints.filter((e) => isSelectable(e)).map((e) => e.providerId),
      );
      if (healthyProviders.size > 0) {
        const healthyCandidates = candidates.filter((m) => healthyProviders.has(m.providerId));
        if (healthyCandidates.length > 0) {
          candidates = healthyCandidates;
        }
      }
    }

    if (candidates.length === 0 && this.routing) candidates = this.endpointCandidates();
    if (filter.capability) {
      candidates = candidates.filter((m) => m.capabilities?.[filter.capability!] === true);
    }
    if (filter.freeOnly) {
      candidates = candidates.filter((m) => m.pricing?.isFree === true);
    }
    return candidates;
  }

  /**
   * Derives candidate ModelDescriptors from the routing engine's registered
   * endpoints. Used as a fallback when model discovery hasn't produced any
   * models yet — so aliases still resolve to a provider's endpoint (and its
   * default capabilities / pricing) even before /models discovery succeeds
   * or when a provider doesn't implement discoverModels.
   */
  private endpointCandidates(): ModelDescriptor[] {
    if (!this.routing) return [];
    return this.routing.listEndpoints().map((e: ProviderEndpoint) => ({
      id: e.tags[0] ?? e.providerId,
      providerId: e.providerId,
      displayName: e.displayName ?? e.providerId,
      contextWindow: e.capabilities?.maxInputTokens,
      maxOutputTokens: e.capabilities?.maxOutputTokens,
      pricing: {
        inputPer1M: (e.pricing?.inputPer1K ?? 0) * 1000,
        outputPer1M: (e.pricing?.outputPer1K ?? 0) * 1000,
        isFree: (e.pricing?.inputPer1K ?? 0) === 0 && (e.pricing?.outputPer1K ?? 0) === 0,
        currency: e.pricing?.currency,
      },
      capabilities: {
        streaming: e.capabilities?.streaming,
        toolCalling: e.capabilities?.toolCalling,
        vision: e.capabilities?.vision,
        audio: e.capabilities?.audio,
        speech: e.capabilities?.speech,
        embeddings: e.capabilities?.embeddings,
        reasoning: e.capabilities?.reasoning,
        jsonMode: e.capabilities?.jsonMode,
      },
      discoveredAt: Date.now(),
      stale: false,
    }));
  }

  /** Ranking strategies. */
  private rank(candidates: readonly ModelDescriptor[], strategy: AliasRankingStrategy): ModelDescriptor[] {
    const sorted = [...candidates];
    switch (strategy) {
      case 'cheapest':
        // Free first, then lowest combined cost.
        return sorted.sort((a, b) => {
          const aFree = a.pricing?.isFree ? 1 : 0;
          const bFree = b.pricing?.isFree ? 1 : 0;
          if (aFree !== bFree) return bFree - aFree; // free first
          const aCost = (a.pricing?.inputPer1M ?? 0) + (a.pricing?.outputPer1M ?? 0);
          const bCost = (b.pricing?.inputPer1M ?? 0) + (b.pricing?.outputPer1M ?? 0);
          return aCost - bCost;
        });
      case 'cheapest_capable':
        // WS3: same cost ordering as `cheapest`, but for aliases that already
        // filtered by required capabilities via `capabilities`/`capability`.
        // Free-first, then lowest combined per-1M cost. Explicitly treats
        // UNKNOWN-priced models as more expensive than known-free so we never
        // route to an unpriced model when a priced (or free) one qualifies.
        return sorted.sort((a, b) => {
          const aFree = a.pricing?.isFree || a.pricing?.freeTier === 'FREE' || a.id.endsWith('-free') ? 1 : 0;
          const bFree = b.pricing?.isFree || b.pricing?.freeTier === 'FREE' || b.id.endsWith('-free') ? 1 : 0;
          if (aFree !== bFree) return bFree - aFree; // free first
          const aUnknown = a.pricing?.freeTier === 'UNKNOWN' || !a.pricing?.source || a.pricing.source === 'unknown' ? 1 : 0;
          const bUnknown = b.pricing?.freeTier === 'UNKNOWN' || !b.pricing?.source || b.pricing.source === 'unknown' ? 1 : 0;
          if (aUnknown !== bUnknown) return aUnknown - bUnknown; // known-priced before unknown
          const aCost = (a.pricing?.inputPer1M ?? 0) + (a.pricing?.outputPer1M ?? 0);
          const bCost = (b.pricing?.inputPer1M ?? 0) + (b.pricing?.outputPer1M ?? 0);
          return aCost - bCost;
        });
      case 'fastest':
        // We don't have per-model latency in ModelDescriptor (latency is per-key
        // in KeyRegistry). Fall back to cheapest as a proxy.
        return sorted.sort((a, b) => {
          const aCost = (a.pricing?.inputPer1M ?? 0) + (a.pricing?.outputPer1M ?? 0);
          const bCost = (b.pricing?.inputPer1M ?? 0) + (b.pricing?.outputPer1M ?? 0);
          return aCost - bCost;
        });
      case 'highest_quality':
        // Most capabilities + largest context window.
        return sorted.sort((a, b) => {
          const aScore = this.capabilityCount(a) + Math.log10((a.contextWindow ?? 1000) / 1000);
          const bScore = this.capabilityCount(b) + Math.log10((b.contextWindow ?? 1000) / 1000);
          return bScore - aScore;
        });
      case 'largest_context':
        return sorted.sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0));
      case 'most_capabilities':
        return sorted.sort((a, b) => this.capabilityCount(b) - this.capabilityCount(a));
      default:
        return sorted;
    }
  }

  private capabilityCount(m: ModelDescriptor): number {
    if (!m.capabilities) return 0;
    // Embeddings capability is not a text generation capability
    const { embeddings: _emb, ...textCaps } = m.capabilities;
    return Object.values(textCaps).filter(Boolean).length;
  }
}

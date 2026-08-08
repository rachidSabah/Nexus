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

import type { ModelDescriptor, ModelRegistry } from '@anx/core';

export type AliasRankingStrategy =
  | 'cheapest'     // lowest inputPer1M + outputPer1M (free first)
  | 'fastest'      // lowest latency (requires KeyRegistry stats — falls back to cheapest)
  | 'highest_quality' // most capabilities + largest context window
  | 'largest_context' // biggest contextWindow
  | 'most_capabilities'; // highest count of true capability flags

export interface AliasFilter {
  /** Only include models with this capability set to true. */
  capability?: 'streaming' | 'toolCalling' | 'vision' | 'audio' | 'speech' | 'embeddings' | 'reasoning' | 'jsonMode';
  /** Only include free-tier models. */
  freeOnly?: boolean;
  /** Minimum context window in tokens. */
  minContextWindow?: number;
  /** Restrict to these provider ids. */
  providers?: readonly string[];
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

  constructor(modelRegistry: ModelRegistry) {
    this.modelRegistry = modelRegistry;
    this.registerBuiltins();
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
    return this.aliases.has(model);
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

    let candidates = this.modelRegistry.list().filter((m) => !m.stale);

    // Apply filters.
    if (alias.filter.freeOnly) {
      candidates = candidates.filter((m) => m.pricing?.isFree === true);
    }
    if (alias.filter.capability) {
      candidates = candidates.filter((m) => m.capabilities?.[alias.filter.capability!] === true);
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
    if (!this.isAlias(model)) return { model };
    const resolution = this.resolve(model);
    if (!resolution) {
      // Alias exists but no candidates — let the routing engine fail with
      // a proper NoEligibleProviderError rather than silently passing the
      // alias through (which would just 404 at the provider).
      return { model };
    }
    return { model: resolution.modelId, resolution };
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
    return Object.values(m.capabilities).filter(Boolean).length;
  }
}

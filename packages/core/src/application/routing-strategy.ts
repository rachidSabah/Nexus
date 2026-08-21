/**
 * RoutingStrategy — explicit primary-selection policies (OmniRoute-competitive
 * "combo strategies" surface, honest Nexus edition).
 *
 * Nexus already has scope-aware failover (DefaultFailover: which candidate to
 * try next AFTER a failure). This module is the complementary PRIMARY selector:
 * given a scored candidate set, it picks the first model per a named strategy.
 * The two compose naturally — strategy selects, failover recovers.
 *
 * Strategies (deterministic except `random`):
 *   - priority     : highest score wins (stable sort). Default.
 *   - round-robin  : persistent per-key counter, cycles through candidates.
 *   - weighted     : weighted random by `weight` (falls back to score when no weight).
 *   - least-used   : candidate with the fewest recorded usages wins.
 *
 * All numbers are taken from real runtime state (scores, usage counts) — no
 * fabricated metrics.
 */

export type RoutingStrategyName = 'priority' | 'round-robin' | 'weighted' | 'least-used';

export interface StrategyCandidate {
  /** Stable id (e.g. endpoint id or `providerId/modelId`). */
  readonly id: string;
  /** Selection score from the router (higher = better). */
  readonly score: number;
  /** Optional explicit weight for `weighted` strategy. */
  readonly weight?: number;
  /** Optional usage count for `least-used` strategy. */
  readonly usageCount?: number;
  /** Optional provider id (for diagnostics only). */
  readonly providerId?: string;
}

export interface StrategySelectionResult {
  readonly selectedId: string;
  readonly strategy: RoutingStrategyName;
  readonly candidatesConsidered: number;
  readonly reasons: readonly string[];
}

/**
 * Pure primary-selection over a candidate set. `stateKey` groups round-robin
 * counters (e.g. a virtual model id like `nexus/auto`); callers pass the same
 * key across requests to get deterministic rotation.
 */
export class RoutingStrategy {
  private readonly rrCounters = new Map<string, number>();

  select(
    candidates: readonly StrategyCandidate[],
    strategy: RoutingStrategyName = 'priority',
    stateKey = 'default',
  ): StrategySelectionResult {
    const pool = candidates.filter((c) => c.score > 0 || strategy === 'priority');
    if (pool.length === 0) {
      throw new Error('RoutingStrategy: no viable candidates to select from');
    }

    const sorted = [...pool].sort((a, b) => b.score - a.score);

    switch (strategy) {
      case 'priority': {
        const top = sorted[0]!;
        return {
          selectedId: top.id,
          strategy,
          candidatesConsidered: pool.length,
          reasons: [`Highest score ${top.score.toFixed(2)} (priority)`],
        };
      }

      case 'round-robin': {
        const counter = this.rrCounters.get(stateKey) ?? 0;
        const idx = counter % pool.length;
        this.rrCounters.set(stateKey, counter + 1);
        const chosen = pool[idx]!;
        return {
          selectedId: chosen.id,
          strategy,
          candidatesConsidered: pool.length,
          reasons: [`Round-robin index ${idx}/${pool.length}`],
        };
      }

      case 'weighted': {
        const total = pool.reduce(
          (sum, c) => sum + (c.weight ?? c.score > 0 ? c.score : 0.01),
          0,
        );
        let r = Math.random() * total;
        let chosen = pool[pool.length - 1]!;
        for (const c of pool) {
          const w = c.weight ?? (c.score > 0 ? c.score : 0.01);
          r -= w;
          if (r <= 0) {
            chosen = c;
            break;
          }
        }
        return {
          selectedId: chosen.id,
          strategy,
          candidatesConsidered: pool.length,
          reasons: [`Weighted-random pick (weight ${chosen.weight ?? chosen.score.toFixed(2)})`],
        };
      }

      case 'least-used': {
        let min = Infinity;
        let best = pool[0]!;
        for (const c of pool) {
          const u = c.usageCount ?? 0;
          if (u < min) {
            min = u;
            best = c;
          }
        }
        return {
          selectedId: best.id,
          strategy,
          candidatesConsidered: pool.length,
          reasons: [`Least-used (${min} prior uses)`],
        };
      }

      default: {
        const top = sorted[0]!;
        return {
          selectedId: top.id,
          strategy: 'priority',
          candidatesConsidered: pool.length,
          reasons: [`Highest score ${top.score.toFixed(2)} (priority fallback)`],
        };
      }
    }
  }

  /** Reset round-robin counters (e.g. on config change). */
  reset(stateKey?: string): void {
    if (stateKey) this.rrCounters.delete(stateKey);
    else this.rrCounters.clear();
  }
}

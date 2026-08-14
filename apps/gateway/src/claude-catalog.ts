/**
 * ───────────────────────────────────────────────────────────────────────────
 * Claude Code model catalog projection.
 *
 * Root cause of the "only 16 models in /model" symptom:
 *   - The gateway's GET /v1/models is fully dynamic (registry-backed,
 *     no cap, no hardcoded list) and already serves every discovered model.
 *   - Claude Code's /model picker renders a gateway response entry only
 *     when the model id matches its own Anthropic-family conventions
 *     (`claude-*`). Everything else (gemini-*, gpt-*, deepseek-*, ...) is
 *     served by the gateway but silently hidden by the CLI's client-side
 *     filter.
 *
 * Fix (master-prompt §10 — deterministic, reversible model id mapping):
 *   Every discovered model is ALSO exposed under an anthropic-compatible
 *   alias id:
 *
 *     claude-gw-<providerId>-<modelId>
 *
 *   e.g.  claude-gw-opencode-zen-deepseek-v4-flash-free
 *
 *   Claude Code's picker accepts `claude-*` ids, so the full prefetched
 *   catalog becomes visible. When a request arrives with a claude-gw-*
 *   id, the alias is reversed back to the native registry id BEFORE
 *   family rewriting or routing, so the selected model genuinely
 *   controls routing (§17) — it is never silently sent to a default
 *   provider.
 *
 * The projection is 100% derived from the live ModelRegistry snapshot:
 *   - new provider models appear with no source change or restart
 *   - models that disappear (stale) vanish from the projection
 *   - no static lists, no caps, no fake entries (every alias resolves)
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ModelDescriptor } from '@anx/core';

/** Prefix for Claude-Code-visible projection aliases. */
export const CLAUDE_GW_PREFIX = 'claude-gw-';

/**
 * Sanitizes an id fragment for alias embedding: lowercase, runs of
 * non-alphanumerics become a single '-', edges trimmed.
 */
export function sanitizeFragment(id: string): string {
  const s = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'm';
}

/** Returns true if the id is a claude-gw projection alias. */
export function isClaudeGwAlias(id: string): boolean {
  return id.startsWith(CLAUDE_GW_PREFIX) && id.length > CLAUDE_GW_PREFIX.length;
}

/** Deterministic anthropic-compatible alias for a discovered model. */
export function claudeGwAlias(providerId: string, modelId: string): string {
  return `${CLAUDE_GW_PREFIX}${sanitizeFragment(providerId)}-${sanitizeFragment(modelId)}`;
}

export interface ClaudeProjectionEntry {
  id: string;
  object: 'model';
  owned_by: string;
  /** The native registry id this alias projects (undefined for natives). */
  nativeId?: string;
  pricing?: ModelDescriptor['pricing'];
  capabilities?: ModelDescriptor['capabilities'];
  context_window?: number;
}

/**
 * Projects a registry snapshot into the Claude Code catalog.
 *
 * Rules (each entry is either the native id or a claude-gw alias):
 *   - stale models are excluded (availability, §16)
 *   - ids already accepted by Claude Code (`claude-*`, `anthropic/...`)
 *     keep their native id
 *   - every other model is emitted as BOTH its native id (for
 *     OpenAI-compatible clients) and its claude-gw alias (for Claude Code)
 *   - endpoint routing aliases (`auto`, `auto-*`) are never projected
 */
export function projectClaudeCatalog(
  models: readonly ModelDescriptor[],
  options: { includeNatives?: boolean } = {},
): ClaudeProjectionEntry[] {
  const includeNatives = options.includeNatives ?? true;
  const out: ClaudeProjectionEntry[] = [];
  const seenAliases = new Set<string>();

  for (const m of models) {
    if (m.stale) continue;
    const id = m.id;
    if (id === 'auto' || id.startsWith('auto-')) continue;

    const acceptedByClaude = id.startsWith('claude-') || id.startsWith('anthropic/');
    if (acceptedByClaude) {
      out.push({
        id,
        object: 'model',
        owned_by: m.providerId,
        pricing: m.pricing,
        capabilities: m.capabilities,
        context_window: m.contextWindow,
      });
      continue;
    }

    const alias = claudeGwAlias(m.providerId, id);
    if (!seenAliases.has(alias)) {
      seenAliases.add(alias);
      out.push({
        id: alias,
        object: 'model',
        // Owned-by is display metadata only — routing is driven by `nativeId`,
        // never by `owned_by`. Report `anthropic` so Claude Code's /model
        // picker (which filters to `claude-*` ids AND `owned_by: 'anthropic'`)
        // actually surfaces the full prefetched catalog instead of hiding it.
        owned_by: 'anthropic',
        nativeId: id,
        pricing: m.pricing,
        capabilities: m.capabilities,
        context_window: m.contextWindow,
      });
    }
    if (includeNatives) {
      out.push({
        id,
        object: 'model',
        owned_by: m.providerId,
        pricing: m.pricing,
        capabilities: m.capabilities,
        context_window: m.contextWindow,
      });
    }
  }

  return out;
}

/**
 * Reverses a claude-gw alias to its native registry id, or undefined.
 *
 * The reverse map is computed from the CURRENT registry snapshot by
 * recomputing aliases — no stored state, so a model removed from the
 * registry entirely immediately stops resolving (§15 real-time
 * invalidation). A model that is merely flagged `stale` is still present
 * in the registry and STILL resolves here: an explicitly-requested alias
 * (e.g. a user's configured default `claude-gw-opencode-zen-hy3-free`)
 * must route to its native id even when the dashboard culls it, and
 * genuine unavailability is handled downstream by routing/failover rather
 * than by silently breaking the alias. The picker/catalog hides stale
 * models separately, so resolution here does not resurrect them for display.
 * If two models collide on the same alias, the first match wins
 * (deterministic).
 */
export function resolveClaudeGwAlias(
  alias: string,
  registryModels: readonly ModelDescriptor[],
): { modelId: string; providerId: string } | undefined {
  if (!isClaudeGwAlias(alias)) return undefined;
  for (const m of registryModels) {
    if (claudeGwAlias(m.providerId, m.id) === alias) {
      return { modelId: m.id, providerId: m.providerId };
    }
  }
  return undefined;
}

export interface ClaudeCatalogDebug {
  agent: 'claude-code';
  sourceRegistryCount: number;
  compatibleCount: number;
  projectedCount: number;
  filteredCount: number;
  filters: string[];
  generatedAt: string;
}

/**
 * Diagnostic view (§25/§26): shows exactly what Claude Code receives and
 * why anything was excluded. Never silently hides models.
 */
export function claudeCatalogDebug(models: readonly ModelDescriptor[]): ClaudeCatalogDebug {
  const nonStale = models.filter((m) => !m.stale);
  const staleCount = models.length - nonStale.length;
  const routingAliases = nonStale.filter((m) => m.id === 'auto' || m.id.startsWith('auto-')).length;
  const nativeCompatible = nonStale.filter((m) => m.id.startsWith('claude-') || m.id.startsWith('anthropic/')).length;
  const projected = nonStale.filter((m) => !m.id.startsWith('auto') && !m.id.startsWith('claude-') && !m.id.startsWith('anthropic/')).length;

  const filters: string[] = [];
  if (staleCount > 0) filters.push(`${staleCount} model(s) excluded: stale (no longer seen by provider discovery)`);
  if (routingAliases > 0) filters.push(`${routingAliases} routing alias(es) excluded: not real models (auto, auto-*)`);
  if (filters.length === 0) filters.push('no models excluded');

  return {
    agent: 'claude-code',
    sourceRegistryCount: models.length,
    compatibleCount: nativeCompatible + projected,
    projectedCount: projected,
    filteredCount: staleCount + routingAliases,
    filters,
    generatedAt: new Date().toISOString(),
  };
}

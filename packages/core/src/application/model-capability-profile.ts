/**
 * model-capability-profile.ts
 *
 * Dynamic Model Context Intelligence — per-model capability profiles with
 * truthful provenance tracking.
 *
 * Design invariants (additive intelligence layer — no architectural rewrite):
 *  - Identity is (providerId, endpointId, providerModelId). The same model
 *    name behind two providers is ALWAYS two independent profiles; metadata
 *    from one provider can never overwrite another's.
 *  - Every context value carries a source + confidence. A context window
 *    that cannot be determined from real metadata is represented as
 *    UNKNOWN (contextUnknown=true) — never an invented number.
 *  - Vision/multimodal support is NEVER inferred from the model NAME; it is
 *    only recorded when the provider metadata (or a runtime probe) states it.
 *  - Refresh is non-blocking (stale-while-revalidate) with per-provider
 *    single-flight locks so a slow provider can never cause a refresh storm.
 *  - A temporary discovery failure NEVER destroys last-known-good metadata:
 *    profiles decay fresh → stale → expired and keep serving, clearly labeled.
 */

import type { ModelDescriptor } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where a context/capability value came from (discovery priority order). */
export type CapabilitySource =
  | 'live_api'
  | 'provider_metadata'
  | 'sdk_metadata'
  | 'nexus_registry'
  | 'runtime_probe'
  | 'fallback';

/** How much the recorded value can be trusted. */
export type CapabilityConfidence = 'authoritative' | 'high' | 'medium' | 'low';

/** Cache freshness lifecycle (stale-while-revalidate). */
export type CapabilityCacheState = 'fresh' | 'stale' | 'expired' | 'invalid';

/** Token accounting fidelity for a model. */
export type TokenizerFidelity = 'exact' | 'estimated' | 'unknown';

/**
 * Capability flags for a specific (provider, endpoint, model). `undefined`
 * always means "unknown" — never asserted true/false without evidence.
 */
export interface ModelCapabilityFlags {
  supportsText?: boolean;
  supportsVision?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  supportsTools?: boolean;
  supportsFunctionCalling?: boolean;
  supportsParallelToolCalls?: boolean;
  supportsStructuredOutput?: boolean;
  supportsJsonMode?: boolean;
  supportsReasoning?: boolean;
  supportsStreaming?: boolean;
  supportsSystemMessages?: boolean;
  supportsDeveloperMessages?: boolean;
  supportsMultiTurn?: boolean;
  supportsPromptCaching?: boolean;
  supportsWebSearch?: boolean;
  supportsCodeExecution?: boolean;
}

/**
 * Independent capability record for one model behind one provider endpoint.
 */
export interface ModelCapabilityProfile {
  /** `${providerId}::${endpointId ?? 'default'}::${providerModelId}` */
  readonly key: string;
  readonly providerId: string;
  readonly endpointId?: string;
  /** The provider-native model id, preserved exactly as discovered. */
  readonly providerModelId: string;
  /** Canonical id when a provider alias was resolved (else same as providerModelId). */
  readonly canonicalModelId: string;
  /** Declared/discovered context window in tokens. Absent when UNKNOWN. */
  readonly contextWindow?: number;
  /** True when no authoritative or metadata source could provide a context window. */
  readonly contextUnknown: boolean;
  readonly maxOutputTokens?: number;
  readonly capabilities: ModelCapabilityFlags;
  readonly contextSource: CapabilitySource;
  readonly capabilitySource: CapabilitySource;
  readonly confidence: CapabilityConfidence;
  /** Which metadata field the context value came from (traceability). */
  readonly contextSourceDetail?: string;
  readonly tokenizer: TokenizerFidelity;
  /** Context window measured by a safe runtime probe (never larger than the declared one is used). */
  readonly validatedContextWindow?: number;
  readonly state: CapabilityCacheState;
  readonly discoveredAt: number;
  readonly lastVerifiedAt?: number;
  readonly expiresAt: number;
  /** Provider-native metadata preserved verbatim (never silently discarded). */
  readonly rawProviderMetadata?: Record<string, unknown>;
  readonly lastError?: string;
}

/** One catalog diff record (model catalog change detection). */
export interface ProfileChange {
  readonly key: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly kind: 'ADDED' | 'REMOVED' | 'CHANGED';
  /** For CHANGED: which profile fields changed (e.g. ['contextWindow']). */
  readonly changedFields?: readonly string[];
}

/** Input entry for ingestCatalog — descriptor plus optional raw provider metadata. */
export interface CatalogEntryInput {
  readonly model: ModelDescriptor;
  /** Verbatim JSON object returned by the provider for this model, when available. */
  readonly raw?: Record<string, unknown>;
  /** Endpoint that served this entry (defaults to 'default'). */
  readonly endpointId?: string;
  /** True when this entry was operator-pinned (GATEWAY_EXPLICIT_MODELS) rather than discovered. */
  readonly operatorPinned?: boolean;
}

/** Per-request context accounting report (telemetry-safe — never contains secrets). */
export interface ContextFitReport {
  readonly providerId: string;
  readonly modelId: string;
  readonly key: string;
  /** effectiveContext = min(discovered, validated) − safety margin; null when UNKNOWN. */
  readonly effectiveContext: number | null;
  readonly estimatedInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly toolTokens: number;
  /** estimatedInputTokens / effectiveContext — null when context unknown. */
  readonly utilization: number | null;
  /** true = fits, false = over budget, null = cannot verify (context UNKNOWN). */
  readonly fits: boolean | null;
  readonly reason: string;
  readonly contextSource: CapabilitySource;
  readonly confidence: CapabilityConfidence;
}

/** Injected port for live metadata refresh (kept pure for deterministic tests). */
export interface CapabilityMetadataFetcher {
  /**
   * Fetches fresh model metadata for a provider. Returns entries with raw
   * provider payloads. Implementations must never throw for auth failures —
   * return `{ ok: false, errorKind }` instead so the cache can decay safely.
   */
  fetch(providerId: string): Promise<{
    ok: boolean;
    entries?: readonly CatalogEntryInput[];
    errorKind?: 'auth' | 'rate_limited' | 'unreachable' | 'model_not_found' | 'unknown';
    retryAfterMs?: number;
  }>;
}

/** Diffable subset of a profile used for change detection. */
interface ProfileFingerprint {
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities: ModelCapabilityFlags;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTEXT_FIELDS: readonly string[] = [
  'context_window',
  'contextWindow',
  'max_context_length',
  'context_length',
  'max_input_tokens',
  'maxInputTokens',
];

function profileKey(providerId: string, endpointId: string | undefined, modelId: string): string {
  return `${providerId}::${endpointId ?? 'default'}::${modelId}`;
}

function readContextFromRaw(raw: Record<string, unknown>): { value?: number; field?: string } {
  for (const field of CONTEXT_FIELDS) {
    const v = raw[field];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return { value: v, field };
  }
  return {};
}

function pickCapabilityFlagsFromRaw(raw: Record<string, unknown>): ModelCapabilityFlags {
  const caps = (raw['capabilities'] ?? raw['capability']) as Record<string, unknown> | undefined;
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  if (!caps || typeof caps !== 'object') return {};
  return {
    supportsText: bool(caps['text']),
    supportsVision: bool(caps['vision']),
    supportsAudio: bool(caps['audio']),
    supportsVideo: bool(caps['video']),
    supportsTools: bool(caps['tools']) ?? bool(caps['tool_calling']),
    supportsFunctionCalling: bool(caps['function_calling']) ?? bool(caps['tools']),
    supportsParallelToolCalls: bool(caps['parallel_tool_calls']),
    supportsStructuredOutput: bool(caps['structured_output']),
    supportsJsonMode: bool(caps['json_mode']),
    supportsReasoning: bool(caps['reasoning']),
    supportsStreaming: bool(caps['streaming']),
    supportsSystemMessages: bool(caps['system_messages']),
    supportsDeveloperMessages: bool(caps['developer_messages']),
    supportsMultiTurn: bool(caps['multi_turn']),
    supportsPromptCaching: bool(caps['prompt_caching']) ?? bool(caps['context_caching']),
    supportsWebSearch: bool(caps['web_search']),
    supportsCodeExecution: bool(caps['code_execution']),
  };
}

function mergeCapabilityFlags(
  base: ModelCapabilityFlags,
  incoming: ModelCapabilityFlags,
): ModelCapabilityFlags {
  const merged: Record<string, boolean | undefined> = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    // Only overwrite when the incoming value is a definite boolean —
    // unknown (undefined) must never erase a known value.
    if (typeof v === 'boolean') merged[k] = v;
  }
  return merged as ModelCapabilityFlags;
}

function fingerprintOf(p: ModelCapabilityProfile): ProfileFingerprint {
  return {
    contextWindow: p.contextWindow,
    maxOutputTokens: p.maxOutputTokens,
    capabilities: p.capabilities,
  };
}

function fingerprintEquals(a: ProfileFingerprint, b: ProfileFingerprint): boolean {
  if (a.contextWindow !== b.contextWindow) return false;
  if (a.maxOutputTokens !== b.maxOutputTokens) return false;
  const ka = Object.keys(a.capabilities).filter((k) => a.capabilities[k as keyof ModelCapabilityFlags] !== undefined);
  const kb = Object.keys(b.capabilities).filter((k) => b.capabilities[k as keyof ModelCapabilityFlags] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a.capabilities[k as keyof ModelCapabilityFlags] !== b.capabilities[k as keyof ModelCapabilityFlags]) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// ModelCapabilityService
// ---------------------------------------------------------------------------

export interface ModelCapabilityServiceOptions {
  /** How long a profile stays `fresh` after verification. Default: 1h. */
  readonly freshTtlMs?: number;
  /** How long a stale profile keeps serving after freshness expiry. Default: 24h. */
  readonly staleTtlMs?: number;
  /** Fraction of the context window reserved as safety margin. Default: 0.04. */
  readonly safetyMarginRatio?: number;
  /** Injected clock (tests). Default: Date.now. */
  readonly now?: () => number;
  /** Injected live-metadata fetcher for background refresh. */
  readonly fetcher?: CapabilityMetadataFetcher;
  /** Base backoff for refresh retries after a failed refresh. Default: 30s. */
  readonly refreshBackoffMs?: number;
}

/**
 * Owns the per-(provider, endpoint, model) capability profiles. Purely
 * in-memory + deterministic; all I/O happens through the injected fetcher.
 */
export class ModelCapabilityService {
  private readonly profiles = new Map<string, ModelCapabilityProfile>();
  private readonly freshTtlMs: number;
  private readonly staleTtlMs: number;
  private readonly safetyMarginRatio: number;
  private readonly nowFn: () => number;
  private readonly fetcher?: CapabilityMetadataFetcher;
  private readonly refreshBackoffMs: number;
  private readonly refreshInFlight = new Map<string, Promise<void>>();
  private readonly nextRefreshAllowedAt = new Map<string, number>();
  /** Last catalog diff per ingest call (for change detection consumers). */
  private lastChanges: readonly ProfileChange[] = [];

  constructor(opts: ModelCapabilityServiceOptions = {}) {
    this.freshTtlMs = opts.freshTtlMs ?? 60 * 60 * 1000;
    this.staleTtlMs = opts.staleTtlMs ?? 24 * 60 * 60 * 1000;
    this.safetyMarginRatio = opts.safetyMarginRatio ?? 0.04;
    this.nowFn = opts.now ?? (() => Date.now());
    this.fetcher = opts.fetcher;
    this.refreshBackoffMs = opts.refreshBackoffMs ?? 30_000;
  }

  // ── Ingestion & change detection ────────────────────────────────────────

  /**
   * Ingests a full provider catalog snapshot. Diffs against the previous
   * snapshot for this provider and returns the detected changes
   * (ADDED / REMOVED / CHANGED). A model that disappeared from the live
   * catalog keeps its last-known-good profile marked `stale` (never deleted
   * immediately — failure safety), mirroring ModelRegistry stale semantics.
   */
  ingestCatalog(providerId: string, entries: readonly CatalogEntryInput[]): ProfileChange[] {
    const now = this.nowFn();
    const changes: ProfileChange[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      const endpointId = entry.endpointId ?? 'default';
      const key = profileKey(providerId, endpointId, entry.model.id);
      seen.add(key);
      const existing = this.profiles.get(key);
      const next = this.buildProfile(providerId, entry, existing, now);

      if (!existing) {
        changes.push({ key, providerId, modelId: entry.model.id, kind: 'ADDED' });
      } else if (!fingerprintEquals(fingerprintOf(existing), fingerprintOf(next))) {
        const changedFields: string[] = [];
        if (existing.contextWindow !== next.contextWindow) changedFields.push('contextWindow');
        if (existing.maxOutputTokens !== next.maxOutputTokens) changedFields.push('maxOutputTokens');
        if (!fingerprintEquals(
          { contextWindow: undefined, maxOutputTokens: undefined, capabilities: existing.capabilities },
          { contextWindow: undefined, maxOutputTokens: undefined, capabilities: next.capabilities },
        )) changedFields.push('capabilities');
        changes.push({ key, providerId, modelId: entry.model.id, kind: 'CHANGED', changedFields });
      }
      this.profiles.set(key, next);
    }

    // Removals: models previously seen for this provider that are absent now.
    for (const [key, profile] of this.profiles) {
      if (profile.providerId !== providerId) continue;
      if (seen.has(key)) continue;
      if (profile.state === 'invalid') continue;
      changes.push({ key, providerId, modelId: profile.providerModelId, kind: 'REMOVED' });
      this.profiles.set(key, {
        ...profile,
        state: 'stale',
        lastError: 'removed from live provider catalog; retaining last-known-good profile',
      });
    }

    this.lastChanges = changes;
    return changes;
  }

  /** Builds (or refreshes) one profile from a catalog entry. */
  private buildProfile(
    providerId: string,
    entry: CatalogEntryInput,
    existing: ModelCapabilityProfile | undefined,
    now: number,
  ): ModelCapabilityProfile {
    const descriptor = entry.model;
    const endpointId = entry.endpointId ?? 'default';
    const raw = entry.raw;
    const rawCaps = raw ? pickCapabilityFlagsFromRaw(raw) : {};

    // ── Context window: priority order, never invented ────────────────────
    let contextWindow: number | undefined;
    let contextSource: CapabilitySource;
    let contextDetail: string | undefined;
    let confidence: CapabilityConfidence;

    const fromRaw = raw ? readContextFromRaw(raw) : {};
    if (fromRaw.value !== undefined) {
      contextWindow = fromRaw.value;
      contextSource = 'live_api';
      contextDetail = fromRaw.field;
      confidence = 'authoritative';
    } else if (typeof descriptor.contextWindow === 'number' && descriptor.contextWindow > 0) {
      contextWindow = descriptor.contextWindow;
      contextSource = entry.operatorPinned ? 'nexus_registry' : 'provider_metadata';
      contextDetail = 'descriptor.contextWindow';
      confidence = entry.operatorPinned ? 'medium' : 'high';
    } else {
      contextWindow = undefined;
      contextSource = 'fallback';
      contextDetail = undefined;
      confidence = 'low';
    }

    // ── Capability flags: metadata only, NEVER name-based inference ───────
    const descriptorCaps: ModelCapabilityFlags = {
      supportsVision: descriptor.capabilities?.vision,
      supportsAudio: descriptor.capabilities?.audio,
      supportsStreaming: descriptor.capabilities?.streaming,
      supportsTools: descriptor.capabilities?.toolCalling,
      supportsJsonMode: descriptor.capabilities?.jsonMode,
      supportsReasoning: descriptor.capabilities?.reasoning,
    };
    const capabilitySource: CapabilitySource = raw ? 'live_api' : 'provider_metadata';
    const caps = mergeCapabilityFlags(mergeCapabilityFlags(existing?.capabilities ?? {}, descriptorCaps), rawCaps);

    const maxOutputTokens =
      (raw && typeof raw['max_output_tokens'] === 'number' ? raw['max_output_tokens'] : undefined) ??
      (typeof descriptor.maxOutputTokens === 'number' ? descriptor.maxOutputTokens : undefined) ??
      existing?.maxOutputTokens;

    // Preserve runtime-probe knowledge across refreshes; a refresh can never
    // raise the validated limit above what a real probe measured.
    const validatedContextWindow = existing?.validatedContextWindow;

    const expiresAt = now + this.freshTtlMs;
    return {
      key: profileKey(providerId, endpointId, descriptor.id),
      providerId,
      endpointId,
      providerModelId: descriptor.id,
      canonicalModelId: descriptor.id,
      contextWindow,
      contextUnknown: contextWindow === undefined,
      maxOutputTokens,
      capabilities: caps,
      contextSource,
      capabilitySource,
      confidence,
      contextSourceDetail: contextDetail,
      tokenizer: existing?.tokenizer ?? 'unknown',
      validatedContextWindow,
      state: 'fresh',
      discoveredAt: existing?.discoveredAt ?? now,
      lastVerifiedAt: now,
      expiresAt,
      rawProviderMetadata: raw ?? existing?.rawProviderMetadata,
    };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Returns the profile with its CURRENT lifecycle state computed. */
  get(providerId: string, modelId: string, endpointId?: string): ModelCapabilityProfile | undefined {
    const p = this.profiles.get(profileKey(providerId, endpointId, modelId));
    if (!p) return undefined;
    return { ...p, state: this.computeState(p) };
  }

  /** All profiles (current states), sorted for stable output. */
  list(): readonly ModelCapabilityProfile[] {
    return Array.from(this.profiles.values())
      .map((p) => ({ ...p, state: this.computeState(p) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  listByProvider(providerId: string): readonly ModelCapabilityProfile[] {
    return this.list().filter((p) => p.providerId === providerId);
  }

  /** Changes reported by the most recent ingestCatalog call. */
  get lastCatalogChanges(): readonly ProfileChange[] {
    return this.lastChanges;
  }

  private computeState(p: ModelCapabilityProfile): CapabilityCacheState {
    if (p.state === 'invalid') return 'invalid';
    // An explicitly-marked stale profile (e.g. removed from the live catalog)
    // stays stale until a new catalog snapshot re-ingests it.
    if (p.state === 'stale') return 'stale';
    const now = this.nowFn();
    if (now < p.expiresAt) return 'fresh';
    if (now < p.expiresAt + this.staleTtlMs) return 'stale';
    return 'expired';
  }

  // ── Effective context & fit ─────────────────────────────────────────────

  /**
   * effectiveContext = min(discovered, validated) − safety margin.
   * Returns null (UNKNOWN) when no real metadata source exists — a fallback
   * number is never fabricated.
   */
  effectiveContext(providerId: string, modelId: string, endpointId?: string): number | null {
    const p = this.get(providerId, modelId, endpointId);
    if (!p) return null;
    if (p.contextUnknown && p.validatedContextWindow === undefined) return null;
    const discovered = p.contextWindow;
    const validated = p.validatedContextWindow;
    const base = Math.min(discovered ?? Number.POSITIVE_INFINITY, validated ?? Number.POSITIVE_INFINITY);
    if (!Number.isFinite(base)) return null;
    const effective = Math.floor(base * (1 - this.safetyMarginRatio));
    return effective > 0 ? effective : null;
  }

  /**
   * Per-request context fit report. `fits: null` means the context window is
   * UNKNOWN — callers decide policy (allow-and-label vs strict rejection);
   * nothing is silently assumed here.
   */
  checkContextFit(
    providerId: string,
    modelId: string,
    usage: {
      estimatedInputTokens: number;
      reservedOutputTokens?: number;
      toolTokens?: number;
    },
    endpointId?: string,
  ): ContextFitReport {
    const p = this.get(providerId, modelId, endpointId);
    const effective = this.effectiveContext(providerId, modelId, endpointId);
    const reservedOutputTokens = usage.reservedOutputTokens ?? 0;
    const toolTokens = usage.toolTokens ?? 0;
    const key = profileKey(providerId, endpointId, modelId);
    if (!p || effective === null) {
      return {
        providerId,
        modelId,
        key,
        effectiveContext: null,
        estimatedInputTokens: usage.estimatedInputTokens,
        reservedOutputTokens,
        toolTokens,
        utilization: null,
        fits: null,
        reason: 'context_unknown',
        contextSource: p?.contextSource ?? 'fallback',
        confidence: p?.confidence ?? 'low',
      };
    }
    const required = usage.estimatedInputTokens + reservedOutputTokens + toolTokens;
    const fits = required <= effective;
    return {
      providerId,
      modelId,
      key,
      effectiveContext: effective,
      estimatedInputTokens: usage.estimatedInputTokens,
      reservedOutputTokens,
      toolTokens,
      utilization: Number((usage.estimatedInputTokens / effective).toFixed(4)),
      fits,
      reason: fits ? 'ok' : 'context_exceeded',
      contextSource: p.contextSource,
      confidence: p.confidence,
    };
  }

  /**
   * Hard context-eligibility check for routing. Returns:
   *  - true  → verified fit
   *  - false → verified over-budget (hard exclusion)
   *  - null  → context UNKNOWN (caller policy decides; never a silent guess)
   */
  isContextEligible(
    providerId: string,
    modelId: string,
    requiredInputTokens: number,
    endpointId?: string,
  ): boolean | null {
    const p = this.get(providerId, modelId, endpointId);
    if (!p) return null;
    const effective = this.effectiveContext(providerId, modelId, endpointId);
    if (effective === null) return null;
    return requiredInputTokens <= effective;
  }

  // ── Probes, invalidation, refresh ───────────────────────────────────────

  /**
   * Records a safe runtime probe result (Priority 5). The effective context
   * is min(discovered, validated) — a probe can lower but never raise the limit.
   */
  recordRuntimeProbe(providerId: string, modelId: string, validatedContext: number, endpointId?: string): void {
    const key = profileKey(providerId, endpointId, modelId);
    const p = this.profiles.get(key);
    if (!p || typeof validatedContext !== 'number' || validatedContext <= 0) return;
    // A probe can LOWER the usable limit but NEVER raise it above what was
    // already validated (spec: never increase a limit on assumption alone).
    const clamped = Math.min(p.validatedContextWindow ?? Number.POSITIVE_INFINITY, validatedContext);
    this.profiles.set(key, {
      ...p,
      validatedContextWindow: clamped,
      lastVerifiedAt: this.nowFn(),
    });
  }

  /**
   * Marks a profile invalid (e.g. upstream 404 invalid_model). Metadata
   * credential/rate-limit problems must NOT be passed here — they do not
   * invalidate capability knowledge.
   */
  invalidate(providerId: string, modelId: string, reason: string, endpointId?: string): void {
    const key = profileKey(providerId, endpointId, modelId);
    const p = this.profiles.get(key);
    if (!p) return;
    this.profiles.set(key, { ...p, state: 'invalid', lastError: reason });
  }

  /**
   * Called by the request path when a model-level upstream failure occurs.
   * Only model-identity failures (404 invalid_model / model_not_found)
   * invalidate capability metadata; 401/429/5xx never poison it.
   */
  recordModelRequestFailure(
    providerId: string,
    modelId: string,
    errorKind: 'model_not_found' | 'auth' | 'rate_limited' | 'server' | 'network',
  ): void {
    if (errorKind === 'model_not_found') {
      this.invalidate(providerId, modelId, 'upstream reported model unavailable (404/invalid_model)');
      void this.scheduleRefresh(providerId);
    }
    // auth / rate_limited / server / network: capability metadata untouched.
  }

  /**
   * Non-blocking stale-while-revalidate refresh with a per-provider
   * single-flight lock and exponential backoff. Never throws; never blocks
   * the caller on network I/O.
   */
  async scheduleRefresh(providerId: string): Promise<void> {
    const fetcher = this.fetcher;
    if (!fetcher) return;
    const now = this.nowFn();
    const notBefore = this.nextRefreshAllowedAt.get(providerId) ?? 0;
    if (now < notBefore) return;
    const inFlight = this.refreshInFlight.get(providerId);
    if (inFlight) return inFlight;

    const task = (async () => {
      try {
        const res = await fetcher.fetch(providerId);
        if (res.ok && res.entries) {
          this.ingestCatalog(providerId, res.entries);
          this.nextRefreshAllowedAt.delete(providerId);
        } else {
          const backoff =
            res.errorKind === 'rate_limited' && res.retryAfterMs
              ? Math.max(res.retryAfterMs, this.refreshBackoffMs)
              : this.refreshBackoffMs;
          this.nextRefreshAllowedAt.set(providerId, this.nowFn() + backoff);
        }
      } catch {
        this.nextRefreshAllowedAt.set(providerId, this.nowFn() + this.refreshBackoffMs);
      } finally {
        this.refreshInFlight.delete(providerId);
      }
    })();

    this.refreshInFlight.set(providerId, task);
    return task;
  }

  /** True while a refresh for this provider is in flight (observability). */
  isRefreshInFlight(providerId: string): boolean {
    return this.refreshInFlight.has(providerId);
  }
}

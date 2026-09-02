import { describe, it, expect } from 'vitest';
import type { ModelDescriptor } from '../src/domain/types.js';
import {
  ModelCapabilityService,
  type CatalogEntryInput,
  type CapabilityMetadataFetcher,
} from '../src/application/model-capability-profile.js';

function desc(id: string, providerId: string, contextWindow?: number, caps?: ModelDescriptor['capabilities']): ModelDescriptor {
  return {
    id,
    providerId,
    contextWindow,
    capabilities: caps,
    discoveredAt: 1_000,
  };
}

/** Deterministic clock: advances only when the test tells it to. */
function makeClock() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function makeService(
  opts: {
    clock?: ReturnType<typeof makeClock>;
    fetcher?: CapabilityMetadataFetcher;
    freshTtlMs?: number;
    staleTtlMs?: number;
  } = {},
) {
  const clock = opts.clock ?? makeClock();
  const service = new ModelCapabilityService({
    now: clock.now,
    fetcher: opts.fetcher,
    freshTtlMs: opts.freshTtlMs ?? 60 * 60 * 1000,
    staleTtlMs: opts.staleTtlMs ?? 24 * 60 * 60 * 1000,
  });
  return { service, clock };
}

describe('ModelCapabilityService — discovery ingestion & provenance', () => {
  it('builds a profile per discovered model with provider attribution', () => {
    const { service } = makeService();
    const changes = service.ingestCatalog('openai', [{ model: desc('gpt-x', 'openai', 128000) }]);

    expect(changes).toEqual([
      { key: 'openai::default::gpt-x', providerId: 'openai', modelId: 'gpt-x', kind: 'ADDED' },
    ]);
    const p = service.get('openai', 'gpt-x')!;
    expect(p.providerId).toBe('openai');
    expect(p.providerModelId).toBe('gpt-x');
    expect(p.contextWindow).toBe(128000);
    // descriptor-sourced context = provider metadata, not an invented number
    expect(p.contextSource).toBe('provider_metadata');
    expect(p.confidence).toBe('high');
    expect(p.contextUnknown).toBe(false);
  });

  it('keeps the same model id on two providers as independent profiles (no cross-contamination)', () => {
    const { service } = makeService();
    service.ingestCatalog('provider-a', [{ model: desc('shared-model', 'provider-a', 32000) }]);
    service.ingestCatalog('provider-b', [
      { model: desc('shared-model', 'provider-b'), raw: { context_window: 1000000 } },
    ]);

    const a = service.get('provider-a', 'shared-model')!;
    const b = service.get('provider-b', 'shared-model')!;
    expect(a.key).not.toBe(b.key);
    expect(a.contextWindow).toBe(32000);
    expect(a.contextSource).toBe('provider_metadata');
    // provider-b's authoritative live value must NOT leak into provider-a
    expect(b.contextWindow).toBe(1000000);
    expect(b.contextSource).toBe('live_api');
    expect(b.confidence).toBe('authoritative');
    expect(b.contextSourceDetail).toBe('context_window');
  });

  it('represents UNKNOWN context truthfully (never invents a number)', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [{ model: desc('mystery', 'p') }]);
    const p = service.get('p', 'mystery')!;
    expect(p.contextUnknown).toBe(true);
    expect(p.contextWindow).toBeUndefined();
    expect(p.contextSource).toBe('fallback');
    expect(p.confidence).toBe('low');
    expect(service.effectiveContext('p', 'mystery')).toBeNull();
  });

  it('labels operator-pinned models as nexus_registry with medium confidence', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [
      { model: desc('pinned', 'p', 64000), operatorPinned: true },
    ]);
    const p = service.get('p', 'pinned')!;
    expect(p.contextSource).toBe('nexus_registry');
    expect(p.confidence).toBe('medium');
  });

  it('NEVER infers vision from the model name; only metadata asserts it', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [
      { model: desc('super-vision-model', 'p', 8000) },
    ]);
    const p = service.get('p', 'super-vision-model')!;
    expect(p.capabilities.supportsVision).toBeUndefined();

    service.ingestCatalog('q', [
      { model: desc('plain-name', 'q', 8000), raw: { capabilities: { vision: true } } },
    ]);
    const q = service.get('q', 'plain-name')!;
    expect(q.capabilities.supportsVision).toBe(true);
    expect(q.capabilitySource).toBe('live_api');
  });

  it('preserves unknown/extra raw provider metadata verbatim', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [
      { model: desc('m', 'p'), raw: { context_window: 4096, brand_new_field: { nested: true } } },
    ]);
    const p = service.get('p', 'm')!;
    expect(p.rawProviderMetadata?.['brand_new_field']).toEqual({ nested: true });
  });
});

describe('ModelCapabilityService — change detection (catalog diff)', () => {
  it('detects ADDED / REMOVED / CHANGED and reports changed fields', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [
      { model: desc('keep', 'p', 8000) },
      { model: desc('grow', 'p', 8000) },
      { model: desc('leave', 'p', 8000) },
    ]);

    const changes = service.ingestCatalog('p', [
      { model: desc('keep', 'p', 8000) },
      { model: desc('grow', 'p', 128000) }, // context changed
      { model: desc('new', 'p', 4096) }, // added
      // 'leave' absent → removed
    ]);

    const kinds = Object.fromEntries(changes.map((c) => [c.modelId, c.kind]));
    expect(kinds['new']).toBe('ADDED');
    expect(kinds['leave']).toBe('REMOVED');
    expect(kinds['grow']).toBe('CHANGED');
    const grow = changes.find((c) => c.modelId === 'grow')!;
    expect(grow.changedFields).toContain('contextWindow');
    // unchanged model produces no record
    expect(kinds['keep']).toBeUndefined();
  });

  it('a removed model keeps its last-known-good profile marked stale (failure safety)', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [{ model: desc('gone', 'p', 8000) }]);
    service.ingestCatalog('p', []);
    const p = service.get('p', 'gone')!;
    expect(p.state).toBe('stale');
    expect(p.contextWindow).toBe(8000);
    expect(p.lastError).toContain('removed');
  });

  it('refresh reuses discoveredAt but bumps lastVerifiedAt, preserving probe knowledge', () => {
    const clock = makeClock();
    const { service } = makeService({ clock });
    service.ingestCatalog('p', [{ model: desc('m', 'p', 8000) }]);
    service.recordRuntimeProbe('p', 'm', 7000);
    clock.advance(5_000);
    service.ingestCatalog('p', [{ model: desc('m', 'p', 8000) }]);

    const p = service.get('p', 'm')!;
    expect(p.discoveredAt).toBe(1_000_000);
    expect(p.lastVerifiedAt).toBe(1_005_000);
    expect(p.validatedContextWindow).toBe(7000);
  });
});

describe('ModelCapabilityService — cache lifecycle (fresh/stale/expired/invalid)', () => {
  it('decays fresh → stale → expired with the injected clock', () => {
    const clock = makeClock();
    const { service } = makeService({ clock, freshTtlMs: 1000, staleTtlMs: 2000 });
    service.ingestCatalog('p', [{ model: desc('m', 'p', 8000) }]);

    expect(service.get('p', 'm')!.state).toBe('fresh');
    clock.advance(1000);
    expect(service.get('p', 'm')!.state).toBe('stale');
    clock.advance(2000);
    expect(service.get('p', 'm')!.state).toBe('expired');
  });

  it('invalidate() marks the profile invalid with the reason', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [{ model: desc('m', 'p', 8000) }]);
    service.invalidate('p', 'm', 'upstream 404 invalid_model');
    const p = service.get('p', 'm')!;
    expect(p.state).toBe('invalid');
    expect(p.lastError).toContain('404');
  });
});

describe('ModelCapabilityService — effective context & fit', () => {
  it('effectiveContext = min(discovered, validated) − safety margin; probe lowers, never raises', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [{ model: desc('m', 'p', 100000) }]);
    // 4% margin → 96000
    expect(service.effectiveContext('p', 'm')).toBe(96000);

    service.recordRuntimeProbe('p', 'm', 50000);
    expect(service.effectiveContext('p', 'm')).toBe(48000);

    // A bogus "larger" probe must NOT raise the declared limit.
    service.recordRuntimeProbe('p', 'm', 900000);
    expect(service.effectiveContext('p', 'm')).toBe(48000);
  });

  it('checkContextFit returns ok / context_exceeded / context_unknown truthfully', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [
      { model: desc('big', 'p', 128000) },
      { model: desc('small', 'p', 8000) },
      { model: desc('unknown', 'p') },
    ]);

    const ok = service.checkContextFit('p', 'big', { estimatedInputTokens: 90000, reservedOutputTokens: 16000, toolTokens: 2000 });
    expect(ok.fits).toBe(true);
    expect(ok.reason).toBe('ok');
    expect(ok.utilization).toBeCloseTo(90000 / 122880, 3);

    const over = service.checkContextFit('p', 'small', { estimatedInputTokens: 90000 });
    expect(over.fits).toBe(false);
    expect(over.reason).toBe('context_exceeded');

    const unknownFit = service.checkContextFit('p', 'unknown', { estimatedInputTokens: 90000 });
    expect(unknownFit.fits).toBeNull();
    expect(unknownFit.reason).toBe('context_unknown');
    expect(unknownFit.effectiveContext).toBeNull();
  });

  it('isContextEligible: true when fits, false when over, null when UNKNOWN', () => {
    const { service } = makeService();
    service.ingestCatalog('p', [
      { model: desc('big', 'p', 128000) },
      { model: desc('unknown', 'p') },
    ]);
    expect(service.isContextEligible('p', 'big', 100000)).toBe(true);
    expect(service.isContextEligible('p', 'big', 200000)).toBe(false);
    expect(service.isContextEligible('p', 'unknown', 1000)).toBeNull();
    expect(service.isContextEligible('p', 'ghost', 1000)).toBeNull();
  });
});

describe('ModelCapabilityService — failure semantics (no metadata poisoning)', () => {
  function recordingFetcher(): { fetcher: CapabilityMetadataFetcher; calls: number[] } {
    const calls: number[] = [];
    return {
      calls,
      fetcher: {
        fetch: async (providerId: string) => {
          calls.push(Date.now());
          return {
            ok: true,
            entries: [{ model: desc('m', providerId, 8000) }] as readonly CatalogEntryInput[],
          };
        },
      },
    };
  }

  it('model_not_found invalidates the profile AND triggers a catalog refresh', async () => {
    let calls = 0;
    const { service } = makeService({
      // The refresh attempt fails (provider unreachable) — so no re-listing
      // can restore the model and the invalidation must persist.
      fetcher: {
        fetch: async () => {
          calls++;
          return { ok: false, errorKind: 'unreachable' };
        },
      },
    });
    service.ingestCatalog('p', [{ model: desc('m', 'p', 8000) }]);
    await service.recordModelRequestFailure('p', 'm', 'model_not_found');
    expect(service.get('p', 'm')!.state).toBe('invalid');
    expect(calls).toBe(1); // refresh actually ran (single fetch)
  });

  it('401 / 429 / 5xx / network failures NEVER touch capability metadata', async () => {
    const r = recordingFetcher();
    const { service } = makeService({ fetcher: r.fetcher });
    service.ingestCatalog('p', [{ model: desc('m', 'p', 8000) }]);
    for (const kind of ['auth', 'rate_limited', 'server', 'network'] as const) {
      await service.recordModelRequestFailure('p', 'm', kind);
    }
    const p = service.get('p', 'm')!;
    expect(p.state).toBe('fresh');
    expect(p.contextWindow).toBe(8000);
    expect(r.calls.length).toBe(0); // no refresh triggered
  });

  it('scheduleRefresh is single-flight per provider (no refresh storms)', async () => {
    let fetchCount = 0;
    const { service } = makeService({
      fetcher: {
        fetch: async (providerId) => {
          fetchCount++;
          await new Promise((r) => setTimeout(r, 20));
          return { ok: true, entries: [{ model: desc('m', providerId, 4096) }] };
        },
      },
    });
    await Promise.all([
      service.scheduleRefresh('p'),
      service.scheduleRefresh('p'),
      service.scheduleRefresh('p'),
    ]);
    expect(fetchCount).toBe(1);
    // and the fetched catalog actually replaced profiles
    expect(service.get('p', 'm')!.contextWindow).toBe(4096);
  });

  it('failed refresh backs off (Retry-After honored), provider failure never deletes profiles', async () => {
    const clock = makeClock();
    let attempts = 0;
    const { service } = makeService({
      clock,
      fetcher: {
        fetch: async () => {
          attempts++;
          return { ok: false, errorKind: 'rate_limited', retryAfterMs: 50_000 };
        },
      },
    });
    service.ingestCatalog('p', [{ model: desc('m', 'p', 8000) }]);
    await service.scheduleRefresh('p');
    expect(attempts).toBe(1);
    // profile retained despite refresh failure
    expect(service.get('p', 'm')!.contextWindow).toBe(8000);
    // backoff window: an immediate retry is suppressed
    clock.advance(10_000);
    await service.scheduleRefresh('p');
    expect(attempts).toBe(1);
    // after Retry-After elapses, refresh is allowed again
    clock.advance(50_000);
    await service.scheduleRefresh('p');
    expect(attempts).toBe(2);
  });
});

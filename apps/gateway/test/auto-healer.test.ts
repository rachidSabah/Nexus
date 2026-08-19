import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutoHealer } from '../src/auto-healer';

// Minimal stand-ins — AutoHealer only uses listEndpoints() + updateEndpoint().
const fakeRouting: any = {
  endpoints: [] as any[],
  listEndpoints() {
    return this.endpoints;
  },
  updateEndpoint(id: string, patch: any) {
    const e = this.endpoints.find((x: any) => x.id === id);
    if (e) Object.assign(e, patch);
  },
};
const fakeKeys: any = {
  listAll: () => [],
  getPlaintext: async () => null,
  reset: () => {},
};

function makeEndpoint(health: 'healthy' | 'degraded' | 'circuit_open' | 'unhealthy') {
  return {
    id: 'ep1',
    providerId: 'p1',
    displayName: 'p1',
    capabilities: {},
    pricing: {},
    priority: 1,
    weight: 1,
    health,
    tags: [],
    timeoutMs: 30000,
    maxRetries: 2,
    concurrencyLimit: 10,
    baseUrl: 'http://example.test',
  } as any;
}

describe('AutoHealer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does NOT promote a billing-dead (always-reachable) circuit_open endpoint to healthy', async () => {
    fakeRouting.endpoints = [makeEndpoint('circuit_open')];
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })));
    const healer = new AutoHealer(fakeRouting as any, fakeKeys as any, { probeTimeoutMs: 200 });

    const res = await healer.healOnce();

    // Bare reachability must not mask a billing-dead endpoint as healthy.
    expect(res.endpointsHealed).toBe(0);
    expect(fakeRouting.endpoints[0]!.health).toBe('circuit_open');
  });

  it('promotes an endpoint to healthy on a genuine unreachable -> reachable recovery', async () => {
    fakeRouting.endpoints = [makeEndpoint('circuit_open')];
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n++;
        if (n === 1) throw new Error('connection refused'); // real outage
        return { status: 200 } as any; // recovered
      }),
    );
    const healer = new AutoHealer(fakeRouting as any, fakeKeys as any, { probeTimeoutMs: 200 });

    await healer.healOnce(); // pass 1: unreachable
    expect(fakeRouting.endpoints[0]!.health).toBe('circuit_open');
    await healer.healOnce(); // pass 2: reachable + wasUnreachable -> healthy
    expect(fakeRouting.endpoints[0]!.health).toBe('healthy');
  });
});

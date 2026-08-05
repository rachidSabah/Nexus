'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function NetworkPage() {
  const { data, isLoading } = useSWR('/api/v1/network/diagnostics', fetcher, { refreshInterval: 10_000 });
  const d = data as any;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Network</h1>
        <p className="text-sm text-white/50">DNS, proxies, IPv4/IPv6 connectivity.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="stat-label">DNS Resolver</div>
          <div className="mt-2 font-mono text-sm">{d?.dns.resolver ?? '…'}</div>
          <div className="mt-1 text-xs text-white/40">{d?.dns.ok ? 'OK' : 'fail'} · {d?.dns.latencyMs ?? 0}ms</div>
        </div>
        <div className="card">
          <div className="stat-label">IPv4</div>
          <div className="mt-2 font-mono text-sm">{d?.ipv4.ok ? 'reachable' : 'unreachable'}</div>
          <div className="mt-1 text-xs text-white/40">{d?.ipv4.latencyMs ?? 0}ms</div>
        </div>
        <div className="card">
          <div className="stat-label">IPv6</div>
          <div className="mt-2 font-mono text-sm">{d?.ipv6.ok ? 'reachable' : 'unreachable'}</div>
          <div className="mt-1 text-xs text-white/40">{d?.ipv6.latencyMs ?? 0}ms</div>
        </div>
        <div className="card">
          <div className="stat-label">Proxies</div>
          <div className="mt-2 font-mono text-sm">{d?.proxies?.length ?? 0} configured</div>
        </div>
      </div>
      {isLoading && <div className="text-sm text-white/40">Running diagnostics…</div>}
    </div>
  );
}

'use client';

import { KeyRound, Boxes } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';

import { ProviderTable } from '@/components/ProviderTable';
import type { Provider } from '@/hooks/api';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ApiKey {
  id: string;
  providerId: string;
  status: 'active' | 'cooldown' | 'exhausted' | 'invalid';
}

export default function ProvidersPage() {
  const { data: providers, isLoading } = useSWR<Provider[]>('/api/v1/providers', fetcher, { refreshInterval: 5000 });
  const { data: keys } = useSWR<ApiKey[]>('/api/v1/keys', fetcher, { refreshInterval: 5000 });

  // Count keys per provider
  const keysByProvider = (keys ?? []).reduce<Record<string, { total: number; active: number; cooldown: number; invalid: number }>>((acc, k) => {
    if (!acc[k.providerId]) acc[k.providerId] = { total: 0, active: 0, cooldown: 0, invalid: 0 };
    acc[k.providerId]!.total++;
    if (k.status === 'active') acc[k.providerId]!.active++;
    else if (k.status === 'cooldown') acc[k.providerId]!.cooldown++;
    else if (k.status === 'invalid') acc[k.providerId]!.invalid++;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Boxes className="h-6 w-6 text-nexus-400" />
          Providers
        </h1>
        <p className="text-sm text-white/50">
          All configured provider endpoints and their current health.
          Add multiple API keys per provider on the {' '}
          <Link href="/keys" className="text-nexus-400 underline">API Keys</Link> page
          to enable intelligent key rotation.
        </p>
      </div>

      {/* Provider summary cards with key counts */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(providers ?? []).map((p) => {
          const keyInfo = keysByProvider[p.providerId];
          return (
            <div key={p.id} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.providerId}</div>
                  <div className="text-xs text-white/40">{p.displayName} · {p.health}</div>
                </div>
                <Link
                  href="/keys"
                  className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-xs text-white/60 transition hover:bg-white/10"
                >
                  <KeyRound className="h-3 w-3" />
                  {keyInfo ? `${keyInfo.active}/${keyInfo.total} keys` : '0 keys'}
                </Link>
              </div>
              {keyInfo && keyInfo.total > 0 && (
                <div className="mt-2 flex gap-2 text-[10px] text-white/40">
                  <span className="text-emerald-400">{keyInfo.active} active</span>
                  {keyInfo.cooldown > 0 && <span className="text-amber-400">{keyInfo.cooldown} cooldown</span>}
                  {keyInfo.invalid > 0 && <span className="text-rose-400">{keyInfo.invalid} invalid</span>}
                </div>
              )}
              {(!keyInfo || keyInfo.total === 0) && (
                <div className="mt-2 text-[10px] text-amber-400">
                  No API keys registered — add keys to enable rotation
                </div>
              )}
            </div>
          );
        })}
        {(providers ?? []).length === 0 && !isLoading && (
          <div className="card col-span-full py-8 text-center text-sm text-white/40">
            No providers configured. Set environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
            to auto-register providers, or configure endpoints in agent-nexus.config.json.
          </div>
        )}
      </div>

      {/* Detailed provider table */}
      <div className="card">
        {isLoading ? <div className="py-8 text-center text-sm text-white/40">Loading…</div> : <ProviderTable providers={providers ?? []} />}
      </div>
    </div>
  );
}

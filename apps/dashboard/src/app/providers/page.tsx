'use client';

import { KeyRound, Boxes, Sparkles, ShieldCheck, Zap } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';

import { EndpointManager } from '@/components/EndpointManager';
import { ProviderTable } from '@/components/ProviderTable';
import { useEndpoints } from '@/hooks/api';
import type { Provider } from '@/hooks/api';
import { etagFetcher } from '@/lib/etagFetcher';

const fetcher = etagFetcher;

interface ApiKey {
  id: string;
  providerId: string;
  status: 'active' | 'cooldown' | 'exhausted' | 'invalid';
}

export default function ProvidersPage() {
  const { data: providers, isLoading, mutate: mutateProviders } = useSWR<Provider[]>('/api/v1/providers', fetcher, { refreshInterval: 5000 });
  const { data: keys } = useSWR<ApiKey[]>('/api/v1/keys', fetcher, { refreshInterval: 5000 });
  const { data: endpoints, mutate: mutateEndpoints } = useEndpoints();

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
    <div className="space-y-8 relative pb-12">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Multi-Provider Mesh Routing
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Boxes className="h-8 w-8 text-nexus-400" />
            AI Provider Endpoints & Mesh Health
          </h1>
          <p className="mt-1 text-sm text-white/60 max-w-2xl">
            Monitor and manage active AI provider endpoints (OpenRouter, Cerebras, Nvidia NIM, DeepSeek, Ollama, OpenCode, etc.).
            Buckle keys on the <Link href="/keys" className="text-nexus-300 underline hover:text-nexus-200">API Keys matrix</Link> to enable automatic failover rotation.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              try {
                await fetch('/api/v1/models/refresh', { method: 'POST' });
                alert('Triggered live API model discovery across all configured providers!');
              } catch (e) {
                alert('Discovery failed: ' + (e as Error).message);
              }
            }}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-nexus-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:scale-[1.02] active:scale-95"
          >
            <Zap className="h-4 w-4 animate-pulse text-emerald-300" /> Auto-Discover & Sync API Models
          </button>
          <Link
            href="/keys"
            className="flex items-center gap-2 rounded-xl bg-white/10 border border-white/10 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:bg-white/20 active:scale-95"
          >
            <KeyRound className="h-4 w-4" /> Manage Vault API Keys
          </Link>
        </div>
      </div>

      {/* Provider summary cards with key counts */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(providers ?? []).map((p) => {
          const keyInfo = keysByProvider[p.providerId];
          const isHealthy = p.health === 'healthy';
          return (
            <div
              key={p.id}
              className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-black/40 p-5 backdrop-blur-xl transition hover:border-nexus-500/40"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-base font-bold text-white">{p.providerId}</div>
                  <div className="text-xs text-white/40">{p.displayName}</div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                  isHealthy
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  {p.health}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                {keyInfo && keyInfo.total > 0 ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-emerald-400 font-semibold">{keyInfo.active} active</span>
                    {keyInfo.cooldown > 0 && <span className="text-amber-400 font-medium">· {keyInfo.cooldown} cooldown</span>}
                    {keyInfo.invalid > 0 && <span className="text-rose-400 font-medium">· {keyInfo.invalid} invalid</span>}
                  </div>
                ) : (
                  <div className="text-[11px] text-amber-400/80 font-medium flex items-center gap-1">
                    <Zap className="h-3 w-3" /> No keys registered
                  </div>
                )}

                <Link
                  href="/keys"
                  className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  {keyInfo ? `${keyInfo.active}/${keyInfo.total} keys` : 'Add keys'}
                </Link>
              </div>
            </div>
          );
        })}
        {(providers ?? []).length === 0 && !isLoading && (
          <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-xs text-white/40 col-span-full">
            No providers registered on gateway. Set environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) or add provider endpoints.
          </div>
        )}
      </div>

      {/* Detailed provider table */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" /> Endpoint Health & Capability Matrix
        </h2>
        {isLoading ? <div className="py-8 text-center text-xs text-white/40">Querying provider mesh...</div> : <ProviderTable providers={providers ?? []} />}
      </div>

      {/* Live endpoint manager — edit base URLs / probe / heal without restart (D5) */}
      <div className="rounded-2xl border border-nexus-500/30 bg-gradient-to-b from-nexus-950/30 to-black/40 p-6 backdrop-blur-xl">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-nexus-300 flex items-center gap-2">
          <Zap className="h-4 w-4 text-nexus-400" /> Live Endpoint Manager
        </h2>
        <p className="mb-4 text-[11px] text-white/40">
          Correct a provider&apos;s base URL from the web, probe reachability, and heal unhealthy endpoints — all without restarting the gateway.
        </p>
        <EndpointManager endpoints={endpoints?.endpoints ?? []} onChanged={() => { mutateProviders(); mutateEndpoints(); }} />
      </div>
    </div>
  );
}


'use client';

import { KeyRound, Boxes, Sparkles, ShieldCheck, Zap, Plus, RefreshCw, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { EndpointManager } from '@/components/EndpointManager';
import { ErrorResolveButton } from '@/components/ErrorResolveButton';
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

interface EnrichedProvider extends Provider {
  baseUrl?: string;
  status?: string;
  modelsCount?: number;
  keysCount?: number;
  activeKeysCount?: number;
  activeErrorsCount?: number;
  errorsCount?: number;
  circuitBreakerState?: 'closed' | 'open' | 'half_open';
  lastErrorDiagnostic?: any;
  lastSync?: number;
  lastError?: string;
}

export default function ProvidersPage() {
  const { data: providers, isLoading, mutate: mutateProviders } = useSWR<EnrichedProvider[]>('/api/v1/providers', fetcher, { refreshInterval: 5000 });
  const { data: keys } = useSWR<ApiKey[]>('/api/v1/keys', fetcher, { refreshInterval: 5000 });
  const { data: endpoints, mutate: mutateEndpoints } = useEndpoints();

  // Add Provider Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProviderId, setNewProviderId] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [probing, setProbing] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    step?: string;
    steps?: {
      gatewayReachable: boolean;
      authenticationSuccessful: boolean;
      modelsEndpointReachable: boolean;
      modelsDiscoveredCount: number;
    };
    error?: string;
    modelsPreview?: Array<{ id: string; owner: string }>;
  } | null>(null);

  // Quick action states
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);

  // Count keys per provider
  const keysByProvider = (keys ?? []).reduce<Record<string, { total: number; active: number; cooldown: number; invalid: number }>>((acc, k) => {
    if (!acc[k.providerId]) acc[k.providerId] = { total: 0, active: 0, cooldown: 0, invalid: 0 };
    acc[k.providerId]!.total++;
    if (k.status === 'active') acc[k.providerId]!.active++;
    else if (k.status === 'cooldown') acc[k.providerId]!.cooldown++;
    else if (k.status === 'invalid') acc[k.providerId]!.invalid++;
    return acc;
  }, {});

  const handleProbe = async () => {
    if (!newBaseUrl) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const res = await fetch('/api/v1/providers/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: newProviderId || undefined,
          baseUrl: newBaseUrl,
          apiKey: newApiKey || undefined,
        }),
      });
      const data = await res.json();
      setProbeResult(data);
    } catch (e) {
      setProbeResult({
        ok: false,
        step: 'CONNECT',
        error: (e as Error).message,
      });
    } finally {
      setProbing(false);
    }
  };

  const handleOnboard = async () => {
    if (!newProviderId || !newBaseUrl) return;
    setOnboarding(true);
    try {
      const res = await fetch('/api/v1/providers/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: newProviderId,
          displayName: newDisplayName || newProviderId.toUpperCase(),
          baseUrl: newBaseUrl,
          apiKey: newApiKey || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setShowAddModal(false);
        setNewProviderId('');
        setNewDisplayName('');
        setNewBaseUrl('');
        setNewApiKey('');
        setProbeResult(null);
        mutateProviders();
        mutateEndpoints();
      } else {
        alert(data.error?.message ?? 'Failed to onboard provider');
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setOnboarding(false);
    }
  };

  const handleSync = async (providerId: string) => {
    setSyncingProvider(providerId);
    try {
      const res = await fetch(`/api/v1/providers/${providerId}/sync`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        mutateProviders();
      }
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Are you sure you want to remove provider '${id}' and sweep its models from the catalog?`)) return;
    try {
      await fetch(`/api/v1/providers/${id}`, { method: 'DELETE' });
      mutateProviders();
      mutateEndpoints();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="space-y-8 relative pb-12">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Universal Provider Fabric
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Boxes className="h-8 w-8 text-nexus-400" />
            Provider Center & Mesh Fabric
          </h1>
          <p className="mt-1 text-sm text-white/60 max-w-2xl">
            Connect any AI provider once. Nexus automatically discovers its models, normalizes capabilities, encrypts credentials, and routes traffic across connected coding agents.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-nexus-600 to-cyan-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:scale-[1.02] active:scale-95"
          >
            <Plus className="h-4 w-4" /> Add Provider
          </button>
          <button
            onClick={async () => {
              try {
                await fetch('/api/v1/models/refresh', { method: 'POST' });
                mutateProviders();
                alert('Triggered live discovery across all providers!');
              } catch (e) {
                alert('Discovery failed: ' + (e as Error).message);
              }
            }}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-nexus-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:scale-[1.02] active:scale-95"
          >
            <Zap className="h-4 w-4 animate-pulse text-emerald-300" /> Discover All Models
          </button>
          <Link
            href="/keys"
            className="flex items-center gap-2 rounded-xl bg-white/10 border border-white/10 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:bg-white/20 active:scale-95"
          >
            <KeyRound className="h-4 w-4" /> Vault Keys
          </Link>
        </div>
      </div>

      {/* Provider summary cards with live telemetry */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(providers ?? []).map((p) => {
          const keyInfo = keysByProvider[p.providerId];
          const isHealthy = p.health === 'healthy';
          const isSyncing = syncingProvider === p.providerId;

            const errorCount = (p.activeErrorsCount ?? 0) || (p.errorsCount ?? 0) || (!isHealthy ? 1 : 0);
            const hasError = !isHealthy || errorCount > 0;

            return (
              <div
                key={p.id}
                className={`relative overflow-hidden rounded-2xl border p-5 backdrop-blur-xl transition ${
                  hasError
                    ? 'border-rose-500/30 bg-gradient-to-b from-rose-950/20 to-black/40 hover:border-rose-500/50'
                    : 'border-white/10 bg-gradient-to-b from-white/[0.05] to-black/40 hover:border-nexus-500/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-base font-bold text-white">{p.displayName || p.providerId}</div>
                    <div className="text-xs text-white/40 font-mono">{p.baseUrl}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                      isHealthy
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${isHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                      {p.circuitBreakerState === 'open' ? 'CIRCUIT OPEN' : p.status ?? p.health}
                    </span>
                  </div>
                </div>

                {hasError && (
                  <div className="mt-3 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/10 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
                      <span className="text-xs font-semibold text-rose-200">
                        {p.lastError ? p.lastError.slice(0, 45) : 'Provider Error Detected'}
                      </span>
                    </div>
                    <ErrorResolveButton
                      target={{ type: 'provider', id: p.providerId, displayName: p.displayName }}
                      errorCount={errorCount}
                      diagnostic={p.lastErrorDiagnostic}
                      size="xs"
                      variant="badge"
                    />
                  </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
                    <div className="text-white/40 text-[10px] font-medium uppercase">Models</div>
                    <div className="text-sm font-bold text-nexus-300 mt-0.5">{p.modelsCount ?? 0} discovered</div>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
                    <div className="text-white/40 text-[10px] font-medium uppercase">Active Keys</div>
                    <div className="text-sm font-bold text-emerald-400 mt-0.5">{keyInfo ? `${keyInfo.active}/${keyInfo.total}` : '0 keys'}</div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSync(p.providerId)}
                      disabled={isSyncing}
                      className="flex items-center gap-1 text-[11px] rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin text-nexus-400' : ''}`} />
                      {isSyncing ? 'Syncing...' : 'Sync Models'}
                    </button>
                    <ErrorResolveButton
                      target={{ type: 'provider', id: p.providerId, displayName: p.displayName }}
                      errorCount={errorCount}
                      diagnostic={p.lastErrorDiagnostic}
                      size="xs"
                      variant="icon"
                    />
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="flex items-center gap-1 text-[11px] rounded-lg border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  <Link
                    href={`/models?provider=${p.providerId}`}
                    className="text-xs text-nexus-400 font-medium hover:underline"
                  >
                    View Models &rarr;
                  </Link>
                </div>
              </div>
            );
          })}
        {(providers ?? []).length === 0 && !isLoading && (
          <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-xs text-white/40 col-span-full">
            No providers registered on gateway. Click &ldquo;Add Provider&rdquo; to connect your first provider.
          </div>
        )}
      </div>

      {/* Add Provider Onboarding Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
          <div className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-neutral-950 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Plus className="h-5 w-5 text-nexus-400" /> Onboard AI Provider
                </h3>
                <p className="text-xs text-white/50 mt-0.5">
                  Connect any OpenAI-compatible provider. Nexus auto-discovers models and registers routing.
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-white/40 hover:text-white text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">Provider ID (slug)</label>
                <input
                  type="text"
                  placeholder="e.g. groq, together, deepseek, fireworks, custom"
                  value={newProviderId}
                  onChange={(e) => setNewProviderId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-nexus-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Groq Cloud Inference"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-nexus-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">Base URL (OpenAI compatible)</label>
                <input
                  type="text"
                  placeholder="e.g. https://api.groq.com/openai/v1"
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-nexus-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">API Key (stored in encrypted vault)</label>
                <input
                  type="password"
                  placeholder="gsk_... or sk-..."
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-nexus-500"
                />
              </div>

              {/* Step-by-step probe test results */}
              {probeResult && (
                <div className={`rounded-xl border p-4 text-xs space-y-2 ${
                  probeResult.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                }`}>
                  <div className="font-semibold flex items-center gap-1.5">
                    {probeResult.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}
                    {probeResult.ok ? 'Connection Test Passed!' : `Probe Failed at step: ${probeResult.step}`}
                  </div>
                  {probeResult.error && <p className="text-rose-400 font-mono text-[11px]">{probeResult.error}</p>}
                  {probeResult.steps && (
                    <div className="grid grid-cols-2 gap-1 text-[11px] text-white/70 pt-1">
                      <div>✓ Gateway reachable: <span className="text-emerald-400 font-semibold">Yes</span></div>
                      <div>✓ Auth successful: <span className={probeResult.steps.authenticationSuccessful ? 'text-emerald-400 font-semibold' : 'text-rose-400'}>{probeResult.steps.authenticationSuccessful ? 'Yes' : 'No'}</span></div>
                      <div>✓ /v1/models reachable: <span className={probeResult.steps.modelsEndpointReachable ? 'text-emerald-400 font-semibold' : 'text-rose-400'}>{probeResult.steps.modelsEndpointReachable ? 'Yes' : 'No'}</span></div>
                      <div>✓ Models found: <span className="text-nexus-300 font-semibold">{probeResult.steps.modelsDiscoveredCount}</span></div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={handleProbe}
                disabled={probing || !newBaseUrl}
                className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
              >
                {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 text-nexus-400" />}
                {probing ? 'Testing...' : 'Test Connection'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl px-4 py-2 text-xs text-white/60 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleOnboard}
                  disabled={onboarding || !newProviderId || !newBaseUrl}
                  className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-nexus-600 px-5 py-2 text-xs font-semibold text-white shadow-lg transition hover:scale-[1.02] disabled:opacity-50"
                >
                  {onboarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {onboarding ? 'Onboarding...' : 'Complete Onboarding'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detailed provider table */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-6 backdrop-blur-xl">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" /> Endpoint Health & Capability Matrix
        </h2>
        {isLoading ? <div className="py-8 text-center text-xs text-white/40">Querying provider mesh...</div> : <ProviderTable providers={providers ?? []} />}
      </div>

      {/* Live endpoint manager */}
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


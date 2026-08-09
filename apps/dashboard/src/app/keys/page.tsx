'use client';

import { KeyRound, Plus, Trash2, Zap, AlertCircle, CheckCircle2, Clock, RefreshCw, TestTube } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * The 17 provider IDs built into the gateway (see packages/providers/src/index.ts).
 * These are always available in the dropdown so keys can be registered for a
 * provider before any endpoint is configured — endpoints can be added later.
 */
const KNOWN_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'deepseek',
  'mistral',
  'xai',
  'groq',
  'together',
  'fireworks',
  'cerebras',
  'cloudflare',
  'nvidia-nim',
  'opencode-zen',
  'opencode-go',
  'ollama',
  'vllm',
  'lmstudio',
  'litellm',
  'azure-openai',
] as const;

interface ApiKey {
  id: string;
  providerId: string;
  label?: string;
  lastFour: string;
  status: 'active' | 'cooldown' | 'exhausted' | 'invalid';
  requests: number;
  tokens: number;
  errors: number;
  rateLimitedCount: number;
  latencyMs: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  cooldownUntil: number | null;
  registeredAt: number;
}

interface Provider {
  id: string;
  providerId: string;
  displayName: string;
  health: string;
  capabilities: {
    embeddings?: boolean;
    vision?: boolean;
    toolCalling?: boolean;
    streaming?: boolean;
  };
}

interface TestResult {
  ok: boolean;
  latencyMs?: number;
  model?: string;
  error?: string;
  status?: number;
}

export default function KeysPage() {
  const { data: keys, mutate: refreshKeys } = useSWR<ApiKey[]>('/api/v1/keys', fetcher, { refreshInterval: 5000 });
  const { data: providers } = useSWR<Provider[]>('/api/v1/providers', fetcher, { refreshInterval: 10000 });
  const { data: metrics } = useSWR<{ keys: { total: number; active: number; cooldown: number; invalid: number; errorRate: number; rateLimitRate: number } }>('/api/v1/metrics', fetcher, { refreshInterval: 5000 });

  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState({ providerId: '', plaintext: '', label: '' });
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);

  // Group keys by provider
  const keysByProvider = (keys ?? []).reduce<Record<string, ApiKey[]>>((acc, k) => {
    if (!acc[k.providerId]) acc[k.providerId] = [];
    acc[k.providerId]!.push(k);
    return acc;
  }, {});

  // Known provider IDs from the providers list
  const providerIds = (providers ?? []).map((p) => p.providerId);
  // Also include providers that have keys but aren't in the endpoints list
  const allProviderIds = Array.from(new Set([...providerIds, ...Object.keys(keysByProvider)]));

  async function addKey() {
    if (!newKey.providerId || !newKey.plaintext) {
      setAddMsg('Provider and API key are required');
      return;
    }
    setAddMsg('Adding...');
    try {
      const r = await fetch('/api/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: newKey.providerId,
          plaintext: newKey.plaintext,
          label: newKey.label || undefined,
        }),
      });
      if (r.ok) {
        const body = await r.json();
        setAddMsg(`Added key ${body.lastFour} for ${body.providerId}`);
        setNewKey({ providerId: '', plaintext: '', label: '' });
        setShowAdd(false);
        await refreshKeys();
      } else {
        const body = await r.json().catch(() => ({ error: { message: 'Failed' } }));
        setAddMsg(`Error: ${body?.error?.message ?? r.statusText}`);
      }
    } catch (err) {
      setAddMsg(`Error: ${(err as Error).message}`);
    }
  }

  async function deleteKey(id: string) {
    if (!confirm(`Delete key ${id}?`)) return;
    await fetch(`/api/v1/keys/${id}`, { method: 'DELETE' });
    await refreshKeys();
  }

  async function resetKey(id: string) {
    await fetch(`/api/v1/keys/${id}/reset`, { method: 'POST' });
    await refreshKeys();
  }

  async function testKey(id: string) {
    setTesting(id);
    setTestResults((prev) => ({ ...prev, [id]: { ok: false } }));
    try {
      const r = await fetch(`/api/v1/keys/${id}/test`, { method: 'POST' });
      const body = await r.json();
      setTestResults((prev) => ({ ...prev, [id]: body }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, error: (err as Error).message } }));
    } finally {
      setTesting(null);
    }
  }

  const statusColors: Record<string, string> = {
    active: 'pill pill-healthy',
    cooldown: 'pill pill-degraded',
    exhausted: 'pill pill-degraded',
    invalid: 'pill pill-unhealthy',
  };

  const statusIcons: Record<string, typeof CheckCircle2> = {
    active: CheckCircle2,
    cooldown: Clock,
    exhausted: AlertCircle,
    invalid: AlertCircle,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <KeyRound className="h-6 w-6 text-nexus-400" />
          API Keys
        </h1>
        <p className="text-sm text-white/50">
          Manage multiple API keys per provider. Keys rotate automatically using adaptive strategy —
          429 rate limits trigger cooldown, 401 invalidates the key, 5xx fails over to the next endpoint.
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <KeyRound className="h-4 w-4 text-nexus-400" />
            <span className="text-sm font-medium">Total Keys</span>
          </div>
          <div className="stat-value mt-2">{metrics?.keys?.total ?? 0}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-medium">Active</span>
          </div>
          <div className="stat-value mt-2 text-emerald-300">{metrics?.keys?.active ?? 0}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <Clock className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-medium">Cooldown</span>
          </div>
          <div className="stat-value mt-2 text-amber-300">{metrics?.keys?.cooldown ?? 0}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <AlertCircle className="h-4 w-4 text-rose-400" />
            <span className="text-sm font-medium">Invalid</span>
          </div>
          <div className="stat-value mt-2 text-rose-300">{metrics?.keys?.invalid ?? 0}</div>
        </div>
      </div>

      {/* Add key button */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowAdd((prev) => !prev)}
          className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-nexus-500"
        >
          <Plus className="mr-1 inline h-4 w-4" />
          {showAdd ? 'Close Form' : 'Add API Key'}
        </button>
        {addMsg && <span className="text-xs text-white/60">{addMsg}</span>}
      </div>

      {/* Add key form */}
      {showAdd && (
        <div className="card border-nexus-500/30">
          <h2 className="mb-3 text-sm font-medium text-white/80">Register New API Key</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-xs text-white/50">
              Provider
              <select
                value={newKey.providerId}
                onChange={(e) => setNewKey({ ...newKey, providerId: e.target.value })}
                className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
              >
                <option value="">Select provider...</option>
                {/* Always show the 17 built-in provider IDs, even before any
                     endpoint is registered on the gateway. */}
                {KNOWN_PROVIDER_IDS.map((pid) => (
                  <option key={pid} value={pid}>{pid}</option>
                ))}
                {/* Also surface any provider IDs the gateway already knows
                     about (from endpoints or previously-registered keys) that
                     aren't in the hardcoded list above (e.g. custom providers). */}
                {allProviderIds
                  .filter((pid) => !(KNOWN_PROVIDER_IDS as readonly string[]).includes(pid))
                  .map((pid) => (
                    <option key={pid} value={pid}>{pid}</option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-white/50">
              API Key (plaintext — stored encrypted in vault)
              <input
                type="password"
                value={newKey.plaintext}
                onChange={(e) => setNewKey({ ...newKey, plaintext: e.target.value })}
                placeholder="sk-..."
                className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-white/50">
              Label (optional)
              <input
                type="text"
                value={newKey.label}
                onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                placeholder="Work account"
                className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={addKey}
              className="rounded-lg bg-nexus-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-nexus-500"
            >
              Register Key
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="rounded-lg bg-white/5 px-4 py-2 text-sm text-white/60 transition hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Keys grouped by provider */}
      {allProviderIds.length === 0 && (
        <div className="card py-8 text-center text-sm text-white/40">
          No providers configured. Set environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
          or add a custom provider endpoint via the config file to get started.
        </div>
      )}

      {allProviderIds.map((pid) => {
        const providerKeys = keysByProvider[pid] ?? [];
        const provider = providers?.find((p) => p.providerId === pid);
        const activeCount = providerKeys.filter((k) => k.status === 'active').length;
        const cooldownCount = providerKeys.filter((k) => k.status === 'cooldown').length;
        const invalidCount = providerKeys.filter((k) => k.status === 'invalid').length;

        return (
          <div key={pid} className="card">
            {/* Provider header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium text-white/80">{pid}</h2>
                {provider && (
                  <span className={`pill ${provider.health === 'healthy' ? 'pill-healthy' : 'pill-degraded'}`}>
                    {provider.health}
                  </span>
                )}
                <span className="text-xs text-white/40">
                  {providerKeys.length} key{providerKeys.length !== 1 ? 's' : ''}
                  {activeCount > 0 && ` · ${activeCount} active`}
                  {cooldownCount > 0 && ` · ${cooldownCount} cooldown`}
                  {invalidCount > 0 && ` · ${invalidCount} invalid`}
                </span>
              </div>
              <button
                onClick={() => {
                  setNewKey({ ...newKey, providerId: pid });
                  setShowAdd(true);
                }}
                className="rounded-md bg-white/5 px-2 py-1 text-xs text-white/60 transition hover:bg-white/10"
              >
                <Plus className="mr-1 inline h-3 w-3" />Add key
              </button>
            </div>

            {/* Keys table */}
            {providerKeys.length === 0 ? (
              <div className="py-4 text-center text-xs text-white/40">
                No API keys registered for {pid}. Add one to enable intelligent key rotation.
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-white/40">
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Key</th>
                      <th className="px-3 py-2 font-medium">Label</th>
                      <th className="px-3 py-2 font-medium">Requests</th>
                      <th className="px-3 py-2 font-medium">Tokens</th>
                      <th className="px-3 py-2 font-medium">Errors</th>
                      <th className="px-3 py-2 font-medium">429s</th>
                      <th className="px-3 py-2 font-medium">Latency</th>
                      <th className="px-3 py-2 font-medium">Last Success</th>
                      <th className="px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providerKeys.map((k) => {
                      const StatusIcon = statusIcons[k.status] ?? AlertCircle;
                      const testResult = testResults[k.id];
                      return (
                        <tr key={k.id} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 ${statusColors[k.status] ?? 'pill pill-degraded'}`}>
                              <StatusIcon className="h-3 w-3" />
                              {k.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-white/60">
                            ••••{k.lastFour}
                          </td>
                          <td className="px-3 py-2 text-white/40">{k.label ?? '—'}</td>
                          <td className="px-3 py-2 text-white/60">{k.requests}</td>
                          <td className="px-3 py-2 text-white/60">{k.tokens.toLocaleString()}</td>
                          <td className="px-3 py-2 text-white/60">
                            {k.errors > 0 ? <span className="text-rose-400">{k.errors}</span> : '0'}
                          </td>
                          <td className="px-3 py-2 text-white/60">
                            {k.rateLimitedCount > 0 ? <span className="text-amber-400">{k.rateLimitedCount}</span> : '0'}
                          </td>
                          <td className="px-3 py-2 text-white/60">
                            {k.latencyMs > 0 ? `${k.latencyMs}ms` : '—'}
                          </td>
                          <td className="px-3 py-2 text-white/40">
                            {k.lastSuccessAt ? new Date(k.lastSuccessAt).toLocaleTimeString() : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => testKey(k.id)}
                                disabled={testing === k.id}
                                title="Test key"
                                className="rounded p-1 text-white/40 transition hover:bg-white/5 hover:text-nexus-400 disabled:opacity-30"
                              >
                                {testing === k.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
                              </button>
                              <button
                                onClick={() => resetKey(k.id)}
                                disabled={k.status === 'active'}
                                title="Reset cooldown"
                                className="rounded p-1 text-white/40 transition hover:bg-white/5 hover:text-amber-400 disabled:opacity-30"
                              >
                                <Zap className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => deleteKey(k.id)}
                                title="Delete key"
                                className="rounded p-1 text-white/40 transition hover:bg-white/5 hover:text-rose-400"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                            {testResult && (
                              <div className={`mt-1 text-[10px] ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {testResult.ok
                                  ? `OK · ${testResult.latencyMs}ms · ${testResult.model}`
                                  : `FAIL · ${testResult.error ?? 'unknown'}`}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

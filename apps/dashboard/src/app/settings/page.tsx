'use client';

import { Activity, Database, Zap, Shield, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

interface PrivacyConfig {
  level: 'off' | 'redacted' | 'strict';
  maxContentChars: number;
  skipCachePersistence?: boolean;
}

export default function SettingsPage() {
  const { data: cacheStats } = useSWR<CacheStats>('/api/v1/cache/stats', fetcher, { refreshInterval: 3000 });
  const { data: privacy, mutate: refreshPrivacy } = useSWR<PrivacyConfig>('/api/v1/privacy', fetcher);
  const { data: gwConfig } = useSWR<{
    server: { host: string; port: number };
    routing: { strategy: string };
    vault: { path: string | null; persisted: boolean; masterKeySet: boolean; note: string };
  }>('/api/v1/config', fetcher, { refreshInterval: 15_000 });
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [modelMsg, setModelMsg] = useState<string | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  async function setPrivacyLevel(level: 'off' | 'redacted' | 'strict') {
    await fetch('/api/v1/privacy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level }),
    });
    await refreshPrivacy();
  }

  async function triggerModelRefresh() {
    setRefreshingModels(true);
    setModelMsg('Triggered dynamic model refresh across all provider endpoints…');
    try {
      await fetch('/api/v1/models/refresh', { method: 'POST' });
    } catch {
      setModelMsg('Refresh triggered');
    } finally {
      setTimeout(() => {
        setRefreshingModels(false);
      }, 2000);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings & Privacy</h1>
        <p className="text-sm text-white/50">Gateway configuration, runtime privacy modes, and observability stats.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <Database className="h-4 w-4 text-nexus-400" />
            <span className="text-sm font-medium">Cache size</span>
          </div>
          <div className="stat-value mt-2">{cacheStats?.size ?? '—'}</div>
          <div className="text-xs text-white/40">entries in cache</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <Activity className="h-4 w-4 text-nexus-400" />
            <span className="text-sm font-medium">Hit rate</span>
          </div>
          <div className="stat-value mt-2">{cacheStats ? `${(cacheStats.hitRate * 100).toFixed(1)}%` : '—'}</div>
          <div className="text-xs text-white/40">{cacheStats ? `${cacheStats.hits} hits / ${cacheStats.misses} misses` : 'no data'}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <Zap className="h-4 w-4 text-nexus-400" />
            <span className="text-sm font-medium">Model Refresh</span>
          </div>
          <button
            onClick={triggerModelRefresh}
            disabled={refreshingModels}
            className="mt-3 flex items-center gap-2 rounded-md bg-nexus-600 px-3 py-1.5 text-xs text-white transition hover:bg-nexus-500 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshingModels ? 'animate-spin' : ''}`} />
            Refresh Provider Models
          </button>
          {modelMsg && <div className="mt-1.5 text-[11px] text-white/50">{modelMsg}</div>}
        </div>
      </div>

      {/* Dynamic Privacy Mode Card */}
      <div className="card">
        <div className="flex items-center gap-2 text-white/90 font-medium">
          <Shield className="h-5 w-5 text-nexus-400" />
          Runtime Privacy & Redaction Mode
        </div>
        <p className="mt-1 text-xs text-white/50">
          Controls how prompt text and key headers are logged in traces and persistent cache.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(['off', 'redacted', 'strict'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setPrivacyLevel(lvl)}
              className={`rounded-lg border p-3 text-left transition ${
                privacy?.level === lvl
                  ? 'border-nexus-500 bg-nexus-950/20 text-white'
                  : 'border-white/5 bg-white/[0.02] text-white/60 hover:bg-white/[0.04]'
              }`}
            >
              <div className="font-semibold text-xs capitalize flex items-center justify-between">
                <span>{lvl} Mode</span>
                {privacy?.level === lvl && <span className="h-2 w-2 rounded-full bg-nexus-400 inline-block" />}
              </div>
              <div className="mt-1 text-[11px] text-white/40">
                {lvl === 'off' && 'Full request/response context logged for debugging.'}
                {lvl === 'redacted' && 'Redacts API keys, auth headers, and sensitive fields.'}
                {lvl === 'strict' && 'Zero persistence of request/response payloads in logs or disk cache.'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Config & Vault status (read-only) */}
      <div className="card">
        <div className="flex items-center gap-2 text-white/90 font-medium">
          <Shield className="h-5 w-5 text-nexus-400" /> Gateway Config &amp; Vault
        </div>
        <p className="mt-1 text-xs text-white/50">
          Live runtime configuration (no secrets). Shows how the gateway is bound and whether credentials persist across restarts.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div className="text-[11px] uppercase tracking-wider text-white/40">Bind</div>
            <div className="mt-1 font-mono text-xs text-white/80">
              {gwConfig?.server.host ?? '—'}:{gwConfig?.server.port ?? '—'}
            </div>
            <div className="text-[10px] text-white/40">
              {gwConfig?.server.host === '127.0.0.1' || gwConfig?.server.host === 'localhost'
                ? 'Loopback only — not reachable from other machines.'
                : 'Exposed on the network.'}
            </div>
          </div>
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div className="text-[11px] uppercase tracking-wider text-white/40">Routing strategy</div>
            <div className="mt-1 font-mono text-xs text-white/80">{gwConfig?.routing.strategy ?? '—'}</div>
          </div>
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 sm:col-span-2">
            <div className="text-[11px] uppercase tracking-wider text-white/40">Credential vault</div>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${gwConfig?.vault.persisted ? 'bg-emerald-400' : 'bg-amber-400'}`}
              />
              <span className="text-xs text-white/80">
                {gwConfig?.vault.persisted ? 'Persisted (encrypted at rest)' : 'Ephemeral (lost on restart)'}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-white/40">
              {gwConfig?.vault.path ? `Path: ${gwConfig.vault.path}` : 'No vault path configured.'}
            </div>
            <div className="mt-1 text-[10px] text-white/50">{gwConfig?.vault.note ?? ''}</div>
          </div>
        </div>
      </div>

      {/* Updater */}
      <div className="card">
        <div className="flex items-center gap-2 text-white/90 font-medium">
          <RefreshCw className="h-5 w-5 text-nexus-400" /> Updater
        </div>
        <p className="mt-1 text-xs text-white/50">
          Check for and apply the latest Nexus revision (git pull + install + build + restart). The check is read-only; applying restarts the gateway.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={async () => {
              setUpdateChecking(true);
              setUpdateMsg('Checking for updates…');
              try {
                const r = await fetch('/api/v1/system/update/check');
                const d = await r.json();
                if (d?.updateAvailable) {
                  setUpdateMsg(`Update available: v${d.localVersion} → v${d.remoteVersion}`);
                } else if (d?.ok === false) {
                  setUpdateMsg(`Check failed: ${d.error ?? 'unknown'}`);
                } else {
                  setUpdateMsg(`Up to date (v${d?.localVersion ?? '?'})`);
                }
              } catch (e: any) {
                setUpdateMsg(`Check failed: ${e?.message ?? e}`);
              } finally {
                setUpdateChecking(false);
              }
            }}
            disabled={updateChecking}
            className="rounded-md bg-nexus-600 px-3 py-1.5 text-xs text-white transition hover:bg-nexus-500 disabled:opacity-50"
          >
            <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${updateChecking ? 'animate-spin' : ''}`} />
            Check for updates
          </button>
          <button
            onClick={async () => {
              if (!confirm('Apply update? The gateway will restart.')) return;
              setUpdateMsg('Update started — gateway will restart in ~90s. Watch the log for progress.');
              try {
                await fetch('/api/v1/system/update', { method: 'POST' });
              } catch (e: any) {
                setUpdateMsg(`Update failed to start: ${e?.message ?? e}`);
              }
            }}
            className="rounded-md border border-nexus-500/40 bg-nexus-500/10 px-3 py-1.5 text-xs text-nexus-200 transition hover:bg-nexus-500/20"
          >
            Update now
          </button>
          {updateMsg && <span className="text-[11px] text-white/50">{updateMsg}</span>}
        </div>
      </div>

      <div className="card">
        <div className="text-sm text-white/60">
          For production deployments, set the following environment variables before starting the gateway:
          <ul className="mt-3 space-y-1 text-xs text-white/40">
            <li><code className="rounded bg-white/5 px-1">AGENT_NEXUS_VAULT_KEY</code> — required when <code className="rounded bg-white/5 px-1">security.vaultPath</code> is set (persistent encrypted credentials)</li>
            <li><code className="rounded bg-white/5 px-1">ANX_ADMIN_API_KEY</code> — bootstraps an admin principal with full access</li>
            <li><code className="rounded bg-white/5 px-1">OPENAI_API_KEY</code>, <code className="rounded bg-white/5 px-1">ANTHROPIC_API_KEY</code>, etc. — auto-registers providers from env when no endpoints are configured</li>
            <li><code className="rounded bg-white/5 px-1">NEXUS_BASE_URL</code>, <code className="rounded bg-white/5 px-1">NEXUS_API_KEY</code> — used by the CLI (<code className="rounded bg-white/5 px-1">anx</code>) to talk to the gateway</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

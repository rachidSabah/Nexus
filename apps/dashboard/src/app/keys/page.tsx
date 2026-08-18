'use client';

import {
  KeyRound,
  Plus,
  Trash2,
  Zap,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  TestTube,
  Search,
  SlidersHorizontal,
  Sparkles,
  Lock,
  Stethoscope,
  Download,
  Upload,
  Shield,
  X,
} from 'lucide-react';
import { useState, useMemo, useRef } from 'react';
import useSWR from 'swr';

import { etagFetcher } from '@/lib/etagFetcher';

const fetcher = etagFetcher;

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
  tokens: number | null;
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
  const [addMsg, setAddMsg] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cooldown' | 'invalid'>('all');

  const [backupModal, setBackupModal] = useState<'export' | 'import' | null>(null);
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [vaultMsg, setVaultMsg] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Group keys by provider
  const keysByProvider = useMemo(() => {
    return (keys ?? []).reduce<Record<string, ApiKey[]>>((acc, k) => {
      if (!acc[k.providerId]) acc[k.providerId] = [];
      acc[k.providerId]!.push(k);
      return acc;
    }, {});
  }, [keys]);

  const providerIds = (providers ?? []).map((p) => p.providerId);
  const allProviderIds = Array.from(new Set([...KNOWN_PROVIDER_IDS, ...providerIds, ...Object.keys(keysByProvider)]));

  // Only show provider IDs that have at least one key registered
  const providerIdsWithKeys = Array.from(new Set([...providerIds, ...Object.keys(keysByProvider)]));

  // Filtered list of provider IDs based on search & filter
  const filteredProviderIds = useMemo(() => {
    return providerIdsWithKeys.filter((pid) => {
      const pKeys = keysByProvider[pid] ?? [];
      if (pKeys.length === 0) return false;
      const matchesSearch = searchQuery === '' ||
        pid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pKeys.some((k) => (k.label ?? '').toLowerCase().includes(searchQuery.toLowerCase()) || k.lastFour.includes(searchQuery));
      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      return pKeys.some((k) => k.status === statusFilter);
    });
  }, [providerIdsWithKeys, keysByProvider, searchQuery, statusFilter]);

  async function addKey() {
    if (!newKey.providerId || !newKey.plaintext) {
      setAddMsg({ text: 'Provider and API Key payload are required for rotation vaulting', type: 'error' });
      return;
    }
    setAddMsg({ text: 'Encrypting and dispatching key to vault...', type: 'info' });
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
        setAddMsg({ text: `Key ••••${body.lastFour} successfully registered under ${body.providerId}`, type: 'success' });
        setNewKey({ providerId: '', plaintext: '', label: '' });
        setShowAdd(false);
        await refreshKeys();
      } else {
        const body = await r.json().catch(() => ({ error: { message: 'Vault Registration Failed' } }));
        setAddMsg({ text: `Error: ${body?.error?.message ?? r.statusText}`, type: 'error' });
      }
    } catch (err) {
      setAddMsg({ text: `Error: ${(err as Error).message}`, type: 'error' });
    }
  }

  async function deleteKey(id: string) {
    if (!confirm(`Confirm revocation of key ID [${id}]?`)) return;
    await fetch(`/api/v1/keys/${id}`, { method: 'DELETE' });
    await refreshKeys();
  }

  async function resetKey(id: string) {
    await fetch(`/api/v1/keys/${id}/reset`, { method: 'POST' });
    await refreshKeys();
  }

  async function healKey(id: string) {
    await fetch(`/api/v1/keys/${id}/heal`, { method: 'POST' });
    await refreshKeys();
  }

  async function resetAllCooldowns() {
    const cooldownKeys = (keys ?? []).filter((k) => k.status === 'cooldown' || k.status === 'exhausted');
    if (cooldownKeys.length === 0) return;
    await Promise.all(cooldownKeys.map((k) => fetch(`/api/v1/keys/${k.id}/reset`, { method: 'POST' })));
    await refreshKeys();
  }

  async function testKey(id: string) {
    setTesting(id);
    setTestResults((prev) => ({ ...prev, [id]: { ok: false } }));
    try {
      const r = await fetch(`/api/v1/keys/${id}/test`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok || (body && typeof body === 'object' && 'error' in body && !('ok' in body))) {
        const errVal = (body as { error?: unknown })?.error;
        let msg = 'Ping Failed';
        if (typeof errVal === 'string') {
          msg = errVal;
        } else if (typeof errVal === 'object' && errVal !== null) {
          const errObj = errVal as { message?: unknown };
          msg = typeof errObj.message === 'string' ? errObj.message : JSON.stringify(errObj);
        } else {
          msg = `HTTP ${r.status}`;
        }
        setTestResults((prev) => ({ ...prev, [id]: { ok: false, error: msg } }));
        return;
      }
      if (body && typeof body === 'object' && body.ok === false) {
        const errVal = body.error;
        const msg = typeof errVal === 'string' ? errVal : typeof errVal === 'object' && errVal !== null ? (errVal.message ?? JSON.stringify(errVal)) : 'Provider endpoint rejected verification';
        setTestResults((prev) => ({ ...prev, [id]: { ok: false, error: String(msg) } }));
        return;
      }
      setTestResults((prev) => ({ ...prev, [id]: body }));
    } catch (err) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, error: (err as Error).message } }));
    } finally {
      setTesting(null);
    }
  }

  async function handleExportVault() {
    setExporting(true);
    setVaultMsg({ text: 'Encrypting vault credentials with AES-256-GCM...', type: 'info' });
    try {
      const res = await fetch('/api/v1/vault/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: vaultPassphrase || 'nexus-default-vault-backup' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setVaultMsg({ text: `Export failed: ${body.error?.message ?? res.statusText}`, type: 'error' });
        return;
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data.bundle, null, 2)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `.anx-vault-${new Date().toISOString().slice(0, 10)}.enc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setVaultMsg({ text: `Successfully exported ${data.bundle?.keyCount ?? 0} keys into encrypted bundle!`, type: 'success' });
    } catch (err) {
      setVaultMsg({ text: `Export error: ${(err as Error).message}`, type: 'error' });
    } finally {
      setExporting(false);
    }
  }

  async function handleImportVaultFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setVaultMsg({ text: 'Reading and decrypting encrypted backup bundle...', type: 'info' });
    try {
      const text = await file.text();
      let bundle;
      try {
        bundle = JSON.parse(text);
      } catch {
        setVaultMsg({ text: 'Invalid JSON format in backup file', type: 'error' });
        return;
      }
      const res = await fetch('/api/v1/vault/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle, passphrase: vaultPassphrase || 'nexus-default-vault-backup' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setVaultMsg({ text: `Import failed: ${body.error?.message ?? res.statusText}`, type: 'error' });
        return;
      }
      const data = await res.json();
      setVaultMsg({ text: `Successfully restored ${data.imported} new keys from bundle (${data.totalInBundle} total)!`, type: 'success' });
      await refreshKeys();
    } catch (err) {
      setVaultMsg({ text: `Import error: ${(err as Error).message}`, type: 'error' });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const statusColors: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]',
    cooldown: 'bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.15)]',
    exhausted: 'bg-orange-500/10 text-orange-400 border border-orange-500/30',
    invalid: 'bg-rose-500/10 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.15)]',
  };

  const statusIcons: Record<string, typeof CheckCircle2> = {
    active: CheckCircle2,
    cooldown: Clock,
    exhausted: AlertCircle,
    invalid: AlertCircle,
  };

  return (
    <div className="space-y-8 relative pb-12">
      {/* Background Cybernetic Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Adaptive Key Matrix & Rotation Engine
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <KeyRound className="h-8 w-8 text-nexus-400" />
            API Key Vault & Rotation Setup
          </h1>
          <p className="mt-1 text-sm text-white/60 max-w-2xl">
            Buckle unlimited provider keys to your gateway. When coding agents hit 429 rate limits or 5xx failures,
            the gateway rotates instantly to active reserve keys in real time.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setBackupModal('export');
              setVaultMsg(null);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-nexus-500/40 bg-nexus-500/10 px-3.5 py-2.5 text-xs font-semibold text-nexus-300 shadow-md transition hover:scale-[1.02] hover:bg-nexus-500/20 active:scale-95"
            title="Export encrypted vault backup bundle (.anx-vault.enc)"
          >
            <Download className="h-4 w-4" /> Export Vault (.enc)
          </button>
          <button
            onClick={() => {
              setBackupModal('import');
              setVaultMsg(null);
            }}
            className="flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-2.5 text-xs font-semibold text-cyan-300 shadow-md transition hover:scale-[1.02] hover:bg-cyan-500/20 active:scale-95"
            title="Restore encrypted vault backup bundle"
          >
            <Upload className="h-4 w-4" /> Restore Vault
          </button>
          {(keys ?? []).some((k) => k.status === 'cooldown' || k.status === 'exhausted') && (
            <button
              onClick={resetAllCooldowns}
              className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs font-semibold text-amber-300 shadow-md transition hover:scale-[1.02] hover:bg-amber-500/20 active:scale-95"
              title="Reset all keys stuck in cooldown/exhausted state back to active"
            >
              <Zap className="h-4 w-4" /> Reset Cooldowns
            </button>
          )}
          <button
            onClick={() => setShowAdd((prev) => !prev)}
            className="relative group overflow-hidden rounded-xl bg-gradient-to-r from-nexus-600 to-cyan-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-all duration-300 hover:scale-[1.02] hover:shadow-nexus-500/25 active:scale-95"
          >
            <span className="relative z-10 flex items-center gap-1.5">
              <Plus className={`h-4 w-4 transition-transform duration-300 ${showAdd ? 'rotate-45' : ''}`} />
              {showAdd ? 'Close Vault' : 'Register Key'}
            </span>
            <div className="absolute inset-0 bg-white/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          </button>
        </div>
      </div>

      {/* Encrypted Vault Backup / Restore Modal */}
      {backupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-slate-950 p-6 shadow-2xl">
            <button
              onClick={() => setBackupModal(null)}
              className="absolute right-4 top-4 text-white/40 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="rounded-xl bg-nexus-500/10 p-2.5 text-nexus-400 border border-nexus-500/20">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">
                  {backupModal === 'export' ? 'Export Encrypted Key Vault' : 'Restore Key Vault from Backup'}
                </h2>
                <p className="text-xs text-white/50">
                  Secured with AES-256-GCM encryption & PBKDF2 passphrase derivation
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-white/60 mb-1.5">
                  Master Passphrase (Optional)
                </label>
                <input
                  type="password"
                  value={vaultPassphrase}
                  onChange={(e) => setVaultPassphrase(e.target.value)}
                  placeholder="Leave empty for default gateway encryption passphrase"
                  className="w-full h-10 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-white/40">
                  If set, this exact passphrase will be required to decrypt and restore this backup bundle.
                </p>
              </div>

              {vaultMsg && (
                <div
                  className={`rounded-xl border p-3 text-xs ${
                    vaultMsg.type === 'success'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : vaultMsg.type === 'error'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                      : 'border-nexus-500/30 bg-nexus-500/10 text-nexus-300'
                  }`}
                >
                  {vaultMsg.text}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => setBackupModal(null)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white/70 hover:bg-white/10"
                >
                  Cancel
                </button>
                {backupModal === 'export' ? (
                  <button
                    disabled={exporting}
                    onClick={handleExportVault}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-nexus-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-nexus-500 disabled:opacity-50"
                  >
                    <Download className={`h-4 w-4 ${exporting ? 'animate-bounce' : ''}`} />
                    {exporting ? 'Exporting…' : 'Download .anx-vault.enc'}
                  </button>
                ) : (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImportVaultFile}
                      accept=".enc,.json"
                      className="hidden"
                    />
                    <button
                      disabled={importing}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-cyan-500 disabled:opacity-50"
                    >
                      <Upload className={`h-4 w-4 ${importing ? 'animate-spin' : ''}`} />
                      {importing ? 'Restoring…' : 'Select .anx-vault.enc File'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Futuristic Metric Cards Matrix */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-nexus-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/50">Total Key Vault</span>
            <div className="rounded-lg bg-nexus-500/10 p-2 text-nexus-400 border border-nexus-500/20">
              <KeyRound className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-white">{metrics?.keys?.total ?? 0}</div>
          <div className="mt-1 text-[11px] text-white/40">Registered across all providers</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-nexus-500 to-cyan-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-emerald-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">Active Rotation Keys</span>
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-emerald-300">{metrics?.keys?.active ?? 0}</div>
          <div className="mt-1 text-[11px] text-emerald-400/60">Healthy & ready for proxying</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-amber-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/80">Rate Limit Cooldown</span>
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400 border border-amber-500/20">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-amber-300">{metrics?.keys?.cooldown ?? 0}</div>
          <div className="mt-1 text-[11px] text-amber-400/60">Temporary 429 backoff timer</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-rose-500/20 bg-gradient-to-b from-rose-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-rose-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-400/80">Revoked / Invalid</span>
            <div className="rounded-lg bg-rose-500/10 p-2 text-rose-400 border border-rose-500/20">
              <AlertCircle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-rose-300">{metrics?.keys?.invalid ?? 0}</div>
          <div className="mt-1 text-[11px] text-rose-400/60">401 Auth error keys disabled</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-500" />
        </div>
      </div>

      {/* Cyber Registration Form */}
      {showAdd && (
        <div className="relative overflow-hidden rounded-2xl border border-nexus-500/40 bg-gradient-to-b from-nexus-950/40 to-black/80 p-6 backdrop-blur-2xl shadow-2xl transition-all duration-300 animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center justify-between border-b border-nexus-500/20 pb-4 mb-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-nexus-300 uppercase tracking-wider">
              <Lock className="h-4 w-4 text-nexus-400" /> Register API Key to Vault
            </div>
            <span className="text-xs text-white/40">AES-256 Vault Encryption Active</span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">Target Provider</label>
              <select
                value={newKey.providerId}
                onChange={(e) => setNewKey({ ...newKey, providerId: e.target.value })}
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white focus:border-nexus-500 focus:outline-none focus:ring-1 focus:ring-nexus-500"
              >
                <option value="" className="bg-slate-900 text-white">Select provider endpoint...</option>
                {KNOWN_PROVIDER_IDS.map((pid) => (
                  <option key={pid} value={pid} className="bg-slate-900 text-white">{pid}</option>
                ))}
                {allProviderIds
                  .filter((pid) => !(KNOWN_PROVIDER_IDS as readonly string[]).includes(pid))
                  .map((pid) => (
                    <option key={pid} value={pid} className="bg-slate-900 text-white">{pid}</option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">API Key Payload</label>
              <input
                type="password"
                value={newKey.plaintext}
                onChange={(e) => setNewKey({ ...newKey, plaintext: e.target.value })}
                placeholder="sk-..."
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white font-mono placeholder:text-white/20 focus:border-nexus-500 focus:outline-none focus:ring-1 focus:ring-nexus-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">Identifier Label (Optional)</label>
              <input
                type="text"
                value={newKey.label}
                onChange={(e) => setNewKey({ ...newKey, label: e.target.value })}
                placeholder="Production Tier 1"
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white placeholder:text-white/20 focus:border-nexus-500 focus:outline-none focus:ring-1 focus:ring-nexus-500"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-4">
            <div className="flex items-center gap-2">
              <button
                onClick={addKey}
                className="rounded-xl bg-nexus-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:bg-nexus-500 active:scale-95"
              >
                Register Key to Vault
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-medium text-white/70 transition hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
            {addMsg && (
              <span
                className={`text-xs px-3 py-1.5 rounded-lg border ${
                  addMsg.type === 'error'
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                    : addMsg.type === 'success'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-nexus-500/30 bg-nexus-500/10 text-nexus-300'
                }`}
              >
                {addMsg.text}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Cyber Search & Filter Toolbar */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center rounded-2xl border border-white/10 bg-white/[0.02] p-3 backdrop-blur-md">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search provider, label, or key mask (••••)..."
            className="h-9 w-full rounded-xl border border-white/5 bg-white/[0.03] pl-9 pr-4 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <SlidersHorizontal className="h-4 w-4 text-white/40" />
          <span className="text-white/40">Status:</span>
          {(['all', 'active', 'cooldown', 'invalid'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`rounded-lg px-3 py-1.5 capitalize transition ${
                statusFilter === filter
                  ? 'bg-nexus-600 text-white font-medium shadow-sm'
                  : 'bg-white/[0.03] text-white/60 hover:bg-white/[0.08]'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Providers & Keys Grid Matrix */}
      <div className="space-y-4">
        {filteredProviderIds.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-sm text-white/40">
            No keys or providers matching the current cyber filter.
          </div>
        ) : (
          filteredProviderIds.map((pid) => {
            const providerKeys = keysByProvider[pid] ?? [];
            const provider = providers?.find((p) => p.providerId === pid);
            const activeCount = providerKeys.filter((k) => k.status === 'active').length;
            const cooldownCount = providerKeys.filter((k) => k.status === 'cooldown').length;
            const invalidCount = providerKeys.filter((k) => k.status === 'invalid').length;

            return (
              <div
                key={pid}
                className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 backdrop-blur-xl transition hover:border-white/20"
              >
                {/* Cyber Provider Card Header */}
                <div className="flex flex-col justify-between gap-2 border-b border-white/5 bg-white/[0.02] px-5 py-4 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl border border-nexus-500/30 bg-nexus-500/10 px-2.5 py-1 text-xs font-mono font-bold text-nexus-300 uppercase">
                      {pid}
                    </div>
                    {provider && (
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                        provider.health === 'healthy'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${provider.health === 'healthy' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                        {provider.health}
                      </span>
                    )}
                    <div className="flex items-center gap-2 text-xs text-white/40">
                      <span>{providerKeys.length} key{providerKeys.length !== 1 ? 's' : ''}</span>
                      {activeCount > 0 && <span className="text-emerald-400 font-medium">· {activeCount} active</span>}
                      {cooldownCount > 0 && <span className="text-amber-400 font-medium">· {cooldownCount} cooldown</span>}
                      {invalidCount > 0 && <span className="text-rose-400 font-medium">· {invalidCount} invalid</span>}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setNewKey({ ...newKey, providerId: pid });
                      setShowAdd(true);
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10"
                  >
                    <Plus className="h-3.5 w-3.5 text-nexus-400" /> Add Key for {pid}
                  </button>
                </div>

                {/* Cyber Table Matrix */}
                {providerKeys.length === 0 ? (
                  <div className="px-5 py-6 text-center text-xs text-white/40">
                    No keys vaulted for <span className="font-mono text-white/60">{pid}</span>. Add keys above to enable non-stop automatic rotation.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/5 bg-black/20 text-white/40 uppercase tracking-wider font-semibold text-[10px]">
                          <th className="px-5 py-3">Status</th>
                          <th className="px-4 py-3">Masked Key</th>
                          <th className="px-4 py-3">Label</th>
                          <th className="px-4 py-3">Requests</th>
                          <th className="px-4 py-3">Tokens</th>
                          <th className="px-4 py-3">Errors</th>
                          <th className="px-4 py-3">429s</th>
                          <th className="px-4 py-3">Latency</th>
                          <th className="px-4 py-3">Last Active</th>
                          <th className="px-5 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.02]">
                        {providerKeys.map((k) => {
                          const StatusIcon = statusIcons[k.status] ?? AlertCircle;
                          const testResult = testResults[k.id];
                          return (
                            <tr key={k.id} className="group transition hover:bg-white/[0.02]">
                              <td className="px-5 py-3.5">
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${statusColors[k.status] ?? ''}`}>
                                  <StatusIcon className="h-3 w-3" />
                                  {k.status}
                                </span>
                              </td>
                              <td className="px-4 py-3.5 font-mono text-white/80 font-semibold">
                                ••••{k.lastFour}
                              </td>
                              <td className="px-4 py-3.5 text-white/60">{k.label ?? '—'}</td>
                              <td className="px-4 py-3.5 font-mono text-white/70">{k.requests}</td>
                              <td className="px-4 py-3.5 font-mono text-white/70">{k.tokens != null ? k.tokens.toLocaleString() : '0'}</td>
                              <td className="px-4 py-3.5 font-mono">
                                {k.errors > 0 ? <span className="text-rose-400 font-bold">{k.errors}</span> : <span className="text-white/40">0</span>}
                              </td>
                              <td className="px-4 py-3.5 font-mono">
                                {k.rateLimitedCount > 0 ? <span className="text-amber-400 font-bold">{k.rateLimitedCount}</span> : <span className="text-white/40">0</span>}
                              </td>
                              <td className="px-4 py-3.5 font-mono text-white/70">
                                {k.latencyMs > 0 ? `${k.latencyMs}ms` : '—'}
                              </td>
                              <td className="px-4 py-3.5 text-white/40">
                                {k.lastSuccessAt ? new Date(k.lastSuccessAt).toLocaleTimeString() : '—'}
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => testKey(k.id)}
                                    disabled={testing === k.id}
                                    title="Verify Key Endpoint Health"
                                    className="rounded-lg border border-white/5 bg-white/5 p-1.5 text-white/60 transition hover:border-nexus-500/40 hover:bg-nexus-500/10 hover:text-nexus-300 disabled:opacity-30"
                                  >
                                    {testing === k.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-nexus-400" /> : <TestTube className="h-3.5 w-3.5" />}
                                  </button>
                                  <button
                                    onClick={() => resetKey(k.id)}
                                    disabled={k.status === 'active'}
                                    title="Reset Cooldown / Status Backoff"
                                    className="rounded-lg border border-white/5 bg-white/5 p-1.5 text-white/60 transition hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-400 disabled:opacity-30"
                                  >
                                    <Zap className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => healKey(k.id)}
                                    title="Heal: reset failure counters and re-probe endpoint health"
                                    className="rounded-lg border border-white/5 bg-white/5 p-1.5 text-white/60 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-300"
                                  >
                                    <Stethoscope className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => deleteKey(k.id)}
                                    title="Revoke Key from Vault"
                                    className="rounded-lg border border-white/5 bg-white/5 p-1.5 text-white/60 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                {testResult && (
                                  <div className={`mt-1 text-[10px] ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {testResult.ok
                                      ? `OK · ${testResult.latencyMs}ms · ${testResult.model}`
                                      : `FAIL · ${typeof testResult.error === 'string' ? testResult.error : (testResult.error ? JSON.stringify(testResult.error) : 'unknown')}`}
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
          })
        )}
      </div>
    </div>
  );
}

'use client';

import { Check, Pencil, RotateCw, Server, X, Zap } from 'lucide-react';
import { useState } from 'react';

import type { RoutingEndpoint } from '@/hooks/api';

interface EndpointManagerProps {
  endpoints: RoutingEndpoint[];
  onChanged: () => void;
}

/**
 * Live provider endpoint manager (D5).
 * Operators can correct a provider's baseUrl from the web UI without restarting
 * the gateway: PATCH via POST /api/v1/endpoints/:id, then probe reachability,
 * and heal (re-register + re-probe) unhealthy endpoints.
 */
export function EndpointManager({ endpoints, onChanged }: EndpointManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  async function saveBaseUrl(ep: RoutingEndpoint) {
    const next = draft.trim();
    if (!next || next === ep.baseUrl) {
      setEditingId(null);
      return;
    }
    setBusy(ep.id);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/endpoints/${ep.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: next }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ id: ep.id, ok: false, text: body?.error?.message ?? `HTTP ${r.status}` });
      } else {
        setMsg({ id: ep.id, ok: true, text: `Base URL updated → ${next}` });
        setEditingId(null);
        onChanged();
      }
    } catch (e) {
      setMsg({ id: ep.id, ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function probe(ep: RoutingEndpoint) {
    setBusy(ep.id);
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/endpoints/${ep.id}/probe`, { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      setMsg({
        id: ep.id,
        ok: !!body?.reachable,
        text: body?.reachable ? `Reachable (${body?.status ?? 'ok'})` : `Unreachable: ${body?.error ?? 'no response'}`,
      });
      onChanged();
    } catch (e) {
      setMsg({ id: ep.id, ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const healthPill = (h: string) =>
    h === 'healthy'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
      : h === 'degraded'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-400';

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-white/50">
            <th className="px-3 py-2 font-medium">Endpoint</th>
            <th className="px-3 py-2 font-medium">Base URL</th>
            <th className="px-3 py-2 font-medium">Health</th>
            <th className="px-3 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((ep) => {
            const editing = editingId === ep.id;
            return (
              <tr key={ep.id} className="border-b border-white/[0.05] hover:bg-white/[0.02]">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-white/80">{ep.id}</div>
                  <div className="text-[10px] text-white/40">{ep.providerId}</div>
                </td>
                <td className="px-3 py-2">
                  {editing ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveBaseUrl(ep);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="h-8 w-[28rem] max-w-full rounded-lg border border-nexus-500/40 bg-white/5 px-2 font-mono text-xs text-white focus:outline-none focus:ring-1 focus:ring-nexus-500"
                        placeholder="https://..."
                      />
                      <button
                        onClick={() => saveBaseUrl(ep)}
                        disabled={busy === ep.id}
                        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-30"
                        title="Save base URL"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/60 transition hover:bg-white/10"
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Server className={`h-3.5 w-3.5 ${ep.health === 'healthy' ? 'text-emerald-400' : 'text-rose-400'}`} />
                      <span className="font-mono text-xs text-white/70">{ep.baseUrl}</span>
                      <button
                        onClick={() => {
                          setEditingId(ep.id);
                          setDraft(ep.baseUrl);
                        }}
                        className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/60 transition hover:border-nexus-500/40 hover:bg-nexus-500/10 hover:text-nexus-300"
                        title="Edit base URL"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {msg && msg.id === ep.id && (
                    <div className={`mt-1 text-[10px] ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{msg.text}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border ${healthPill(ep.health)}`}>
                    {ep.health}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => probe(ep)}
                      disabled={busy === ep.id}
                      title="Probe reachability"
                      className="flex items-center gap-1 rounded-lg border border-white/5 bg-white/5 px-2 py-1.5 text-[11px] text-white/60 transition hover:border-cyan-500/40 hover:bg-cyan-500/10 hover:text-cyan-300 disabled:opacity-30"
                    >
                      {busy === ep.id ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Probe
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

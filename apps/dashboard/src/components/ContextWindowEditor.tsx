'use client';

import { Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';

interface ContextWindowEditorProps {
  provider: string;
  modelId: string;
  contextWindow?: number;
  onChanged: () => void;
}

/**
 * Per-model context-window editor (D4).
 * Lets operators correct a wrong/missing context length live via
 * POST /api/v1/models/context-window. The gateway also auto-corrects context
 * windows when an upstream `context_length_exceeded` error reports the real cap.
 */
export function ContextWindowEditor({ provider, modelId, contextWindow, onChanged }: ContextWindowEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(contextWindow ?? ''));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function save() {
    const next = Number(draft);
    if (!Number.isFinite(next) || next <= 0) {
      setMsg({ text: 'Enter a positive number of tokens', ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/v1/models/context-window', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model: modelId, contextWindow: next }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ text: body?.error?.message ?? `HTTP ${r.status}`, ok: false });
      } else {
        setMsg({ text: `Context window set to ${next.toLocaleString()}`, ok: true });
        setEditing(false);
        onChanged();
      }
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/60">{contextWindow ? contextWindow.toLocaleString() : '—'}</span>
        <button
          onClick={() => {
            setDraft(String(contextWindow ?? ''));
            setEditing(true);
            setMsg(null);
          }}
          className="rounded-lg border border-white/10 bg-white/5 p-1 text-white/60 transition hover:border-nexus-500/40 hover:bg-nexus-500/10 hover:text-nexus-300"
          title="Edit context window"
        >
          <Pencil className="h-3 w-3" />
        </button>
        {msg && <span className={`text-[10px] ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{msg.text}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="h-7 w-32 rounded-lg border border-nexus-500/40 bg-white/5 px-2 font-mono text-xs text-white focus:outline-none focus:ring-1 focus:ring-nexus-500"
        placeholder="tokens"
      />
      <button
        onClick={save}
        disabled={busy}
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1 text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-30"
        title="Save"
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        onClick={() => setEditing(false)}
        className="rounded-lg border border-white/10 bg-white/5 p-1 text-white/60 transition hover:bg-white/10"
        title="Cancel"
      >
        <X className="h-3 w-3" />
      </button>
      {msg && <span className={`text-[10px] ${msg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{msg.text}</span>}
    </div>
  );
}

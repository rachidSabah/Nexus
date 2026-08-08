'use client';

import { KeyRound, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

interface AuditSummary {
  allow: number;
  deny: number;
  total: number;
}

export default function SecurityPage() {
  const [summary, setSummary] = useState<AuditSummary>({ allow: 0, deny: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/v1/audit?limit=200');
        const body = (await r.json()) as Array<{ entry: { result: 'allow' | 'deny' } }>;
        if (cancelled) return;
        const allow = body.filter((e) => e.entry.result === 'allow').length;
        const deny = body.filter((e) => e.entry.result === 'deny').length;
        setSummary({ allow, deny, total: body.length });
      } catch {
        // ignore — gateway may not be running
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <KeyRound className="h-6 w-6 text-nexus-400" />
          Security
        </h1>
        <p className="text-sm text-white/50">Credentials, RBAC, JWT, and audit policies.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-medium">Allowed (last 200)</span>
          </div>
          <div className="stat-value mt-2 text-emerald-300">{summary.allow}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <ShieldAlert className="h-4 w-4 text-rose-400" />
            <span className="text-sm font-medium">Denied (last 200)</span>
          </div>
          <div className="stat-value mt-2 text-rose-300">{summary.deny}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-white/80">
            <KeyRound className="h-4 w-4 text-nexus-400" />
            <span className="text-sm font-medium">Total audit entries</span>
          </div>
          <div className="stat-value mt-2">{summary.total}</div>
        </div>
      </div>

      <div className="card">
        <div className="font-medium">Encrypted credential vault</div>
        <div className="mt-1 text-sm text-white/50">
          AES-256-GCM at rest. Master key derived from <code className="rounded bg-white/5 px-1">AGENT_NEXUS_VAULT_KEY</code> via scrypt.
          If the env var is unset and <code className="rounded bg-white/5 px-1">security.vaultPath</code> is configured, the gateway refuses to start.
        </div>
      </div>

      <div className="card">
        <div className="font-medium">Built-in roles</div>
        <ul className="mt-2 space-y-1 text-sm text-white/60">
          <li><code className="text-nexus-300">admin</code> — wildcard permission (<code>*</code>)</li>
          <li><code className="text-nexus-300">developer</code> — gateway:chat, gateway:embed, gateway:stream, providers:read</li>
          <li><code className="text-nexus-300">viewer</code> — providers:read, metrics:read</li>
          <li><code className="text-nexus-300">service</code> — gateway:*, embed:* (for service accounts)</li>
        </ul>
        <div className="mt-3 text-xs text-white/40">
          JWT issuance: <code className="rounded bg-white/5 px-1">POST /v1/auth/login</code> with <code className="rounded bg-white/5 px-1">{'{ "apiKey": "..." }'}</code> returns a short-lived JWT (1h default).
        </div>
      </div>
    </div>
  );
}

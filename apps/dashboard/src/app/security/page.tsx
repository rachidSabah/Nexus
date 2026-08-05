'use client';

import { KeyRound } from 'lucide-react';
export default function SecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-white/50">Credentials, RBAC, JWT, and audit policies.</p>
      </div>
      <div className="card flex items-center gap-4">
        <KeyRound className="h-8 w-8 text-nexus-400" />
        <div>
          <div className="font-medium">Encrypted credential vault</div>
          <div className="text-sm text-white/50">AES-256-GCM at rest. Master key derived from <code>AGENT_NEXUS_VAULT_KEY</code>.</div>
        </div>
      </div>
      <div className="card">
        <div className="font-medium">Built-in roles</div>
        <ul className="mt-2 space-y-1 text-sm text-white/60">
          <li><code className="text-nexus-300">admin</code> — full access</li>
          <li><code className="text-nexus-300">developer</code> — chat, embed, read providers</li>
          <li><code className="text-nexus-300">viewer</code> — read-only</li>
          <li><code className="text-nexus-300">service</code> — gateway + embeddings (for service accounts)</li>
        </ul>
      </div>
    </div>
  );
}

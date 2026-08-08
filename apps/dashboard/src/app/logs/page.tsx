'use client';

import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AuditEntry {
  id: string;
  occurredAt: string;
  entry: {
    principal: string;
    action: string;
    resource: string;
    result: 'allow' | 'deny';
    reason?: string;
    metadata?: Record<string, unknown>;
  };
}

export default function LogsPage() {
  const [principal, setPrincipal] = useState<string>('');
  const [action, setAction] = useState<string>('');
  const [limit, setLimit] = useState<number>(50);

  const qs = new URLSearchParams();
  if (principal) qs.set('principal', principal);
  if (action) qs.set('action', action);
  qs.set('limit', String(limit));

  const { data, isLoading } = useSWR<AuditEntry[] | { entries: AuditEntry[] }>(
    `/api/v1/audit?${qs.toString()}`,
    fetcher,
    { refreshInterval: 5000 },
  );

  const entries: AuditEntry[] = Array.isArray(data) ? data : ((data as { entries?: AuditEntry[] })?.entries ?? []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ScrollText className="h-6 w-6 text-nexus-400" />
          Audit Logs
        </h1>
        <p className="text-sm text-white/50">
          Every authorization decision, credential access, and configuration change is recorded here.
        </p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-white/50">
            Principal
            <input
              type="text"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              placeholder="admin"
              className="ml-2 h-8 w-40 rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/50">
            Action
            <input
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="gateway:chat"
              className="ml-2 h-8 w-40 rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/50">
            Limit
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="ml-2 h-8 rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-black/40 backdrop-blur">
              <tr className="border-b border-white/5 text-white/40">
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Principal</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Resource</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-white/40">Loading…</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-white/40">No audit entries yet.</td></tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
                    <td className="px-4 py-2 font-mono text-white/60">
                      {new Date(e.occurredAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-white/80">{e.entry.principal}</td>
                    <td className="px-4 py-2 font-mono text-nexus-300">{e.entry.action}</td>
                    <td className="px-4 py-2 text-white/60">{e.entry.resource}</td>
                    <td className="px-4 py-2">
                      <span className={`pill pill-${e.entry.result === 'allow' ? 'healthy' : 'unhealthy'}`}>
                        {e.entry.result}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-white/40">{e.entry.reason ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

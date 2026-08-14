'use client';

import { ScrollText, Shield, RefreshCw, Filter, Search } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { etagFetcher } from '@/lib/etagFetcher';

interface AuditLogEntry {
  id: string;
  ts: string;
  principal: string;
  action: string;
  resource: string;
  result: 'allow' | 'deny';
  reason?: string;
  metadata?: Record<string, unknown>;
}

export default function AuditPage() {
  const [filterAction, setFilterAction] = useState('');
  const [filterPrincipal, setFilterPrincipal] = useState('');

  const { data: logsData, mutate, isLoading } = useSWR<{ logs: AuditLogEntry[] }>(
    '/api/v1/audit',
    etagFetcher,
    { refreshInterval: 5000 }
  );

  const logs = logsData?.logs ?? [];

  const filteredLogs = logs.filter((log) => {
    if (filterAction && !log.action.toLowerCase().includes(filterAction.toLowerCase())) return false;
    if (filterPrincipal && !log.principal.toLowerCase().includes(filterPrincipal.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-purple-400 mb-2">
            <Shield className="h-3.5 w-3.5 text-purple-400" /> Security Fabric
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
            Immutable Audit Trail
          </h1>
          <p className="mt-1 text-sm text-white/60">
            Cryptographically structured authorization, provider mutation, policy enforcement, and execution access logs.
          </p>
        </div>
        <div>
          <button
            onClick={() => void mutate()}
            className="pill bg-purple-500/10 text-purple-300 ring-1 ring-purple-500/30 hover:bg-purple-500/20"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            placeholder="Filter by action (e.g. auth, access, build)..."
            className="w-full rounded-lg border border-white/10 bg-white/[0.02] pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-purple-500/50 focus:outline-none"
          />
        </div>
        <div className="relative flex-1">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={filterPrincipal}
            onChange={(e) => setFilterPrincipal(e.target.value)}
            placeholder="Filter by principal / role..."
            className="w-full rounded-lg border border-white/10 bg-white/[0.02] pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-purple-500/50 focus:outline-none"
          />
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tracking-tight text-white flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-purple-400" /> Recorded Security Events ({filteredLogs.length})
          </h2>
          {isLoading && <span className="text-xs text-white/40">Loading...</span>}
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-white/40">
            No audit events recorded matching current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs font-semibold uppercase tracking-wider text-white/40">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Principal</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Resource</th>
                  <th className="py-3 px-4">Result</th>
                  <th className="py-3 px-4">Reason / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-xs">
                {filteredLogs.map((entry, idx) => (
                  <tr key={`${idx}-${entry.id ?? entry.ts}`} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4 text-white/60">{entry.ts ? new Date(entry.ts).toLocaleTimeString() : '—'}</td>
                    <td className="py-3 px-4 text-white font-medium">{entry.principal}</td>
                    <td className="py-3 px-4 text-sky-400">{entry.action}</td>
                    <td className="py-3 px-4 text-white/80 max-w-xs truncate">{entry.resource}</td>
                    <td className="py-3 px-4">
                      <span className={entry.result === 'allow' ? 'pill pill-healthy' : 'pill pill-unhealthy'}>
                        {entry.result.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-white/50">{entry.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

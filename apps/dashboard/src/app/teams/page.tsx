'use client';

import { Users, Vote } from 'lucide-react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Team {
  id: string;
  name: string;
  description: string;
  members: Array<{ agentId: string; role: string; votingPower: number }>;
  createdAt: string;
}

interface Proposal {
  id: string;
  teamId: string;
  title: string;
  description: string;
  proposedBy: string;
  status: 'open' | 'accepted' | 'rejected' | 'expired';
  votes: Record<string, string>;
}

export default function TeamsPage() {
  const { data: teams, isLoading } = useSWR<readonly Team[]>('/api/v1/teams', fetcher, { refreshInterval: 5000 });
  const { data: proposals } = useSWR<readonly Proposal[]>('/api/v1/proposals', fetcher, { refreshInterval: 5000 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Users className="h-6 w-6 text-nexus-400" />
          Teams
        </h1>
        <p className="text-sm text-white/50">Agent collaboration: teams, proposals, voting, and shared workspaces.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card">
          <div className="stat-label">Active teams</div>
          <div className="mt-2 stat-value">{teams?.length ?? 0}</div>
        </div>
        <div className="card">
          <div className="stat-label">Open proposals</div>
          <div className="mt-2 stat-value">{(proposals ?? []).filter((p) => p.status === 'open').length}</div>
        </div>
        <div className="card">
          <div className="stat-label">Accepted proposals</div>
          <div className="mt-2 stat-value text-emerald-400">{(proposals ?? []).filter((p) => p.status === 'accepted').length}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-sm font-medium text-white/80">Teams</h2>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-white/40">Loading…</div>
          ) : (teams ?? []).length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">No teams formed yet.</div>
          ) : (
            <div className="space-y-3">
              {(teams ?? []).map((t) => (
                <div key={t.id} className="rounded-lg bg-black/30 p-3">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-white/40">{t.description}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.members.map((m) => (
                      <span key={m.agentId} className="pill bg-white/5 text-white/60">
                        {m.agentId} · {m.role} · {m.votingPower}×
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-white/80">
            <Vote className="h-4 w-4" /> Proposals
          </h2>
          {(proposals ?? []).length === 0 ? (
            <div className="py-8 text-center text-sm text-white/40">No proposals yet.</div>
          ) : (
            <div className="space-y-2">
              {(proposals ?? []).map((p) => (
                <div key={p.id} className="rounded-lg bg-black/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{p.title}</span>
                    <span className={`pill pill-${p.status === 'accepted' ? 'healthy' : p.status === 'rejected' ? 'unhealthy' : 'degraded'}`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-white/50">{p.description}</div>
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <span className="text-emerald-400">✓ {Object.values(p.votes).filter((v) => v === 'yes').length}</span>
                    <span className="text-rose-400">✗ {Object.values(p.votes).filter((v) => v === 'no').length}</span>
                    <span className="text-white/40">⊘ {Object.values(p.votes).filter((v) => v === 'abstain').length}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

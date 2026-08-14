'use client';

import { Users, Vote, Sparkles, CheckCircle2 } from 'lucide-react';
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
    <div className="space-y-8 relative pb-12 w-full max-w-full overflow-x-hidden">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Multi-Agent Swarm Governance
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Users className="h-8 w-8 text-nexus-400" />
            Agent Teams & Swarm Voting
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Collaborative agent teams, voting power distribution, proposals, and consensus decisions.
          </p>
        </div>

        <button
          onClick={async () => {
            const name = prompt('Enter Team Name:', 'Autonomous Engineering Swarm');
            if (!name) return;
            const description = prompt('Enter Description:', 'Full-stack development, code review, and QA swarm');
            if (!description) return;
            await fetch('/api/v1/teams', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                description,
                members: [
                  { agentId: 'architect-prime', role: 'planner', votingPower: 2 },
                  { agentId: 'coder-executor', role: 'executor', votingPower: 1 },
                  { agentId: 'qa-critic', role: 'critic', votingPower: 1 },
                ],
              }),
            });
            window.location.reload();
          }}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-nexus-600 to-cyan-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:scale-[1.02] active:scale-95 self-start md:self-auto"
        >
          <Users className="h-4 w-4" /> Form New Agent Team
        </button>
      </div>

      {/* Cyber Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-nexus-500/20 bg-gradient-to-b from-nexus-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-nexus-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-nexus-300/80">Active Teams</span>
            <div className="rounded-lg bg-nexus-500/10 p-2 text-nexus-400 border border-nexus-500/20">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-nexus-300">{teams?.length ?? 0}</div>
          <div className="mt-1 text-[11px] text-nexus-400/60">Formed agent swarms</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-nexus-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-amber-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400/80">Open Proposals</span>
            <div className="rounded-lg bg-amber-500/10 p-2 text-amber-400 border border-amber-500/20">
              <Vote className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-amber-300">
            {(proposals ?? []).filter((p) => p.status === 'open').length}
          </div>
          <div className="mt-1 text-[11px] text-amber-400/60">Awaiting swarm votes</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/20 to-white/[0.02] p-5 backdrop-blur-xl transition hover:border-emerald-500/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400/80">Accepted Proposals</span>
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 text-3xl font-black tracking-tight text-emerald-300">
            {(proposals ?? []).filter((p) => p.status === 'accepted').length}
          </div>
          <div className="mt-1 text-[11px] text-emerald-400/60">Consensus reached</div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Active Teams Grid */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
            <Users className="h-4 w-4 text-nexus-400" /> Active Swarm Teams & Members
          </h2>
          {isLoading ? (
            <div className="py-8 text-center text-xs text-white/40">Querying swarm registry...</div>
          ) : (teams ?? []).length === 0 ? (
            <div className="py-8 text-center text-xs text-white/40">No agent teams formed yet.</div>
          ) : (
            <div className="space-y-4">
              {(teams ?? []).map((t) => (
                <div key={t.id} className="rounded-xl border border-white/5 bg-black/40 p-4 transition hover:border-white/20">
                  <div className="font-bold text-sm text-white">{t.name}</div>
                  <div className="text-xs text-white/50 mt-0.5">{t.description}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.members.map((m) => (
                      <span key={m.agentId} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80 font-mono">
                        <span className="text-nexus-300">{m.agentId}</span> · {m.role} · <span className="text-emerald-400 font-bold">{m.votingPower}×</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Swarm Proposals & Voting Panel */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/70 flex items-center gap-2">
            <Vote className="h-4 w-4 text-amber-400" /> Swarm Proposals & Governance
          </h2>
          {(proposals ?? []).length === 0 ? (
            <div className="py-8 text-center text-xs text-white/40">No active or historic proposals recorded.</div>
          ) : (
            <div className="space-y-3">
              {(proposals ?? []).map((p) => (
                <div key={p.id} className="rounded-xl border border-white/5 bg-black/40 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">{p.title}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize border ${
                      p.status === 'accepted' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
                      p.status === 'rejected' ? 'border-rose-500/30 bg-rose-500/10 text-rose-400' :
                      'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    }`}>
                      {p.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-white/60">{p.description}</div>
                  <div className="mt-3 flex items-center gap-4 text-xs font-mono">
                    <span className="text-emerald-400 font-bold">✓ Yes: {Object.values(p.votes).filter((v) => v === 'yes').length}</span>
                    <span className="text-rose-400 font-bold">✗ No: {Object.values(p.votes).filter((v) => v === 'no').length}</span>
                    <span className="text-white/40">⊘ Abstain: {Object.values(p.votes).filter((v) => v === 'abstain').length}</span>
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


import { randomUUID } from 'node:crypto';

/**
 * Agent-to-Agent (A2A) Protocol.
 *
 * Lets the gateway orchestrate multiple specialized agents (e.g. one for
 * coding, one for retrieval, one for tool execution) and route messages
 * between them. Inspired by A2A proposals from Google, AWS, and others.
 *
 * Status: scaffold — the wire protocol is defined and the runtime can
 * route messages, but multi-agent orchestration primitives (planner,
 * executor, critic) are next-release.
 */

export type AgentRole = 'coordinator' | 'planner' | 'executor' | 'critic' | 'observer';

export interface AgentDescriptor {
  readonly id: string;
  readonly name: string;
  readonly role: AgentRole;
  readonly capabilities: readonly string[];
  readonly endpoint: string; // URL where this agent receives messages
  readonly publicKey?: string; // for signed messages
}

export interface A2AMessage {
  readonly id: string;
  readonly from: string; // agent ID
  readonly to: string | 'broadcast'; // agent ID or broadcast
  readonly type: 'request' | 'response' | 'event' | 'error';
  readonly taskId?: string;
  readonly replyTo?: string; // message ID
  readonly payload: unknown;
  readonly createdAt: string;
  readonly signature?: string;
}

/**
 * Registry of known agents. The coordinator uses this to route messages.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentDescriptor>();

  register(agent: AgentDescriptor): void {
    this.agents.set(agent.id, agent);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  get(agentId: string): AgentDescriptor | undefined {
    return this.agents.get(agentId);
  }

  list(): readonly AgentDescriptor[] {
    return Array.from(this.agents.values());
  }

  findByCapability(capability: string): readonly AgentDescriptor[] {
    return this.list().filter((a) => a.capabilities.includes(capability));
  }
}

/**
 * A2A coordinator — routes messages between agents, tracks conversations,
 * and supports request/response correlation.
 *
 * For now, this is an in-process coordinator. A future release will support
 * remote agents over HTTP/gRPC.
 */
export class A2ACoordinator {
  private readonly handlers = new Map<string, (msg: A2AMessage) => Promise<unknown>>();
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private readonly registry: AgentRegistry) {}

  /**
   * Register a handler for messages addressed to a given agent.
   */
  onMessage(agentId: string, handler: (msg: A2AMessage) => Promise<unknown>): void {
    this.handlers.set(agentId, handler);
  }

  /**
   * Send a request to an agent and await its response.
   */
  async request(from: string, to: string, payload: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = randomUUID();
    const msg: A2AMessage = {
      id,
      from,
      to,
      type: 'request',
      payload,
      createdAt: new Date().toISOString(),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`A2A request ${id} timed out`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      void this.route(msg);
    });
  }

  /**
   * Send a one-way event to an agent (or broadcast).
   */
  async emit(from: string, to: string | 'broadcast', payload: unknown): Promise<void> {
    const msg: A2AMessage = {
      id: randomUUID(),
      from,
      to,
      type: 'event',
      payload,
      createdAt: new Date().toISOString(),
    };
    await this.route(msg);
  }

  /**
   * Route a message to its destination(s) and handle the response.
   */
  private async route(msg: A2AMessage): Promise<void> {
    const targets = msg.to === 'broadcast' ? this.registry.list().map((a) => a.id) : [msg.to];

    for (const target of targets) {
      const handler = this.handlers.get(target);
      if (!handler) continue;
      try {
        const result = await handler(msg);
        if (msg.type === 'request' && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          p.resolve(result);
        }
      } catch (err) {
        if (msg.type === 'request' && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          p.reject(err as Error);
        }
      }
    }
  }
}

// ─── Phase 4: Teams, Voting, Consensus, Shared Workspace ────────────────────

import { buildEvent, type EventBusPort, type TeamFormedEvent, type TeamVoteEvent } from '@anx/core';

/**
 * A team is a named group of agents that collaborate on a shared goal.
 */
export interface AgentTeam {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly members: readonly TeamMember[];
  readonly createdAt: Date;
  readonly sharedWorkspaceId: string;
}

export interface TeamMember {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly votingPower: number;  // default 1
}

export interface Proposal {
  readonly id: string;
  readonly teamId: string;
  readonly title: string;
  readonly description: string;
  readonly proposedBy: string;       // agent id
  readonly createdAt: Date;
  readonly votes: ReadonlyMap<string, 'yes' | 'no' | 'abstain'>;
  readonly status: 'open' | 'accepted' | 'rejected' | 'expired';
  readonly deadline?: Date;
}

export interface SharedWorkspace {
  readonly id: string;
  readonly teamId: string;
  readonly artifacts: ReadonlyMap<string, WorkspaceArtifact>;
}

export interface WorkspaceArtifact {
  readonly id: string;
  readonly name: string;
  readonly type: 'document' | 'code' | 'decision' | 'review' | 'note';
  readonly content: string;
  readonly authorId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Team Manager — forms teams, manages proposals, and tracks shared workspaces.
 */
export class TeamManager {
  private readonly teams = new Map<string, AgentTeam>();
  private readonly proposals = new Map<string, Proposal>();
  private readonly workspaces = new Map<string, SharedWorkspace>();
  private readonly artifacts = new Map<string, WorkspaceArtifact>();

  constructor(private readonly events: EventBusPort) {}

  // ─── Team management ───────────────────────────────────────────────────

  formTeam(name: string, description: string, members: readonly TeamMember[]): AgentTeam {
    const id = randomUUID();
    const workspaceId = randomUUID();
    const team: AgentTeam = {
      id,
      name,
      description,
      members,
      createdAt: new Date(),
      sharedWorkspaceId: workspaceId,
    };
    this.teams.set(id, team);
    this.workspaces.set(workspaceId, { id: workspaceId, teamId: id, artifacts: new Map() });

    void this.events.publish(
      buildEvent<TeamFormedEvent>(
        'team.formed',
        {
          teamId: id,
          name,
          memberCount: members.length,
          members: members.map((m) => m.agentId),
        },
      ),
    );
    return team;
  }

  disbandTeam(teamId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    this.workspaces.delete(team.sharedWorkspaceId);
    this.teams.delete(teamId);
    return true;
  }

  getTeam(teamId: string): AgentTeam | undefined {
    return this.teams.get(teamId);
  }

  listTeams(): readonly AgentTeam[] {
    return Array.from(this.teams.values());
  }

  addMember(teamId: string, member: TeamMember): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    const updated: AgentTeam = { ...team, members: [...team.members, member] };
    this.teams.set(teamId, updated);
    return true;
  }

  removeMember(teamId: string, agentId: string): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    const updated: AgentTeam = {
      ...team,
      members: team.members.filter((m) => m.agentId !== agentId),
    };
    this.teams.set(teamId, updated);
    return true;
  }

  // ─── Proposals & Voting ─────────────────────────────────────────────────

  createProposal(
    teamId: string,
    title: string,
    description: string,
    proposedBy: string,
    deadlineMs?: number,
  ): Proposal | undefined {
    const team = this.teams.get(teamId);
    if (!team) return undefined;
    const proposal: Proposal = {
      id: randomUUID(),
      teamId,
      title,
      description,
      proposedBy,
      createdAt: new Date(),
      votes: new Map(),
      status: 'open',
      deadline: deadlineMs ? new Date(Date.now() + deadlineMs) : undefined,
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  vote(proposalId: string, voterId: string, vote: 'yes' | 'no' | 'abstain'): Proposal | undefined {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'open') return undefined;
    const team = this.teams.get(proposal.teamId);
    if (!team || !team.members.some((m) => m.agentId === voterId)) return undefined;

    const newVotes = new Map(proposal.votes);
    newVotes.set(voterId, vote);
    const updated: Proposal = { ...proposal, votes: newVotes };
    this.proposals.set(proposalId, updated);

    void this.events.publish(
      buildEvent<TeamVoteEvent>(
        'team.vote',
        { teamId: proposal.teamId, proposalId, voterId, vote },
      ),
    );

    // Auto-close if all members have voted
    if (newVotes.size >= team.members.length) {
      return this.closeProposal(proposalId);
    }
    return updated;
  }

  closeProposal(proposalId: string): Proposal | undefined {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'open') return undefined;

    let yes = 0;
    let no = 0;
    let abstain = 0;
    for (const [, v] of proposal.votes) {
      if (v === 'yes') yes++;
      else if (v === 'no') no++;
      else abstain++;
    }

    // Weight by voting power
    const team = this.teams.get(proposal.teamId);
    if (team) {
      yes = 0; no = 0; abstain = 0;
      for (const [voterId, v] of proposal.votes) {
        const member = team.members.find((m) => m.agentId === voterId);
        const power = member?.votingPower ?? 1;
        if (v === 'yes') yes += power;
        else if (v === 'no') no += power;
        else abstain += power;
      }
    }
    void abstain;

    const status: Proposal['status'] = yes > no ? 'accepted' : no >= yes ? 'rejected' : 'expired';
    const updated: Proposal = { ...proposal, status };
    this.proposals.set(proposalId, updated);
    return updated;
  }

  getProposal(proposalId: string): Proposal | undefined {
    return this.proposals.get(proposalId);
  }

  listProposals(teamId: string): readonly Proposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.teamId === teamId);
  }

  /**
   * Reach consensus: returns the accepted proposals for a team. If no
   * consensus yet, returns empty.
   */
  consensus(teamId: string): readonly Proposal[] {
    return this.listProposals(teamId).filter((p) => p.status === 'accepted');
  }

  // ─── Shared Workspace ────────────────────────────────────────────────────

  addArtifact(
    teamId: string,
    artifact: Omit<WorkspaceArtifact, 'id' | 'createdAt' | 'updatedAt'>,
  ): WorkspaceArtifact | undefined {
    const team = this.teams.get(teamId);
    if (!team) return undefined;
    const id = randomUUID();
    const now = new Date();
    const full: WorkspaceArtifact = { ...artifact, id, createdAt: now, updatedAt: now };
    this.artifacts.set(id, full);

    const workspace = this.workspaces.get(team.sharedWorkspaceId);
    if (workspace) {
      const artifacts = new Map(workspace.artifacts);
      artifacts.set(id, full);
      this.workspaces.set(team.sharedWorkspaceId, { ...workspace, artifacts });
    }
    return full;
  }

  updateArtifact(artifactId: string, content: string): WorkspaceArtifact | undefined {
    const existing = this.artifacts.get(artifactId);
    if (!existing) return undefined;
    const updated: WorkspaceArtifact = { ...existing, content, updatedAt: new Date() };
    this.artifacts.set(artifactId, updated);
    return updated;
  }

  getArtifact(artifactId: string): WorkspaceArtifact | undefined {
    return this.artifacts.get(artifactId);
  }

  listArtifacts(teamId: string): readonly WorkspaceArtifact[] {
    const team = this.teams.get(teamId);
    if (!team) return [];
    const workspace = this.workspaces.get(team.sharedWorkspaceId);
    if (!workspace) return [];
    return Array.from(workspace.artifacts.values());
  }

  /**
   * Delegate a task to a specific team member via A2A.
   */
  async delegateTask(
    coordinator: A2ACoordinator,
    teamId: string,
    fromAgentId: string,
    toAgentId: string,
    task: unknown,
  ): Promise<unknown> {
    const team = this.teams.get(teamId);
    if (!team) throw new Error(`Unknown team: ${teamId}`);
    if (!team.members.some((m) => m.agentId === toAgentId)) {
      throw new Error(`Agent ${toAgentId} is not a member of team ${teamId}`);
    }
    return coordinator.request(fromAgentId, toAgentId, task);
  }
}

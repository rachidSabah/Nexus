import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryEventBus } from '@anx/core';

import { TeamManager, A2ACoordinator, AgentRegistry, type TeamMember } from '../src/index.js';

describe('TeamManager', () => {
  let bus: InMemoryEventBus;
  let teams: TeamManager;
  let members: TeamMember[];

  beforeEach(() => {
    bus = new InMemoryEventBus();
    teams = new TeamManager(bus);
    members = [
      { agentId: 'architect-1', role: 'planner', votingPower: 2 },
      { agentId: 'coder-1', role: 'executor', votingPower: 1 },
      { agentId: 'reviewer-1', role: 'critic', votingPower: 1 },
    ];
  });

  it('forms a team and emits team.formed event', async () => {
    const events: unknown[] = [];
    bus.subscribe('team.formed', (e) => events.push(e));

    const team = teams.formTeam('Engineering Team', 'software engineering', members);
    expect(team.id).toBeDefined();
    expect(team.members.length).toBe(3);
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(1);
  });

  it('disbands a team', () => {
    const team = teams.formTeam('Temp', 'temp', members);
    expect(teams.disbandTeam(team.id)).toBe(true);
    expect(teams.getTeam(team.id)).toBeUndefined();
  });

  it('adds and removes members', () => {
    const team = teams.formTeam('Team', 'test', [members[0]!]);
    expect(team.members.length).toBe(1);
    teams.addMember(team.id, members[1]!);
    expect(teams.getTeam(team.id)?.members.length).toBe(2);
    teams.removeMember(team.id, members[1]!.agentId);
    expect(teams.getTeam(team.id)?.members.length).toBe(1);
  });

  it('creates a proposal', () => {
    const team = teams.formTeam('Team', 'test', members);
    const proposal = teams.createProposal(team.id, 'Adopt TypeScript', 'Use TS everywhere', 'architect-1');
    expect(proposal).toBeDefined();
    expect(proposal?.status).toBe('open');
    expect(proposal?.votes.size).toBe(0);
  });

  it('records votes and emits team.vote events', async () => {
    const events: unknown[] = [];
    bus.subscribe('team.vote', (e) => events.push(e));

    const team = teams.formTeam('Team', 'test', members);
    const proposal = teams.createProposal(team.id, 'Vote test', 'desc', 'architect-1')!;
    teams.vote(proposal.id, 'architect-1', 'yes');
    teams.vote(proposal.id, 'coder-1', 'no');
    await new Promise((r) => queueMicrotask(r));
    expect(events.length).toBe(2);
  });

  it('auto-closes proposal when all members have voted', () => {
    const team = teams.formTeam('Team', 'test', members);
    const proposal = teams.createProposal(team.id, 'Test', 'desc', 'architect-1')!;
    teams.vote(proposal.id, 'architect-1', 'yes');
    teams.vote(proposal.id, 'coder-1', 'yes');
    expect(teams.getProposal(proposal.id)?.status).toBe('open');
    teams.vote(proposal.id, 'reviewer-1', 'no');
    expect(teams.getProposal(proposal.id)?.status).toBe('accepted');
  });

  it('weights votes by votingPower', () => {
    const team = teams.formTeam('Team', 'test', members);
    const proposal = teams.createProposal(team.id, 'Test', 'desc', 'architect-1')!;
    // architect-1 has votingPower 2; coder-1 + reviewer-1 have 1 each (total 2 vs 2)
    teams.vote(proposal.id, 'architect-1', 'yes');   // yes=2
    teams.vote(proposal.id, 'coder-1', 'no');        // no=1
    teams.vote(proposal.id, 'reviewer-1', 'no');     // no=2
    // Yes=2, No=2 → no >= yes → rejected
    expect(teams.getProposal(proposal.id)?.status).toBe('rejected');
  });

  it('consensus returns accepted proposals', () => {
    const team = teams.formTeam('Team', 'test', members);
    const p1 = teams.createProposal(team.id, 'Accepted', 'desc', 'architect-1')!;
    const p2 = teams.createProposal(team.id, 'Rejected', 'desc', 'architect-1')!;
    teams.vote(p1.id, 'architect-1', 'yes');
    teams.vote(p1.id, 'coder-1', 'yes');
    teams.vote(p1.id, 'reviewer-1', 'yes');
    teams.vote(p2.id, 'architect-1', 'no');
    teams.vote(p2.id, 'coder-1', 'no');
    teams.vote(p2.id, 'reviewer-1', 'no');
    const accepted = teams.consensus(team.id);
    expect(accepted.length).toBe(1);
    expect(accepted[0]?.title).toBe('Accepted');
  });

  it('manages shared workspace artifacts', () => {
    const team = teams.formTeam('Team', 'test', members);
    const artifact = teams.addArtifact(team.id, {
      name: 'Architecture Decision Record',
      type: 'decision',
      content: 'We will use TypeScript.',
      authorId: 'architect-1',
    });
    expect(artifact).toBeDefined();
    expect(teams.listArtifacts(team.id).length).toBe(1);

    const updated = teams.updateArtifact(artifact!.id, 'We will use TypeScript + Zod.');
    expect(updated?.content).toContain('Zod');

    expect(teams.getArtifact(artifact!.id)?.content).toContain('Zod');
  });

  it('delegateTask routes through A2ACoordinator', async () => {
    const registry = new AgentRegistry();
    const coordinator = new A2ACoordinator(registry);

    coordinator.onMessage('coder-1', async (msg) => ({ received: msg.payload }));
    registry.register({ id: 'coder-1', name: 'Coder', role: 'executor', capabilities: [], endpoint: '' });
    registry.register({ id: 'architect-1', name: 'Architect', role: 'planner', capabilities: [], endpoint: '' });

    const team = teams.formTeam('Team', 'test', members);
    const result = await teams.delegateTask(coordinator, team.id, 'architect-1', 'coder-1', { task: 'implement feature' });
    expect(result).toEqual({ received: { task: 'implement feature' } });
  });

  it('delegateTask rejects non-members', async () => {
    const registry = new AgentRegistry();
    const coordinator = new A2ACoordinator(registry);
    const team = teams.formTeam('Team', 'test', members);

    await expect(
      teams.delegateTask(coordinator, team.id, 'architect-1', 'non-member', {}),
    ).rejects.toThrow('not a member');
  });
});

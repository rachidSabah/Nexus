/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AgentScoringEngine — Transparent & Explainable Agent Scoring for Phase 28.
 *
 * Computes deterministic multi-dimensional scores for available local agents
 * based on task intent, capabilities, health state, latency, and policies.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  AgentCandidateScore,
  AgentCapabilityTag,
  OrchestrationPolicy,
  TaskIntentClassification,
} from '../../domain/agent-orchestrator.js';
import type { LocalAgent } from '../../domain/local-agent.js';

export interface AgentRuntimeMetricsSnapshot {
  readonly successRate: number; // 0 to 1
  readonly averageLatencyMs: number;
  readonly activeExecutions: number;
  readonly lastFailureTime?: number;
  readonly consecutiveFailures: number;
}

export const KNOWN_AGENT_CAPABILITIES: Record<string, readonly AgentCapabilityTag[]> = {
  'claude-code': ['coding', 'repository-edit', 'repository-read', 'terminal', 'debugging', 'refactoring', 'testing'],
  'codex-cli': ['coding', 'repository-edit', 'repository-read', 'terminal', 'debugging', 'testing', 'tool-usage'],
  'hermes-cli': ['coding', 'tool-usage', 'terminal', 'analysis', 'multi-model'],
  opencode: ['coding', 'repository-edit', 'repository-read', 'debugging', 'multi-model'],
  agy: ['application-building', 'scaffolding', 'coding', 'testing', 'verification', 'repository-edit'],
};

export class AgentScoringEngine {
  scoreAgent(
    agent: LocalAgent,
    intent: TaskIntentClassification,
    policy: OrchestrationPolicy = 'nexus/auto',
    metrics: AgentRuntimeMetricsSnapshot = { successRate: 1.0, averageLatencyMs: 2000, activeExecutions: 0, consecutiveFailures: 0 },
    userPreferences?: { preferredAgents?: readonly string[]; excludedAgents?: readonly string[] },
  ): AgentCandidateScore {
    const isExcluded = userPreferences?.excludedAgents?.includes(agent.id);
    if (isExcluded) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        isHealthy: false,
        isExecutable: false,
        score: -999,
        breakdown: {
          capabilityScore: 0,
          healthScore: 0,
          reliabilityScore: 0,
          latencyScore: 0,
          modelAvailabilityScore: 0,
          failurePenalty: 999,
          loadPenalty: 0,
          finalScore: -999,
          rationale: `Excluded by user preference configuration`,
        },
      };
    }

    const caps = KNOWN_AGENT_CAPABILITIES[agent.id] ?? ['coding'];
    const reqCaps = intent.requiredCapabilities;

    // 1. Capability Score (max 40)
    let matchedCapsCount = 0;
    for (const req of reqCaps) {
      if (caps.includes(req)) matchedCapsCount++;
    }
    const capRatio = reqCaps.length > 0 ? matchedCapsCount / reqCaps.length : 1;
    let capabilityScore = Math.round(capRatio * 40);

    // Special category alignment
    if (intent.category === 'application-building' && agent.id === 'agy') {
      capabilityScore += 15; // AGY specialized builder bonus
    }

    // 2. Health Score (max 30)
    let healthScore = 0;
    const isExecutable = agent.health.executableFound;
    const isHealthy = agent.health.level === 'READY' || agent.status === 'READY';

    if (agent.health.level === 'READY' || agent.status === 'READY') {
      healthScore = 30;
    } else if (agent.health.level === 'CONFIGURABLE' || agent.status === 'AVAILABLE') {
      healthScore = 20;
    } else if (agent.health.level === 'EXECUTABLE') {
      healthScore = 15;
    } else if (agent.health.level === 'INSTALLED') {
      healthScore = 10;
    } else {
      healthScore = 0;
    }

    // If agent is not installed on host machine, heavily discount
    if (!isExecutable) {
      healthScore = -50;
    }

    // 3. Reliability Score (max 15)
    const reliabilityScore = Math.round(metrics.successRate * 15);

    // 4. Latency Score (max 10)
    let latencyScore = 10;
    if (metrics.averageLatencyMs > 60_000) {
      latencyScore = 2;
    } else if (metrics.averageLatencyMs > 20_000) {
      latencyScore = 5;
    } else if (metrics.averageLatencyMs > 5_000) {
      latencyScore = 8;
    }

    // 5. Model Availability (5 points)
    const modelAvailabilityScore = 5;

    // 6. Failure Penalty (up to 30)
    let failurePenalty = metrics.consecutiveFailures * 10;
    const timeSinceLastFailure = metrics.lastFailureTime ? Date.now() - metrics.lastFailureTime : Infinity;
    if (timeSinceLastFailure < 60_000) {
      failurePenalty += 15; // Cooldown penalty
    }

    // 7. Load Penalty (5 points per active execution)
    const loadPenalty = Math.min(25, metrics.activeExecutions * 5);

    // 8. Policy Bonus
    let policyBonus = 0;
    if (policy === 'nexus/prefer-claude' && agent.id === 'claude-code') policyBonus = 35;
    if (policy === 'nexus/prefer-codex' && agent.id === 'codex-cli') policyBonus = 35;
    if (policy === 'nexus/prefer-hermes' && agent.id === 'hermes-cli') policyBonus = 35;
    if (policy === 'nexus/prefer-opencode' && agent.id === 'opencode') policyBonus = 35;
    if (policy === 'nexus/prefer-agy' && agent.id === 'agy') policyBonus = 35;
    if (policy === 'nexus/application-builder' && agent.id === 'agy') policyBonus = 25;
    if (policy === 'nexus/best-coding-agent' && (agent.id === 'claude-code' || agent.id === 'codex-cli')) policyBonus = 10;

    // User preference boost
    if (userPreferences?.preferredAgents?.includes(agent.id)) {
      policyBonus += 20;
    }

    const finalScore = Math.max(
      0,
      capabilityScore + healthScore + reliabilityScore + latencyScore + modelAvailabilityScore + policyBonus - failurePenalty - loadPenalty,
    );

    const rationale = isExecutable
      ? `Matched ${matchedCapsCount}/${reqCaps.length} capabilities, health=${agent.health.level}, reliability=${Math.round(metrics.successRate * 100)}%`
      : `Agent executable not found on host filesystem`;

    return {
      agentId: agent.id,
      agentName: agent.name,
      isHealthy,
      isExecutable,
      score: finalScore,
      breakdown: {
        capabilityScore,
        healthScore,
        reliabilityScore,
        latencyScore,
        modelAvailabilityScore,
        failurePenalty,
        loadPenalty,
        finalScore,
        rationale,
      },
    };
  }
}

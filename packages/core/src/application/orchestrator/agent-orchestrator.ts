/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AgentOrchestrator — Phase 28 Intelligent Multi-Agent Orchestration Fabric.
 *
 * Implements intent classification, multi-dimensional candidate scoring,
 * execution leases, automated failover, model fabric binding, and lifecycle telemetry.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type {
  AgentSelection,
  FailoverAttemptRecord,
  OrchestratedExecutionRequest,
  OrchestratedExecutionResult,
  OrchestrationPolicy,
  OrchestratorMetrics,
} from '../../domain/agent-orchestrator.js';
import type { LocalAgentBridge } from '../local-agent-bridge.js';
import type { EventBusPort } from '../ports.js';

import { AgentPool } from './agent-pool.js';
import { AgentScoringEngine } from './agent-scoring-engine.js';
import { IntentClassifier } from './intent-classifier.js';

export interface AgentOrchestratorOptions {
  readonly bridge: LocalAgentBridge;
  readonly events?: EventBusPort;
  readonly defaultPolicy?: OrchestrationPolicy;
}

export class AgentOrchestrator {
  private readonly bridge: LocalAgentBridge;
  private readonly events?: EventBusPort;
  private readonly defaultPolicy: OrchestrationPolicy;

  private readonly classifier = new IntentClassifier();
  private readonly scoringEngine = new AgentScoringEngine();
  private readonly pool = new AgentPool();
  private readonly executions = new Map<string, OrchestratedExecutionResult>();
  private readonly selectionDistribution: Record<string, number> = {};

  private totalOrchestrations = 0;
  private successfulExecutions = 0;
  private failedExecutions = 0;
  private failoverCount = 0;
  private totalSelectionLatencyMs = 0;

  constructor(options: AgentOrchestratorOptions) {
    this.bridge = options.bridge;
    this.events = options.events;
    this.defaultPolicy = options.defaultPolicy ?? 'nexus/auto';
  }

  /**
   * Dry-run / Explain mode — determines best agent, scores all candidates,
   * constructs fallback chain, and generates human-readable rationale without executing.
   */
  async selectAgent(request: {
    prompt: string;
    policy?: OrchestrationPolicy;
    userPreferences?: { preferredAgents?: readonly string[]; excludedAgents?: readonly string[] };
  }): Promise<AgentSelection> {
    const t0 = Date.now();
    const policy = request.policy ?? this.defaultPolicy;
    const intent = this.classifier.classify(request.prompt);

    // Get discovered agents from Local Agent Bridge
    let agents = this.bridge.list();
    if (agents.length === 0) {
      agents = await this.bridge.discoverAll();
    }

    const candidateScores = agents.map((agent) => {
      const metrics = this.pool.getMetricsSnapshot(agent.id);
      return this.scoringEngine.scoreAgent(agent, intent, policy, metrics, request.userPreferences);
    });

    // Sort candidates by score descending
    candidateScores.sort((a, b) => b.score - a.score);

    const topCandidate = candidateScores[0];
    const fallbackChain = candidateScores
      .filter((c) => c.agentId !== topCandidate?.agentId && c.isExecutable && c.score > 0)
      .map((c) => c.agentId);

    const selectionTime = Date.now() - t0;
    this.totalSelectionLatencyMs += selectionTime;

    const selectedAgentId = topCandidate ? topCandidate.agentId : 'claude-code';
    const selectedAgentName = topCandidate ? topCandidate.agentName : 'Claude Code';

    const reason = topCandidate
      ? `Selected '${topCandidate.agentName}' (score: ${topCandidate.score}) for intent '${intent.category}' based on highest capability match and health state.`
      : 'Defaulted to standard coding agent (no active candidates found).';

    return {
      selectedAgentId,
      selectedAgentName,
      policy,
      intent,
      candidateScores,
      fallbackChain,
      reason,
      timestamp: Date.now(),
    };
  }

  /**
   * Orchestrates execution: selects optimal agent, acquires concurrency lease,
   * executes via bridge, and executes automated multi-agent failover if necessary.
   */
  async execute(request: OrchestratedExecutionRequest): Promise<OrchestratedExecutionResult> {
    this.totalOrchestrations++;
    const executionId = `orch-${randomUUID().substring(0, 8)}`;
    const startTime = Date.now();

    // 1. Selection & Planning
    const selection = await this.selectAgent({
      prompt: request.prompt,
      policy: request.policy,
      userPreferences: request.userPreferences,
    });

    this.selectionDistribution[selection.selectedAgentId] = (this.selectionDistribution[selection.selectedAgentId] ?? 0) + 1;

    void this.events?.publish({
      type: 'agent.selection.completed' as any,
      occurredAt: new Date(),
      payload: {
        executionId,
        selectedAgentId: selection.selectedAgentId,
        policy: selection.policy,
        category: selection.intent.category,
      },
    });

    // 2. Form execution queue (primary + fallbacks if failover allowed)
    const queue = [selection.selectedAgentId];
    if (request.allowFailover !== false) {
      for (const fallbackId of selection.fallbackChain) {
        if (!queue.includes(fallbackId)) {
          queue.push(fallbackId);
        }
      }
    }

    const maxAttempts = Math.min(queue.length, request.maxRetries ?? 3);
    const failoverHistory: FailoverAttemptRecord[] = [];
    let lastError: string | undefined = undefined;
    let finalOutput = '';
    let success = false;
    let usedAgentId = selection.selectedAgentId;
    let usedAgentName = selection.selectedAgentName;
    let attemptsCount = 0;

    for (let i = 0; i < maxAttempts; i++) {
      const currentAgentId = queue[i]!;
      attemptsCount++;
      const currentAgent = this.bridge.get(currentAgentId);
      usedAgentId = currentAgentId;
      usedAgentName = currentAgent?.name ?? currentAgentId;

      if (i > 0) {
        this.failoverCount++;
        void this.events?.publish({
          type: 'agent.failover.started' as any,
          occurredAt: new Date(),
          payload: {
            executionId,
            fromAgentId: queue[i - 1],
            toAgentId: currentAgentId,
            attempt: i + 1,
          },
        });
      }

      // Acquire concurrency lease
      const lease = this.pool.acquireLease(currentAgentId, executionId, request.timeoutMs ?? selection.intent.suggestedTimeoutMs);
      const attemptStart = Date.now();

      void this.events?.publish({
        type: 'agent.execution.started' as any,
        occurredAt: new Date(),
        payload: {
          executionId,
          agentId: currentAgentId,
          leaseId: lease.leaseId,
        },
      });

      try {
        const result = await this.bridge.execute({
          agentId: currentAgentId,
          prompt: request.prompt,
          workspace: request.workspace,
          modelPolicy: request.targetModel ?? selection.intent.suggestedPolicy,
          timeoutMs: request.timeoutMs ?? selection.intent.suggestedTimeoutMs,
          env: request.env,
        });

        const attemptDuration = Date.now() - attemptStart;

        if (result.status === 'SUCCESS') {
          this.pool.recordSuccess(currentAgentId, attemptDuration);
          this.successfulExecutions++;
          finalOutput = result.stdout;
          success = true;
          this.pool.releaseLease(lease.leaseId);
          break;
        } else {
          lastError = result.stderr || `Agent '${currentAgentId}' failed with status ${result.status}`;
          this.pool.recordFailure(currentAgentId);
          failoverHistory.push({
            agentId: currentAgentId,
            error: lastError,
            durationMs: attemptDuration,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        const attemptDuration = Date.now() - attemptStart;
        lastError = (err as Error).message;
        this.pool.recordFailure(currentAgentId);
        failoverHistory.push({
          agentId: currentAgentId,
          error: lastError,
          durationMs: attemptDuration,
          timestamp: Date.now(),
        });
      } finally {
        this.pool.releaseLease(lease.leaseId);
      }
    }

    if (!success) {
      this.failedExecutions++;
    }

    const durationMs = Date.now() - startTime;
    const finalResult: OrchestratedExecutionResult = {
      executionId,
      prompt: request.prompt,
      status: success ? 'SUCCESS' : 'FAILED',
      selectedAgentId: usedAgentId,
      selectedAgentName: usedAgentName,
      selectedModel: request.targetModel ?? 'nexus/best-coding',
      policy: selection.policy,
      attempts: attemptsCount,
      durationMs,
      output: finalOutput,
      error: success ? undefined : lastError,
      failoverHistory,
      selection,
    };

    this.executions.set(executionId, finalResult);

    void this.events?.publish({
      type: (success ? 'agent.execution.completed' : 'agent.execution.failed') as any,
      occurredAt: new Date(),
      payload: {
        executionId,
        agentId: usedAgentId,
        status: finalResult.status,
        durationMs,
        attempts: attemptsCount,
      },
    });

    return finalResult;
  }

  getExecution(executionId: string): OrchestratedExecutionResult | undefined {
    return this.executions.get(executionId);
  }

  listExecutions(limit: number = 50): readonly OrchestratedExecutionResult[] {
    return Array.from(this.executions.values()).slice(-limit).reverse();
  }

  cancelExecution(executionId: string): boolean {
    const cancelled = this.bridge.cancelExecution(executionId);
    this.pool.releaseLease(executionId);
    return cancelled;
  }

  getMetrics(): OrchestratorMetrics {
    const avgLatency = this.totalOrchestrations > 0 ? Math.round(this.totalSelectionLatencyMs / this.totalOrchestrations) : 0;

    return {
      totalOrchestrations: this.totalOrchestrations,
      successfulExecutions: this.successfulExecutions,
      failedExecutions: this.failedExecutions,
      failoverCount: this.failoverCount,
      averageSelectionLatencyMs: avgLatency,
      activeLeases: this.pool.getActiveLeasesCount(),
      selectionDistribution: { ...this.selectionDistribution },
    };
  }
}

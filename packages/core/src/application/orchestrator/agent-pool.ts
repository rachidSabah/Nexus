/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AgentPool — Concurrency, Leases, and Health Tracking for Agent Orchestrator.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type { ExecutionLease } from '../../domain/agent-orchestrator.js';

import type { AgentRuntimeMetricsSnapshot } from './agent-scoring-engine.js';

interface AgentInternalStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  consecutiveFailures: number;
  lastFailureTime?: number;
  totalLatencyMs: number;
}

export class AgentPool {
  private readonly leases = new Map<string, ExecutionLease>();
  private readonly stats = new Map<string, AgentInternalStats>();

  private getOrCreateStats(agentId: string): AgentInternalStats {
    let stat = this.stats.get(agentId);
    if (!stat) {
      stat = {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        consecutiveFailures: 0,
        totalLatencyMs: 0,
      };
      this.stats.set(agentId, stat);
    }
    return stat;
  }

  acquireLease(agentId: string, executionId: string, timeoutMs: number = 120_000): ExecutionLease {
    const leaseId = `lease-${randomUUID().substring(0, 8)}`;
    const now = Date.now();
    const lease: ExecutionLease = {
      leaseId,
      executionId,
      agentId,
      createdAt: now,
      expiresAt: now + timeoutMs,
      status: 'ACTIVE',
    };
    this.leases.set(leaseId, lease);
    return lease;
  }

  releaseLease(identifier: string): boolean {
    for (const [id, lease] of this.leases.entries()) {
      if (id === identifier || lease.executionId === identifier) {
        this.leases.set(id, { ...lease, status: 'RELEASED' });
        this.leases.delete(id);
        return true;
      }
    }
    return false;
  }

  getActiveLeasesCount(agentId?: string): number {
    const now = Date.now();
    let count = 0;
    for (const lease of this.leases.values()) {
      if (lease.status === 'ACTIVE' && lease.expiresAt > now) {
        if (!agentId || lease.agentId === agentId) {
          count++;
        }
      }
    }
    return count;
  }

  recordSuccess(agentId: string, durationMs: number): void {
    const stat = this.getOrCreateStats(agentId);
    stat.totalExecutions++;
    stat.successfulExecutions++;
    stat.consecutiveFailures = 0;
    stat.totalLatencyMs += durationMs;
  }

  recordFailure(agentId: string): void {
    const stat = this.getOrCreateStats(agentId);
    stat.totalExecutions++;
    stat.failedExecutions++;
    stat.consecutiveFailures++;
    stat.lastFailureTime = Date.now();
  }

  getMetricsSnapshot(agentId: string): AgentRuntimeMetricsSnapshot {
    const stat = this.getOrCreateStats(agentId);
    const successRate = stat.totalExecutions > 0 ? stat.successfulExecutions / stat.totalExecutions : 1.0;
    const averageLatencyMs = stat.totalExecutions > 0 ? Math.round(stat.totalLatencyMs / stat.totalExecutions) : 2000;
    const activeExecutions = this.getActiveLeasesCount(agentId);

    return {
      successRate,
      averageLatencyMs,
      activeExecutions,
      lastFailureTime: stat.lastFailureTime,
      consecutiveFailures: stat.consecutiveFailures,
    };
  }

  getSummaryStats(): { totalLeases: number; activeLeases: number; agentLoads: Record<string, number> } {
    const agentLoads: Record<string, number> = {};
    for (const lease of this.leases.values()) {
      if (lease.status === 'ACTIVE') {
        agentLoads[lease.agentId] = (agentLoads[lease.agentId] ?? 0) + 1;
      }
    }
    return {
      totalLeases: this.leases.size,
      activeLeases: this.getActiveLeasesCount(),
      agentLoads,
    };
  }
}

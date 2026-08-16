/**
 * ───────────────────────────────────────────────────────────────────────────
 * @anx/core — Phase 34 Bounded Signal Collector
 * ───────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from 'node:crypto';

import type { DomainEvent } from '../../domain/events.js';
import type { RuntimeSignal } from '../../domain/runtime-intelligence.js';
import type { SubsystemName } from '../../domain/system-health.js';
import type { EventBusPort } from '../ports.js';

export interface SignalCollectorOptions {
  readonly maxSignalsPerSubsystem?: number;
  readonly windowMs?: number;
}

export class SignalCollector {
  private readonly signalsBySubsystem = new Map<SubsystemName, RuntimeSignal[]>();
  private readonly maxSignals: number;
  private readonly windowMs: number;
  private unsubscribeBus?: () => void;

  constructor(opts: SignalCollectorOptions = {}) {
    this.maxSignals = opts.maxSignalsPerSubsystem ?? 300;
    this.windowMs = opts.windowMs ?? 60_000; // 1 minute window
  }

  recordSignal(
    subsystem: SubsystemName,
    signalType: string,
    value: number,
    metadata?: Record<string, unknown>,
    correlationId?: string,
  ): RuntimeSignal {
    const signal: RuntimeSignal = {
      id: randomUUID(),
      timestamp: Date.now(),
      subsystem,
      signalType,
      value,
      metadata: metadata ? this.sanitizeMetadata(metadata) : undefined,
      correlationId,
    };

    let list = this.signalsBySubsystem.get(subsystem);
    if (!list) {
      list = [];
      this.signalsBySubsystem.set(subsystem, list);
    }

    if (list.length >= this.maxSignals) {
      list.shift();
    }
    list.push(signal);

    return signal;
  }

  getSignals(subsystem?: SubsystemName, options?: { since?: number; limit?: number }): RuntimeSignal[] {
    const since = options?.since ?? Date.now() - this.windowMs;
    const limit = options?.limit ?? 100;

    let result: RuntimeSignal[] = [];
    if (subsystem) {
      const list = this.signalsBySubsystem.get(subsystem) ?? [];
      result = list.filter((s) => s.timestamp >= since);
    } else {
      for (const list of this.signalsBySubsystem.values()) {
        result.push(...list.filter((s) => s.timestamp >= since));
      }
      result.sort((a, b) => b.timestamp - a.timestamp);
    }

    return result.slice(0, limit);
  }

  getSignalAggregates(subsystem: SubsystemName, signalType: string, windowMs?: number): {
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
    latest?: RuntimeSignal;
  } {
    const cutoff = Date.now() - (windowMs ?? this.windowMs);
    const list = (this.signalsBySubsystem.get(subsystem) ?? []).filter(
      (s) => s.signalType === signalType && s.timestamp >= cutoff,
    );

    if (list.length === 0) {
      return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
    }

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (const s of list) {
      sum += s.value;
      if (s.value < min) min = s.value;
      if (s.value > max) max = s.value;
    }

    return {
      count: list.length,
      sum,
      avg: Math.round((sum / list.length) * 100) / 100,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
      latest: list[list.length - 1],
    };
  }

  wireToEventBus(bus: EventBusPort): void {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
    }

    const unsubscribers: Array<() => void> = [];

    // Provider requests
    unsubscribers.push(
      bus.subscribe('provider.request.succeeded', (event: DomainEvent) => {
        const p = event.payload as { endpointId?: string; providerId?: string; latencyMs?: number; costUsd?: number };
        this.recordSignal('providers', 'request_success', 1, { providerId: p.providerId, endpointId: p.endpointId });
        if (typeof p.latencyMs === 'number') {
          this.recordSignal('providers', 'latency_ms', p.latencyMs, { providerId: p.providerId, endpointId: p.endpointId });
        }
        if (typeof p.costUsd === 'number') {
          this.recordSignal('tokenEngine', 'cost_usd', p.costUsd);
        }
      }),
    );

    unsubscribers.push(
      bus.subscribe('provider.request.failed', (event: DomainEvent) => {
        const p = event.payload as { endpointId?: string; providerId?: string; code?: string; error?: string };
        const code = p.code ?? 'ERROR';
        this.recordSignal('providers', 'request_failure', 1, { providerId: p.providerId, endpointId: p.endpointId, code });

        if (code === '429' || code === 'RATE_LIMIT') {
          this.recordSignal('providers', 'rate_limit_429', 1, { providerId: p.providerId, endpointId: p.endpointId });
        } else if (code === '401' || code === '403' || code === 'AUTH_ERROR') {
          this.recordSignal('apiKeys', 'auth_failure', 1, { providerId: p.providerId, endpointId: p.endpointId });
        } else if (code === '404' || code === 'MODEL_NOT_FOUND') {
          this.recordSignal('models', 'model_not_found', 1, { providerId: p.providerId, endpointId: p.endpointId });
        } else if (code.startsWith('5') || code === 'TIMEOUT') {
          this.recordSignal('providers', 'server_error_5xx', 1, { providerId: p.providerId, endpointId: p.endpointId });
        }
      }),
    );

    // Failover
    unsubscribers.push(
      bus.subscribe('failover.triggered', (event: DomainEvent) => {
        const p = event.payload as { fromEndpointId?: string; toEndpointId?: string; reason?: string };
        this.recordSignal('failover', 'failover_count', 1, { from: p.fromEndpointId, to: p.toEndpointId, reason: p.reason });
      }),
    );

    // Agents
    unsubscribers.push(
      bus.subscribe('agent.failed', (event: DomainEvent) => {
        const p = event.payload as { agentId?: string; code?: string };
        this.recordSignal('localAgents', 'agent_failure', 1, { agentId: p.agentId, code: p.code });
      }),
    );

    // Workflows / Missions
    unsubscribers.push(
      bus.subscribe('task.execution.failed', (event: DomainEvent) => {
        const p = event.payload as { taskId?: string; agentId?: string; error?: string };
        this.recordSignal('missionEngine', 'task_failure', 1, { taskId: p.taskId, agentId: p.agentId });
      }),
    );

    this.unsubscribeBus = () => unsubscribers.forEach((u) => u());
  }

  clear(): void {
    this.signalsBySubsystem.clear();
  }

  private sanitizeMetadata(meta: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    const redactKeys = new Set(['key', 'apikey', 'api_key', 'token', 'authorization', 'secret', 'password', 'credential']);

    for (const [k, v] of Object.entries(meta)) {
      if (redactKeys.has(k.toLowerCase())) {
        clean[k] = '[REDACTED]';
      } else if (typeof v === 'string' && (v.startsWith('sk-') || v.length > 100)) {
        clean[k] = v.startsWith('sk-') ? '[REDACTED_API_KEY]' : v.slice(0, 100) + '...';
      } else if (typeof v === 'object' && v !== null) {
        try {
          clean[k] = JSON.parse(JSON.stringify(v));
        } catch {
          clean[k] = '[OBJECT]';
        }
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }
}

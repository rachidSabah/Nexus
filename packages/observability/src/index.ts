import { randomUUID } from 'node:crypto';

import type { TelemetryPort, EventBusPort, DomainEvent } from '@anx/core';

/**
 * Structured logger — JSON to stdout by default. Pino-compatible shape
 * so it can be swapped without changing call sites.
 */
export interface LogRecord {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly timestamp: string;
  readonly message: string;
  readonly correlationId?: string;
  readonly [k: string]: unknown;
}

export class StructuredLogger {
  constructor(private readonly sink: (record: LogRecord) => void = (r) => process.stdout.write(JSON.stringify(r) + '\n')) {}

  debug(message: string, meta: Record<string, unknown> = {}): void {
    this.emit('debug', message, meta);
  }
  info(message: string, meta: Record<string, unknown> = {}): void {
    this.emit('info', message, meta);
  }
  warn(message: string, meta: Record<string, unknown> = {}): void {
    this.emit('warn', message, meta);
  }
  error(message: string, meta: Record<string, unknown> = {}): void {
    this.emit('error', message, meta);
  }

  private emit(level: LogRecord['level'], message: string, meta: Record<string, unknown>): void {
    this.sink({
      level,
      timestamp: new Date().toISOString(),
      message,
      ...meta,
    });
  }
}

/**
 * Default in-process telemetry implementation. Records spans in memory and
 * exposes metrics via a Prometheus-compatible scrape endpoint.
 *
 * OpenTelemetry SDK integration: when the OTEL_EXPORTER_OTLP_ENDPOINT env var
 * is set, spans are also exported via OTLP to the configured collector
 * (Jaeger, Tempo, Honeycomb, etc.). The in-process implementation continues
 * to work alongside the OTLP exporter — the OTLP exporter is additive.
 *
 * To enable OTLP export:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *   OTEL_SERVICE_NAME=agent-nexus-gateway
 */
export class InProcessTelemetry implements TelemetryPort {
  readonly spans = new Map<string, SpanImpl>();
  readonly counters = new Map<string, { value: number; attrs: Record<string, number> }>();
  readonly gauges = new Map<string, { value: number; attrs: Record<string, number> }>();
  readonly histograms = new Map<string, { count: number; sum: number; attrs: Record<string, number> }>();
  /** OTLP exporter — activated when OTEL_EXPORTER_OTLP_ENDPOINT is set. */
  private readonly otlpEndpoint: string | undefined;
  private readonly serviceName: string;

  constructor() {
    this.otlpEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
    this.serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'agent-nexus-gateway';
    if (this.otlpEndpoint) {
      // Log that OTLP export is active. We use console directly since the
      // structured logger might not be initialized yet at construction time.
      // eslint-disable-next-line no-console
      console.info(`[telemetry] OTLP export active → ${this.otlpEndpoint} (service: ${this.serviceName})`);
    }
  }

  startSpan(name: string, attributes: Record<string, unknown> = {}): SpanImpl {
    const spanId = randomUUID();
    const span = new SpanImpl(spanId, name, attributes);
    this.spans.set(spanId, span);
    // If OTLP is configured, export the span on end.
    if (this.otlpEndpoint) {
      span.onEnd = () => this.exportSpanOtlp(span);
    }
    return span;
  }

  /** Exports a span via OTLP/HTTP to the configured collector. */
  private async exportSpanOtlp(span: SpanImpl): Promise<void> {
    if (!this.otlpEndpoint) return;
    try {
      const traceId = randomUUID().replace(/-/g, '');
      const otlpSpan = {
        traceId,
        spanId: span.id.replace(/-/g, '').slice(0, 16),
        name: span.name,
        kind: 0, // INTERNAL
        startTimeUnixNano: `${span.startTime}000000`,
        endTimeUnixNano: `${Date.now()}000000`,
        attributes: Object.entries(span.attributes).map(([k, v]) => ({
          key: k,
          value: { stringValue: String(v) },
        })),
        status: span.error ? { code: 2, message: span.error.message } : { code: 1 },
      };
      await fetch(`${this.otlpEndpoint}/v1/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceSpans: [{
            resource: { attributes: [{ key: 'service.name', value: { stringValue: this.serviceName } }] },
            scopeSpans: [{ scope: { name: this.serviceName }, spans: [otlpSpan] }],
          }],
        }),
      });
    } catch {
      // OTLP export failure should never break the request — swallow silently.
    }
  }

  meter(_name: string): {
    counter(name: string): { add(value: number, attrs?: Record<string, unknown>): void };
    gauge(name: string): { set(value: number, attrs?: Record<string, unknown>): void };
    histogram(name: string): { record(value: number, attrs?: Record<string, unknown>): void };
  } {
    return {
      counter: (name: string) => ({
        add: (value: number, attrs: Record<string, unknown> = {}) => {
          const key = `${name}:${Object.entries(attrs).sort().toString()}`;
          const existing = this.counters.get(key) ?? { value: 0, attrs: {} };
          existing.value += value;
          existing.attrs[name] = (existing.attrs[name] ?? 0) + value;
          this.counters.set(key, existing);
        },
      }),
      gauge: (name: string) => ({
        set: (value: number, attrs: Record<string, unknown> = {}) => {
          const key = `${name}:${Object.entries(attrs).sort().toString()}`;
          this.gauges.set(key, { value, attrs: { [name]: value } });
        },
      }),
      histogram: (name: string) => ({
        record: (value: number, _attrs: Record<string, unknown> = {}) => {
          const existing = this.histograms.get(name) ?? { count: 0, sum: 0, attrs: {} };
          existing.count++;
          existing.sum += value;
          this.histograms.set(name, existing);
        },
      }),
    };
  }

  /**
   * Render metrics in Prometheus text exposition format.
   */
  prometheus(): string {
    const lines: string[] = [];
    for (const [key, { value }] of this.counters) {
      const [name] = key.split(':');
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${value}`);
    }
    for (const [key, { value }] of this.gauges) {
      const [name] = key.split(':');
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }
    for (const [name, { count, sum }] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      lines.push(`${name}_count ${count}`);
      lines.push(`${name}_sum ${sum}`);
      lines.push(`${name}_avg ${count === 0 ? 0 : sum / count}`);
    }
    return lines.join('\n') + '\n';
  }
}

class SpanImpl {
  readonly startTime = Date.now();
  endTime?: number;
  readonly attributes: Record<string, unknown> = {};
  error?: Error;
  /** Called when the span ends — used by OTLP exporter. */
  onEnd?: () => void;

  constructor(
    readonly id: string,
    readonly name: string,
    attributes: Record<string, unknown>,
  ) {
    Object.assign(this.attributes, attributes);
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }

  recordError(error: Error): void {
    this.error = error;
  }

  end(): void {
    this.endTime = Date.now();
    if (this.onEnd) {
      try { this.onEnd(); } catch { /* swallow */ }
    }
  }
}

/**
 * Bridge: subscribe to domain events on the bus and emit OpenTelemetry
 * spans + structured log records + Prometheus counters.
 */
export function wireEventsToTelemetry(
  bus: EventBusPort,
  telemetry: InProcessTelemetry,
  logger: StructuredLogger,
): () => void {
  const unsubscribers: Array<() => void> = [];

  unsubscribers.push(
    bus.subscribe(
      ['request.received', 'route.resolved', 'provider.request.started',
       'provider.request.succeeded', 'provider.request.failed', 'failover.triggered',
       'health.changed', 'circuit_breaker.tripped'],
      (event: DomainEvent) => {
        const meter = telemetry.meter('anx');
        meter.counter(`anx_events_${event.type.replace(/\./g, '_')}`).add(1, { type: event.type });
        logger.debug(`event:${event.type}`, { type: event.type, payload: event.payload });
      },
    ),
  );

  unsubscribers.push(
    bus.subscribe('provider.request.succeeded', (event: DomainEvent) => {
      const p = event.payload as { endpointId: string; latencyMs: number; costUsd: number; inputTokens: number; outputTokens: number };
      const meter = telemetry.meter('anx');
      meter.histogram('anx_request_latency_ms').record(p.latencyMs, { endpoint: p.endpointId });
      meter.counter('anx_tokens_input_total').add(p.inputTokens, { endpoint: p.endpointId });
      meter.counter('anx_tokens_output_total').add(p.outputTokens, { endpoint: p.endpointId });
      meter.counter('anx_cost_usd_total').add(Math.round(p.costUsd * 1_000_000) / 1_000_000, { endpoint: p.endpointId });
    }),
  );

  unsubscribers.push(
    bus.subscribe('provider.request.failed', (event: DomainEvent) => {
      const p = event.payload as { endpointId: string; code: string };
      const meter = telemetry.meter('anx');
      meter.counter('anx_request_failures_total').add(1, { endpoint: p.endpointId, code: p.code });
    }),
  );

  // ─── Phase 4: Agent / Workflow / Memory / Tool metrics ─────────────────────

  unsubscribers.push(
    bus.subscribe('agent.started', (event: DomainEvent) => {
      const p = event.payload as { agentId: string };
      const meter = telemetry.meter('anx');
      meter.counter('anx_agent_tasks_started_total').add(1, { agentId: p.agentId });
    }),
  );

  unsubscribers.push(
    bus.subscribe('agent.completed', (event: DomainEvent) => {
      const p = event.payload as { agentId: string; durationMs: number; tokensUsed: number; costUsd: number; success: boolean };
      const meter = telemetry.meter('anx');
      meter.histogram('anx_agent_execution_time_ms').record(p.durationMs, { agentId: p.agentId });
      meter.counter('anx_agent_tokens_used_total').add(p.tokensUsed, { agentId: p.agentId });
      meter.counter('anx_agent_cost_usd_total').add(Math.round(p.costUsd * 1_000_000) / 1_000_000, { agentId: p.agentId });
      if (p.success) {
        meter.counter('anx_agent_tasks_succeeded_total').add(1, { agentId: p.agentId });
      }
    }),
  );

  unsubscribers.push(
    bus.subscribe('agent.failed', (event: DomainEvent) => {
      const p = event.payload as { agentId: string; code: string };
      const meter = telemetry.meter('anx');
      meter.counter('anx_agent_tasks_failed_total').add(1, { agentId: p.agentId, code: p.code });
    }),
  );

  unsubscribers.push(
    bus.subscribe('workflow.started', (event: DomainEvent) => {
      const p = event.payload as { workflowId: string };
      const meter = telemetry.meter('anx');
      meter.counter('anx_workflows_started_total').add(1, { workflowId: p.workflowId });
    }),
  );

  unsubscribers.push(
    bus.subscribe('workflow.completed', (event: DomainEvent) => {
      const p = event.payload as { workflowId: string; durationMs: number; stepsCompleted: number; stepsFailed: number; totalCostUsd: number; success: boolean };
      const meter = telemetry.meter('anx');
      meter.histogram('anx_workflow_duration_ms').record(p.durationMs, { workflowId: p.workflowId });
      meter.counter('anx_workflow_steps_completed_total').add(p.stepsCompleted, { workflowId: p.workflowId });
      meter.counter('anx_workflow_steps_failed_total').add(p.stepsFailed, { workflowId: p.workflowId });
      meter.counter('anx_workflow_cost_usd_total').add(Math.round(p.totalCostUsd * 1_000_000) / 1_000_000, { workflowId: p.workflowId });
      if (p.success) {
        meter.counter('anx_workflows_succeeded_total').add(1, { workflowId: p.workflowId });
      }
    }),
  );

  unsubscribers.push(
    bus.subscribe('workflow.step.completed', (event: DomainEvent) => {
      const p = event.payload as { agentId: string; success: boolean; durationMs: number };
      const meter = telemetry.meter('anx');
      meter.histogram('anx_workflow_step_duration_ms').record(p.durationMs, { agentId: p.agentId });
    }),
  );

  unsubscribers.push(
    bus.subscribe('memory.created', (event: DomainEvent) => {
      const p = event.payload as { scope: string; namespace: string; tokenCount: number };
      const meter = telemetry.meter('anx');
      meter.counter('anx_memory_created_total').add(1, { scope: p.scope, namespace: p.namespace });
      meter.counter('anx_memory_tokens_total').add(p.tokenCount, { scope: p.scope, namespace: p.namespace });
    }),
  );

  unsubscribers.push(
    bus.subscribe('memory.retrieved', (event: DomainEvent) => {
      const p = event.payload as { namespace: string; matches: number; topScore: number };
      const meter = telemetry.meter('anx');
      meter.counter('anx_memory_retrievals_total').add(1, { namespace: p.namespace });
      meter.histogram('anx_memory_retrieval_matches').record(p.matches, { namespace: p.namespace });
      meter.histogram('anx_memory_retrieval_top_score').record(p.topScore, { namespace: p.namespace });
    }),
  );

  unsubscribers.push(
    bus.subscribe('tool.executed', (event: DomainEvent) => {
      const p = event.payload as { toolName: string; agentId: string; durationMs: number; success: boolean };
      const meter = telemetry.meter('anx');
      meter.counter('anx_tool_executions_total').add(1, { toolName: p.toolName, agentId: p.agentId });
      meter.histogram('anx_tool_execution_duration_ms').record(p.durationMs, { toolName: p.toolName });
      if (!p.success) {
        meter.counter('anx_tool_failures_total').add(1, { toolName: p.toolName, agentId: p.agentId });
      }
    }),
  );

  unsubscribers.push(
    bus.subscribe('team.vote', (event: DomainEvent) => {
      const p = event.payload as { teamId: string; vote: string };
      const meter = telemetry.meter('anx');
      meter.counter('anx_team_votes_total').add(1, { teamId: p.teamId, vote: p.vote });
    }),
  );

  return () => unsubscribers.forEach((u) => u());
}

/**
 * Compute aggregate success rate metric: succeeded / (succeeded + failed).
 * Called by the gateway on a schedule to expose a gauge.
 */
export function computeSuccessRate(telemetry: InProcessTelemetry): number {
  const succeeded = telemetry.counters.get('anx_agent_tasks_succeeded_total:[]')?.value ?? 0;
  const failed = telemetry.counters.get('anx_agent_tasks_failed_total:[]')?.value ?? 0;
  const total = succeeded + failed;
  return total === 0 ? 1 : succeeded / total;
}

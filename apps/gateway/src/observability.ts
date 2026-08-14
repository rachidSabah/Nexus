/**
 * Nexus Phase 20 — Observability Fabric Registry
 * 
 * Tracks in-process request throughput, real latency percentiles (ring buffer),
 * concurrency gauges, and routing history.
 */

export interface LatencyStats {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
}

export interface RoutingDecisionRecord {
  timestamp: string;
  requestId: string;
  agent?: string;
  taskCategory?: string;
  intent?: string;
  selectedModel?: string;
  selectedProvider?: string;
  policy?: string;
  candidateCount: number;
  rejectedCount: number;
  reason?: string;
  fallbacks: number;
}

export class ObservabilityRegistry {
  private requestsTotal = 0;
  private requestsSuccess = 0;
  private requestsFailed = 0;
  private activeRequests = 0;

  // Latency ring buffer (1000 items)
  private readonly latencyBuffer: number[] = [];
  private readonly maxLatencySamples = 1000;

  // Routing decisions ring buffer (200 items)
  private readonly routingHistory: RoutingDecisionRecord[] = [];
  private readonly maxRoutingHistory = 200;

  recordRequestStart(): void {
    this.requestsTotal++;
    this.activeRequests++;
  }

  recordRequestEnd(durationMs: number, success: boolean): void {
    if (this.activeRequests > 0) {
      this.activeRequests--;
    }
    if (success) {
      this.requestsSuccess++;
    } else {
      this.requestsFailed++;
    }

    this.latencyBuffer.push(durationMs);
    if (this.latencyBuffer.length > this.maxLatencySamples) {
      this.latencyBuffer.shift();
    }
  }

  recordRoutingDecision(record: Omit<RoutingDecisionRecord, 'timestamp'>): void {
    this.routingHistory.push({
      ...record,
      timestamp: new Date().toISOString(),
    });
    if (this.routingHistory.length > this.maxRoutingHistory) {
      this.routingHistory.shift();
    }
  }

  getRecentRouting(limit = 50): RoutingDecisionRecord[] {
    return this.routingHistory.slice(-limit).reverse();
  }

  getLatencyStats(): LatencyStats {
    if (this.latencyBuffer.length === 0) {
      return { avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, sampleCount: 0 };
    }

    const sorted = [...this.latencyBuffer].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const count = sorted.length;

    const p50Index = Math.floor(count * 0.5);
    const p95Index = Math.min(Math.floor(count * 0.95), count - 1);
    const p99Index = Math.min(Math.floor(count * 0.99), count - 1);

    return {
      avgMs: Math.round(sum / count),
      p50Ms: Math.round(sorted[p50Index] ?? 0),
      p95Ms: Math.round(sorted[p95Index] ?? 0),
      p99Ms: Math.round(sorted[p99Index] ?? 0),
      sampleCount: count,
    };
  }

  getSnapshot() {
    const lat = this.getLatencyStats();
    return {
      requestsTotal: this.requestsTotal,
      requestsSuccess: this.requestsSuccess,
      requestsFailed: this.requestsFailed,
      activeRequests: this.activeRequests,
      avgLatencyMs: lat.avgMs,
      p50Ms: lat.p50Ms,
      p95Ms: lat.p95Ms,
      p99Ms: lat.p99Ms,
    };
  }
}

export const globalObservability = new ObservabilityRegistry();

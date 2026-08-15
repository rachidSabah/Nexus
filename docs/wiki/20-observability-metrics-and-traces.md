# 20 — Observability, Metrics & Traces

[← Previous: Operations Control Plane](19-operations-control-plane.md) | [Index](01-introduction-and-overview.md) | [Next: Realtime Events & Telemetry Streaming →](21-realtime-events-and-telemetry-streaming.md)

---

## High-Performance Metrics & Percentiles

Nexus measures real-time operational telemetry with sub-millisecond overhead:

- **Latency Percentiles**: P50, P90, P95, P99 calculated over a bounded sliding window via `OperationsMetricsTracker`.
- **Request Tracing**: End-to-end tracing with Time-To-First-Token (TTFT) and token breakdown via `RequestTracer`.
- **Prometheus Export**: Industry standard scraping on `/metrics`.

---

## Metrics API

```http
GET /v1/system/metrics
```

Response:
```json
{
  "timestamp": "2026-08-15T08:00:00.000Z",
  "gateway": {
    "uptimeSeconds": 14200,
    "memoryRssMb": 182,
    "heapUsedMb": 94
  },
  "traffic": {
    "totalRequests": 12450,
    "successCount": 12390,
    "errorCount": 60,
    "errorRatePct": 0.48,
    "tokensProcessed": 4820000,
    "latency": {
      "avgMs": 240,
      "p50Ms": 180,
      "p90Ms": 420,
      "p95Ms": 650,
      "p99Ms": 1100
    }
  },
  "traces": {
    "total": 12450,
    "success": 12390,
    "failed": 60,
    "cached": 3120,
    "fallbackRate": 0.02,
    "avgLatencyMs": 240,
    "avgTtftMs": 120
  }
}
```

---

[← Previous: Operations Control Plane](19-operations-control-plane.md) | [Index](01-introduction-and-overview.md) | [Next: Realtime Events & Telemetry Streaming →](21-realtime-events-and-telemetry-streaming.md)

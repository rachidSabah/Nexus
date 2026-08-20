# 22 — Production Operations Dashboard

[← Previous: Realtime Events & Telemetry Streaming](21-realtime-events-and-telemetry-streaming.md) | [Index](01-introduction-and-overview.md) | [Next: Security, RBAC & Isolation →](23-security-rbac-and-isolation.md)

---

## Modern Dark-Mode Glassmorphic Interface

Nexus includes a production-ready Next.js 15 web application (`apps/dashboard/`) designed for real-time monitoring and control.

### Dashboard Capabilities

- **14-Pillar Health Matrix**: Real-time traffic-light indicators across all subsystems.
- **Dynamic Diagnostics**: Instant root-cause breakdowns and recommended operator remediations.
- **Mission Control Center**: Visual DAG task inspection, real-time SSE progress logs, pause/resume/cancel controls.
- **Provider & Model Catalog**: Capability tags, free-tier badges, live endpoint health toggles.
- **Token Efficiency & Budget Visualizer**: Compression savings, cache hit rates, cost burn charts.

### Competitive Edge Dashboards (latest)

These dashboards turn static claims into **live, measured** telemetry — every value is computed from the running gateway (no fabricated quotas):

- **Compression Lab** (`/compression`): paste any prompt → real per-engine token savings (minify · dedupe · collapse-arrays · elide-middle) from the stacked `compressPipeline` (`POST /v1/compression/pipeline-preview`).
- **Routing Decision Replay** (`/routing-replay`): click any past request → real fallback attempt chain + live candidate ranking and why the winner won (`GET /v1/traces`).
- **Cost & Budget Dashboard** (`/cost-budget`): live token burn + per-provider throughput + configurable budget guard with over/near-ceiling alerts (`GET /v1/metrics/usage`, `/v1/metrics/providers`).
- **Strategy A/B Simulator** (`/strategy-sim`): rank the same candidate pool under two routing strategies and compare outcomes side-by-side (read-only `POST /v1/routing/compare`).
- **Agent Health & Resilience Board** (`/resilience`): circuit-open / degraded providers, detached long-tasks, and orchestrated-agent failovers in one ops view (`GET /v1/tasks`, `/v1/agents/executions`, `/v1/metrics`).

> Introduced in commits `a4ed97f` (Compression Lab) and `2725c3a` (the four dashboards).

```
┌────────────────────────────────────────────────────────────────────────┐
│  NEXUS CONTROL PLANE — PRODUCTION OPERATIONS DASHBOARD                 │
├────────────────────────────────────────────────────────────────────────┤
│  [OVERALL: HEALTHY]  • Uptime: 4h 12m • Requests: 12.4k • P95: 650ms   │
├────────────────────────────────────────────────────────────────────────┤
│  SUBSYSTEM PILLARS (14/14 HEALTHY)                                     │
│  [✓] Ingress Gateway    [✓] Routing Engine       [✓] Model Registry    │
│  [✓] Key Registry       [✓] Credential Vault     [✓] Agent Bridge      │
│  [✓] Agent Orchestrator [✓] Mission Orchestrator [✓] Persistence       │
│  [✓] Crash Recovery     [✓] Observability        [✓] Token Optimizer   │
│  [✓] Service Mesh       [✓] Security & RBAC                            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Running the Dashboard

```bash
pnpm --filter @anx/dashboard dev
```

Open `http://localhost:3000` to view the control plane.

---

[← Previous: Realtime Events & Telemetry Streaming](21-realtime-events-and-telemetry-streaming.md) | [Index](01-introduction-and-overview.md) | [Next: Security, RBAC & Isolation →](23-security-rbac-and-isolation.md)

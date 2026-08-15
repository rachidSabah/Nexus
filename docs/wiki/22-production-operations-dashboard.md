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

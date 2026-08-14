# NEXUS PHASE 6 AUDIT REPORT

## Executive Summary
This document records the architectural baseline, existing capabilities, reusable components, and specific gaps in the Nexus repository prior to initiating Phase 6 (Autonomous Execution & Control Plane).

---

## 1. Existing Architecture & Baseline
- **Hexagonal Domain & Orchestration (`@anx/core`):** `AgentTask`, `AgentRun`, `TaskStatus`, `TaskCategory` defined in `packages/core/src/domain/orchestration.ts`.
- **Application Services:** `TaskOrchestrator`, `AgentSelector`, `InMemoryTaskStore`, `SubprocessAgentExecutor`.
- **Gateway Endpoints:** `/v1/orchestration/plan`, `/v1/orchestration/tasks`, `/v1/orchestration/tasks/:id`, `/v1/debug/orchestration/explain`.

---

## 2. Gaps & Lifecycle Upgrade Plan for Phase 6
1. **Formal Task State Machine (UPGRADE):** Expand `TaskStatus` to include `CREATED`, `PLANNING`, `PLANNED`, `QUEUED`, `STARTING`, `RUNNING`, `WAITING`, `RETRYING`, `COMPLETED`, `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`, `TIMED_OUT` with strict transition validation.
2. **Concurrency Manager & Scheduler (NEW):** Implement `ConcurrencyManager` with configurable `maxConcurrency` (default 10 via `NEXUS_MAX_CONCURRENCY`), queue depth tracking, and slot allocation.
3. **Task Cancellation & SSE Streaming (NEW):** Implement `POST /v1/orchestration/tasks/:id/cancel` and `GET /v1/orchestration/tasks/:id/stream` (SSE output stream for stdout/stderr).
4. **Retry & Failover Engine (UPGRADE):** Exponential backoff with jitter, model failover across free/paid policies, and agent failover.
5. **Orchestration Status & Template Endpoints (NEW):** Expose `/v1/orchestration/status`, `/v1/orchestration/templates`, and `/v1/orchestration/history`.

# NEXUS PHASE 11 AUDIT REPORT — AGY APPLICATION BUILDER INTEGRATION

## Executive Summary
This audit document records the detailed repository inspection and architectural boundary analysis conducted prior to implementing Nexus Phase 11. 

- **Target Objective:** Make AGY the primary autonomous application building agent while preserving Nexus as the autonomous control plane.
- **Architectural Boundary:**
  `USER → NEXUS CONTROL PLANE → ApplicationEngine → AutonomousPlanner → RiskEngine → Workflow DAG → AGY BUILDER → Nexus Routing Fabric → Models/Providers → Generated Application → Tests/Verification → Application State → USER`

---

## 1. Existing Subsystem Inspection & Capability Matrix

| Subsystem | Existing Location | Responsibilities | Phase 11 Integration Point |
| :--- | :--- | :--- | :--- |
| **Application Subsystem** | `packages/core/src/application/application-engine.ts` | State machine & application lifecycle | Upgraded with Phase 11 lifecycle stages (`DISCOVER` → `COMPLETED`) & repair loop |
| **Domain Models** | `packages/core/src/domain/application.ts` | Value objects for app spec & state | Extended with `workspace`, `buildContext`, `eventLog`, and `ApplicationStage` |
| **AGY Domain Port** | `packages/core/src/domain/agy-builder.ts` | Domain contract for build runtime | Created `AgyBuilderPort`, `WorkspaceConfig`, `AgyBuildTask`, `AgyBuildResult` |
| **Autonomous Planner** | `packages/core/src/application/autonomous-planner.ts` | Prompt classification & DAG generation | Extended to output AGY execution nodes (`AGY_SCAFFOLD`, `AGY_IMPLEMENT`, `AGY_TEST`, `AGY_VERIFY`) |
| **Risk Engine** | `packages/core/src/application/risk-engine.ts` | Safety classification (`LOW`..`CRITICAL`) | Integrated approval gates for `HIGH`/`CRITICAL` risk applications |
| **Workflow Fabric** | `packages/core/src/application/workflow-orchestrator.ts` | Execution engine & checkpointing | Restores and checkpoints AGY process state and repair attempts |
| **Task Orchestration** | `packages/core/src/application/task-orchestrator.ts` | Task dispatch & agent selection | Connects AGY execution nodes to dynamic routing fabric |
| **Routing Engine** | `packages/core/src/application/routing-engine.ts` | Model/Provider selection | Resolves model policies (`nexus/best-coding`, `nexus/fast`, `nexus/long-context`) to endpoints |
| **Agent Detector** | `apps/gateway/src/agent-detector.ts` | System binary discovery | Detected AGY CLI v1.1.12 at `~\AppData\Local\agy\bin\agy.exe` |
| **REST Server** | `apps/gateway/src/server.ts` | HTTP API routes | Added Phase 11 endpoints (`/v1/applications/:id/build`, `/v1/applications/:id/events`, etc.) |

---

## 2. AGY Detection & Invocation Analysis

- **AGY Binary Location:** `~\AppData\Local\agy\bin\agy.exe`
- **AGY CLI Version:** `1.1.12`
- **Invocation Mechanism:**
  - Non-interactive mode: `agy --print --dangerously-skip-permissions --model <policy> "<prompt>"`
  - Gateway Integration via environment injection:
    - `OPENAI_BASE_URL=http://127.0.0.1:8787/v1`
    - `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`
    - `NEXUS_TARGET_MODEL=<selected_model>`
    - `CI=true`
    - `NO_COLOR=1`
  - Direct provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are scrubbed from AGY subprocess environment to force model traffic through Nexus Routing Fabric.

---

## 3. Integration Gaps & Risk Analysis

1. **Workspace Safety:** Need strict isolation so AGY cannot modify the Nexus codebase itself (`E:/CodingGhost`).
   - *Mitigation:* Managed workspace model under `~/.nexus/applications/<id>/` with path traversal validation in `AgyBuilderAdapter` and `ApplicationVerifier`.
2. **Infinite Repair Loops:** Risk of continuous failing test repair attempts.
   - *Mitigation:* Bounded repair loop (`maxRepairAttempts = 3`) with checkpointing after every attempt.
3. **Secret Leakage:** Risk of exposing API keys in stdout/stderr logs.
   - *Mitigation:* Redaction helper `sanitizeEnvForLogging` and stripping sensitive environment headers before emitting domain events.

---

## 4. Implementation Plan Summary

1. **Domain Abstraction:** Create `agy-builder.ts` with `AgyBuilderPort` and `WorkspaceConfig`.
2. **Adapter Implementation:** Build `AgyBuilderAdapter` handling subprocess spawn, timeout, cancellation, and simulation fallback.
3. **Pipeline Upgrade:** Refactor `ApplicationEngine` to support the full 12-stage lifecycle.
4. **Artifact Verification:** Create `ApplicationVerifier` to inspect build outputs and manifests.
5. **Gateway REST & SSE:** Add `/v1/applications/:id/build`, `/v1/applications/:id/events`, `/v1/doctor` extension.
6. **Quality Gates:** Verify zero type errors, 100% passing tests, and clean production build.

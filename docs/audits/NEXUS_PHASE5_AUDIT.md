# NEXUS PHASE 5 AUDIT REPORT

## Executive Summary
This document records the architectural baseline, existing capabilities, reusable modules, and specific gaps in the Nexus repository prior to initiating Phase 5 (Autonomous Coding-Agent Orchestration & Control Plane).

---

## 1. Existing Architecture & Baseline
- **Hexagonal Core (`@anx/core`):** Domain models (`types.ts`, `events.ts`, `errors.ts`), ports (`ports.ts`), and application services (`RoutingEngine`, `ModelRegistry`, `KeyRegistry`, `PromptCompressor`, `ContextWindowManager`, `TaskClassifier`, `InMemoryEventBus`).
- **Gateway Server (`@anx/gateway`):** Fastify HTTP server (`server.ts`) exposing OpenAI/Anthropic projections, model fabric endpoints, diagnostic endpoints (`/v1/doctor`, `/v1/catalog`, `/v1/debug/tokens`), and Phase 4 runtime agent management (`/v1/runtime-agents`).
- **Agent Integration Layer (`@anx/integrations`):** 18 built-in agent connectors for Claude Code, Codex CLI, Gemini CLI, Hermes CLI, OpenCode, Aider, Cline, Roo Code, etc.
- **Agent Detection & Runtime (`AgentDetector` & `AgentRuntimeManager`):** Machine-wide binary detection across PATH and config files; safe configuration backup and installation.

---

## 2. Reusable Subsystems for Orchestration
1. **`TaskClassifier` & `IntentDetector`:** Automatically classifies workloads (`CODING`, `DEBUGGING`, `REFACTORING`, `TESTING`, `REASONING`, `VISION`, `TOOL_USE`, etc.).
2. **`RoutingEngine` & `ScoringEngine`:** Autonomous O(1) set-intersection routing (`RoutingIndexManager`) respecting health, pricing (FREE vs PAID), context window limits, EWMA latency, and model capabilities.
3. **`AgentRuntimeManager` & `AgentDetector`:** Returns live detected, configured, runnable, and live-verified agent matrix.
4. **`InMemoryEventBus`:** Asynchronous domain event emitter handling events without blocking requests.

---

## 3. Identifiable Gaps for Phase 5
1. **Task Orchestration Engine (MISSING):** No core domain entities or application services for managing high-level multi-step coding tasks (`taskId`, `status`, `prompt`, `requestedAgent`, `selectedAgent`, `parentTaskId`, `childTasks`).
2. **Autonomous `AgentSelector` (MISSING):** No scoring module to map task requirements to the optimal installed coding agent based on capability, protocol, and health.
3. **Subprocess `AgentExecutor` (MISSING):** No isolation mechanism to safely launch and manage CLI agent subprocesses (Claude Code, Codex CLI, Hermes CLI) with timeout, working directory, and stdout/stderr capture.
4. **Task Persistence & In-Memory Queue (MISSING):** No task queue or persistence port for task state tracking across execution attempts.
5. **Multi-Agent Handoff & Decomposition (MISSING):** No protocol for passing context, files, and results between agent execution stages.
6. **Orchestration APIs & Endpoints (MISSING):** No REST endpoints (`/v1/orchestration/tasks`, `/v1/orchestration/plan`, `/v1/debug/orchestration/explain`) or WebSocket event channels for orchestration tasks.

---

## 4. Next Action & Implementation Plan
Implement Phase 5 incrementally:
- **Phase 5.2:** Define orchestration domain models (`AgentTask`, `AgentRun`, `TaskStatus`, `OrchestrationEvent`) and ports (`AgentExecutorPort`, `TaskStorePort`).
- **Phase 5.3:** Create `AgentSelector` evaluating detected agents against task capabilities.
- **Phase 5.4:** Create `TaskOrchestrator` combining task planning, intent detection, agent selection, and routing.
- **Phase 5.5:** Create `SubprocessAgentExecutor` for real CLI agent execution.
- **Phase 5.6:** Create `InMemoryTaskStore` and lightweight queue.
- **Phase 5.7:** Implement task retry, autonomous failover, and multi-agent handoff.
- **Phase 5.8:** Implement REST endpoints and catalog/doctor extensions.
- **Phase 5.9:** Execute unit, integration, quality gate, and live E2E verification.

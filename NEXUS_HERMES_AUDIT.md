# NEXUS Hermes Phase — Verification Audit

Branch/worktree: `hermes` (working tree)
Audit date: 2026-08-13
Auditor: Hermes (building agent) — source of truth is the local working tree.

## 1. Executive summary

Agent Nexus Gateway has a **real, working, broadly complete** HTTP API surface: a
universal model identity/fabric layer (`interop-*` bridges), model discovery
(OpenCode Zen + NVidia NIM adapters), catalog, doctor/diagnostics, runtime-agent
binding for 18 AI tools, key rotation, orchestration engines (autonomous,
task, workflow, application/AGY build), pricing, risk, tracing, debug
subsystem, streaming, tool calls, and a multi-page dashboard.

Most of STEP 1–13 of the Hermes-phase brief are DONE or PARTIAL. Gaps that
undermine integrity or the user experience are:

| # | Gap | Severity |
|---|-----|----------|
| 1 | `/v1/doctor` reports a **hardcoded** `apiKeysLoaded: 3` instead of the real key count | HIGH (fabricated metric) |
| 2 | `/v1/debug/hermes` endpoint **does not exist** (STEP 13 explicitly required) | HIGH (required deliverable) |
| 3 | Hermes CLI integration is not first-class: refuses to bind by default (`skipIfConfigured: true`) and there is no runtime Hermes diagnostics/build tracking | MEDIUM (brief: "Hermes must be a first-class building agent") |
| 4 | Dashboard has **no Models page** although model discovery is complete — user reports pages decorative/missing | MEDIUM (UX) |

Everything else required by the brief was verified as implemented; details and
evidence below.

## 2. What is verified real (source-of-truth checklist)

### STEP 1 — Goal alignment
- `docs/GATEWAY.md`, `docs/AGY_INTEGRATION.md`, `apps/gateway/README` describe
  unified model identity, discovery, routing, agent binding. GATEWAY.md already
  documents routing + agent binding flow. **DONE.**

### STEP 2 — API baseline (OpenAI-compatible)
- `apps/gateway/src/server.ts`: `/v1/chat/completions`, `/v1/models*`,
  `/v1/completions`, `/v1/embeddings`, `anthropic-compat.ts`,
  `responses-compat.ts` (OpenAI Responses). **DONE.**

### STEP 3 — Catalog & discovery
- `claude-catalog.ts` (1,300+ Claude models), `model-fabric.ts`,
  `model-aliases.ts` (`nexus/*`, `local/*` builtins, custom file),
  `OpenCodeZenAdapter` + `NvidiaNimAdapter`, `/v1/catalog`,
  `/v1/models/discover`, `/v1/models/stats`. Phase 11 report + tree confirm
  60 models discovered from opencode-zen. **DONE (verified via probing earlier
  this session — discovery returned real catalog data).**

### STEP 4 — Routing & scoring
- `routing-index.ts`, `scoring-engine.ts`, `model-aliases.ts`, concurrency
  manager, `/v1/aliases`, and alias mutation (`/v1/aliases` PUT/DELETE per
  tree). **DONE.**

### STEP 5 — Streaming & tool calls
- Streaming implemented (SSE), native tool calls, function-call flattening
  (coerce into tool_calls) verified in trace logs earlier this session. **DONE.**

### STEP 6 — Multi-key rotation
- `packages/core/src/application/key-registry.ts` with `adaptive` /
  `round_robin` rotation, circuit breaker on 401/403, persistence of key
  descriptors across restarts (`runtime.ts:266-276`). **DONE.**

### STEP 7 — Free-tier exhaustion
- Free-tier matching exists in the model fabric/alias layer. GAP noted in
  §3 (see Step-7 hardening below). **PARTIAL** — re-verified in this phase.

### STEP 8 — Dashboard
- Next.js app with 17 pages (home, agents, providers, keys, requests, logs,
  integrations, settings, router-studio, workflows, workflow-editor, security,
  teams, mcp, memory, network, plugins, marketplace). Requests page streams WS
  events from `/v1/ws`. **PARTIAL** — Models page missing.

### STEP 9 — Runtime agent management
- `agent-runtime-manager.ts`, `agent-detector.ts`, `/v1/runtime-agents`,
  `/v1/runtime-agents/:id`, `/v1/runtime-agents/configure`,
  `/v1/runtime-agents/restore`, `/v1/runtime-agents/configure-all`. **DONE.**

### STEP 10 — CLI / gateway registry
- `packages/integrations` (18 builtins incl. Hermes, OpenCode Zen).
  `apps/cli` surfaces `anx integrations ...`. **DONE.**

### STEP 11 — Orchestration engines
- `autonomous-planner.ts`, `task-orchestrator.ts`, `workflow-orchestrator.ts`,
  `dag-engine.ts`, `application-engine.ts`, `agy-builder-adapter.ts`,
  `/v1/orchestration/*`, `/v1/workflow-fabric/*`, `/v1/applications/*`. **DONE.**

### STEP 12 — Diagnostics & observability
- `/v1/doctor`, `/v1/debug/models`, `/v1/debug/engine`, `/v1/traces`,
  `/v1/debug/diagnostics`, `/v1/debug/repo-index`, `/v1/debug/context-win`,
  `/v1/metrics/pricing`, score attribution in traces. **DONE.** One integrity
  bug found: hardcoded key count (Gap 1).

### STEP 13 — (Requirement of THIS phase) Hermes build diagnostics
- **GAP: `/v1/debug/hermes` missing.** Also no Hermes build tracker and the
  Hermes integration refuses to bind. Addressed in Increments 1–3 (§4).

## 3. Gap matrix (detailed)

| STEP | Requirement | Status | Evidence / Notes |
|------|-------------|--------|------------------|
| 1 | Goal alignment doc | DONE | docs/GATEWAY.md, docs/AGY_INTEGRATION.md |
| 2 | OpenAI-compatible API | DONE | server.ts chat/completions, anthropic-compat, responses-compat |
| 3 | Model discovery/catalog | DONE | claude-catalog, opcodezen/nim adapters, /v1/catalog, /v1/models/discover; probed live this session |
| 4 | Routing/scoring/aliases | DONE | routing-index, scoring-engine, model-aliases, /v1/aliases |
| 5 | Streaming + tool calls | DONE | SSE streaming, native tool_calls; verified in trace logs |
| 6 | Multi-key rotation | DONE | key-registry.ts adaptive/round_robin + 401/403 circuit breaker |
| 7 | Free-tier exhaustion | PARTIAL | Free-only alias resolution leaves no candidate; not yet a clean 503 NO_ELIGIBLE_PROVIDER. Hardening planned. |
| 8 | Dashboard | PARTIAL | 17 pages; Models page missing |
| 9 | Runtime agent management | DONE | agent-runtime-manager, agent-detector, runtime-agents routes |
| 10 | CLI/gateway registry | DONE | integrations pkg (18 builtins), anx CLI |
| 11 | Orchestration engines | DONE | autonomous/task/workflow/dag/application engines + routes |
| 12 | Diagnostics/observability | PARTIAL | Extensive; hardcoded vaultKeysCount in /v1/doctor (server.ts:413) |
| 13 | Hermes build diagnostics + first-class integration | GAP | No /v1/debug/hermes; hermes-cli skipIfConfigured=true; no Hermes runtime tracking |

## 4. Plan (increments, each with verify step)

1. **Increment 1** — Real `/v1/debug/hermes`: detection, configured state,
   gateway URL, protocol, active model (resolved `nexus/*` policy), build
   stats from a real in-memory Hermes build tracker fed by the application
   engine. Fix `/v1/doctor` hardcoded key count → `keyRegistry.listAll().length`.
2. **Increment 2** — First-class Hermes binding: dynamic gateway-provider block
   + `NEXUS_TARGET_MODEL`, opt-in via `anx integrations install hermes-cli
   --force` / `NEXUS_BIND_HERMES=1`, dry-run support (already in base), while
   preserving Hermes' own ecosystem contract.
3. **Increment 3** — Dashboard **Models page** (real data: /v1/models/discover,
   /v1/catalog, free/capability filters, provider breakdown, refresh), added to
   Sidebar.
4. **Increment 4** — Step-7 hardening: free-only request with no free candidate
   → `503 NO_ELIGIBLE_PROVIDER` (not a 500 unknown-model).
5. **Verify** — typecheck + tests for touched packages, build both apps, boot
   gateway, curl probe `/v1/debug/hermes`, `/v1/catalog`, `/v1/models/discover`,
   `/v1/doctor`; then write `NEXUS_HERMES_PHASE_REPORT.md`.

## 5. Integrity rules (applied this phase)

- No fabricated metrics — any number exposed by the API must come from a real
  source (the hardcoded `vaultKeysCount` is the canonical counter-example and
  is being fixed).
- No blind overwrites of user config — Hermes binding stays opt-in.
- Every increment must be verified (typecheck/test/probe) before the next.

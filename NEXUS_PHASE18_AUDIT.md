# NEXUS PHASE 18 — Repository Audit

**Date:** 2026-08-14
**Scope:** Full repository inspection before implementing Phase 18 (Universal Agent Registry, Agent Operations, BuildingAgentPort for Hermes/OpenCode, unified Execution Trace, Application Operations Center).
**Method:** Direct source reads (`read_file`) + `grep` over `apps/` and `packages/` (node_modules excluded). Every claim below is backed by a file/line citation. No subsystem was assumed — each was read or grepped.

---

## 1. Legend

- ✅ EXISTS & wired
- 🟡 EXISTS but incomplete / not wired to REST or UI
- ❌ MISSING (gap, must be built)
- ⚠️ SMELL (works but should be fixed)

---

## 2. Existing subsystems (evidence)

### 2.1 Agent detection — ✅ exists
- `apps/gateway/src/agent-detector.ts` (339 lines). `AgentDetector` auto-detects **22 known coding agents** via PATH (`where`/`command -v`), npm global packages, and config-file existence.
- Known agents include: `claude-code`, `codex-cli`, `gemini-cli`, `hermes-cli`, `opencode`, `opencode-go`, `opencode-zen`, `aider`, `cline`, `roo-code`, `openhands`, `goose`, `crush`, `kimi-code`, `qwen-code`, `cursor`, `zed`, `vscode`, `jetbrains`, `neovim`, `emacs`.
- Non-destructive (inspect only). `detectAll()` returns found AND not-found entries for a full detection matrix.
- REST: `GET /v1/agents/detect` (server.ts:2183), `GET /v1/agents/detect/:id` (server.ts:2194).

### 2.2 Agent runtime manager / configuration — ✅ exists
- `apps/gateway/src/agent-runtime-manager.ts` (169 lines). `AgentRuntimeManager` has `listAgents`, `getAgent`, `configureAgent`, `configureAll`, `restoreAgent`.
- Uses `@anx/integrations` `createIntegrationRegistry()` for connector adapters; backs up existing config before writing; emits SHA-256 checksums.
- `liveVerified` is hardcoded true only for `claude-code`, `codex-cli`, `hermes-cli` (lines 36, 46, 85, 121) — other detected agents are never marked live-verified.
- REST: `GET /v1/runtime-agents` (server.ts:556), `GET /v1/runtime-agents/environment` (server.ts:562), `GET /v1/runtime-agents/:id` (server.ts:575), `POST /v1/runtime-agents/:id/configure` (server.ts:585), `POST /v1/runtime-agents/:id/restore` (server.ts:592), `POST /v1/runtime-agents/configure-all` (server.ts:598).

### 2.3 Agent registry (registered agents) — ✅ exists (separate from detection)
- REST: `GET /v1/agents` (server.ts:3086), `GET /v1/agents/stats` (server.ts:3090), `GET /v1/agents/:id` (server.ts:3094), `POST /v1/agents` (server.ts:3101), `DELETE /v1/agents/:id` (server.ts:3119), `POST /v1/agents/:id/tasks` (server.ts:3126).
- Two parallel agent concepts coexist: **registry agents** (`/v1/agents`, CRUD + tasks) and **runtime agents** (`/v1/runtime-agents`, detection/configuration). Phase 18 must reconcile/unify these into the "Universal Agent Registry".

### 2.4 Application engine — ✅ exists
- `packages/core/src/application/application-engine.ts` (727 lines). `ApplicationEngine` implements the full Phase 11 build lifecycle: `DISCOVER → SPECIFY → ARCHITECT → PLAN → APPROVAL → SCAFFOLD → BUILD → TEST → REPAIR(loop) → VERIFY → FINALIZE → COMPLETED`.
- Emits `application.*`, `agy.*` events via `EventBusPort`.
- Build/repair loop bounded by `maxRepairAttempts` (default 3), `buildTimeoutMs` (default 300s).
- Uses `AgyBuilderPort` for actual build/test/fix operations (see 2.5).

### 2.5 Building port — 🟡 partial
- `AgyBuilderPort` exists: `packages/core/src/domain/agy-builder.ts` (interface at line 111): `detect()`, `healthCheck()`, `initializeProject()`, `build()`, `test()`. Real adapter: `packages/core/src/application/agy-builder-adapter.ts`.
- ❌ **`BuildingAgentPort` does NOT exist** anywhere in the repo (grep over `packages` + `apps` returned nothing). The spec calls for a `BuildingAgentPort` abstraction to integrate **Hermes** and **OpenCode** as coding-agent runtimes. Today, coding-agent integration is done through `@anx/integrations` connectors (in `AgentRuntimeManager`), NOT through a core port. This is a gap to build.

### 2.6 Session manager (Agent Session Fabric, prior Phase 17) — 🟡 exists in core, not exposed
- `packages/core/src/application/session-manager.ts` (282 lines). `SessionManager` with full lifecycle: `create`, `start`, `send`, `pause`, `resume`, `cancel`, `restart`, `checkpoint`, `restore`, `recordFailover`, `get`, `list`.
- Uses explicit state machine via `assertTransition` (`packages/core/src/domain/session.ts`). Runtime = `SubprocessSessionRuntime` (`session-runtime.ts`) — real subprocess spawn + stdout/stderr streaming.
- Store: `InMemorySessionStore` (`session-store.ts`).
- Events published: `session.created`, `session.started`, `session.message.received`, `session.message.sent`, `session.start.failed`, `session.paused`, `session.resumed`, `session.cancelled`, `session.completed`, `session.failed`, `session.checkpoint.created`, `session.recovered`, `session.model.failover`.
- ⚠️ These `session.*` events are **NOT declared as typed `DomainEvent` members** in `packages/core/src/domain/events.ts`. `DomainEvent.type` is open (`string`), so they compile and flow through the bus, but they are not part of the typed contract. Should be added for type-safety.
- ❌ **NO REST endpoints** for sessions: grep for `/v1/sessions` in `server.ts` returns nothing (only the `sessions: SessionManager` deps field at line 126). So the SessionManager is constructed and injected but currently unreachable over HTTP.
- ❌ **NO SSE/WebSocket channel** exposes session events to the dashboard (the `/api/ws` socket exists and is now stable, but no session subscription is wired).

### 2.7 Event bus — ✅ exists
- `packages/core/src/application/event-bus.ts` (65 lines). `InMemoryEventBus` implements `EventBusPort`; fan-out via per-subscriber queues; `subscribeAll()` for wildcard (audit/debug). Handler errors are swallowed so the bus never dies.
- Note: in-memory only; comment says "swap with Redis Streams / NATS JetStream for production." Multi-instance fan-out is a known limitation.

### 2.8 Gateway WebSocket / realtime — 🟡 partial
- `apps/gateway/src/server.ts:3310+` registers `fastify.websocket('/ws', ...)` (the `/ws` route). Dashboard proxies `/api/ws` → `/ws` (next.config). The `useLiveEvents` hook (dashboard) now opens it correctly (fixed this session).
- Only generic events are broadcast; there is **no per-channel subscription** (e.g. `session:<id>`, `agent:<id>`, `application:<id>`). Phase 18 realtime (spec step 14) needs channel scoping.

### 2.9 Orchestration / Workflow fabric — ✅ exists
- REST: `/v1/orchestration/*` (status, history, templates, plan, tasks, cancel, retry) and `/v1/workflow-fabric/*` (create, validate, runs, pause, resume, cancel, approve, reject, **events**). The workflow-fabric runs already have `GET /v1/workflow-fabric/:id/runs/:runId/events` (server.ts:799) — a model for the session/application SSE channels.

### 2.10 Routing / provider registry — ✅ exists
- `/v1/routing/policies`, `/v1/catalog`, `/v1/models`, `/v1/models/discover`, `/v1/models/stats` all live (verified 200 this session). `RoutingEnginePort` resolves model→endpoint→provider. `ApplicationEngine` already calls `routing.resolve()` for model selection.

### 2.11 Dashboard — 🟡 partial
Pages present: `agents`, `models`, `providers`, `keys`, `router-studio`, `workflows`, `workflow-editor`, `teams`, `memory`, `requests`, `integrations`, `marketplace`, `logs`, `plugins`, `network`, `security`, `mcp`, `settings`, `overview` (root).
- `agents/page.tsx` (359 lines) consumes `/v1/agents`, `/v1/agents/stats`, `/v1/agents/detect` and supports dynamic model push to agents.
- ❌ **No `sessions` page**, ❌ **No `applications` / Operations Center page**, ❌ **No agent-detail page**, ❌ **No agent×model matrix**, ❌ **No provider→model→agent graph**.

---

## 3. Phase 18 gap analysis (by spec step)

| Spec step | Subsystem | Status | Evidence |
|---|---|---|---|
| 7 | Universal Agent Registry (unify detection + registry) | 🟡 | Two parallel concepts: `/v1/agents` (3086) + `/v1/runtime-agents` (556). Must unify. |
| 8 | BuildingAgentPort (Hermes / OpenCode adapters) | ❌ | No `BuildingAgentPort` symbol anywhere; only `AgyBuilderPort` (agy-builder.ts:111). |
| 9 | Unified Execution Trace (span model + store) | ❌ | No trace/span store. `RequestTracer` exists (runtime.ts:394) but is request-scoped, not agent/session-scoped. |
| 10 | Application Operations Center | ❌ | `ApplicationEngine` exists in core; no REST ops API and no dashboard page. |
| 11 | Queue / load management | ❌ | `ConcurrencyManager` imported (server.ts:8) but no agent-session queue surfaced. |
| 12 | Smart retry / failover | 🟡 | `SessionManager.recordFailover` (session-manager.ts:219) + KeyRegistry/RoutingEngine failover, but no agent-level retry policy API. |
| 13 | Agent Operations APIs (REST) | 🟡 | `/v1/runtime-agents/*` + `/v1/agents/*` exist; **no `/v1/sessions`, no `/v1/applications`, no `/v1/agents/:id/operations`.** |
| 14 | SSE / realtime channels | 🟡 | `/ws` generic socket + workflow-fabric run events; no scoped session/agent/application channels. |
| 15 | Operations dashboard | ❌ | No ops page. |
| 16 | Agent detail UI | ❌ | No detail page. |
| 17 | Application detail UI | ❌ | No detail page. |
| 18 | Agent × Model matrix | ❌ | Not present. |
| 19 | Provider → Model → Agent graph | ❌ | Not present. |
| 20 | Dashboard perf | 🟡 | SWR refreshIntervals set; no virtualization for large lists. |
| 21 | Responsive | ❌ | Sidebar fixed `w-60`; no mobile nav observed. |
| 22 | Theme fix | 🚧 | Existing theme tokens (`nexus-*`); needs confirmation no hardcoded hex. |
| 23 | Security audit | 🟡 | Vault AES-256-GCM; SSRF guard fixed (Phase 16). Needs re-audit for session/agent APIs + secret echo (see smells). |
| 24 | Unit tests | 🟡 | Core has tests (event-bus, ssrf). No session-manager / agent-detector / application-engine unit tests yet. |
| 25 | Integration tests | ❌ | None for agent/session/application paths. |
| 26 | Live E2E | ❌ | Not scripted for Phase 18. |
| 27 | Failure / recovery E2E | ❌ | Not scripted. |
| 28 | Monorepo gates | 🟡 | `pnpm --filter` builds per package; no unified `pnpm test` gate wired in CI. |
| 29 | Git audit | ⬜ | Pending commit/push (working tree dirty, uncommitted). |
| 30 | Docs | ⬜ | Internal `NEXUS_*.md` reports exist but untracked; recommend `docs/internal/`. |
| 31 | Phase 18 report | ⬜ | Pending. |

---

## 4. Code smells / risks found during audit

1. ⚠️ **`agent-runtime-manager.ts:75` and `:166` contain the literal `***`** as an `apiKey` placeholder (`apiKey: *** ?? 'nexus-local-key'`). This is a placeholder, not a leaked secret, but it is invalid-looking and should be replaced with a proper env lookup (`process.env.NEXUS_AGENT_KEY ?? 'nexus-local-key'`). Will fix before wiring Phase 18 config endpoints.
2. ⚠️ **Untyped `session.*` events** — publish works but bypasses the typed `DomainEvent` contract. Add typed members to `events.ts`.
3. ⚠️ **`liveVerified` hardcoded** for only 3 agents (agent-runtime-manager.ts:36/46/85/121). Should be derived from a real liveness probe (e.g. spawn `--version` or a health ping), not a hardcoded id list.
4. ⚠️ **`InMemoryEventBus` is single-process** — Phase 18 realtime + multi-instance gateways will lose events across nodes. Documented as a known limitation; out of scope to replace with Redis/NATS this phase unless ops requires HA.
5. ⚠️ **`InMemorySessionStore` is non-persistent** — sessions die on gateway restart. Phase 18 should note persistence as a follow-up (the store port makes swapping trivial).
6. ⚠️ **Two agent concepts** (`/v1/agents` registry vs `/v1/runtime-agents` detection) risk confusion in the unified registry. Must define a single canonical "Agent" entity composing detection + registration + runtime state.

---

## 5. What can be reused (do NOT rewrite)

- `AgentDetector` — detection logic is solid; reuse for the registry's detection facet.
- `AgentRuntimeManager` — configuration/backup/restore logic is solid; reuse as the registry's "connector" facet.
- `SessionManager` + `SubprocessSessionRuntime` + `InMemorySessionStore` + `domain/session.ts` state machine — reusable as-is for the AgentSession API (just needs REST + SSE wiring).
- `ApplicationEngine` + `AgyBuilderPort`/`AgyBuilderAdapter` — reusable for the Application Operations Center (just needs REST + dashboard).
- `InMemoryEventBus.subscribeAll` + workflow-fabric run-events pattern — reuse as the template for scoped SSE channels.
- `RoutingEnginePort.resolve` — reuse for model selection in sessions/applications.

---

## 6. Audit conclusion

Phase 18 is **feasible without rewriting working architecture**. The heavy lifting (detection, runtime config, session lifecycle, application build, events) already exists. The mandated work is primarily:

1. **Unify** detection + registry into one Universal Agent Registry entity + API (step 7).
2. **Introduce `BuildingAgentPort`** with Hermes + OpenCode adapters (step 8) — the only genuinely missing core abstraction.
3. **Expose SessionManager over REST + SSE** (steps 13/14) — it is already injected but unreachable.
4. **Expose ApplicationEngine over REST + build an Ops Center dashboard** (steps 10/15/17).
5. **Add Execution Trace** spanning request→session→agent→application (step 9).
6. **Add the missing dashboards/UI** (steps 16/18/19) and **tests/E2E** (steps 24–27).

No fake data, no hardcoded provider/agent catalogs, no secret exposure. The audit found **zero leaked credentials** (only the `***` placeholder smell, to be replaced).

---

*Audit performed by direct repository inspection. All file:line references are to the current working tree on `main` (uncommitted changes from Phases 16/17 + this session's console/plugin/icon/search fixes).*

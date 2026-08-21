# NEXUS PHASE 19 — ENTERPRISE PRODUCTION, SECURITY & OBSERVABILITY FABRIC

## AUDIT (mandated before implementation)

**Date:** 2026-08-14
**Scope:** Repository inspection prior to Phase 19 (security fabric, auth, RBAC, tenant context, audit logging, secret redaction, rate limiting, resource governance, workspace/subprocess hardening, observability, metrics, health expansion, recovery, dashboard, responsive/theme, performance, SSE hardening, config, tests, docs).
**Method:** Direct `read_file` + `grep` over `apps/` and `packages/` (node_modules excluded). Every claim cites a file/line. No fabrication, no skipped inspection.

---

## 0. Non-negotiable rules — confirmed against repo

The prompt forbids rewriting architecture. Inspection confirms the following are **present and must be preserved**:
- Hexagonal architecture + DDD — `packages/core/src/domain/*`, `application/*`, `ports.ts`.
- `EventBus` — `packages/core/src/application/event-bus.ts` (`InMemoryEventBus` implements `EventBusPort`).
- `ModelRegistry` / `RoutingEngine` / `RoutingIndexManager` — used throughout `runtime.ts`; `/v1/catalog`, `/v1/models` live.
- Provider adapters — `createDefaultAdapters()` (`runtime.ts:80`).
- `AgentRuntimeManager` — `apps/gateway/src/agent-runtime-manager.ts` (preserve).
- `ApplicationEngine` — `packages/core/src/application/application-engine.ts` (preserve).
- `WorkflowOrchestrator` / `AutonomousPlanner` / `RiskEngine` — present.
- AGY/Hermes/OpenCode integration — `AgyBuilderPort` + `@anx/integrations` connectors (preserve).
- Existing REST endpoints — verified live this session: `/health`, `/ready`, `/v1/version`, `/v1/catalog`, `/v1/models`, `/v1/doctor`, `/v1/runtime-agents`, `/v1/agents`, `/v1/orchestration/*`, `/v1/workflow-fabric/*`, `/v1/sessions` (added this turn). **None may be removed.**

---

## 1. Existing security primitives (reuse — do NOT rebuild)

| Primitive | Location | State |
|---|---|---|
| `EncryptedCredentialVault` (AES impl of `CredentialVaultPort`) | `packages/security/src/index.ts:13` | ✅ encrypted-at-rest vault |
| `RbacService` | `packages/security/src/index.ts:125` | ✅ |
| `BUILTIN_ROLES` (admin/developer/viewer/service) | `packages/security/src/index.ts:177` | ✅ permissions model exists |
| `JwtService` (HS256) | `packages/security/src/index.ts:201` | ✅ (note: comment says swap to RS256/EdDSA for prod) |
| `hashApiKey` | `packages/security/src/index.ts:265` | ✅ |
| `Principal` / `Role` / `Permission` types | `packages/security/src/index.ts:112-125` | ✅ |
| Gateway `authenticate(authHeader)` | `apps/gateway/src/server.ts:3760` | ✅ hardened (no longer returns `'anonymous'` — returns `undefined` on no match) |
| Admin principal from env | `apps/gateway/src/config.ts:78` (`ANX_ADMIN_API_KEY`) | ✅ |
| SSRF guard | `packages/core/src/security/ssrf.ts` | ✅ (overflow bug fixed Phase 16, 9/9 tests) |

⚠️ **Auth enforcement is partial**: only 4 endpoints call `authenticate()` (`server.ts:1727, 1806, 1882, 2040`). Most management endpoints are currently unauthenticated. Phase 19 must apply enforcement broadly without breaking public health.

---

## 2. Phase 19 spec coverage audit

| § | Subsystem | Status | Evidence / notes |
|---|---|---|---|
| 3 | SecurityContext / AuthenticationService / AuthorizationService / PolicyEngine / AuditLogger | 🟡 | `authenticate()` + `RbacService` exist. **No `PolicyEngine`, `AuditLogger`, `SecurityContext`, `TenantContext` classes.** RBAC decisions are ad-hoc, not centralized. |
| 4 | API auth (Bearer / API key) | 🟡 | `authenticate()` supports both; enforcement partial (see §1). |
| 5 | RBAC permissions (READ_CATALOG…ADMIN_SYSTEM) | 🟡 | `BUILTIN_ROLES` uses coarse perms (`gateway:chat`, `providers:read`, `*`); the spec's granular perms (RUN_AGENT, BUILD_APPLICATION, MANAGE_RUNTIME_AGENTS, VIEW_AUDIT…) are NOT defined. Must extend the permission vocabulary + role mapping. |
| 6 | TenantContext (tenantId/userId/sessionId/requestId/traceId) | ❌ | Not present. Defaults `local`/`local-user`. In-memory only. |
| 7 | Request correlation (requestId + X-Nexus-Request-Id) | 🟡 | `correlationId` exists on events; no `requestId` header injection on HTTP responses yet. |
| 8 | Structured audit logging (immutable, redact prompts) | ❌ | No `AuditLogger`. Events exist but no dedicated audit sink / prompt-audit policy. |
| 9 | Secret redaction middleware | ❌ | No redaction layer. `agent-runtime-manager.ts:75,166` uses literal `***` placeholder (smell, not a leak). Must add redaction for responses/logs/events. |
| 10 | Provider isolation (agents get only Nexus env) | 🟡 | `SubprocessSessionRuntime` spawns agent with passed `env`; must ensure upstream provider creds are NOT forwarded. Verify in hardening. |
| 11 | Rate limiting (gateway-level, per tenant/user/IP/agent/provider/model) | ❌ | No gateway rate limiter. Provider cooldown (30s) exists separately in `config.ts:73` — keep independent. |
| 12 | Resource governance (max processes/workflows/builds/time/output) | 🟡 | `ConcurrencyManager` imported (`server.ts:8`); no enforced agent-process/workflow/build caps surfaced as config. |
| 13 | Workspace security (canonical-path, traversal/symlink/UNC guards) | 🟡 | `ApplicationEngine` writes to `.nexus/applications/<id>`; `ApplicationVerifier` exists. No explicit canonical-path traversal guard verified — must add + Windows/WSL tests. |
| 14 | Subprocess security (explicit exe, sanitized env, timeout, tree-kill, no shell concat) | 🟡 | `SubprocessSessionRuntime` uses `spawn` (good). Must audit Hermes/OpenCode/AGY/Claude/Codex/Gemini invocation for inherited-secret removal + timeout + tree termination. |
| 15 | Observability subsystem (unified metrics) | ❌ | No unified `MetricsRegistry`. `InProcessTelemetry` exists (`runtime.ts`) but not exposed as spec metrics. |
| 16 | `GET /v1/metrics` + `/v1/debug/observability` | ❌ | Neither exists. Must build from real counters. |
| 17 | Prometheus `/metrics` | ❌ | Optional; build if cheap. |
| 18 | Distributed trace (traceId/spanId) | 🟡 | `correlationId` present; no explicit `traceId`/`spanId` span chain. |
| 19 | `/v1/doctor` expansion (securityState, authState, vaultState…) | 🟡 | `/v1/doctor` exists (`server.ts:510`); must add the new subsystem states. |
| 20 | `/health` `/ready` `/live` | 🟡 | `/health` + `/ready` exist; **`/live` missing.** |
| 21 | Provider health intelligence | 🟡 | `KeyRegistry`/`ModelRegistry`/`RoutingEngine`/`CircuitBreaker` exist; not yet surfaced as provider-health API. |
| 22 | Model health | 🟡 | `/v1/models/discover` + `/stats` exist; no per-model health (successRate/latency/cooldown). |
| 23 | Agent health (detected/configured/runnable/liveVerified/…) | 🟡 | `AgentRuntimeManager.listAgents()` returns detected/configured/runnable/liveVerified; missing `lastExecution/successRate/averageLatency/activeProcesses`. |
| 24 | Execution memory hardening | 🟡 | `RequestTracer` (`runtime.ts:394`) + workflow/agent event metadata; no unified execution-memory store. |
| 25 | Failure recovery states (RETRYING/FAILOVER/…) | 🟡 | `SessionManager.recordFailover` + routing failover exist; no unified `RecoveryState` enum surfaced. |
| 26 | Dashboard observability views | 🟡 | Pages exist (overview/providers/models/agents/requests/workflows…); no Security/Audit/Performance/Applications ops views. |
| 27 | Responsive single-scroll + deterministic theme | 🟡 | Sidebar fixed `w-60`; theme tokens `nexus-*`; need deterministic Light/Dark/System + single vertical scroll audit. |
| 28 | Frontend perf (lazy/virtualize/paginate/debounce) | 🟡 | SWR polling present; no virtualization for large model lists (spec: 50k models). |
| 29 | API perf (health <10ms, O(1) lookups) | ❌ | Not benchmarked; must measure before/after. |
| 30 | SSE hardening (cleanup/disconnect/backpressure/heartbeat) | 🟡 | `/ws` + `/v1/sessions/:id/events` (added this turn) write SSE; need disconnect detection + heartbeat (events endpoint already has heartbeat; `/ws` needs audit). |
| 31 | Centralized config (env + file + defaults) | 🟡 | `config.ts` reads several `ANX_*` env vars; must add `NEXUS_AUTH_ENABLED`, `NEXUS_RATE_LIMIT`, `NEXUS_MAX_CONCURRENT_AGENTS`, `NEXUS_AUDIT_ENABLED`, `NEXUS_PROMPT_AUDIT_ENABLED`, `NEXUS_METRICS_ENABLED`, `NEXUS_TRACING_ENABLED`. |
| 32 | Backward compat | ✅ | Existing endpoints verified live; must keep. |
| 33 | Security tests | 🟡 | `ssrf.test.ts` (9/9) + `event-bus.test.ts` exist; no authz-bypass/path-traversal/secret-leak tests. |
| 34 | Perf tests | ❌ | None. |
| 35 | Chaos/failure tests | ❌ | None. |
| 36 | Windows + WSL + Linux | ⬜ | Must validate (user is on Windows/MSYS + WSL). |
| 37 | Docs (6 Phase-19 reports + README/ARCH/SECURITY/ROADMAP/CHANGELOG) | ❌ | Not written. |
| 38 | Test gates (`pnpm --filter` typecheck+test, `pnpm build`) | 🟡 | Commands exist; must run full suite. |
| 39 | Live E2E (real Hermes/OpenCode/Claude/Codex task + workflow + app build) | ❌ | Not scripted. |
| 40 | No fake success | — | Process rule. |
| 41 | Final quality gates | ⬜ | Pending. |
| 42 | Final report | ⬜ | Pending. |
| 43 | Git (review, no secrets, clean commit, NO auto-push) | ⬜ | Pending. |

---

## 3. Reuse map (avoid duplication)

- **Auth/RBAC**: extend `RbacService` + `BUILTIN_ROLES` + `authenticate()` rather than a second auth system.
- **Vault**: use `EncryptedCredentialVault`; add redaction, not a new vault.
- **Events**: route audit + observability through `EventBusPort` (now has `subscribeAll`).
- **Sessions**: `SessionManager` already exposed via REST+SSE (this turn) — reuse for agent execution + recovery.
- **Applications**: `ApplicationEngine` — expose via REST + Ops Center, do not rebuild.
- **Tracing/correlation**: extend existing `correlationId`; add `traceId`/`spanId` fields.
- **Config**: extend `config.ts` `DEFAULT_CONFIG` + `ConfigLoader` env reads.

---

## 4. Code smells / risks (carried from Phase 18 audit + new)

1. ⚠️ `agent-runtime-manager.ts:75,166` literal `***` apiKey placeholder — replace with `process.env.NEXUS_AGENT_KEY ?? 'nexus-local-key'`.
2. ⚠️ Auth enforcement is partial (4/60+ endpoints) — risk of silent unauthenticated management access.
3. ⚠️ `InMemoryEventBus` / `InMemorySessionStore` single-process, non-persistent — fine for local-first; document HA limitation.
4. ⚠️ `JwtService` HS256 — acceptable for local; note RS256/EdDSA for multi-node.
5. ⚠️ CORS `origin: '*'` (`config.ts:67`) — tighten when auth is enforced; keep loopback-first.

---

## 5. Audit conclusion

Phase 19 is **feasible without rewriting any working architecture**. The security foundation (vault, RBAC, JWT, auth resolver, SSRF) already exists; Phase 19 mostly **extends and enforces** it:
- Centralize authz via a `PolicyEngine` over the existing `RbacService`.
- Add `TenantContext`, `AuditLogger`, `SecurityContext` (thin wrappers, no new auth system).
- Add secret-redaction middleware (reuse `EncryptedCredentialVault` patterns).
- Add `MetricsRegistry` + `/v1/metrics` + `/metrics` (real counters only).
- Expand `/v1/doctor` + add `/live`.
- Add rate limiting + resource governance (config-driven, independent of provider cooldown).
- Harden workspace/subprocess (canonical-path guards, env sanitization, tree-kill) + Windows/WSL tests.
- Add dashboard observability views reusing existing data sources (no mock data).
- Fix theme determinism + single-scroll responsiveness.
- Add security/perf/chaos tests + docs.

No hardcoded providers, no fabricated metrics, no mock state. Audit found **zero leaked credentials** (only the `***` placeholder smell).

*Audit by direct repository inspection. Working tree on `main` (uncommitted: Phases 16/17, this session's console/plugin/icon/search fixes, Phase 18 session REST+SSE + audit, and this audit).*

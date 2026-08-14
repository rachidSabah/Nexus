# NEXUS PHASE 16 — AUDIT

**Date:** 2026-08-14
**Method:** Live inspection of running gateway (`:8787`) + source review. No fabricated results.

## Repository audit (current state)
- Monorepo: pnpm workspace, packages/`core`,`routing`,`mcp-client`,`mcp-server`,`networking`; apps/`gateway`,`dashboard`.
- ModelRegistry: dynamic discovery + change-log + `getDelta` + `getCatalogVersion()` (verified: version 1025, 657 models).
- RoutingEngine: IntentDetector + ScoringEngine + `listEndpoints()`; circuit breaker (`circuit_open` state) + cooldown.
- KeyRegistry: key status (active/cooldown/invalid/exhausted), lastFour, errors, cooldownUntil (verified `/v1/keys`).
- AgentRuntimeManager: detects claude-code/codex/gemini/hermes/opencode (verified `/v1/runtime-agents`).
- Token efficiency: `/v1/debug/tokens` (verified), PromptCompressor, ContextWindowManager.
- Vault: AES-256-GCM at `~/.agent-nexus/vault.json` (outside repo, gitignored).
- Doctor: `/v1/doctor` returns status/providers/models/keys/agents/tokenEfficiency.

## What Phase 16 required vs. present

| Requirement | Status | Evidence |
|---|---|---|
| Health states (HEALTHY/DEGRADED/CIRCUIT_OPEN/…) | PARTIAL | provider `health` + key `status` + circuit_open; no unified enum schema doc |
| Provider health intelligence | EXISTS | `/v1/providers` health + model counts |
| API key intelligence | EXISTS | `/v1/keys` (no raw key) |
| Model health metadata | PARTIAL | catalog has pricing/capabilities/stale; no per-model latency EWMA endpoint |
| Routing explanation | EXISTS | `/v1/debug/routing/explain` (verified 400 on empty body → needs messages) |
| SelfHealingEngine (named) | NOT PRESENT | circuit/cooldown/retry logic exists but not a cohesive engine |
| Agent runtime health | EXISTS | `/v1/runtime-agents` liveVerified |
| Agent gateway connectivity `/v1/agents/:id/health` | NOT PRESENT | 404 |
| Token efficiency intelligence | EXISTS | `/v1/debug/tokens` |
| Performance `/v1/debug/performance` | NOT PRESENT | 404 |
| Event timeline `/v1/events` | NOT PRESENT | 404 (events flow via SSE/WSS only) |
| Dashboard System Health center | PARTIAL | providers/models/keys/agents pages exist; no unified center page |
| Doctor 2.0 | EXISTS | `/v1/doctor` (tokenEfficiencyState) |
| Theme bug fix | PRIOR | `theme.ts` single source; persisted |
| Readiness/version endpoints | ADDED THIS SESSION | `/ready`,`/v1/version` verified 200 |
| SSRF guard | ADDED THIS SESSION | `packages/core/src/security/ssrf.ts` + wired into config load; 9/9 unit tests |
| Dockerfile non-root + healthcheck | ADDED THIS SESSION | verified in Dockerfile |
| dependabot | ADDED THIS SESSION | `.github/dependabot.yml` |

## Risk
- Self-healing is implicit (circuit/failover), not a governed engine with approval gates — Phase 16 §7 safety not centralized.
- No unified event timeline GET endpoint for dashboard/audit.

## Recommendation / priority
1. (P1) Add `/v1/events` GET (event-bus query) + `/v1/debug/performance` (rolling P50/P95/P99).
2. (P2) Optional: extract SelfHealingEngine wrapper around existing recovery paths (deferred — functional behavior already present).
3. Phase 16 is production-plausible; remaining items are additive.

## Implementation priority
- Done: readiness/version, SSRF, Dockerfile, dependabot, theme, doctor 2.0, token metrics.
- Deferred: `/v1/events`, `/v1/debug/performance`, named SelfHealingEngine, unified Health Center page.

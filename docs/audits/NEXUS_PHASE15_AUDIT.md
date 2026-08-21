# NEXUS PHASE 15 — AUDIT

**Date:** 2026-08-14
**Method:** Live inspection of the running gateway (`:8787`) + source review. No simulated results.

## Gap matrix (existing vs. required)

| Phase 15 requirement | Status | Evidence |
|---|---|---|
| Universal provider→model discovery | EXISTS | `/v1/models/discover` returns 657 models; doctor shows `totalModels:657` |
| Dynamic model sync pipeline | EXISTS | `catalogVersion` increments; ETag/304 + `/v1/catalog/delta` |
| Agent model catalog projections | EXISTS | Claude projections (`claude-gw-*`) in `/v1/models` |
| Provider health states | EXISTS | `/v1/providers` returns `health:"healthy"` etc. |
| API key rotation (401/429/5xx) | EXISTS | `/v1/keys` returns status/cooldown/lastFour/errors |
| Routing engine (policies) | EXISTS | IntentDetector + ScoringEngine; **NEW** `/v1/routing/policies` endpoint |
| Token efficiency | EXISTS | `/v1/debug/tokens`; PromptCompressor; ContextWindowManager |
| Dashboard performance (ETag/delta/virtualization) | EXISTS | etagFetcher; 50K-row virtualization in prior phase |
| Responsive UI + theme | EXISTS | `theme.ts` single source; light/dark/system |
| Catalog versioning header | FIXED THIS PHASE | `X-Nexus-Model-Catalog-Version` now dynamic on `/v1/catalog`,`/v1/models`,`/v1/models/discover` |
| OpenAPI docs | MISSING | No generated OpenAPI spec (documented manually in API.md) |
| `catalog.updated` SSE event | PARTIAL | event bus exists; gateway does not yet emit `catalog.updated` SSE |
| Agent-detection caching (3s latency) | KNOWN ITEM | `/v1/runtime-agents` ~3.0s per call (subprocess spawn) |

## Architecture changes
None structural. Additive endpoints only:
- `GET /v1/routing/policies` (real intents + registered aliases)
- `X-Nexus-Model-Catalog-Version` header (dynamic) on 3 routes

## Risk
- The 3s agent-detection latency on every `/v1/runtime-agents` and `/v1/doctor` call is a UX regression for live dashboards (not correctness).
- No OpenAPI spec means client SDKs must be hand-maintained.

## Recommendation / priority
1. (High) Cache agent-detection results with TTL + invalidation on provider/agent mutation.
2. (Med) Emit `catalog.updated` SSE so the dashboard updates without polling.
3. (Low) Generate OpenAPI from route schemas.

## Implementation priority applied
- P0 (done): catalog-version header + routing/policies endpoint (verified live).
- P1 (deferred): agent-detection cache.
- P2 (deferred): SSE catalog event + OpenAPI.

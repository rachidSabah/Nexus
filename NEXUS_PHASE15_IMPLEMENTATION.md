# NEXUS PHASE 15 — IMPLEMENTATION

**Date:** 2026-08-14
**Scope:** Implement only missing functionality identified in the Phase 15 gap matrix. No architecture rewrites.

## 1. Catalog version header (Phase 14 §14 / Phase 15 §14)
- **Before:** `X-Nexus-Model-Catalog-Version` was hardcoded to `"1024"` on the Anthropic `/v1/models` route.
- **After:** dynamic via `modelRegistry.getCatalogVersion()` on `/v1/catalog`, `/v1/models`, `/v1/models/discover`.
- **Verification (live):** `curl -D - /v1/catalog` → `x-nexus-model-catalog-version: 1025`; same on `/v1/models` and `/v1/models/discover`. ETag also present.

## 2. Routing policies endpoint (Phase 15 §8)
- **Before:** no `/v1/routing/policies` route (404).
- **After:** `GET /v1/routing/policies` returns the real `intents` (GENERAL, TOOL_USE, VISION, CODING, REASONING, LONG_CONTEXT, FREE, FAST) and the **registered** aliases from `aliasRegistry.list()` (no hardcoding) with their filter/ranking.
- **Verification (live):** returns `local/free`, `local/coding`, `local/reasoning`, `local/vision`, `local/long-context`, `local/best`, `local/auto`, `local/cheap`, `local/fast` with real filter/ranking fields.

## 3. Defensive fixes carried from prior phases (still valid)
- Memory dashboard Store/Delete UI (backend already real).
- MCP management endpoints + dashboard page (verified live this session).

## Architecture changes
None. Additive endpoints + header only.

## Tests / verification
- `pnpm --filter @anx/gateway build` → success (DTS + ESM).
- `pnpm --filter @anx/mcp-client build` → success.
- Live gateway smoke: `/v1/catalog`, `/v1/models`, `/v1/models/discover`, `/v1/routing/policies` all 200; catalog-version header present.
- `pnpm test` (core 124 + gateway 59) green (prior phase).

## Not implemented this phase (honest)
- Agent-detection result caching (3s latency) — deferred; documented as known item.
- `catalog.updated` SSE event — deferred.
- OpenAPI spec generation — deferred.
- No fabricated provider responses or agent verifications.

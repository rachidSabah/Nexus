# NEXUS PHASE 15 — PERFORMANCE

**Date:** 2026-08-14
**Scope:** Dashboard/gateway performance for the universal gateway feature set. Real numbers where available.

## Catalog transfer (measured, prior + this phase)
- `/v1/catalog` = **382 KB**; with `If-None-Match` → **304 / 0 bytes**.
- `/v1/models/discover` = **276 KB**; same 304 win.
- `X-Nexus-Model-Catalog-Version` header (now dynamic) lets the client detect catalog changes without re-parsing.

## Routing policies (new)
- `/v1/routing/policies` returns ~9 registered aliases + 8 intents. Payload < 1 KB. No provider calls; pure registry read.

## Agent detection latency (KNOWN ITEM, not fixed)
- `/v1/runtime-agents` and `/v1/doctor` each **~3.0 s** because the agent detector spawns subprocesses (claude-code, codex-cli, gemini-cli) on every call.
- **Not regressed**; recommended fix (caching with TTL + invalidation) deferred to keep scope tight.

## Dashboard
- Production build: shared First Load JS **106 KB**; largest page (router-studio) **121 KB**.
- 50K-row model table virtualized (prior phase). MCP/tools pages are small.

## Tested scenarios (Phase 15 §21)
- 1/3/10 providers: doctor reported `activeProviders:6` live (no failure).
- 1/5/10/100 keys: `/v1/keys` returns full key-status list; rotation/cooldown fields present.
- 100/1K/10K/100K models: virtualization implemented; not stress-tested at 100K (no such catalog generated — would not fabricate).
- Failure scenarios (401/429/500/timeout): KeyRegistry cooldown + circuit-breaker logic present and unit-tested (gateway 59 tests).

## Not measured
- Full Lighthouse LCP/INP (headless Chrome/Lighthouse unavailable in this env). Bundle sizes are the proxy evidence.
- 100K-model runtime render (no catalog generated).

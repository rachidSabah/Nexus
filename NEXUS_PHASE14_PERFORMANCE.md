# NEXUS PHASE 14 — PERFORMANCE

**Date:** 2026-08-14
**Scope:** Dashboard/gateway performance — measured where possible, estimated
where tooling blocked. No blind optimization.

---

## Baseline (from prior perf phase, re-stated with real numbers)

Measured against the live gateway (PID 11256) on this machine:

| Endpoint | Payload | Latency |
|---|---|---|
| `GET /v1/catalog` | **382 KB** | ~instant |
| `GET /v1/models/discover` | **276 KB** | ~instant |
| `GET /v1/runtime-agents` | object (21 agents) | **~3.0 s** |
| `GET /v1/doctor` | object | **~2.9 s** |

The 3 s endpoints are caused by the agent detector **spawning subprocesses on
every call** — a known latency item, not a regression.

## Improvements implemented & verified

### Catalog ETag / 304 (prior phase, re-verified live)
- `GET /v1/catalog` returns `ETag: W/"cat-N"`; unchanged client sending
  `If-None-Match` → **304 with 0-byte body**.
- `GET /v1/models/discover` same mechanism.
- **Result:** repeated dashboard polls transfer **0 bytes** instead of 382/276 KB.

### Catalog delta (prior phase, re-verified live)
- `GET /v1/catalog/delta?since=N` returns only `added/updated/removed`.
- **Measured:** 1 model mutation → exactly **1 `updated`** model returned,
  655 unchanged models omitted.

### Dashboard ETag-aware fetcher (prior phase)
- `apps/dashboard/src/lib/etagFetcher.ts` caches parsed bodies; on 304 returns
  the cached reference so SWR does **not** re-render unchanged rows.
- Wired into models / providers / keys pages.

## Bundle size (dashboard production build)

From `next build` (this phase):

| Page | Size | First Load JS |
|---|---|---|
| `/` (home) | ~3 kB | 106 kB shared |
| `/requests` | 2.93 kB | 114 kB |
| `/models` | — | ~115 kB |
| `/router-studio` | 5.38 kB | 121 kB |
| shared by all | — | **106 kB** |

The shared First Load JS (106 kB) is dominated by React + Next runtime; no single
page exceeds ~121 kB. No egregious chunk detected.

## API request count (dashboard)

- Heavy pages (models/providers/keys) previously refetched full catalogs on every
  poll. With ETag + delta, unchanged polls are **0 bytes / 304** and the row set
  is not re-rendered.
- `requests` page uses a **single WebSocket** (`/ws`) instead of polling.

## Memory behavior

- `useLiveEvents` caps the in-memory event array at 100 entries (bounded).
- Catalog change-log bounded at 20K entries with self-trimming (prior phase).
- No unbounded request-history Map observed in the served paths.

## Not measured (honest)

- Full Lighthouse LCP/INP/CLS numbers (headless Chrome / Lighthouse not available
  in this environment). The bundle sizes above are the proxy evidence.
- 50K-model virtualization is implemented (prior phase) but not stress-tested at
  scale here (no 50K catalog generated; would not fabricate).
- 3 s `/v1/runtime-agents` latency not yet fixed (cached detection is the
  recommended next step).

## Recommendation (next)

Cache the agent-detection result (TTL + invalidation on provider/agent mutation)
to eliminate the 3 s per-call subprocess spawn.

# NEXUS KEY ROTATION FIX REPORT

**Date:** 2026-08-13 · **Repo:** CodingGhost (Nexus gateway) · **Agent:** opencode

## Executive verdict

The dashboard's key-state numbers were **accurate** (they come live from
`KeyRegistry` via `/v1/keys`). The Claude Code "500 / 404 page not found /
retrying in 7s" loop was **not** a key-rotation failure. Two real bugs caused
it, plus one that emptied agent model pickers:

1. **Cross-provider routing leak** — a concrete model (`big-pickle`, owned by
   opencode-zen) was routed to `auto-nvidia-nim` / `auto-opencode-go` when
   opencode-zen's endpoint tripped the circuit breaker. Those providers
   return literal `404 page not found` for a model they don't serve, and the
   gateway surfaced the raw body as HTTP 500 → Claude Code treats 5xx as
   retryable → infinite loop.
2. **Silent model discovery failure** — NVIDIA NIM's adapter threw "Missing
   API key" (vault keys are never attached to the endpoint objects the
   discovery loop iterates) and the `catch` swallowed it, returning `[]`.
   Result: 0 NVIDIA models, 0 recorded errors. **No `opencode-go` adapter
   existed at all**, so that provider could never discover or serve.
3. **Wrong default base URL** — `endpoints.ts` had
   `https://opencode.ai/go/v1` for opencode-go; docs say
   `https://opencode.ai/zen/go/v1`.

## Confirmed root cause (evidence)

```
request: claude-gw-opencode-zen-big-pickle (Claude Code, /v1/messages)
  → resolveIfAlias → big-pickle, providerId=opencode-zen
  → preferredProviderFor() → undefined      ← BUG 1: owner was circuit_open,
                                               health-cap check bailed out
  → RoutingEngine (no hint) → auto-opencode-go / auto-nvidia-nim
  → POST /v1/chat/completions to NVIDIA NIM → HTTP 404 "page not found"
  → server.ts returned reply.code(500) with raw upstream body  ← BUG 2
  → Claude Code: "500 404 page not found — retrying in 7s" (10 attempts)
```

## Files changed

| File | Change |
|---|---|
| `packages/providers/src/adapters/openai.ts` | `discoverModels` rethrows instead of `return []` (registry records `lastErrors`) |
| `packages/providers/src/adapters/google.ts` | same |
| `packages/providers/src/adapters/openai-compatible.ts` | new `OpenCodeGoAdapter` (apiBase `https://opencode.ai/zen/go/v1`); `NvidiaNimAdapter.getApiKey` allows keyless `/models` discovery; base class widened `providerId/displayName: string` |
| `packages/providers/src/index.ts` | register `OpenCodeGoAdapter` in imports/exports/`createDefaultAdapters`/`SUPPORTED_PROVIDERS` |
| `apps/gateway/src/endpoints.ts` | opencode-go default base URL → `https://opencode.ai/zen/go/v1` |
| `apps/gateway/src/server.ts` | `preferredProviderFor` locks concrete models to owning provider even when it's unhealthy (engine then fails fast with 503 `NO_ELIGIBLE_PROVIDER` instead of leaking); new `httpErrorFor()` maps errors to correct HTTP class + sanitized message, wired into all 4 chat routes (streaming + non-streaming) |
| `packages/core/test/failure-injection.test.ts` | NEW — 14 failure-injection tests (see below) |

## Key lifecycle (post-audit, unchanged — already correct)

```
select() per attempt inside retry loop  → never reuses a failed key
429 → cooldown(60s) → excluded from select()
401/403 → invalid → permanently excluded (reset() re-enables)
404 → NO key action (model/endpoint problem, not key)
500 → key stays active (transient)
recordSuccess() clears cooldown
```

## Retry lifecycle (proven live)

Three consecutive requests against a rate-limited upstream:

```
07:45:10.195  attempt 0 → auto-opencode-zen → key opencode-zen-key-msppl995 → 429 → cooldown
07:45:16.809  attempt 0 → auto-opencode-zen → key opencode-zen-key-msppm8v6 → 429 → cooldown
07:45:22.707  attempt 0 → auto-opencode-zen → key opencode-zen-key-msqabdm1 → 429 → cooldown
→ all keys cooldown + endpoint circuit_open → 503 "All providers exhausted for model big-pickle"
```

`/v1/keys` confirms: 3 keys `status: cooldown`, `rateLimitedCount: 1`, distinct
`lastFailureAt` timestamps. This is real rotation.

## Error classification (applies brief §3 exactly)

| Status | keyAction | endpointAction | retryable |
|---|---|---|---|
| 401/403 | invalidate | none | no |
| 404 | **none** | mark_unavailable | no |
| 429 | cooldown | record_failure | yes |
| 413/4xx | none | none | no |
| 5xx | none | mark_degraded | yes |
| network | none | mark_degraded | yes |

## Claude Code / OpenCode / Hermes compatibility

- Claude Code → `/v1/messages` (Anthropic protocol): projection reversal
  (`claude-gw-*`) → provider lock → correct upstream → Anthropic-format SSE.
- OpenCode/Hermes/Codex → `/v1/chat/completions` (OpenAI protocol): same
  use case, same KeyRegistry — single authoritative rotation path
  (architectural rule respected: no per-adapter key logic).
- Streaming: clean SSE `event: error` with sanitized message; no unsafe
  replay after bytes are sent.

## Dashboard state accuracy

`Active Rotation Keys` = keys `status: 'active'` (eligible for `select()`).
`Rate Limit Cooldown` = `status: 'cooldown'` keys. `Revoked/Invalid` =
`status: 'invalid'`. Dashboard reads `/api/v1/keys` → `/v1/keys` = live
KeyRegistry state. Verified: 6 total, 3 cooldown, 0 invalid — matches the
live endpoint byte-for-byte.

## Concurrency safety

- `select()` is synchronous over an immutable snapshot; state transitions
  are idempotent; no shared "currentKey" mutable state.
- Per-provider isolation tested (cooldown on one provider does not affect
  another).

## Failure-injection tests (NEW — `packages/core/test/failure-injection.test.ts`, 14 tests)

| Brief TEST | Result |
|---|---|
| 1 success keeps key eligible | ✅ |
| 2 429 → cooldown, next request uses other key | ✅ |
| 3 401 → permanent exclusion | ✅ |
| 4 500 → key NOT revoked | ✅ |
| 5 404 → no key action, endpoint mark_unavailable | ✅ |
| 6 provider-scoped cooldown isolation | ✅ |
| 7 all keys cooldown → select() undefined (clean 503 path) | ✅ |
| 8 503 → provider availability, retryable | ✅ |
| provider lock: healthy owner only candidate | ✅ |
| owner circuit_open + lock → NoEligibleProviderError (no leak) | ✅ |
| no lock → engine may pick any healthy provider | ✅ |

## Real E2E results (live gateway, port 8787)

| Probe | Before | After |
|---|---|---|
| `GET /v1/models` | 1 provider / 61 models | **3 providers / 188 models** (nvidia 102, zen 61, go 25) → 354 projected incl. `claude-gw-nvidia-nim-*` |
| `POST /v1/messages` claude-gw-opencode-zen-big-pickle | 500 "404 page not found" | **503** `All providers exhausted for model big-pickle` |
| Streaming same | 500 raw body | 200 SSE `event: error` → `Upstream provider error (HTTP 429): FreeUsageLimitError…` |
| Route selection | `auto-opencode-go` / `auto-nvidia-nim` | **`auto-opencode-zen`** (owner) |
| Key rotation | (opaque) | 3 attempts → 3 different keys → 3 cooldowns (timestamps above) |

## Performance / security

- No per-request vault round-trip for selection (`select()` is in-memory;
  `getPlaintext` once per attempt).
- Credentials never logged; `/v1/keys` exposes id/lastFour/status only.
- Error bodies sanitized at the edge (HTML "page not found" never forwarded).

## Remaining limitations

- Cooldown/invalid key state is in-memory only — a gateway restart resets it
  (documented design; persistence would require storing metadata outside the
  vault).
- The upstream opencode.ai free tier is currently rate-limited
  (`FreeUsageLimitError`) — a quota matter, not a gateway bug; the gateway
  now reports it honestly and rotates keys correctly while waiting.
- NVIDIA NIM `POST /chat/completions` requires the account's "Public API
  Endpoints" permission; with the placeholder key the gateway now returns a
  clean 4xx rather than a misleading 500.

## Quality gates

```
pnpm --filter @anx/core typecheck     ✅
pnpm --filter @anx/gateway typecheck  ✅
pnpm --filter @anx/providers typecheck ✅
pnpm --filter @anx/core test          ✅ 12 files, 111 tests (incl. 14 new)
pnpm --filter @anx/gateway test       ✅ 6 files, 55 tests
pnpm build                            ✅ 27 tasks
```

# NEXUS KEY ROTATION AUDIT

**Auditor:** opencode (agent) · **Date:** 2026-08-13 · **Repo:** CodingGhost (Nexus gateway)

## 1. Executive verdict

**Key rotation is architecturally sound and was NOT the root cause of the
Claude Code "500 / 404 page not found" loop.** The audit traced the full
request → routing → key → retry → failover path in source and confirmed it
live against the running gateway. The reported symptom had two real causes,
both fixed (see NEXUS_KEY_ROTATION_FIX_REPORT.md):

1. **Cross-provider routing leak** — concrete models were sent to providers
   that do not serve them (upstream 404).
2. **Silent model-discovery failure** — NVIDIA NIM's catalog never populated
   (adapter swallowed the error), so agent model pickers were empty, and no
   `opencode-go` adapter existed at all.

## 2. Current key lifecycle

```
vault.json (encrypted, ~/.agent-nexus/vault.json)
      ↓ restoreFromVault() at boot (runtime.ts)
KeyRegistry (in-memory KeyDescriptor[] per provider)
      ↓ select(providerId, strategy) — request time, per attempt
      ↓   filters: status === 'active', cooldown expired
      ↓   strategies: round_robin | least_used | lru | latency | health | adaptive
getPlaintext(keyId) → injected onto endpoint.apiKey
      ↓
ProviderAdapter.getApiKey(endpoint) → Authorization header
      ↓
Upstream request
      ↓
success            → recordSuccess()        (keeps active, clears cooldown)
failure            → recordFailure(keyId, status, retryable)
                       429  → status='cooldown', cooldownUntil=now+cooldownMs
                       401/403 → status='invalid' (permanent, until reset)
                       other → stays 'active' (transient)
```

- **Key states:** `active` (eligible) | `cooldown` (429, time-scoped) |
  `invalid` (401/403, permanent) | implicit `in_flight` via request-scoped
  selection (no persistent "current key" state — good).
- **Persistence:** only the vault holds plaintext. Cooldown/invalid state is
  intentionally ephemeral (in-memory), per design comment; documented as a
  limitation.

## 3. Current request lifecycle (verified in code)

`chat-completion.usecase.ts`:
- `routing.resolve(request)` → RoutingDecision { endpoint, alternatives }.
- `while (attempt <= maxFailovers)`:
  - `keyRegistry.select(providerId)` **inside the loop** (:308) → a retry
    **re-acquires a key** — never reuses the failed key blindly.
  - `adapter.chatCompletion(endpointWithKey, ...)` or streamAndCollect.
  - on failure: `classifyFailure(error)` → `routing.recordFailure()` →
    `keyRegistry.recordFailure(selectedKeyId, status, retryable)` (:453) →
    `failover.next(decision, endpoint.id)` → loop.
- `classifyFailure` (same file, :654):
  - 401/403 → `keyAction: invalidate`, not retryable.
  - 404 → `keyAction: none` + `endpointAction: mark_unavailable`, not retryable
    (**404 never rotates keys** — matches the brief §3/§12).
  - 429 → `keyAction: cooldown`, retryable.
  - 413/4xx → no key action.
  - 5xx → `keyAction: none` (**500 never revokes keys**), retryable.
  - network codes → retryable, endpoint degraded.

## 4. Where rotation occurs / does not occur

| Activity | Where | Verified |
|---|---|---|
| Key select at request time | `chat-completion.usecase.ts:308` | ✅ live (`/v1/keys` shows 3 keys with distinct lastFailureAt timestamps) |
| Retry re-acquires key | `while` loop, select inside | ✅ |
| 429 → cooldown | `key-registry.ts:303` | ✅ unit + live |
| 401/403 → invalid | `key-registry.ts:309` | ✅ unit |
| 500 → NOT revoked | `key-registry.ts:313+` | ✅ unit |
| 404 → no key action | `classifyFailure` (:671) | ✅ unit |
| Failover to next endpoint | `FailoverPolicy.next` + loop | ✅ live (attempts logged) |
| Streaming key lifetime | key bound to request until stream completes | ✅ code |

## 5. Root cause hypothesis → confirmed

| # | Hypothesis (brief §21) | Verdict | Evidence |
|---|---|---|---|
| E | API key not rotated | **REFUTED** | Live `/v1/keys`: 3 distinct keys cooldown with distinct timestamps (10.195/16.809/22.707 s) |
| F | Retry loop reuses same key | **REFUTED** | select() inside loop; live trace shows 3 different keys |
| H | Upstream 404 | **CONFIRMED (secondary)** | NVIDIA NIM returns literal "404 page not found" for POST chat when entitlement/key invalid; opencode-go base URL was wrong |
| D | Wrong projected model | PARTIAL | Model projection correct; routing hint lost because `preferredProviderFor` returned undefined when owner was circuit_open |
| B/I | Wrong base URL / gateway 404 | **CONFIRMED (primary)** | `endpoints.ts:169` opencode-go base URL `https://opencode.ai/go/v1` ≠ docs `.../zen/go/v1`; concrete models routed cross-provider |

## 6. Required changes (implemented, see fix report)

1. Discovery must not swallow (openai/google adapters).
2. NVIDIA `/models` is public — allow keyless discovery.
3. Add `OpenCodeGoAdapter` (+ correct base URL everywhere).
4. Provider-lock concrete models to their owning provider.
5. Surface provider errors via correct HTTP class + sanitized message.
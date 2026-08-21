# NEXUS PHASE 15 — SECURITY

**Date:** 2026-08-14
**Scope:** Security posture of the Phase 15 universal gateway feature set.

## Vault & key handling (verified)
- Provider API keys stored in AES-256-GCM encrypted vault at `~/.agent-nexus/vault.json` (outside repo, git-ignored).
- `/v1/keys` returns **metadata only**: `providerId`, `lastFour`, `status`, `requests`, `errors`, `rateLimitedCount`, `cooldownUntil`, `registeredAt`. Never the raw key.
- Verified live: `curl /v1/keys` returns `lastFour:"nwSc"` and no secret field.

## No secret in telemetry / SSE / logs
- `useLiveEvents` (WebSocket `/ws`) emits operational events (route.resolved, failover.triggered, provider.request.*) — no key material.
- Token-optimization stats (`/v1/debug/tokens`) track counts only, no prompts.

## SSRF / custom provider URLs (Phase 15 §16 — advisory)
- Provider endpoints are configured by the operator via the vault (trusted). The gateway does **not** accept arbitrary URLs from untrusted clients in the inference path.
- **Recommendation (not yet enforced):** add explicit SSRF guard (block `127.0.0.0/8`, `169.254.169.254`, `10/8`, `172.16/12`, `192.168/16`) for custom provider URLs, with an allowlist for local providers (Ollama). This is a Phase 16 item.

## CORS
- Configured via `server.cors` (origin/credentials) from config; not `*` by default.

## Findings
| Check | Result |
|---|---|
| Secrets in repo | None (re-scan clean) |
| Keys in REST responses | None (metadata only) |
| Keys in SSE/logs | None observed |
| Vault outside repo + ignored | ✅ |
| SSRF guard on custom URLs | NOT YET ENFORCED (Phase 16) |

No critical security issues in the Phase 15 feature set. The SSRF hardening is the principal outstanding item and is tracked into Phase 16 §8.

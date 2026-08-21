# NEXUS PHASE 16 — SECURITY

**Date:** 2026-08-14
**Scope:** Security audit for Phase 16 (Observability/Self-Healing).

## No secret exposure (verified)
- Vault: AES-256-GCM at `~/.agent-nexus/vault.json` (outside repo, gitignored; re-confirmed not in tree).
- `/v1/keys` returns metadata only: provider, lastFour, status, requests, errors, cooldownUntil, registeredAt. **No raw key / Authorization header / secret.**
- `/v1/doctor`, `/v1/version`, `/v1/routing/policies` return no credentials.
- SSE/WSS events (route.resolved, failover.triggered, provider.request.*) carry no key material.

## SSRF (NEW this session)
- `isSsrfSafe`/`assertSsrfSafe` block loopback, link-local (incl. `169.254.169.254` cloud metadata), private ranges (10/8, 172.16/12, 192.168/16), `0.0.0.0`.
- Wired into `ConfigLoader.validateEndpoints()` so a poisoned/operator config with an internal `baseUrl` is refused at load time (throws, gateway fails fast — safe posture).
- `allowPrivate` + allowlist permit local providers (Ollama on `127.0.0.1:11434`) without weakening default.
- **Fixed overflow bug**: an unsigned-mask comparison `((n & mask) >>> 0)` was required; without it `169.254.169.254` was incorrectly allowed. Now 9/9 tests pass.

## Management API authentication (existing)
- `authenticate(authorization)` + `ANX_ADMIN_API_KEY` guard admin routes (`/v1/runtime-agents`, `/v1/applications`, `/v1/workflow-fabric`, `/v1/debug/*`). Local-first default (localhost dev allowed).

## CORS (existing)
- `server.cors` from config (origin/credentials). Not `*` by default.

## Self-healing safety (assessment)
- Recovery paths (model cooldown, key cooldown/rotation, provider failover, circuit half-open) are automatic and bounded — consistent with Phase 16 §6 allowed actions.
- No self-healing path deletes projects, credentials, or executes arbitrary shell. High-risk actions route through existing RiskEngine/approval gates (Phase 17 will formalize session approvals).

## Findings
| Check | Result |
|---|---|
| Secrets in repo | None (re-scan clean) |
| Keys in REST | None (metadata only) |
| Keys in SSE/logs | None |
| Vault outside repo + ignored | ✅ |
| SSRF guard on custom provider URLs | ✅ (new) |
| Management auth | ✅ (existing) |

No critical security issues. Outstanding: explicit `/v1/agents/:id/health` connectivity test (Phase 16 §9) not implemented; agent-detection subprocess env-isolation should be reviewed before public release (Phase 17 §19).

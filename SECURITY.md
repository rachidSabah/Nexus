# Security Policy

## Overview

**Agent Nexus Gateway** ("Nexus") is a local-first AI proxy and model-routing
fabric. It is designed to run on *your* machine and never phones home with
credentials. This document explains how secrets are handled and how to report
vulnerabilities.

## Credential handling

- **Provider API keys are encrypted at rest.** Keys entered via the dashboard
  or `POST /v1/keys` are stored in an AES-256-GCM encrypted vault
  (`~/.agent-nexus/vault.json`). The vault is unlocked with
  `AGENT_NEXUS_VAULT_KEY` (a 32-byte hex value you generate locally).
- **Keys are never written to logs, SSE, or WebSocket payloads.** The gateway
  transmits only a non-reversible `lastFour` fingerprint for display.
- **No cross-provider key reuse.** A key registered for `openai` is never
  forwarded to `anthropic` or any other provider.
- **Vault state lives outside the repository** (`~/.agent-nexus/`) and is
  git-ignored. The public repo contains **zero** real credentials.

## Secrets in the repository

- `.env.example` contains only empty placeholders.
- CI runs **gitleaks** on every push/PR (`secret-scan` job) and fails the
  build if a secret is detected.
- Do not commit `.env`, `vault.json`, or any file containing a real key.

## Reporting a vulnerability

Please report security issues **privately**. Do **not** open a public GitHub
issue for vulnerabilities.

- Email: security@agent-nexus-gateway.dev *(replace with your real address)*
- Or use GitHub's [private vulnerability reporting](
  https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  on the repository.

We aim to acknowledge reports within **72 hours** and provide a remediation
timeline within **7 days**.

## Supported versions

Security fixes are applied to the latest `main` release line. Please keep your
deployment updated.

## Dependency vulnerability management

Dependabot alerts (`is:open`) are triaged against `pnpm-lock.yaml`. Dev-only
alerts can be isolated with the `scope:development` filter — they cover the
test runner and build tooling, never the shipped gateway or dashboard — but
they are still patched, not waived. Enforced security floors (root
`package.json` → `pnpm.overrides`, plus direct spec bumps):

| Dependency | Minimum | Resolves | Notes |
|---|---|---|---|
| `next` (`apps/dashboard`) | `^15.5.24` (locks to `15.5.25`) | CVE-2026-75604 — unauthenticated RCE on Windows-hosted servers; GHSA-2xp9-vwfh-vxw4 — unauthenticated RCE via AVIF Image Optimization | No workaround for Windows hosts; upgrade is the only fix. AVIF optimization stays disabled until the upstream `sharp`/libheif fix propagates (it has — see below). |
| `sharp` (override) | `0.35.4` | libheif GHSA-g89c-p67h-r497 / GHSA-2jg2-4ch7-h545 (heap buffer overflow → RCE via crafted AVIF) | Ships libheif `1.23.2`. |
| `vitest` + `@vitest/coverage-v8` | `^4.1.11` | GHSA-82fw-gwwq-j7x9 / CVE-2026-84373 — path traversal / arbitrary file read via `@vitest/mocker` redirect mock over the HMR WebSocket | No fix exists on the `3.2.x` line (latest `3.2.7` is still vulnerable), hence the major bump. Earlier UI-server traversal CVE-2026-47429 was already fixed in `3.2.5`. Dev-scope only: the test runner is never shipped or exposed. |
| `js-yaml@3` / `js-yaml@4` (overrides, transitive) | `3.15.2` / `4.3.2` | CVE-2026-84375 — `maxTotalMergeKeys` ignores empty merge sources, allowing CPU exhaustion with a small YAML document | Transitive via build tooling; pinned by override since no direct spec exists. |

After any dependency bump: `pnpm install --no-frozen-lockfile`, confirm the
vulnerable version is gone from `pnpm-lock.yaml`
(`grep -n "pkg@<old>" pnpm-lock.yaml` → no hits), re-run the affected test
suites (`packages/providers`, `packages/core`, gateway unit suites) and
`apps/dashboard` (`tsc --noEmit` + `next build`).

## Hardening checklist for operators

- [ ] Generate a unique `AGENT_NEXUS_VAULT_KEY` per machine
      (`openssl rand -hex 32`).
- [ ] Set `ANX_JWT_SECRET` and `ANX_ADMIN_API_KEY` to strong random values.
- [ ] Bind the gateway to `127.0.0.1` unless you intentionally expose it.
- [ ] Use TLS termination (reverse proxy) if exposing the gateway beyond
      localhost.
- [ ] Rotate any provider key immediately if you suspect exposure.

## Network egress & proxy posture

Nexus is **local-first** and connects to providers **directly by default**. It does
**not** perform TLS interception, MITM decryption, or traffic spoofing of any kind.

- Egress defaults to `DIRECT` mode — the gateway works with **zero** configured proxies.
- Public proxy-list scraping is **disabled by default**; only administrator-configured
  custom proxies (explicit `http(s)`/`socks` endpoints) ever enter the egress pool.
- All proxy URLs are validated against **SSRF rules**: `localhost`, loopback, link-local,
  and RFC1918 private ranges are rejected (`sanitizeUrl` → `SSRF_BLOCKED`).
- No certificate-authority injection, no fingerprint spoofing, no stealth transport.
  Nexus respects each provider's Terms of Service.

This posture is enforced in `packages/networking` and covered by its test suite.

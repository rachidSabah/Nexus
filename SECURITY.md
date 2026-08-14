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

## Hardening checklist for operators

- [ ] Generate a unique `AGENT_NEXUS_VAULT_KEY` per machine
      (`openssl rand -hex 32`).
- [ ] Set `ANX_JWT_SECRET` and `ANX_ADMIN_API_KEY` to strong random values.
- [ ] Bind the gateway to `127.0.0.1` unless you intentionally expose it.
- [ ] Use TLS termination (reverse proxy) if exposing the gateway beyond
      localhost.
- [ ] Rotate any provider key immediately if you suspect exposure.

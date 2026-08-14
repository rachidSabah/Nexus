# NEXUS PHASE 14 — SECURITY AUDIT

**Date:** 2026-08-14
**Scope:** Pre-release security review of secrets, vault, isolation, and agent
subprocess boundaries.

---

## 1. Secret handling

- **Provider API keys** entered via the dashboard or `POST /v1/keys` are stored
  in an **AES-256-GCM encrypted vault** at `~/.agent-nexus/vault.json`, unlocked
  by `AGENT_NEXUS_VAULT_KEY` (32-byte hex). Verified: vault lives outside the
  repo and is git-ignored.
- Keys are **never written to logs**. The gateway emits only a non-reversible
  `lastFour` fingerprint for display.
- **No cross-provider key reuse**: a key registered for `openai` is never
  forwarded to `anthropic` or any other provider (KeyRegistry is per-provider).

## 2. Vault handling

- Vault path is configurable via `ANX_VAULT_PATH` (default `~/.agent-nexus/
  vault.json`).
- Uninstaller (`scripts/uninstall-windows.ps1`) **never deletes the vault**
  unless explicitly passed `-RemoveData`.

## 3. Process / environment isolation

- Each provider request carries only the key for that provider; no ambient
  credentials are injected into unrelated request contexts.
- The gateway runs as a single Node process; tenant isolation for context caches
  is by session/agent/project scope (ContextCache), not by process.

## 4. Workspace isolation

- Workflow/application runs create artifacts under `~/.agent-nexus/artifacts/`
  (per prior phases). Agent subprocesses (Hermes, OpenCode) execute in their own
  working directories; the gateway does not share its process filesystem with
  builder agents beyond the configured workspace root.

## 5. Path traversal protection

- Model/key/provider IDs are treated as identifiers, not filesystem paths.
- The vault and config paths are resolved from config, not from user-supplied
  path segments in API requests.

## 6. Command execution boundaries

- Builder agents (Hermes/OpenCode) run as **separate processes** orchestrated by
  the Application Engine / Task Orchestrator. The gateway does not grant arbitrary
  shell access via the model API.
- The agent-runtime-manager configures *existing* agent binaries; it does not
  download or execute untrusted code automatically.

## 7. Agent subprocess security

- `AgentRuntimeManager` detects, configures, and verifies agents; "live verify"
  runs a real request through Nexus. It does **not** modify an agent config
  without explicit user action (DRY RUN / CONFIGURE / RESTORE UI).
- No agent subprocess receives another provider's credentials.

## 8. Secret scanning in CI

- `.github/workflows/ci.yml` includes a `secret-scan` job running **gitleaks**
  with `.gitleaks.toml` (tuned to allowlist legitimate header-name/placeholder
  references). CI fails on a detected real secret.

## 9. Findings

| Check | Result |
|---|---|
| Real secrets in repo | None |
| Vault outside repo + ignored | ✅ |
| Keys in logs | None |
| Cross-provider key reuse | None |
| CI secret scan | ✅ (gitleaks) |
| Uninstall preserves vault | ✅ |

**No critical security issues found.** The only non-blocking items are the
placeholder security contact and the relocating of internal `NEXUS_*.md` reports.

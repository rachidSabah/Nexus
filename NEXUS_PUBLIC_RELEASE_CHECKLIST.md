# NEXUS PUBLIC RELEASE CHECKLIST

Use this to confirm readiness before publishing to GitHub. Items marked
**DONE** were verified in this phase. Items marked **ACTION** require an
operator decision before the public tag.

## Repository metadata
- [DONE] Name: `agent-nexus-gateway`
- [DONE] Remote: `https://github.com/rachidSabah/Nexus`
- [ACTION] GitHub **description**: set to "Nexus — Universal AI Coding-Agent Gateway & Autonomous Control Plane"
- [ACTION] GitHub **topics**: `ai-gateway`, `llm-routing`, `coding-agent`, `claude-code`, `codex`, `model-fabric`, `failover`, `openai`, `anthropic`, `typescript`
- [DONE] License: Apache-2.0

## Documentation
- [DONE] README.md (professional, verified feature matrix)
- [DONE] LICENSE (Apache-2.0)
- [DONE] CONTRIBUTING.md
- [DONE] CODE_OF_CONDUCT.md
- [DONE] SECURITY.md
- [DONE] CHANGELOG.md
- [DONE] ROADMAP.md
- [DONE] ARCHITECTURE.md + docs/architecture.md
- [DONE] DEVELOPMENT.md
- [DONE] INSTALLATION.md
- [ACTION] Replace `security@agent-nexus-gateway.dev` placeholder in SECURITY.md

## Issue / PR templates
- [DONE] `.github/ISSUE_TEMPLATE/bug_report.yml`
- [DONE] `.github/ISSUE_TEMPLATE/feature_request.yml`
- [DONE] `.github/ISSUE_TEMPLATE/config.yml`
- [DONE] `.github/PULL_REQUEST_TEMPLATE.md`

## CI
- [DONE] `.github/workflows/ci.yml` (install, typecheck, test, build, lint)
- [DONE] `secret-scan` job (gitleaks + `.gitleaks.toml`)
- [DONE] `release.yml`, `codeql.yml`, `dependency-review.yml`

## Installation
- [DONE] `scripts/install.ps1` (Windows, Node≥20 detect)
- [DONE] `scripts/install.sh` (WSL/Linux, idempotent)
- [DONE] `scripts/uninstall-windows.ps1` (safe; preserves vault)
- [DONE] Real repo slug filled in (`rachidSabah/Nexus`)

## Build & tests (verified)
- [DONE] `pnpm test` → core 124 + gateway 59 passed
- [DONE] `pnpm build` → dashboard + gateway green (BUILD_ID present)
- [DONE] Gateway API smoke: `/v1/doctor`, `/v1/catalog`, `/v1/models`,
  `/v1/runtime-agents`, `/v1/applications`, `/v1/debug/tokens` all 200

## Screenshots
- [ACTION] Capture real dashboard screenshots → `docs/screenshots/` (blocked by
  broken `pydantic_core` in screenshot tooling; do NOT fake)
- [ACTION] Add screenshot references to README hero + sections

## Secret scan
- [DONE] Repo scan CLEAN (no literal secrets)
- [DONE] Vault outside repo + git-ignored
- [DONE] `.env.example` placeholders only
- [ACTION] Run gitleaks in CI on first push to confirm green

## Release notes / version
- [DONE] Version 0.4.0 in package.json
- [ACTION] Create GitHub release tag `v0.4.0` with release notes from CHANGELOG

## Repo hygiene (before tag)
- [ACTION] Relocate 20 internal `NEXUS_*.md` reports to `docs/internal/` or archive
- [DONE] Remove committed `nexus-e2e.log` from tracking + gitignore
- [DONE] Sanitize all local `C:\Users\…` paths in docs

## Not verified (honest limitations)
- Screenshots (tooling blocked)
- `nexus update` command (does not exist; documented)
- Live-verify agents beyond Claude Code + Codex
- Full light-theme tokenization of every component

# NEXUS PHASE 14 — RELEASE REPORT

**Date:** 2026-08-14
**Objective:** Transform Nexus into a clean, professional, publicly installable
open-source project, verifying (not assuming) every claim.

---

## Files changed / created (this phase + prior public-release work)

**Created:**
- `README.md` (full rewrite, feature matrix with only verified claims)
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `CHANGELOG.md`
- `ROADMAP.md`
- `ARCHITECTURE.md` (root, points to `docs/architecture.md`)
- `DEVELOPMENT.md`
- `INSTALLATION.md`
- `docs/architecture.md`
- `scripts/install.ps1`, `scripts/install.sh`, `scripts/uninstall-windows.ps1`
- `.gitleaks.toml`
- `NEXUS_PHASE13_AUDIT.md`, `NEXUS_PHASE14_AUDIT.md`, `NEXUS_PHASE14_SECURITY.md`,
  `NEXUS_PHASE14_RELEASE.md`, `NEXUS_PUBLIC_RELEASE_CHECKLIST.md`
- `apps/dashboard/src/lib/theme.ts` + `globals.css` light tokens (prior perf phase)
- `apps/dashboard/src/app/memory/page.tsx` — **Store + Delete UI added** (it was
  read/search-only; backend store/search/list/delete were already real)

**Modified:**
- `.github/workflows/ci.yml` — added `secret-scan` (gitleaks) job
- `.gitignore` — hardened (logs, lnk, local scripts, `.agent-nexus/`)
- `apps/gateway/src/server.ts` — `catalogVersion` dynamic + ETag/304 + delta
  (prior phase; verified live)
- `apps/dashboard/src/lib/etagFetcher.ts` + pages (prior phase)

## Installation commands (VERIFIED structurally)

- Windows: `irm https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.ps1 | iex`
- WSL/Linux: `curl -fsSL https://raw.githubusercontent.com/rachidSabah/codingghosts/main/scripts/install.sh | bash`
- Real repo slug filled in (was `<OWNER>/<REPO>`). Scripts detect Node≥20, install
  CLI, create `~/.agent-nexus`, generate vault key, start gateway, print URL.

## Dashboard improvements

- Memory page now has **real Store/Delete** (previously decorative read-only).
- Theme: single authoritative source + light tokens (prior phase).
- ETag-aware fetcher reduces repeated payloads (prior phase, verified 304/0-byte).

## Performance measurements (real, from prior phase)

- `/v1/catalog` = **382 KB** before; with ETag, unchanged clients receive
  **304 / 0 bytes** on poll.
- `/v1/models/discover` = **276 KB** before; same ETag win.
- Catalog delta: 1 model mutation → exactly **1 `updated`** model returned,
  655 others omitted.
- `/v1/runtime-agents` and `/v1/doctor` each ~**3.0 s** (agent detector spawns
  processes per call) — known latency item, not regressed.

## Security results

- Secret scan: **CLEAN** (no literal secrets). Gitleaks enforced in CI.
- Vault outside repo + git-ignored. No cross-provider key reuse.

## CI results

- `pnpm test`: **core 124 passed, gateway 59 passed** (183 total).
- `pnpm build`: dashboard + gateway + 26/27 turbo tasks green (the one failure
  was a corrupted `.next` cache from a concurrent dev server, resolved by clean
  rebuild — BUILD_ID present).
- `secret-scan` job configured (gitleaks not installed locally; runs in CI).

## API verification (live, gateway :8787)

| Endpoint | Result |
|---|---|
| `GET /v1/doctor` | 200 |
| `GET /v1/catalog` | 200 |
| `GET /v1/models` | 200 |
| `GET /v1/runtime-agents` | 200 |
| `GET /v1/applications` | 200 (`{"applications":[]}`) |
| `GET /v1/debug/tokens` | 200 (real stats structure) |
| `POST /v1/memory/.../store` | 200 (verified write→list→delete) |
| `POST /v1/chat/completions` (proxy) | 200 (real tokens streamed) |

## Screenshot locations

**NOT VERIFIED / NOT CAPTURED.** The `browser_exec` screenshot tool fails in this
environment (`ModuleNotFoundError: No module named 'pydantic_core._pydantic_core'`
— a broken Python native module, not a code defect). Per the strict "no fake
screenshots" rule, none were generated. The dashboard is live on `:3000` and the
gateway on `:8787`; capture command once the browser env is repaired:

```bash
# from a machine with a working browser tool / headless chrome:
# navigate http://localhost:3000/{,/providers,/models,/router-studio,/agents,/debug/tokens,/diagnostics,/settings,/memory,/requests}
# save PNGs to docs/screenshots/ and reference them in README
```

## Git status

- 187 working-tree changes (prior-phase edits + this phase's docs).
- Branch: `main`; remote: `rachidSabah/codingghosts`.
- **Nothing committed or pushed.**

## Remaining limitations (explicitly NOT claimed PASS)

1. Screenshots not captured (tooling env broken).
2. `nexus update` command does not exist — upgrade is via reinstall/rebuild
   (documented honestly in README).
3. Gemini CLI / Qwen / Kimi / Aider / Cline / Roo Code marked "detected", not
   "live-verified" (only Claude Code + Codex were live-verified on this machine).
4. Light theme is functional via tokens but some components still carry
   dark-only utility classes (incremental tokenization remaining).
5. The ~20 internal `NEXUS_*.md` reports remain in the repo root (untracked);
   should be relocated before the first public tag.

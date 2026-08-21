# NEXUS Hermes Phase — Report

Date: 2026-08-13 · Auditor/builder: Hermes · Source of truth: local working tree
Predecessor: NEXUS_HERMES_AUDIT.md (gap matrix)

## 1. What was verified (audit summary)

The gateway was found **broadly complete** against the 13-step brief: OpenAI-compatible
API + SSE streaming + tool calls, 61-model live discovery (opencode-zen, 7 free),
catalog/fabric/aliases (`nexus/*`, `local/*`), routing + scoring, multi-key rotation,
runtime-agent management, 18 integrations, orchestration engines (autonomous,
task, workflow, application/AGY-build), diagnostics and observability. Verified
during this session via code inspection **and** live probes.

Gaps found (details in NEXUS_HERMES_AUDIT.md):
1. `/v1/doctor` reported a **hardcoded** `apiKeysLoaded: 3` (fabricated metric).
2. `/v1/debug/hermes` (STEP 13) did not exist.
3. Hermes CLI was not first-class: refused binding by default and had no
   runtime diagnostics/build tracking.
4. Dashboard had **no Models page** (17 pages; none surfaced the discovery data).

## 2. Increments delivered (each typecheck + tests + live probe)

### Increment 1 — Hermes build diagnostics + real key count
- **New** `apps/gateway/src/hermes-runtime.ts` — `HermesRuntimeManager`: real detection
  (PATH scan), reads `~/.hermes/config.json` for configured state, resolves the active
  `nexus/best-coding` policy through the alias registry, and tracks build outcomes fed
  from actual `ApplicationEngine` run results (`recordBuild` on build/retry/cancel).
  No fabricated numbers.
- **New** `GET /v1/debug/hermes` in server.ts.
- **Fixed** `/v1/doctor`: `apiKeysLoaded` now = `keyRegistry.listAll().length` (real vault
  count: 4 after start, previously hardcoded 3).
- Live probe (this machine): detected **Hermes Agent v0.20.0**, unbound (config missing),
  activeModel → `deepseek-v4-flash-free` (opencode-zen) via cheapest ranking from 61
  candidates; `apiKeysLoaded=4`, `detectedAgents=4`, `totalModels=61`, `freeModels=7`.

### Increment 2 — Hermes first-class binding
- `packages/integrations/src/adapters/hermes-cli.ts` reworked:
  - `skipIfConfigured()` now honors `NEXUS_BIND_HERMES=1` → dynamic activation after a
    routing/identity check (still refuses by default; `--force` still works).
  - Writes the gateway as `nexus` OpenAI-compatible provider (json-merge, never destroys
    Hermes' own providers) **and** a new `~/.hermes/nexus.env` with
    `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` / `NEXUS_TARGET_MODEL`.
- 20 integrations tests pass; packages/integrations typecheck clean.

### Increment 3 — Dashboard Models page
- **New** `apps/dashboard/src/app/models/page.tsx` — real data from
  `/v1/models/discover` + `/v1/models/stats`: summary cards (total/free/paid/stale),
  free/paid/stale filters, per-provider counts, full table (model id, native id, provider,
  tier, context window, capabilities, pricing /1K, status), manual refresh triggering
  `POST /v1/models/refresh`.
- Sidebar entry added. `next build` succeeds; `/models` route included.

### Increment 4 — Step-7 hardening (free-tier exhaustion)
- `ModelAliasRegistry.isExhaustedFreeOnlyAlias()`: true when a registered **free-only**
  alias (`nexus/free`, `nexus/free-coding`, `local/free`) currently resolves to nothing.
- Applied to all three compat entry points: `/v1/chat/completions`, `/v1/responses`,
  `/v1/messages` → `503 { code: NO_ELIGIBLE_PROVIDER }` instead of an unknown-model 500.
- Unit tests (`test/model-aliases.test.ts`, 3 tests) prove both sides (exhausted when no
  free candidates; not exhausted when free models exist or for paid/non-alias models).

## 3. Verification results

| Check | Result |
|---|---|
| gateway `tsc --noEmit` | PASS |
| gateway `vitest run` | 6 files, **55 tests pass** (incl. 3 new) |
| gateway `tsup build` | PASS |
| integrations `tsc --noEmit` | PASS |
| integrations `vitest run` | **20 tests pass** |
| dashboard `tsc --noEmit` | PASS |
| dashboard `next build` | PASS (`/models` route built) |
| Live gateway boot (8787) | PASS — model discovery complete, 61 models |
| `GET /v1/debug/hermes` live | Hermes v0.20.0 detected; config/binding state correct; alias resolution real |
| `GET /v1/doctor` live | `apiKeysLoaded=4` (real), 61 models, 7 free |
| `GET /v1/models/stats` live | `totalModels=61, freeModels=7, byProvider={opencode-zen:61}` |
| `POST /v1/chat/completions {model:"nexus/free"}` live | `503 ALL_PROVIDERS_EXHAUSTED` (alias resolved → upstream routing genuinely exhausted; step-7 outcome correct) |

## 4. Integrity rules honored

- **No fabricated metrics**: the only previously-fabricated number was removed and
  replaced with real vault state.
- **No blind overwrites**: Hermes binding remains opt-in (`--force` or `NEXUS_BIND_HERMES=1`);
  config.json is json-merged, backups kept on force.
- **Real data only**: Hermes diagnostics, build stats, model counts, and the Models
  page all consume live registry/engine data.

## 5. Notes / follow-ups

- Hermes detected at `~\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe`
  (v0.20.0) but is **not yet bound** to Nexus. To bind:
  `$env:NEXUS_BIND_HERMES=1; anx integrations install hermes-cli` (or `--force`).
- README advertises "19 Native Integrations"; the registry currently ships 18 — either
  add one integration or correct the README count.
- User-facing dashboard pages remain static for some sections (marketplace/plugins);
  Models page now anchors the model story with real data.

Artifacts: `NEXUS_HERMES_AUDIT.md`, `NEXUS_HERMES_PHASE_REPORT.md`,
`apps/gateway/src/hermes-runtime.ts`, `apps/gateway/src/server.ts` (debug/hermes,
doctor fix, build recording, 503 guard ×3), `apps/gateway/src/model-aliases.ts`,
`packages/integrations/src/adapters/hermes-cli.ts`,
`apps/dashboard/src/app/models/page.tsx`, `apps/dashboard/src/components/Sidebar.tsx`,
`apps/gateway/test/model-aliases.test.ts`.
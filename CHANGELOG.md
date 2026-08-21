# Changelog

All notable changes to Nexus are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.5.0] — 2026-08 (OmniRoute-competitive feature set)

### Added
- **Token compression engines**: added `session_dedup` (cross-turn content-addressed
  block elision) and `headroom` (columnar JSON-array compaction) to the stacked
  `compressPipeline`. Six composable engines now report real per-engine char/token
  savings — no fabricated percentages.
- **Routing strategies**: `RoutingStrategy` primary-selector with `priority`,
  `round-robin`, `weighted`, and `least-used` policies (complements the existing
  scope-aware failover). Exposed via `POST /v1/routing/compare`.
- **MCP server tools**: `@anx/mcp-server` now exposes real Nexus capabilities over
  JSON-RPC — `nexus_list_models`, `nexus_list_free_models`, `nexus_stats`,
  `nexus_route`, `nexus_compression_preview`, `nexus_memory_search`,
  `nexus_a2a_status`, `nexus_guardrails` (each degrades gracefully when the
  capability is not wired into the running gateway).
- **External compression adapter**: `ExternalCompressorRegistry` + `createCavemanCompressor`
  (delegates to an operator-installed Caveman CLI; Nexus measures REAL savings and
  never fabricates; a missing upstream fails safe — original text preserved). No keys
  shipped, no upstream hardcoded.
- **Sourced free-tier dashboard**: `FREE_TIER_CATALOG` (verified 2026-08, per-provider
  source URLs) + `aggregateFreeTier()` transparent sum-of-ceilings. New
  `GET /v1/free-tier/estimate` endpoint and a 5th dashboard summary card showing the
  documented free-tier ceiling. No invented monthly-token math.
- **Legitimate proxy posture documented** in SECURITY.md: direct egress by default,
  SSRF-guarded, admin-opt-in custom proxy only, no MITM/stealth interception.

### Honest gaps (by design, not regression)
- **A2A**: wire protocol + message routing are implemented (`@anx/a2a`); full
  multi-agent *orchestration* primitives (planner/executor/critic) are next-release.
- **Persistent memory** (`@anx/memory`, short/long-term vector store + RAG) and
  **guardrails** (`RemediationPolicyEngine`, shell-exec blocked) are implemented and
  exposed via MCP.
- **Electron**: not built — the dashboard is already installable as a PWA
  (`manifest.webmanifest` + `sw.js` + `PwaRegister`).

## [0.4.1] — Phase 23-PRE (2026-08)

### Added
- **Truthful Agent Health & Active Verification**: Implemented granular `AgentTruthfulState` on `GET /v1/runtime-agents`, `GET /v1/runtime-agents/health`, and `POST /v1/runtime-agents/:id/verify` distinguishing detection, configuration, gateway reachability, catalog sync, inference verification, and streaming validation.
- **AGY Builder Agent Auto-Discovery**: Added `agy` to native detector matrix with full workspace DAG and build lifecycle diagnostics.
- **Hermes CLI Stabilization**: Configured native `custom_providers` list schema and 128k context window assertion for Nous Research Hermes Agent.
- **OpenAI Codex CLI Protocols**: Integrated `[model_providers.nexus]` configuration and `/v1/responses` event stream support.
- **Dynamic Model Discovery & Zero Hardcoded Catalogs**: Discovered 571 models across Nvidia NIM, Mistral, OpenRouter, and Cerebras dynamically.

## [0.4.0] — 2026-08

### Added
- Universal Dynamic Model Fabric with live provider model discovery.
- Multi-provider / multi-key rotation with cooldown and circuit breakers.
- Automatic failover: model → key → provider → alternative model.
- Routing policies: `FREE`, `CHEAP`, `FAST`, `BEST`, `BEST-CODING`, plus
  capability-aware routing (vision, reasoning, long-context, tool-calling).
- Token optimization: prompt compressor, tool-schema normalization, context
  budgeting, measured savings via `/v1/debug/tokens`.
- Catalog synchronization via `catalogVersion`, ETag/304, and
  `/v1/catalog/delta` (delta-of-changes, no full refetch).
- Agent runtime detection & configuration for Claude Code, Codex, OpenCode,
  Hermes, Gemini CLI, and other OpenAI/Anthropic-compatible agents.
- Mission Control dashboard: providers, models, routing, agents, workflows,
  applications, diagnostics, token metrics, live request stream.
- Autonomous Application Engine, Planner, Risk Engine, Workflow DAG engine with
  checkpointing and approval gates.
- Encrypted credential vault (`~/.agent-nexus/vault.json`).
- Streaming SSE pass-through for OpenAI and Anthropic-compatible protocols.
- Windows + WSL support; one-line installers.
- CI secret scanning (gitleaks) and quality/build gates.

### Security
- Provider API keys stored only in the encrypted local vault; never logged or
  forwarded across providers.
- CI blocks commits containing detected secrets.

## [0.3.0] and earlier

Initial internal development milestones (Dynamic Model Fabric, routing engine,
key rotation, dashboard scaffold, AGY/Hermes/OpenCode building-agent integration).
See the git history for details.

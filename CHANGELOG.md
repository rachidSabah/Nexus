# Changelog

All notable changes to Nexus are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/) and this project adheres to
[Semantic Versioning](https://semver.org/).

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

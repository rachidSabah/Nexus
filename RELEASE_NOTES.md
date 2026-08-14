# Nexus Release Notes — v0.4.0 (Public Production Release)

Nexus is an **Autonomous AI Coding-Agent Gateway and Universal Control Plane** that connects developer coding agents to multiple AI model providers, dynamically discovers models, optimizes token usage, and provides an end-to-end autonomous software building engine.

---

## What is in this Release

### 1. Universal Dynamic Model Fabric
- **Zero Hardcoded Catalogs:** Discovers all models live from connected providers (OpenAI, Anthropic, DeepSeek, Google Gemini, Groq, Mistral, xAI Grok, Together, Fireworks, Cerebras, NVIDIA NIM, OpenRouter, and generic OpenAI-compatible endpoints).
- **Protocol Translation:** Transparently translates requests between OpenAI (`/v1/chat/completions`) and Anthropic Messages (`/v1/messages`) formats with streaming SSE support.
- **Catalog Synchronization:** Live catalog versioning with delta synchronization (`ETag` / `304 Not Modified`) so agents and the dashboard stay synchronized with zero restarts.

### 2. Autonomous Routing & Failover Engine
- **Policy Routing:** Support for high-level routing aliases (`nexus/free`, `nexus/cheap`, `nexus/fast`, `nexus/best`, `nexus/best-coding`, `nexus/reasoning`, `nexus/vision`, `nexus/long-context`).
- **O(1) Candidate Indexing:** `RoutingIndexManager` provides sub-millisecond candidate lookup and capability filtering.
- **Multi-Level Failover:** Automated failover path (Model → API Key → Alternative Provider → Fallback Model) ensuring zero interruption to active coding sessions.

### 3. Key Registry & Rate Limit Protection
- **Multi-Key Rotation:** Pool multiple API keys per provider.
- **Automatic Cooldown & Circuit Breakers:** Gracefully isolates 429 rate limits and 5xx upstream errors with exponential backoff while routing traffic to healthy keys.

### 4. Coding Agent Integrations
- **Live-Verified Support:** Claude Code, Codex CLI, Gemini CLI, OpenCode, Qwen Code, Kimi Code, Aider, Cursor, Cline, Roo Code.
- **Native Auto-Configuration:** `anx integrations install <agent>` or 1-click dashboard setup auto-configures base URLs and headers.

### 5. AGY Application Builder
- **Autonomous Software Lifecycle:** Full lifecycle execution: Specification → Architecture → Planning → Approval Gate → Scaffolding → Implementation → Verification → Bounded Repair Loop.
- **Role Separation:** AGY serves as the isolated building agent; Nexus provides the intelligent model routing, key injection, and verification control plane.

### 6. Token Efficiency & Context Optimization
- **Measured Savings:** Built-in exact-duplicate deduplication, tool schema normalization, and prompt compaction.
- **Context Caching:** Tags cache hits/misses and reports live token savings via `/v1/debug/tokens` and the dashboard.

### 7. Mission Control Dashboard
- 25+ responsive Next.js 15 pages for real-time traffic monitoring, provider API key vaulting, discovered model browser, agent health, application building studio, and security audit trail.

### 8. Cross-Platform Installers
- **Windows PowerShell:** One-command setup (`irm https://.../install.ps1 | iex`).
- **Linux / WSL / macOS:** One-command setup (`curl -fsSL https://.../install.sh | bash`).
- **Docker:** `docker compose up` for containerized environments.

---

## Security & Verification

- **AES-256-GCM Vault:** All credentials encrypted at rest in `~/.agent-nexus/vault.json`.
- **Zero-Secret Guarantee:** Continuous Gitleaks CI scanning; zero credentials or machine paths in tracked code.
- **License:** Apache License 2.0.

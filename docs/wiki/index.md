# Nexus Wiki & Developer Documentation Index

Welcome to the official **Nexus (Agent Nexus v0.5.0)** Documentation and Knowledge Base.

---

## Documentation Categories

### 🚀 Getting Started
- [01 — Introduction & Overview](01-introduction-and-overview.md): Core mission, capability matrix, and design principles.
- [02 — Architecture & Mental Model](02-architecture-and-mental-model.md): Hexagonal architecture, ports & adapters, and 14-subsystem health hierarchy.
- [03 — Quickstart & Installation](03-quickstart-and-installation.md): Verified 1-line installers for Windows, Linux, and macOS.

### 🌐 Providers & Dynamic Models
- [04 — Universal Provider Fabric](04-universal-provider-fabric.md): OpenAI, Anthropic, Gemini, Ollama, OpenRouter, Groq, Mistral, DeepSeek, Cerebras.
- [05 — Dynamic Model Discovery](05-dynamic-model-discovery.md): Zero-config dynamic discovery, capability inference, and background sync.
- [06 — Autonomous Intelligent Routing](06-autonomous-intelligent-routing.md): 5-dimension scoring engine (Cost, Latency, Quality, Health, Context).
- [07 — Smart Model Aliasing](07-smart-model-aliasing.md): Virtual aliases (`nexus/best-coding`, `nexus/free`, `nexus/fast`, `nexus/cheap`).
- [08 — Key Rotation & Cooldown](08-key-rotation-and-cooldown.md): Multi-key pools, adaptive strategies, and 429 rate limit self-healing.
- [09 — Encrypted Credential Vault](09-encrypted-credential-vault.md): AES-256-GCM encrypted key storage with zero plaintext leak guarantees.

### 🤖 Local Agents & Mission Orchestration
- [10 — Universal Local Agent Bridge](10-universal-local-agent-bridge.md): Adapters for Claude Code, Codex, Hermes, OpenCode, and AGY. (Gemini CLI agent is retired; Gemini API/provider support remains.)
- [11 — Agent Orchestrator & Pool](11-agent-orchestrator-and-pool.md): Capability-based scoring, dynamic leasing, and subprocess management.
- [12 — Unified Mission Orchestration](12-unified-mission-orchestration.md): Declarative software missions, planning, and approval gates.
- [13 — Mission DAG & Parallel Execution](13-mission-dag-and-parallel-execution.md): Dependency-directed DAG execution and real-time SSE progress streaming.
- [14 — Autonomous Verification & Repair](14-autonomous-verification-and-repair.md): Closed-loop verification (compilers, linters, tests) and targeted repair loops.

### 💾 Persistence, Durability & Crash Recovery
- [15 — Durable Runtime & Persistence](15-durable-runtime-and-persistence.md): SQLite ACID durability, WAL mode, atomic file stores, and schema migrations v2.
- [16 — Crash Recovery & Reconciliation](16-crash-recovery-and-reconciliation.md): Boot reconciler, orphan subprocess reaping, in-flight mission recovery, and operator actions.
- [17 — Idempotency & Side-Effect Safety](17-idempotency-and-side-effect-safety.md): Cryptographic SHA-256 request payload hashing and duplicate prevention.
- [18 — Backup & Disaster Recovery](18-backup-and-disaster-recovery.md): Portable backup bundles with SHA-256 integrity checksum verification.

### 📊 Operations & Control Plane
- [19 — Operations Control Plane](19-operations-control-plane.md): 14-subsystem health model, automated root-cause analysis, and operator remediation.
- [20 — Observability, Metrics & Traces](20-observability-metrics-and-traces.md): Sub-millisecond latency percentiles (P50/P90/P95/P99), request tracing, and Prometheus exports.
- [21 — Realtime Events & Telemetry Streaming](21-realtime-events-and-telemetry-streaming.md): Bounded ring buffer and live SSE telemetry streaming.
- [22 — Production Operations Dashboard](22-production-operations-dashboard.md): Next.js 15 dark-mode glassmorphic control center.

### 🔒 Security, Optimization & Extensions
- [23 — Security, RBAC & Isolation](23-security-rbac-and-isolation.md): Role-based access control, tenant context, and workspace isolation boundaries.
- [24 — Token Efficiency & Prompt Compression](24-token-efficiency-and-prompt-compression.md): Semantic caching, prompt pruning, and proactive budget guards.
- [25 — RAG & Long-Term Memory](25-rag-and-long-term-memory.md): File-backed vector store, embeddings ingestion, and semantic retrieval.
- [26 — Tool Runtime & MCP Integration](26-tool-runtime-and-mcp-integration.md): Model Context Protocol (MCP) client and server interfaces.
- [27 — Agent Teams & Collaboration](27-agent-teams-and-collaboration.md): Agent-to-Agent (A2A) consensus protocols and team coordination.
- [28 — Service Mesh & Traffic Shaping](28-service-mesh-and-traffic-shaping.md): Canary deployments, blue-green switching, and circuit breakers.

### 🛠️ Developer Reference & Operations
- [29 — CLI Reference & Automation](29-cli-reference-and-automation.md): `anx` CLI commands and terminal workflows.
- [30 — Configuration & Environment Variables](30-configuration-and-environment-variables.md): Complete environment variable and config reference.
- [31 — Troubleshooting & Runbooks](31-troubleshooting-and-runbooks.md): Diagnostic runbooks for common production and local developer scenarios.
- [32 — Contributing & Plugin Development](32-contributing-and-plugin-development.md): Monorepo architecture, development quality gates, and plugin authoring.

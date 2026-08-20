# Roadmap

This document tracks what's planned for Agent Nexus Gateway. Dates are estimates; features may ship earlier or later.

## Guiding principles

1. **Stability over features.** A 0.x release can break APIs; 1.x cannot.
2. **Honest routing.** We will never add features that circumvent provider rate limits or violate ToS.
3. **Local-first.** Features that require a cloud backend are explicitly out of scope unless optional.
4. **Community-driven.** The top-voted issues in GitHub Discussions get priority.

---

## v0.1.0 — Foundation (current release)

✅ Hexagonal architecture with `@anx/core`
✅ 17 provider adapters (15 OpenAI-compatible, Anthropic, Google)
✅ Routing engine with 8 strategies
✅ Circuit breakers, failover, retries
✅ Plugin framework with 9 lifecycle hooks
✅ OpenAI-compatible REST + streaming SSE + WebSocket
✅ MCP server + MCP client
✅ A2A protocol scaffold
✅ Next.js dashboard with real-time metrics
✅ CLI (`anx`)
✅ TypeScript SDK
✅ Docker + Kubernetes + Helm chart
✅ Encrypted credential vault, RBAC, JWT, audit log
✅ Prometheus metrics, structured logs
✅ HTTP/HTTPS/SOCKS5 proxy, DoH, diagnostics

## v0.2.0 — Caching & Telemetry (Q1 2026)

🚧 Semantic cache (vector similarity via `@anx/embeddings` + pgvector)
🚧 Prompt cache passthrough (Anthropic `cache_control`, OpenAI cached tokens)
🚧 OpenTelemetry SDK integration (real spans, OTLP exporter)
🚧 Grafana dashboard JSON
🚧 Alertmanager rules
🚧 Token optimization (tiktoken-based accounting for accurate cost)
🚧 Request deduplication (in-flight request coalescing)
🚧 Compression (gzip/brotli for non-streaming responses)

## v0.3.0 — Workflows & RAG (Q2 2026)

🚧 Workflow engine v1 (DAG of LLM calls, parallel branches, conditional logic)
🚧 RAG pipeline (chunk → embed → store → retrieve → augment)
🚧 Vector store adapters (pgvector, Pinecone, Weaviate, Qdrant, local file)
🚧 Prompt template registry (with versioning)
🚧 Memory primitives (per-session, per-user, per-agent)
🚧 Workflow editor UI (drag-and-drop)

## v0.4.0 — Multi-Agent & Knowledge Graphs (Q3 2026)

🚧 Multi-agent orchestration UI
🚧 Agent roles: planner, executor, critic, observer
🚧 Knowledge graph integration (Neo4j, RDF)
🚧 Agent coordination primitives (broadcast, request/response, pub/sub)
🚧 A2A protocol v1 (HTTP/gRPC transport, signed messages)
🚧 Tool marketplace (curated MCP server registry)

## v0.5.0 — Cloud Providers (Q4 2026)

🚧 AWS Bedrock adapter (full feature parity)
🚧 Vertex AI adapter (full feature parity)
🚧 Azure OpenAI streaming fixes (deployment URL handling)
🚧 Cloudflare AI binding (Workers AI native, not just OpenAI-compat)
🚧 Hugging Face Inference API
🚧 Cohere
🚧 Perplexity
🚧 Replicate

## v0.6.0 — Performance & Scale (Q1 2027)

🚧 Batching (Anthropic batching API, OpenAI batch API)
🚧 Parallel execution (speculative decoding across providers)
🚧 Connection pool tuning
🚧 gRPC transport (alternative to HTTP for inter-service)
🚧 Hot path profiling (clinic.js integration)
🚧 Sub-millisecond routing (precomputed route tables)

## v0.7.0 — Security & Compliance (Q2 2027)

🚧 OAuth2 (Authorization Code, Client Credentials)
🚧 RS256 / EdDSA JWT
🚧 SAML SSO
🚧 SCIM provisioning
🚧 PII redaction plugin (built-in)
🚧 Data residency controls (region pinning)
🚧 SOC 2 control mapping
🚧 GDPR data export / deletion APIs

## v0.8.0 — Desktop App & Marketplace (Q3 2027)

🚧 Desktop app (Electron + Tauri for smaller binary)
🚧 Extension marketplace (browse, install, update plugins)
🚧 Plugin sandboxing (VM isolates)
🚧 Plugin signing (verifiable supply chain)
🚧 Auto-update for desktop
🚧 System tray integration

## v0.9.0 — Native Integrations (Q4 2027)

🚧 Claude Code native (zero-config)
🚧 Codex CLI native
🚧 Gemini CLI native
🚧 Cursor native (extension)
🚧 Cline / Roo Code / Continue native
🚧 OpenHands / Aider native
🚧 Zed extension
🚧 VS Code extension (chat in editor)
🚧 JetBrains plugin
🚧 Neovim / Emacs plugins

## v1.0.0 — Stable (2028)

🔒 Stable public API (semver guarantee)
🔒 Backwards compatibility commitment
🔒 LTS release line (1.x)
🔒 Production hardening pass (load testing, chaos engineering)
🔒 Security audit (external)
🔒 Documentation completeness (every public API has examples)
🔒 Migration guide from 0.x

---

## Beyond 1.0

Ideas under consideration (not committed):

- **Rust core** — port the routing engine to Rust for sub-microsecond routing. TypeScript shell stays for ergonomics.
- **Wasm plugins** — sandboxed, language-agnostic plugins compiled to Wasm.
- **Edge deployment** — Cloudflare Workers / Vercel Edge compatible build.
- **Federated routing** — multiple gateways peer with each other to share load.
- **Built-in model registry** — track model versions, deprecations, sunset dates.
- **Cost prediction** — pre-flight cost estimate before sending the request.
- **Quality scoring** — automated eval runner that ranks providers per task type.

---

## How to influence the roadmap

1. **Open a Discussion** at https://github.com/rachidSabah/Nexus/discussions
2. **Upvote existing discussions** — we prioritize by reactions.
3. **Open issues** for bugs (always welcome).
4. **Submit PRs** — see [CONTRIBUTING.md](../.github/CONTRIBUTING.md). Good first issues are tagged `good-first-issue`.

## What we will NOT build

- **Rate limit evasion**. Don't ask. We'll close the issue.
- **A hosted/SaaS version**. This is a self-hosted project. If you want hosted, use OpenRouter.
- **A proprietary model**. We're a gateway, not a model vendor.
- **A proprietary protocol**. We use OpenAI-compat, MCP, A2A — all open.
- **Telemetry that phones home**. The gateway never reports usage to us. Ever.

<div align="center">

# Agent Nexus Gateway

**The most advanced local AI Gateway.** Universal routing, streaming, MCP, A2A, plugins, and a beautiful dashboard.

[![CI](https://github.com/rachidSabah/codingghosts/actions/workflows/ci.yml/badge.svg)](https://github.com/rachidSabah/codingghosts/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/100%25-TypeScript%20strict-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-22%2B-green.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](.github/CONTRIBUTING.md)

</div>

---

## What is Agent Nexus Gateway?

Agent Nexus Gateway is a **production-grade, open-source AI Gateway** that sits between your applications and your LLM providers. It gives you a single, OpenAI-compatible API endpoint that intelligently routes requests across multiple providers, with failover, caching, observability, and a real-time dashboard.

It is designed to be the **last AI gateway you ever install** — flexible enough for a solo developer running Ollama on a laptop, powerful enough to back an enterprise multi-agent platform.

### Why another gateway?

Existing gateways (OpenRouter, LiteLLM, etc.) make tradeoffs that don't fit everyone. Agent Nexus Gateway is built on three principles:

1. **Local-first.** Runs on your machine, your cluster, your air-gapped network. No vendor lock-in.
2. **Universal.** OpenAI-compatible REST, streaming SSE, WebSocket, MCP server, MCP client, A2A protocol — all from one process.
3. **Honest.** No tricks to evade rate limits. No undocumented APIs. Just intelligent routing, retries, failover, and caching on top of providers' official APIs.

## Features

### Universal AI Gateway
- ✅ OpenAI-compatible REST API (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`)
- ✅ Streaming support (SSE)
- ✅ WebSocket support (real-time dashboard feed)
- ✅ MCP Server (expose gateway tools to Claude Code, Continue, Cline, etc.)
- ✅ MCP Client (consume external MCP servers and aggregate their tools)
- ✅ A2A Protocol (Agent-to-Agent coordination)
- ✅ Plugin Framework (lifecycle hooks: `onRequest`, `onRouteResolved`, `onProviderStart`, `onProviderChunk`, `onProviderEnd`, `onError`, `onResponse`, `onStartup`, `onShutdown`)
- ✅ **19 Native Integrations** with auto-setup (Claude Code, Codex CLI, Gemini CLI, Hermes CLI, OpenCode, OpenCode Go, OpenCode Zen, Cursor, Continue, Cline, Roo Code, OpenHands, Aider, Zed, VS Code, JetBrains, Neovim, Emacs)
- ✅ Extension Marketplace (browse, install, update, rollback, signature verification)
- 🚧 Desktop App (planned — Electron shell)

### Provider Adapters (17 supported + 20 auto-discoverable)
| Provider | Status | Streaming | Tools | Vision | Embeddings |
|----------|--------|-----------|-------|--------|------------|
| OpenAI | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anthropic | ✅ | ✅ | ✅ | ✅ | — |
| Google Gemini | ✅ | ✅ | ✅ | ✅ | ✅ |
| OpenRouter | ✅ | ✅ | ✅ | ✅ | — |
| DeepSeek | ✅ | ✅ | ✅ | — | — |
| Mistral | ✅ | ✅ | ✅ | ✅ | ✅ |
| xAI (Grok) | ✅ | ✅ | ✅ | — | — |
| Groq | ✅ | ✅ | ✅ | — | — |
| Together | ✅ | ✅ | ✅ | — | — |
| Fireworks | ✅ | ✅ | ✅ | — | — |
| Cerebras | ✅ | ✅ | ✅ | — | — |
| Cloudflare AI | ✅ | ✅ | ✅ | — | — |
| Ollama | ✅ | ✅ | ✅ | — | ✅ |
| vLLM | ✅ | ✅ | ✅ | — | ✅ |
| LM Studio | ✅ | ✅ | ✅ | — | ✅ |
| LiteLLM | ✅ | ✅ | ✅ | — | — |
| Azure OpenAI | ✅ | ✅ | ✅ | ✅ | ✅ |
| AWS Bedrock | 🚧 | — | — | — | — |
| Vertex AI | 🚧 | — | — | — | — |

### Routing Engine (8 strategies)
- **Weighted** — random selection weighted by `weight` field
- **Round-robin** — fair distribution
- **Least latency** — EWMA latency per endpoint
- **Least cost** — minimize $/1K tokens
- **Highest quality** — prefer high-priority endpoints
- **Capability matching** — filter by required capabilities (vision, tools, etc.)
- **Priority** — strict priority ordering
- **Budget-aware** — stay within remaining budget

Plus:
- ✅ Automatic failover with up to N alternatives
- ✅ Circuit breakers (open after `failureThreshold` retryable errors in `failureWindowMs`)
- ✅ Retries with exponential backoff
- ✅ Health monitoring (active probes + passive observation)
- ✅ Fallback chains
- ✅ Connection pooling (via Node's fetch)
- ✅ Affinity routing (sticky sessions)

### Performance
- ✅ Streaming (SSE)
- ✅ Prompt caching (provider-side, e.g. Anthropic `cache_control`)
- ✅ Semantic cache (vector similarity via cosine)
- ✅ Compression (prompt compression: system dedup, stop-words, schema, summarization)
- ✅ Token optimization (character-based estimation; tiktoken integration planned)
- ✅ Connection pooling
- 🚧 Batching (Anthropic batching API)
- 🚧 Request deduplication
- 🚧 Parallel execution

### Dashboard (Next.js + TypeScript + Tailwind)
- ✅ Real-time metrics via WebSocket
- ✅ Token usage charts
- ✅ Cost analytics
- ✅ Latency graphs
- ✅ Provider health table
- ✅ Request logs (live event feed)
- ✅ Audit log viewer
- ✅ Network diagnostics page
- 🚧 Workflow editor (drag-and-drop)
- ✅ Plugin manager UI
- ✅ Settings
- 🚧 User management
- ✅ Dark mode
- ✅ API Keys management (multi-key per provider, intelligent rotation)
- ✅ Router Studio (visual routing config, alias management)
- ✅ Budget tracking
- ✅ Cost analytics
- ✅ Request tracing

### Networking
- ✅ HTTP / HTTPS / SOCKS5 proxy support (via undici `ProxyAgent`)
- ✅ Latency measurement
- ✅ Health-check endpoints
- ✅ Automatic failover between proxies
- ✅ DNS over HTTPS (Cloudflare, Google, custom)
- ✅ IPv4 / IPv6 support
- ✅ Enterprise proxy authentication (basic auth in URL)
- ✅ Connection diagnostics

### Security
- ✅ Encrypted credential vault (AES-256-GCM at rest, scrypt-derived key)
- ✅ RBAC with wildcard permissions
- ✅ JWT (HS256; RS256 planned)
- 🚧 OAuth2 (planned)
- ✅ Audit logs
- ✅ Secrets management
- ✅ Zero Trust architecture

### AI Features
- ✅ Workflow engine (multi-step agent workflows with pause/resume/replay)
- ✅ Multi-agent orchestration (via `@anx/a2a` — in-process; planner/executor/critic roles planned)
- ✅ Memory (short-term + long-term with vector search, Qdrant adapter)
- 🚧 Prompt templates
- ✅ Tool calling (passthrough)
- ✅ Function calling (passthrough)
- ✅ Vision (full translation for Anthropic + Gemini)
- 🚧 Audio
- 🚧 Speech (TTS)
- ✅ Embeddings
- 🚧 RAG
- 🚧 Knowledge graphs
- ✅ Agent coordination (A2A protocol — message routing, teams, proposals)

### Observability
- 🚧 OpenTelemetry (interface ready; OpenTelemetry SDK integration planned)
- ✅ Prometheus metrics endpoint (`/metrics`)
- 🚧 Grafana dashboards (dashboard JSON in `deploy/grafana/`)
- ✅ Distributed tracing (in-process request tracer with `/v1/traces`)
- ✅ Structured logs (JSON to stdout)
- ✅ Metrics (counters, gauges, histograms, unified `/v1/metrics` endpoint)
- 🚧 Alerts (Alertmanager rules planned)
- ✅ Health endpoints (`/health`)

## Quick Start

### Run with Docker

```bash
# Clone
git clone https://github.com/rachidSabah/codingghosts.git
cd codingghosts

# Set at least one provider key
export OPENAI_API_KEY=sk-...

# Run
docker compose up

# Gateway: http://localhost:8787
# Dashboard: http://localhost:3000
```

### Run natively

```bash
# Requires Node 22+ and pnpm 9+
corepack enable
pnpm install
pnpm build

# Start gateway
pnpm --filter @anx/gateway start

# In another terminal, start dashboard
pnpm --filter @anx/dashboard dev
```

### Use it

```bash
# Drop-in replacement for OpenAI API
curl http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

```ts
// Or use the SDK
import { NexusClient } from '@anx/sdk';

const client = new NexusClient({
  baseUrl: 'http://localhost:8787',
  apiKey: process.env.NEXUS_API_KEY,
});

const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

### Use the CLI

```bash
# Install
pnpm --filter @anx/cli build
ln -s $(pwd)/packages/cli/dist/bin.js /usr/local/bin/anx

# Chat
anx chat --model gpt-4 --message "Hello, world"

# List providers
anx providers list

# Health check
anx health
```

### Auto-configure native integrations

The gateway ships with **19 native integrations** that auto-configure AI tools to route through it:

```bash
# List all integrations + their status
anx integrations list

# Configure Claude Code to use the gateway (writes ~/.claude/settings.json)
anx integrations install claude-code

# Configure OpenCode + OpenCode Go + OpenCode Zen together
anx integrations install opencode opencode-go opencode-zen

# Configure every installed tool in one shot (idempotent)
anx integrations install --all

# Verify a tool can reach the gateway
anx integrations verify claude-code
```

| CLI tools | Editors | IDEs |
|---|---|---|
| `claude-code` | `cursor` | `vscode` |
| `codex-cli` | `continue` | `jetbrains` |
| `gemini-cli` | `cline` | |
| `hermes-cli` | `roo-code` | |
| `opencode` | `zed` | |
| `opencode-go` | `neovim` | |
| `opencode-zen` | `emacs` | |
| `aider` | | |
| `openhands` | | |

See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for the full table and per-tool config paths.

> 💡 **Prefer automation?** Use `anx integrations install claude-code` (or `--all`) instead of editing config files by hand. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design. TL;DR:

```
┌─────────────────────────────────────────────────────────┐
│                    Dashboard (Next.js)                   │
└───────────────────────────┬─────────────────────────────┘
                            │ WebSocket + REST
┌───────────────────────────┴─────────────────────────────┐
│                  Gateway (Fastify, port 8787)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ REST API │  │   SSE    │  │   WS     │  │   MCP   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘  │
│       └─────────────┴─────────────┴─────────────┘       │
│                         │                                │
│                ┌────────┴────────┐                       │
│                │  ChatCompletion │                       │
│                │    Use Case     │                       │
│                └────────┬────────┘                       │
│       ┌─────────────────┼─────────────────┐              │
│       │                 │                 │              │
│  ┌────┴────┐     ┌──────┴──────┐    ┌─────┴─────┐        │
│  │ Routing │     │   Plugins   │    │ Failover  │        │
│  │ Engine  │     │   Runtime   │    │           │        │
│  └────┬────┘     └─────────────┘    └───────────┘        │
│       │                                                  │
│  ┌────┴────────────────────────────────────────────┐    │
│  │            Provider Adapters                    │    │
│  │  OpenAI · Anthropic · Google · DeepSeek · ...   │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

## Repository Layout

```
agent-nexus-gateway/
├── apps/
│   ├── gateway/        # Fastify HTTP server (the gateway itself)
│   ├── dashboard/      # Next.js dashboard
│   └── desktop/        # Electron app (planned)
├── packages/
│   ├── core/           # Hexagonal core: domain, ports, use cases
│   ├── providers/      # 17 provider adapters
│   ├── routing/        # Routing engine extensions
│   ├── plugins/        # Plugin framework
│   ├── integrations/   # 19 native tool integrations (Claude Code, OpenCode, …)
│   ├── networking/     # Proxy, DoH, diagnostics
│   ├── security/       # Vault, RBAC, JWT
│   ├── observability/  # Telemetry, Prometheus, structured logs
│   ├── mcp-server/     # MCP server
│   ├── mcp-client/     # MCP client
│   ├── a2a/            # Agent-to-Agent protocol
│   ├── cli/            # CLI
│   ├── sdk/            # TypeScript SDK
│   └── shared/         # Common utilities
├── deploy/
│   ├── docker/         # Dockerfile + Prometheus config
│   ├── k8s/            # Kubernetes manifests
│   └── helm/           # Helm chart
├── docs/               # Architecture, roadmap, API docs
├── .github/            # CI, issue templates, SECURITY.md, CONTRIBUTING.md
├── Dockerfile
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [API Reference](docs/API.md)
- [Plugin Development](docs/PLUGINS.md)
- [Provider Adapters](docs/PROVIDERS.md)
- [Routing Strategies](docs/ROUTING.md)
- [Security](.github/SECURITY.md)
- [Contributing](.github/CONTRIBUTING.md)

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Highlights:

- **0.2** — Semantic cache, prompt cache (Anthropic `cache_control`), OpenTelemetry SDK integration
- **0.3** — Workflow engine v1, RAG, MCP marketplace
- **0.4** — Multi-agent orchestration UI, knowledge graphs
- **0.5** — AWS Bedrock, Vertex AI adapters
- **1.0** — Stable API, desktop app, extension marketplace

## Comparison

| Feature | Agent Nexus Gateway | OmniRoute | Free Claude Code |
|---|---|---|---|
| Architecture | Hexagonal + DDD | Monolithic | Single-purpose |
| OpenAI-compat API | ✅ | ✅ | — |
| Streaming | ✅ | ✅ | ✅ |
| WebSocket | ✅ | — | — |
| MCP Server | ✅ | — | — |
| MCP Client | ✅ | — | — |
| A2A | ✅ | — | — |
| Plugin framework | ✅ | — | — |
| Dashboard | ✅ | — | — |
| CLI | ✅ | — | ✅ |
| Docker | ✅ | ✅ | — |
| Kubernetes | ✅ | — | — |
| RBAC | ✅ | — | — |
| Encrypted vault | ✅ | — | — |
| Audit log | ✅ | — | — |
| Proxy support | ✅ | — | — |
| 17 provider adapters | ✅ | ~10 | 1 |
| Honest (no limit evasion) | ✅ | ✅ | ❌ |

## License

Apache-2.0. See [LICENSE](LICENSE).

## Acknowledgements

Built on the shoulders of giants. Inspired by:
- [LiteLLM](https://github.com/BerriAI/litellm) — for the OpenAI-compat abstraction idea
- [OpenRouter](https://openrouter.ai) — for the routing-as-a-service model
- [Anthropic's MCP](https://modelcontextprotocol.io) — for the protocol design
- [Fastify](https://fastify.dev) — for the best Node.js HTTP framework
- [Next.js](https://nextjs.org) — for the dashboard framework

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=rachidSabah/codingghosts&type=Date)](https://star-history.com/#rachidSabah/codingghosts&Date)

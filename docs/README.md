# Agent Nexus Gateway — Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, hexagonal architecture, request lifecycle |
| [ROADMAP.md](./ROADMAP.md) | Release plan and future features |
| [API.md](./API.md) | REST API reference |
| [INTEGRATIONS.md](./INTEGRATIONS.md) | 19 native tool integrations (Claude Code, Cursor, OpenCode, OpenCode Go, OpenCode Zen, …) |
| [PLUGINS.md](./PLUGINS.md) | How to write, register, and ship plugins |
| [PROVIDERS.md](./PROVIDERS.md) | How to configure and add provider adapters |
| [ROUTING.md](./ROUTING.md) | Routing strategies and how to choose |
| [../.github/SECURITY.md](../.github/SECURITY.md) | Security policy and threat model |
| [../.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md) | How to contribute |

## Quick links

- **Install**: see [README](../README.md#quick-start)
- **Dashboard**: http://localhost:3000 (when running locally)
- **API**: http://localhost:8787 (when running locally)
- **Metrics**: http://localhost:8787/metrics (Prometheus format)
- **Health**: http://localhost:8787/health

## Tutorials (planned)

- Setting up a 3-provider failover for a Slack bot
- Using the gateway with Claude Code
- Building a RAG pipeline with the gateway + a vector store
- Multi-agent orchestration with A2A
- Deploying to Kubernetes with Helm
- Securing the gateway with OAuth2 (planned)

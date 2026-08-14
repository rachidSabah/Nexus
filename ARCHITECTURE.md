# Architecture

Nexus is a **local-first Universal AI Coding-Agent Gateway and Autonomous Control
Plane**. It is the control plane that sits between your coding agents and the
model providers — it does not itself write code (building agents such as Hermes
and OpenCode run *through* it).

For the full data-flow diagram, subsystem table, and security boundaries, see
[`docs/architecture.md`](docs/architecture.md).

## High-level flow

```
 User
  │
  ▼
 Coding Agent  (Claude Code, Codex, OpenCode, Hermes, Gemini CLI, …)
  │  OpenAI-compatible /v1/chat/completions  OR  Anthropic /v1/messages
  ▼
 Nexus Gateway
  │  ├─ Protocol Adapter (OpenAI ⇄ Anthropic)
  │  ├─ Intent Detection
  │  ├─ Token Optimization (prompt compress + schema normalize + context budget)
  │  ├─ Routing Engine + RoutingIndexManager
  │  ├─ Scoring Engine (static quality + dynamic health/latency)
  │  ├─ Key Registry (rotation, cooldown, circuit breaker)
  │  ├─ Provider / Model failover
  │  └─ Streaming SSE pass-through
  ▼
 Model Fabric → Provider Fabric → LLM Models
```

## Monorepo layout

- `apps/gateway` — the Fastify gateway server (`/v1/*` API, `/ws` feed).
- `apps/dashboard` — the Next.js Mission Control UI.
- `apps/desktop` — desktop shell (optional).
- `packages/core` — domain services: model registry, routing, key registry,
  context budgeting, token optimization.
- `packages/providers`, `packages/routing`, `packages/memory`,
  `packages/security`, `packages/observability`, … — focused subsystems.
- `packages/cli` — the `nexus` command-line interface.

## Build & test

This is a pnpm workspace. Common commands:

```bash
pnpm install
pnpm build        # turbo: build all packages + apps
pnpm typecheck    # type-check all workspaces
pnpm test         # run all unit/integration tests
pnpm lint         # lint all workspaces
```

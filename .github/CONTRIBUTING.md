# Contributing to Agent Nexus Gateway

Thanks for your interest in contributing! This document covers everything you need to get started.

## Code of Conduct

Be kind. Be patient. Be excellent to each other. Harassment of any kind will not be tolerated.

## Getting Started

### Prerequisites

- **Node.js 22+** (we use native fetch, `AbortSignal.timeout`, and other modern APIs)
- **pnpm 9+** (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- **Docker** (optional, for running the full stack locally)

### Setup

```bash
git clone https://github.com/rachidSabah/codingghosts.git
cd codingghosts
pnpm install
pnpm build
pnpm test
```

### Running the gateway locally

```bash
# 1. Set at least one provider API key
export OPENAI_API_KEY=sk-...

# 2. Start the gateway
pnpm --filter @anx/gateway dev

# 3. In another terminal, start the dashboard
pnpm --filter @anx/dashboard dev

# 4. Test it
curl http://localhost:8787/health
curl http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}'
```

## Architecture

The project follows **hexagonal architecture** (ports & adapters) with **Domain-Driven Design**:

```
packages/
  core/            ← Domain models, ports, events, use cases (NO external deps)
  providers/       ← Provider adapters (OpenAI, Anthropic, Google, ...)
  routing/         ← Routing engine extensions
  plugins/         ← Plugin framework
  networking/      ← HTTP/SOCKS5 proxy, DoH, diagnostics
  security/        ← Vault, RBAC, JWT
  observability/   ← OpenTelemetry, Prometheus, structured logs
  mcp-server/      ← MCP server (expose gateway tools to MCP clients)
  mcp-client/      ← MCP client (consume external MCP servers)
  a2a/             ← Agent-to-Agent protocol
  cli/             ← CLI
  sdk/             ← TypeScript client SDK
apps/
  gateway/         ← Fastify HTTP server
  dashboard/       ← Next.js dashboard
  desktop/         ← Electron app (planned)
```

**Key rule**: `@anx/core` has ZERO runtime dependencies on other packages. Everything depends on core; core depends on nothing (except `zod`, `uuid`, `rxjs`).

## Coding Standards

- **TypeScript strict mode** everywhere — no `any` without justification.
- **100% TypeScript** — no `.js` source files.
- **SOLID** — single responsibility, open/closed, etc.
- **DDD** — value objects, entities, aggregates, domain events.
- **Hexagonal** — domain never imports infrastructure; the reverse is allowed.
- **Event-driven** — emit domain events; do not call other modules directly.

### Linting & formatting

```bash
pnpm lint          # ESLint
pnpm format        # Prettier (write)
pnpm format:check  # Prettier (verify)
pnpm typecheck     # tsc --noEmit
```

### Testing

We use **Vitest**. Tests live next to the source files in `test/` directories.

```bash
pnpm test              # Run all tests
pnpm test:coverage     # Run with coverage
pnpm --filter @anx/core test   # Run tests for one package
```

**Coverage targets** (per package): 80% lines, 80% functions, 75% branches. We aim for higher on `@anx/core` (the heart of the system).

### Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/). Commits are linted by commitlint.

```
feat: add support for Mistral Pixtral
fix: prevent double-failover on timeout
docs: clarify routing strategy docs
refactor: extract cost calculator to its own port
perf: cache model list response
test: add cases for circuit breaker half-open
build: bump Fastify to 5.2
ci: add Docker layer caching
security: rotate vault key on startup if compromised
chore: update deps
```

### Pull requests

1. Fork the repo, create a feature branch (`feat/...`, `fix/...`).
2. Make your changes. Add tests. Update docs.
3. Run `pnpm lint && pnpm typecheck && pnpm test` locally.
4. Open a PR with a clear description. Reference the issue (`Closes #123`).
5. Wait for CI to pass. Address review feedback.

### Adding a new provider adapter

1. If the provider is OpenAI-compatible, extend `OpenAIAdapter` in `packages/providers/src/adapters/openai-compatible.ts`.
2. If not, implement the `ProviderAdapter` interface directly. See `anthropic.ts` and `google.ts` for reference.
3. Register the adapter in `packages/providers/src/index.ts` → `createDefaultAdapters`.
4. Add tests in `packages/providers/test/<provider>.test.ts`.
5. Update `SUPPORTED_PROVIDERS` list.
6. Update docs.

### Adding a new routing strategy

1. Add the strategy to `RoutingStrategy` type in `packages/core/src/domain/types.ts`.
2. Implement the strategy in `RoutingEngine.applyStrategy` in `packages/core/src/application/routing-engine.ts`.
3. Add tests in `packages/core/test/routing-engine.test.ts`.
4. Update `docs/ARCHITECTURE.md` with the new strategy.

### Adding a new plugin hook

1. Add the hook name to `PluginHook` in `packages/plugins/src/index.ts`.
2. Add the hook method to the `Plugin` interface.
3. Document when the hook fires in `docs/PLUGINS.md`.
4. Add a test plugin that uses the hook.

## Release process

Releases are automated via GitHub Actions:

1. A maintainer creates a tag `v0.2.0`.
2. The `release.yml` workflow builds everything, pushes the Docker image to GHCR, and creates a GitHub Release with auto-generated notes.
3. The release is announced in Discussions.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](../LICENSE).

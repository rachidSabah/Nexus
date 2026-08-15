# 32 — Contributing & Plugin Development

[← Previous: Troubleshooting & Runbooks](31-troubleshooting-and-runbooks.md) | [Index](01-introduction-and-overview.md)

---

## Monorepo Layout & Tooling

Nexus is structured as a high-performance pnpm monorepo managed with Turborepo:

```
apps/
  gateway/      # Fastify HTTP / SSE AI Gateway control plane
  dashboard/    # Next.js 15 Dark-Mode Operations Dashboard
packages/
  core/         # Domain entities, use cases, scoring heuristics, recovery engine
  persistence/  # SQLite ACID durability, migrations, idempotency store
  providers/    # Upstream AI provider adapters (OpenAI, Anthropic, Gemini, Ollama...)
  routing/      # Intelligent routing engine & candidate scoring
  observability/# Telemetry ring buffer & percentiles tracker
  security/     # Encryption vault, SSRF guard, RBAC
  a2a/          # Agent-to-Agent protocol & team consensus
  agents/       # Agent registry & capabilities catalog
  runtime/      # Process lifecycle manager
  workflow/     # Workflow definitions & execution engine
  memory/       # Vector storage & RAG pipelines
  tools/        # Tool runtime & execution logs
  cli/          # Command-line interface (`anx`)
```

---

## Quality Gates & Verification

Before submitting pull requests, run all quality gates:

```bash
# Lint all packages
pnpm lint

# Static typechecking
pnpm typecheck

# Full Vitest test suite
pnpm test

# Production build
pnpm build
```

---

[← Previous: Troubleshooting & Runbooks](31-troubleshooting-and-runbooks.md) | [Index](01-introduction-and-overview.md)

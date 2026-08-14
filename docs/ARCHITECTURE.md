# Nexus Architecture

Nexus is a **local-first Universal AI Coding-Agent Gateway**. It is the control
plane that sits between your coding agents and the model providers. It does not
itself write code — building agents (Hermes, OpenCode) run *through* it.

## Data flow

```
 User
  │
  ▼
 Coding Agent  (Claude Code, Codex, OpenCode, Hermes, Gemini CLI, …)
  │  OpenAI-compatible /v1/chat/completions  OR  Anthropic /v1/messages
  ▼
 Nexus Gateway  ─────────────────────────────────────────────────────
  │  ├─ Protocol Adapter (OpenAI ⇄ Anthropic translation)
  │  ├─ Intent Detection (coding? reasoning? vision? long-context?)
  │  ├─ Prompt Compressor + Tool-Schema Normalizer   (token optimization)
  │  ├─ ContextWindowManager (budget check before routing)
  │  ├─ Routing Engine + RoutingIndexManager (O(1) candidate filtering)
  │  ├─ Scoring Engine (static quality + dynamic health/latency)
  │  ├─ Key Registry (rotation, cooldown, circuit breaker)
  │  ├─ Provider / Model failover
  │  └─ Streaming SSE pass-through (minimal transformation)
  ▼
 Model Fabric (normalized, dynamically discovered models)
  ▼
 Provider Fabric (Provider A / B / C …)
  ▼
 LLM Models
```

## Subsystems

| Subsystem | Responsibility |
|---|---|
| **Protocol Adapter** | Translates between OpenAI chat-completions and Anthropic Messages APIs. |
| **Model Fabric** | Normalizes every discovered model (id, context window, pricing, capabilities, free/paid). |
| **ModelRegistry** | Aggregates discovered models, classifies free models, background + runtime refresh. Increments `catalogVersion` on every mutation. |
| **RoutingIndexManager** | Indexes models by capability/policy for O(1) candidate filtering. |
| **ScoringEngine** | Separates static quality scores from dynamic health/latency/cooldown. |
| **KeyRegistry** | Per-provider key rotation, 429/5xx cooldown, 401 disable, circuit breaker. |
| **Provider Failover** | Model → key → provider → alternative-model escalation. |
| **Catalog Sync** | `catalogVersion` + ETag/304 + `/v1/catalog/delta` so the dashboard fetches only changes. |
| **Token Optimization** | `PromptCompressor`, tool-schema normalization, context hashing, measured savings via `/v1/debug/tokens`. |
| **AgentRuntimeManager** | Detects, configures, and verifies coding agents (detected/configured/runnable/liveVerified). |
| **Observability** | Event bus → OpenTelemetry bridge; sanitized request traces. |

## Cross-cutting concerns

- **Catalog Synchronization** — adding a provider key triggers discovery →
  registration → `catalogVersion++` → delta event, with no gateway restart and
  no hardcoded catalog.
- **Token Optimization** — runs in the gateway; reports `originalInputTokens`,
  `optimizedInputTokens`, `savedTokens`, `savingsPercent` from real measurements.
- **Health Monitoring** — per-provider endpoint health, per-key health, model
  availability; unhealthy candidates are excluded from routing.
- **Observability** — domain events (`route.resolved`, `failover.triggered`,
  `provider.request.failed`, `model.updated`, …) feed metrics and the dashboard.

## Security boundaries

- Provider API keys are encrypted at rest in `~/.agent-nexus/vault.json`.
- Keys are never forwarded across providers.
- Logs and traces never contain raw credentials or full sensitive prompts.
- Context caches are scoped by session/agent/project; they are never reused
  across security boundaries.

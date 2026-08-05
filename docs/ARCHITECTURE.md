# Architecture

This document describes the architecture of Agent Nexus Gateway. It is the source of truth for design decisions.

## Design Principles

1. **Hexagonal Architecture (Ports & Adapters)** — the domain never imports infrastructure. All external dependencies are expressed as interfaces ("ports") in `@anx/core`. Concrete implementations ("adapters") live in other packages and depend on the ports.

2. **Domain-Driven Design (DDD)** — we model the domain explicitly: value objects, entities, aggregates, domain events. The `ProviderEndpoint` is the central aggregate root. Routing decisions, request lifecycles, and health transitions are domain events.

3. **SOLID** — every class has one responsibility. Use cases orchestrate; ports abstract; adapters implement. The `RoutingEngine` only routes; the `ChatCompletionUseCase` only orchestrates; the `ProviderAdapter` only translates.

4. **Event-Driven** — modules communicate via domain events on the `EventBusPort`. This decouples the request hot path from observability, audit, and dashboard concerns. A slow dashboard subscriber cannot block a chat request.

5. **Plugin-First** — every cross-cutting concern (logging, metrics, auth, rate limiting, custom routing) can be implemented as a plugin. The plugin runtime invokes hooks at well-defined points.

6. **100% TypeScript strict** — no `any` without justification, no implicit anything, noUncheckedIndexedAccess, strict null checks.

7. **Honest** — no undocumented APIs, no rate-limit evasion, no ToS-violating tricks. We maximize reliability through legitimate means: intelligent routing, retries, failover, caching.

## Layered Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Presentation                            │
│  ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐   │
│  │  REST API  │  │    SSE     │  │    WS    │  │    MCP     │   │
│  │ (Fastify)  │  │ (streaming)│  │ (live)   │  │  (JSON-RPC)│   │
│  └────────────┘  └────────────┘  └──────────┘  └────────────┘   │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────────┐
│                          Application                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │ ChatCompletion   │  │  Routing Engine  │  │    Failover    │ │
│  │    Use Case      │  │   (8 strategies) │  │                │ │
│  └────────┬─────────┘  └──────────────────┘  └────────────────┘ │
│           │                                                      │
│  ┌────────┴─────────────────────────────────────────────────┐   │
│  │              Plugin Runtime (lifecycle hooks)             │   │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────────┐
│                            Domain                                │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌────────────┐ │
│  │   Ports     │  │   Events    │  │  Errors  │  │   Types    │ │
│  │ (interfaces)│  │ (12 events) │  │ (8 errs) │  │  (domain)  │ │
│  └─────────────┘  └─────────────┘  └──────────┘  └────────────┘ │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────────┐
│                        Infrastructure                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐│
│  │ OpenAI   │ │Anthropic │ │ Google   │ │ DeepSeek │ │ 15 more ││
│  │ Adapter  │ │ Adapter  │ │ Adapter  │ │ Adapter  │ │         ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────┘│
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐│
│  │  Vault   │ │   RBAC   │ │   JWT    │ │Telemetry │ │  Audit  ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────┘│
└──────────────────────────────────────────────────────────────────┘
```

## Core Domain

### Aggregates

- **`ProviderEndpoint`** — the central aggregate. Has identity (`id`), state (`health`, `updatedAt`), behavior (health transitions). Other modules interact with endpoints only through the `RoutingEnginePort`.

### Value Objects

- `RoutingRequest`, `RoutingDecision` — immutable routing inputs and outputs
- `ChatCompletionRequest`, `ChatCompletionResponse`, `ChatCompletionChunk` — OpenAI-compatible request/response shapes
- `TokenUsage`, `CostBreakdown` — accounting
- `ProviderCapabilities`, `ProviderPricing` — endpoint metadata

### Domain Events

12 events, all derived from the request lifecycle:

| Event | When | Subscriber use cases |
|---|---|---|
| `request.received` | HTTP request enters | Logging, rate limiting |
| `route.resolved` | Router picks endpoint | Dashboard, debug |
| `provider.request.started` | Adapter call begins | Tracing, concurrency tracking |
| `provider.request.succeeded` | Adapter returns | Cost accounting, EWMA latency |
| `provider.request.failed` | Adapter throws | Circuit breaker, alerting |
| `failover.triggered` | Switching to alternative | Dashboard, alerting |
| `health.changed` | Endpoint health transition | Dashboard, routing |
| `circuit_breaker.tripped` | Failure threshold hit | Alerting |
| `plugin.loaded` | Plugin registered | Dashboard |
| `cache.hit` / `cache.miss` | Cache lookup | Metrics |
| `budget.threshold` | Budget crosses threshold | Alerting |
| `audit` | Authorization decision | Compliance |

### Errors

Each domain error has a stable `code`. Plugins and the dashboard branch on `code`, never on error message:

- `PROVIDER_UNAVAILABLE`
- `NO_ELIGIBLE_PROVIDER`
- `ALL_PROVIDERS_EXHAUSTED`
- `CIRCUIT_BREAKER_OPEN`
- `BUDGET_EXCEEDED`
- `PROVIDER_RESPONSE_ERROR`
- `PLUGIN_ERROR`
- `AUTHENTICATION_ERROR`
- `AUTHORIZATION_ERROR`
- `VALIDATION_ERROR`

## Request Lifecycle

```
HTTP request
  ↓
[plugin: onRequest]      ← mutate request, e.g. inject system message
  ↓
Routing engine           ← picks endpoint + alternatives
  ↓
[plugin: onRouteResolved]
  ↓
For each attempt (up to maxFailovers):
  ├─ [plugin: onProviderStart]
  ├─ Provider adapter    ← chatCompletion or streamChatCompletion
  ├─ For each chunk (if streaming):
  │    └─ [plugin: onProviderChunk]   ← mutate chunk, e.g. redact PII
  ├─ [plugin: onProviderEnd]
  └─ On success: emit `provider.request.succeeded`, return
     On retryable failure: emit `provider.request.failed`, emit `failover.triggered`, loop
     On non-retryable failure: emit `provider.request.failed`, throw
  ↓
[plugin: onResponse]      ← mutate final response
  ↓
HTTP response
```

## Routing Engine

### Strategies

| Strategy | Selection algorithm | Use case |
|---|---|---|
| `weighted` | Random sample weighted by `weight * U(0.5, 1.5)` | Default; spreads load |
| `round_robin` | Cursor-based round-robin | Fair distribution |
| `least_latency` | Pick lowest EWMA latency | Performance |
| `least_cost` | Pick lowest `inputPer1K + outputPer1K` | Cost optimization |
| `highest_quality` | Pick highest `priority` value | Quality preference |
| `capability_match` | Filter by required capabilities, then by priority | Vision, tools, etc. |
| `priority` | Strict priority order | Tiered fallback |
| `budget_aware` | Within budget: cheapest. Over budget: least over | Cost control |

### Circuit Breaker

- Sliding window of `failureWindowMs` (default 60s)
- Opens after `failureThreshold` retryable failures (default 5)
- Cooldown `cooldownMs` (default 30s)
- After cooldown, endpoint enters `degraded` state (half-open) and is allowed one probe request
- Successful probe → `healthy`; failed probe → `circuit_open` again

Health transitions are guarded by `canTransition()` — no skipping states.

### Failover

The `FailoverPort` interface has one method: `next(decision, failedEndpointId) → ProviderEndpoint | null`.

The default implementation walks `decision.alternatives` in order. Custom implementations can:
- Re-run routing with relaxed constraints (e.g. drop `region` filter)
- Prefer endpoints in different regions from the failed one
- Skip endpoints whose circuit breaker is open

## Provider Adapters

All adapters implement `ProviderAdapter` from `@anx/core`:

```ts
interface ProviderAdapter {
  chatCompletion(endpoint, request, signal): Promise<ChatCompletionResponse>;
  streamChatCompletion(endpoint, request, signal): AsyncIterable<ChatCompletionChunk>;
  embed?(endpoint, request, signal): Promise<EmbeddingResponse>;
  resolveModel?(alias: string): string | undefined;
  healthCheck(endpoint, signal): Promise<boolean>;
}
```

**Key design**: every provider returns the OpenAI-compatible shape. Translation happens in the adapter. This means the gateway's request hot path doesn't need to know which provider it's talking to — it just calls `adapter.chatCompletion()`.

For OpenAI-compatible providers (DeepSeek, OpenRouter, Groq, Together, Mistral, xAI, Fireworks, Cerebras, Cloudflare, Ollama, vLLM, LM Studio, LiteLLM, Azure), we extend a single `OpenAIAdapter` base class and only override what differs (base URL, auth header, model alias map).

For Anthropic and Google, which have their own native APIs, we implement the full translation in dedicated adapter files.

## Plugin Framework

Plugins implement hooks at lifecycle points:

```ts
interface Plugin {
  descriptor: PluginDescriptor;
  onStartup?(ctx): Promise<void>;
  onShutdown?(ctx): Promise<void>;
  onRequest?(ctx, request): Promise<unknown>;       // can mutate
  onRouteResolved?(ctx, decision): Promise<void>;
  onProviderStart?(ctx, info): Promise<void>;
  onProviderChunk?(ctx, chunk): Promise<unknown>;    // can mutate
  onProviderEnd?(ctx, info): Promise<void>;
  onError?(ctx, error): Promise<void>;
  onResponse?(ctx, response): Promise<unknown>;      // can mutate
}
```

**Hook dispatch rules**:
- Hooks run in registration order.
- A throw in a hook does NOT abort the request; it is logged and the runtime continues.
- "Transformer" hooks (`onRequest`, `onProviderChunk`, `onResponse`) pass the return value of plugin N to plugin N+1.
- Hooks are only invoked if the plugin declares them in `descriptor.hooks`.

## Security

### Credential Vault

- AES-256-GCM at rest
- Master key derived from `AGENT_NEXUS_VAULT_KEY` via `scrypt` with fixed salt (version-pinned)
- Optional persistence to disk (encrypted)
- In-memory only if no key configured (lost on restart)

### RBAC

- Roles bundle permissions
- Permissions support wildcards: `gateway:*` matches `gateway:chat`
- Built-in roles: `admin`, `developer`, `viewer`, `service`
- Custom roles via config

### JWT

- HS256 (HMAC-SHA256) today
- RS256 / EdDSA planned (interface stays the same)
- Short TTL (1h default)
- Constant-time signature comparison

### Audit Log

- Every authorization decision is appended
- Every credential access is appended
- Every config change is appended
- In-memory default; Postgres/Elasticsearch backends planned

## Observability

### Three pillars

1. **Logs** — structured JSON to stdout (`StructuredLogger`). Each record has `level`, `timestamp`, `message`, and arbitrary metadata. Designed to be ingested by Loki, Elasticsearch, Datadog, etc.

2. **Metrics** — counters, gauges, histograms via `InProcessTelemetry`. Exposed in Prometheus text format at `/metrics`. Key metrics:
   - `anx_request_latency_ms` (histogram)
   - `anx_tokens_input_total`, `anx_tokens_output_total` (counters)
   - `anx_cost_usd_total` (counter)
   - `anx_request_failures_total` (counter, labeled by `code`)
   - `anx_events_<type>` (counter, per event type)

3. **Traces** — span interface via `TelemetryPort.startSpan()`. OpenTelemetry SDK integration is on the roadmap; the interface is identical.

### Event bridge

`wireEventsToTelemetry()` subscribes to all domain events on the bus and emits:
- A log record (debug level) for every event
- A Prometheus counter increment for every event type
- Histogram observations for request latency
- Counter increments for token usage and cost

This means **every** request produces structured observability data without any application code calling telemetry explicitly.

## Networking

- Outbound HTTP via Node's native `fetch`
- Proxy support via `undici.ProxyAgent` (HTTP/HTTPS/SOCKS5)
- DNS-over-HTTPS resolver (configurable)
- Latency measurement for diagnostics
- IPv4-preferred by default (works around common AAAA issues)

All outbound calls go through `NetworkPort`. Adapters receive a `ProviderEndpoint` with a `baseUrl`, and they call `fetch` directly (the `OpenAIAdapter` uses `fetchJson` from `@anx/providers/shared/http.ts`). Future versions will inject `NetworkPort` into adapters so all outbound calls honor proxy / DoH config.

## Deployment

### Docker

- Multi-stage build: deps → build → slim runtime
- Final image ~150MB
- Runs as non-root
- Health check via `/health`

### Kubernetes

- 3 replicas default, HPA to 20
- PodDisruptionBudget for HA
- Ingress with SSE-friendly timeouts
- ConfigMap for config, Secret for API keys
- Headless service for internal discovery

### Native

- Node 22+
- `pnpm install && pnpm build && pnpm --filter @anx/gateway start`
- Or use the installer scripts (planned)

## Performance Considerations

- **Event bus is fire-and-forget**: `publish()` returns immediately; subscribers run in a microtask. A slow dashboard subscriber cannot block the request path.
- **No synchronous I/O on the hot path**: all DB / network calls are async.
- **Connection pooling**: Node's `fetch` uses `undici` under the hood, which pools connections.
- **Streaming is zero-copy**: chunks flow from provider → adapter → SSE encoder → response stream without buffering the full response.

## Extension Points

| Want to... | Implement... |
|---|---|
| Add a new provider | `ProviderAdapter` in `@anx/providers` |
| Add a routing strategy | Extend `RoutingEngine.applyStrategy` |
| Add a cache backend | `CachePort` |
| Add an audit backend | `AuditLogPort` |
| Add telemetry backend | `TelemetryPort` (or use the OTel bridge) |
| Add a custom hook | `Plugin` in `@anx/plugins` |
| Add an MCP server tool | `McpTool` in `@anx/mcp-server` |
| Add an A2A agent | `AgentDescriptor` in `@anx/a2a` |

## Tradeoffs

- **In-memory everything by default**. We trade durability for simplicity. Production users swap in Postgres / Redis backends via the port interfaces.
- **HS256 JWT**. Simpler to operate (no key rotation infrastructure needed), but requires shared secret. RS256 is a drop-in replacement via the same interface.
- **No built-in rate limiting**. The plugin framework supports it; we don't ship a default implementation because rate limit strategies vary wildly (per-user, per-IP, per-API-key, sliding window, token bucket, etc.).
- **Node-only**. We chose Node because of the streaming ecosystem (undici, fastify) and because TypeScript is the lingua franca of AI tooling. A Rust core is a long-term ambition.

## Non-Goals

- We do NOT circumvent provider rate limits. If a provider says "1 RPS", we route around it via failover — we don't try to sneak past it.
- We do NOT log user message content by default. Audit logs record metadata only.
- We do NOT ship with a default admin password. Operators must configure auth.
- We do NOT auto-update. Container image tags are explicit.

# API Reference

Agent Nexus Gateway exposes an OpenAI-compatible REST API plus gateway-specific endpoints for management and observability.

## Base URL

- Local: `http://localhost:8787`
- Production: your deployment URL (e.g. `https://nexus.example.com`)

## Authentication

All `/v1/*` endpoints accept an optional `Authorization: Bearer <token>` header.

- If the gateway is configured with no principals, all requests are anonymous.
- If principals are configured, the token is either a JWT (issued via `/v1/auth/token`) or a raw API key.

The gateway also accepts `X-Nexus-Principal` header to identify the principal without auth (for internal trusted networks).

---

## OpenAI-compatible endpoints

### `POST /v1/chat/completions`

Create a chat completion. Drop-in replacement for OpenAI's API.

**Request body** (see [OpenAI docs](https://platform.openai.com/docs/api-reference/chat/create) for full schema):

```jsonc
{
  "model": "gpt-4",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false,
  "tools": [...],
  "tool_choice": "auto",
  "response_format": { "type": "json_object" },
  "seed": 42,

  // ─── Agent Nexus extensions ──────────────────────────────
  "routing": {
    "strategy": "least_cost",            // weighted|round_robin|least_latency|least_cost|highest_quality|capability_match|priority|budget_aware
    "preferredProviders": ["openai"],    // optional
    "excludedProviders": ["ollama"],     // optional
    "maxLatencyMs": 2000,                // optional
    "maxCostPer1K": 0.01,                // optional
    "region": "us-east",                 // optional
    "tags": ["gpt-4"],                   // optional
    "capabilities": {                    // optional
      "vision": true,
      "toolCalling": true
    },
    "budgetRemainingUsd": 5.00           // optional
  },
  "metadata": {                          // optional, passthrough
    "sessionId": "abc-123"
  }
}
```

**Non-streaming response** (OpenAI-compatible):

```jsonc
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help?" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "promptTokens": 25, "completionTokens": 8, "totalTokens": 33 },
  "system_fingerprint": "...",
  "provider": "openai",
  "endpoint": "auto-openai",
  "latencyMs": 842,
  "costUsd": 0.00049
}
```

**Streaming response**: SSE stream of `chat.completion.chunk` objects, terminated by `data: [DONE]`.

```jsonc
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Errors**:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing `model` or `messages` |
| 401 | `AUTHENTICATION_ERROR` | Invalid or missing API key |
| 403 | `AUTHORIZATION_ERROR` | Principal lacks `gateway:chat` permission |
| 429 | `RATE_LIMITED` | (when rate limit plugin is enabled) |
| 503 | `NO_ELIGIBLE_PROVIDER` | No provider matches routing constraints |
| 503 | `ALL_PROVIDERS_EXHAUSTED` | All providers failed |
| 500 | `PROVIDER_RESPONSE_ERROR` | Provider returned non-2xx |

---

### `POST /v1/embeddings`

Create embeddings. OpenAI-compatible.

```jsonc
{
  "model": "text-embedding-3-small",
  "input": "The food was delicious",
  "dimensions": 1536,
  "encoding_format": "float"
}
```

---

### `GET /v1/models`

List all available model aliases. OpenAI-compatible.

```jsonc
{
  "object": "list",
  "data": [
    { "id": "gpt-4", "object": "model", "owned_by": "openai" },
    { "id": "claude-3-5-sonnet", "object": "model", "owned_by": "anthropic" },
    { "id": "deepseek-chat", "object": "model", "owned_by": "deepseek" }
  ]
}
```

---

## Gateway-specific endpoints

### `GET /health`

```jsonc
{
  "status": "ok",           // ok | degraded
  "version": "0.1.0",
  "endpoints": {
    "total": 4,
    "healthy": 4,
    "degraded": 0,
    "open": 0
  },
  "uptime": 12345.6
}
```

### `GET /v1/providers`

List all configured provider endpoints with health, pricing, capabilities.

### `GET /metrics`

Prometheus text exposition format. Suitable for scraping by Prometheus / VictoriaMetrics / Grafana Agent.

### `POST /v1/mcp`

JSON-RPC 2.0 endpoint for MCP. Methods:

- `initialize` — handshake
- `tools/list` — list gateway-exposed tools
- `tools/call` — invoke a tool
- `resources/list` — list resources
- `resources/read` — read a resource
- `ping` — keepalive

### `POST /v1/a2a/message`

Send an A2A message between agents.

```jsonc
{
  "from": "agent-coordinator",
  "to": "agent-coder",
  "payload": { "task": "implement feature X" }
}
```

### `GET /v1/network/diagnostics`

Returns DNS, proxy, IPv4, IPv6 connectivity status. Used by the dashboard Network page.

### `GET /v1/audit?principal=&action=&since=&limit=`

Query audit log. Requires `admin` role.

### `WS /ws`

WebSocket subscription. Server pushes domain events as JSON:

```jsonc
{ "type": "request.received", "occurredAt": "...", "payload": {...} }
{ "type": "route.resolved", "occurredAt": "...", "payload": {...} }
{ "type": "provider.request.succeeded", "occurredAt": "...", "payload": {...} }
```

---

## SDK usage

```ts
import { NexusClient } from '@anx/sdk';

const client = new NexusClient({
  baseUrl: 'http://localhost:8787',
  apiKey: process.env.NEXUS_API_KEY,
});

// Non-streaming
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);

// Streaming
const stream = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Write a haiku about code' }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}

// Embeddings
const embedding = await client.embeddings.create({
  model: 'text-embedding-3-small',
  input: 'Hello world',
});
```

---

## CLI usage

```bash
# Set base URL (default: http://localhost:8787)
export NEXUS_BASE_URL=http://localhost:8787
export NEXUS_API_KEY=your-key

anx chat --model gpt-4 --message "Hello, world"
anx chat --model claude-3-5-sonnet --stream true --message "Write a haiku"
anx providers list
anx health
anx config init
anx version
```

---

## Native integrations

### Claude Code

`~/.claude/settings.json`:

```json
{
  "apiKeyHelper": "echo $NEXUS_API_KEY",
  "apiBaseUrl": "http://localhost:8787/v1"
}
```

### Continue

`~/.continue/config.json`:

```json
{
  "models": [{
    "title": "Nexus",
    "provider": "openai",
    "model": "gpt-4",
    "apiBase": "http://localhost:8787/v1",
    "apiKey": "your-key"
  }]
}
```

### Cursor

Settings → Models → OpenAI API Base: `http://localhost:8787/v1`

### OpenCode / Aider / Cline / Roo Code

Set `OPENAI_API_BASE=http://localhost:8787/v1` and `OPENAI_API_KEY=your-key`.

### VS Code (GitHub Copilot Chat)

Not directly supported — Copilot Chat uses GitHub's backend. Use Continue or Cline instead.

### Zed

`~/.config/zed/settings.json`:

```json
{
  "language_models": {
    "openai": {
      "api_url": "http://localhost:8787/v1",
      "available_models": [{ "name": "gpt-4", "max_tokens": 8192 }]
    }
  }
}
```

### JetBrains

Settings → Tools → AI Assistant → OpenAI API → Custom server: `http://localhost:8787/v1`

### Neovim (with codecompanion.nvim)

```lua
require('codecompanion').setup({
  adapters = {
    nexus = function()
      return require('codecompanion.adapters').extend('openai', {
        env = { api_key = 'NEXUS_API_KEY', url = 'http://localhost:8787/v1' },
      })
    end,
  },
})
```

### Emacs (with gptel)

```elisp
(setq gptel-api-key "your-key")
(setq gptel-use-curl t)
(setq gptel--openai-url "http://localhost:8787/v1/chat/completions")
```

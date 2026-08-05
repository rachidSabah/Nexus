# Plugin Development

Plugins extend Agent Nexus Gateway without modifying core. This document covers the plugin contract, lifecycle hooks, and best practices.

## The Plugin Contract

A plugin is an object that implements (some of) the hooks defined in `Plugin`:

```ts
import type { Plugin, PluginContext, PluginDescriptor } from '@anx/plugins';

const myPlugin: Plugin = {
  descriptor: {
    id: 'redact-pii',
    name: 'PII Redactor',
    version: '1.0.0',
    description: 'Redacts email addresses and phone numbers from responses',
    author: 'you@example.com',
    hooks: ['onProviderChunk', 'onResponse'],
    capabilities: ['transform'],
  },

  async onProviderChunk(ctx, chunk) {
    // Mutate the chunk before it goes to the client.
    if (chunk.choices[0]?.delta?.content) {
      chunk.choices[0].delta.content = redact(chunk.choices[0].delta.content);
    }
    return chunk;
  },

  async onResponse(ctx, response) {
    if (response.choices[0]?.message.content) {
      response.choices[0].message.content = redact(response.choices[0].message.content);
    }
    return response;
  },
};

function redact(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]');
}
```

## Lifecycle Hooks

Hooks fire in this order for a typical request:

```
onStartup (gateway boot)
   ↓
onRequest (HTTP request received, before routing)
   ↓
onRouteResolved (routing picked an endpoint)
   ↓
onProviderStart (about to call provider)
   ↓
onProviderChunk (one stream chunk — streaming only, may fire many times)
   ↓
onProviderEnd (provider call finished)
   ↓
onResponse (final response, before sending to client)
   ↓
onShutdown (gateway shutdown)
```

`onError` fires whenever an error occurs in the request path.

## Hook Semantics

### Transformer hooks

`onRequest`, `onProviderChunk`, `onResponse` can **mutate** the value they receive by returning a new value. The return value of plugin N is passed to plugin N+1.

```ts
// Plugin A
async onRequest(ctx, request) {
  request.metadata = { ...request.metadata, source: 'A' };
  return request;  // passed to plugin B
}

// Plugin B
async onRequest(ctx, request) {
  console.log(request.metadata.source);  // 'A'
  return request;
}
```

### Observer hooks

`onRouteResolved`, `onProviderStart`, `onProviderEnd`, `onError`, `onStartup`, `onShutdown` are observers — their return value is ignored. They're for side effects (logging, metrics, alerting).

## Plugin Context

Every hook receives a `PluginContext`:

```ts
interface PluginContext {
  readonly pluginId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly log: (level, msg, meta?) => void;
  readonly events: EventBusPort;     // publish your own events
  readonly config: Record<string, unknown>;  // from PluginSpec.config
}
```

Use `ctx.log` for structured logging — it goes through the same structured logger as the gateway itself.

Use `ctx.events.publish()` to emit custom events that other plugins or the dashboard can subscribe to.

## Registering a Plugin

### Inline (in code)

```ts
import { GatewayRuntime } from '@anx/gateway';
import { InlinePluginLoader } from '@anx/plugins';

const runtime = await GatewayRuntime.create();

await runtime.plugins.load({
  id: 'redact-pii',
  source: 'inline',
  config: { patterns: ['email', 'phone'] },
  factory: () => myPlugin,
});
```

### From a module

```ts
await runtime.plugins.load({
  id: 'redact-pii',
  source: 'module',
  path: './plugins/redact-pii.js',
  config: { patterns: ['email', 'phone'] },
});
```

The module must export a factory function as default (or named `default`):

```ts
// plugins/redact-pii.ts
import type { Plugin } from '@anx/plugins';

export default function(config: Record<string, unknown>): Plugin {
  return {
    descriptor: { /* ... */ },
    // ...hooks
  };
}
```

### From config (planned)

```json
{
  "plugins": [
    {
      "id": "redact-pii",
      "source": "module",
      "path": "./plugins/redact-pii.js",
      "config": { "patterns": ["email", "phone"] }
    }
  ]
}
```

## Error Handling

**A throw in a plugin hook does NOT abort the request.** The runtime catches the error, logs it, and continues to the next plugin.

This is by design: a buggy plugin must not break the gateway. If you need hard enforcement (e.g. auth), use middleware at the HTTP layer, not a plugin.

## Built-in Plugin Ideas

These don't ship in v0.1 but are good starting points for community plugins:

- **Rate limiter** — token bucket per principal, per IP, per API key
- **PII redactor** — regex or NLP-based redaction
- **Prompt injection detector** — flag suspicious user input
- **Cost guard** — block requests that would exceed budget
- **A/B router** — split traffic by percentage for model comparison
- **Caching** — exact-match cache (Redis) or semantic cache (vector store)
- **Logger** — log every request to a file / S3 / Loki
- **Webhook** — POST events to an external URL
- **Slack alerts** — notify on circuit breaker trips
- **Canary** — send 1% of traffic to a new provider and compare results

## Best Practices

1. **Keep hooks fast.** Hooks run on the request hot path. If you need to do slow I/O, queue it and process async.
2. **Don't mutate arguments in-place** in transformer hooks — return a new value. This makes the chain debuggable.
3. **Declare your hooks** in `descriptor.hooks`. The runtime only invokes hooks you declare, which makes the contract explicit.
4. **Use `ctx.log`** for logging — it includes the plugin ID and request ID automatically.
5. **Publish events** for interesting state changes — the dashboard and other plugins can subscribe.
6. **Idempotent hooks** — your hook may fire multiple times for the same request (e.g. on retry). Make sure that's safe.
7. **Test your plugin** — see `packages/plugins/test/` for examples.

## Plugin Discovery (planned)

A future release will add a plugin marketplace at `https://marketplace.agent-nexus-gateway.dev` where you can browse, install, and update plugins via the CLI:

```bash
anx plugins install @anx/redact-pii
anx plugins list
anx plugins update --all
anx plugins uninstall @anx/redact-pii
```

Plugins will be signed and verified on install.

## Example: A Custom Router Plugin

Plugins can't directly override routing (use `RoutingEnginePort` for that), but they can influence it via `onRequest`:

```ts
const routerHintPlugin: Plugin = {
  descriptor: {
    id: 'router-hint',
    name: 'Router Hint',
    version: '1.0.0',
    description: 'Sets routing.strategy based on user metadata',
    hooks: ['onRequest'],
    capabilities: ['transform'],
  },
  async onRequest(ctx, request) {
    if (request.metadata?.['costSensitive']) {
      request.routing = { ...request.routing, strategy: 'least_cost' };
    }
    if (request.metadata?.['latencySensitive']) {
      request.routing = { ...request.routing, strategy: 'least_latency' };
    }
    return request;
  },
};
```

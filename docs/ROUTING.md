# Routing Strategies

Agent Nexus Gateway supports 8 routing strategies. This document explains when to use each.

## Quick reference

| Strategy | Best for | Cost-aware? | Latency-aware? |
|---|---|---|---|
| `weighted` | Default, spreads load | No | No |
| `round_robin` | Fair distribution | No | No |
| `least_latency` | Performance-critical | No | Yes (EWMA) |
| `least_cost` | Cost optimization | Yes | No |
| `highest_quality` | Quality preference | No | No |
| `capability_match` | Filter by capability | No | No |
| `priority` | Tiered fallback | No | No |
| `budget_aware` | Stay in budget | Yes | No |

## Strategy details

### `weighted` (default)

Random sample weighted by `weight * U(0.5, 1.5)`. The jitter prevents thundering-herd on the heaviest endpoint.

**Use when**: You have multiple providers of similar quality and want to spread load proportionally.

```json
{ "strategy": "weighted" }
```

Endpoint weights:
```json
{ "endpoints": [
  { "id": "a", "weight": 10 },
  { "id": "b", "weight": 5 },
  { "id": "c", "weight": 1 }
] }
```
Roughly: A gets ~62% of traffic, B ~31%, C ~6%.

### `round_robin`

Cursor-based round-robin. Each request goes to the next endpoint in the list.

**Use when**: You want exactly equal distribution across endpoints of equal capability.

```json
{ "strategy": "round_robin" }
```

### `least_latency`

Picks the endpoint with the lowest Exponentially-Weighted Moving Average (EWMA) latency. The EWMA is updated on every successful request: `new = old * 0.7 + observed * 0.3`.

**Use when**: You care about p50 latency more than cost.

```json
{ "strategy": "least_latency" }
```

Combine with `maxLatencyMs` to filter:
```json
{
  "strategy": "least_latency",
  "maxLatencyMs": 2000
}
```

### `least_cost`

Picks the endpoint with the lowest `inputPer1K + outputPer1K` pricing.

**Use when**: You want to minimize spend.

```json
{ "strategy": "least_cost" }
```

Combine with `maxCostPer1K` to filter:
```json
{
  "strategy": "least_cost",
  "maxCostPer1K": 0.01
}
```

### `highest_quality`

Picks the endpoint with the highest `priority` value. (Note: priority 1 is *higher* priority than priority 2 in the `priority` strategy, but `highest_quality` treats higher numbers as higher quality. We're aware this is confusing and may normalize in 1.0.)

**Use when**: You have tiered providers (e.g. GPT-4 > Claude > DeepSeek > local) and always want the best.

```json
{ "strategy": "highest_quality" }
```

### `capability_match`

Filters endpoints by required capabilities, then ranks by priority.

**Use when**: You need a specific capability (vision, tools, etc.).

```json
{
  "strategy": "capability_match",
  "capabilities": {
    "vision": true,
    "toolCalling": true
  }
}
```

### `priority`

Strict priority ordering. Lower `priority` value = higher priority. Endpoints at the same priority level are tried in registration order.

**Use when**: You want primary/secondary/tertiary fallback.

```json
{ "strategy": "priority" }
```

Endpoint priorities:
```json
{ "endpoints": [
  { "id": "primary",   "priority": 1 },
  { "id": "secondary", "priority": 2 },
  { "id": "tertiary",  "priority": 3 }
] }
```
Primary is always used unless unhealthy; secondary is failover; tertiary is last resort.

### `budget_aware`

Within budget: cheapest. Over budget: least-over.

**Use when**: You have a hard budget and want to maximize requests within it.

```json
{
  "strategy": "budget_aware",
  "budgetRemainingUsd": 5.00
}
```

## Combining strategies

The `CompositeRoutingEngine` (in `@anx/routing`) chains strategies with fallback. The first engine that returns a decision wins; if it throws `NoEligibleProviderError`, the next engine is tried.

```ts
import { RoutingEngine } from '@anx/core';
import { CompositeRoutingEngine } from '@anx/routing';

const leastCost = new RoutingEngine(bus);
const weighted = new RoutingEngine(bus);

// Try least_cost first; if no provider meets cost constraints, fall back to weighted.
const composite = new CompositeRoutingEngine([leastCost, weighted]);
```

## Per-request strategy override

The strategy can be set globally (in config) or per-request (in the `routing` field of the chat completion request):

```bash
curl http://localhost:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "hi"}],
    "routing": {
      "strategy": "least_cost",
      "maxCostPer1K": 0.005
    }
  }'
```

## Filtering

All strategies respect these filters (any strategy can be combined with any filter):

| Filter | Description |
|---|---|
| `preferredProviders` | Only these `providerId`s |
| `excludedProviders` | Not these `providerId`s |
| `region` | Match this region exactly |
| `tags` | Endpoint must have all these tags |
| `maxLatencyMs` | EWMA latency must be below this |
| `maxCostPer1K` | `inputPer1K + outputPer1K` must be below this |
| `capabilities` | Endpoint must support all `true` capabilities |

## Circuit breakers

All strategies automatically exclude endpoints whose circuit breaker is open. See [ARCHITECTURE.md](./ARCHITECTURE.md#circuit-breaker) for details.

## Failover

Every strategy returns a primary endpoint plus up to 5 alternatives. If the primary fails with a retryable error, the gateway tries alternatives in order. See [ARCHITECTURE.md](./ARCHITECTURE.md#failover) for details.

## Affinity routing

The `AffinityRouter` (in `@anx/routing`) wraps another engine and "sticks" requests to the same endpoint based on a key extractor:

```ts
import { RoutingEngine } from '@anx/core';
import { AffinityRouter } from '@anx/routing';

const inner = new RoutingEngine(bus);
const affinity = new AffinityRouter(inner, (req) => req.metadata?.['sessionId']);

// Requests with the same sessionId will stick to the same endpoint
// (until that endpoint becomes unhealthy).
```

**Use when**: You want session affinity (e.g. for prompt caching to work — Anthropic's cache works per-endpoint, so hitting the same endpoint improves cache hit rate).

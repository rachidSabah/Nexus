# NEXUS Key Rotation

Nexus treats **API-key rotation as the primary rotation system** — not proxy
rotation. Every provider maintains a pool of keys, each tracked with full
health telemetry.

## Per-key state

```
Provider
 ├── Key A  { status, healthScore, requests, successes, failures,
 │            c401, c403, c429, c5xx, cTimeout,
 │            cooldownUntil, lastUsedAt, lastSuccessAt, lastFailureAt,
 │            consecutiveFailures, totalTokens, estimatedCost }
 ├── Key B  ...
 └── Key N  ...
```

## Selection strategies

`KeyRegistry.select(providerId, { strategy })` supports:

- `round_robin` — even distribution across active keys.
- `least_used` — prefer the key with the fewest requests.
- `lru` — prefer the least-recently-used key.
- `latency` — prefer the fastest key (lowest observed latency).
- `health` — prefer the key with the highest success rate.
- `adaptive` (default) — balances health, latency, and exploration (new keys get
  a first chance).

Keys in `cooldown` or `invalid` status are excluded from selection.

## Error classification

Driven by `KeyRegistry.recordFailure(keyId, status, retryable)`:

| Status | Result |
| ------ | ------ |
| `401` | `invalid` — removed from rotation until re-registered |
| `403` | `invalid` — authorization failure, removed from rotation |
| `429` | `cooldown` for `cooldownMs` (default 60s); after expiry the key is eligible again |
| `5xx` / timeout / network | stays `active` (transient); circuit breaker on the endpoint handles sustained failure |
| success (`recordSuccess`) | resets consecutive-failure counters, recovers health |

## Failover chain

```
request
  ↓
select healthy key (strategy)
  ↓ 401 → mark invalid → select next key
  ↓ 429 → cooldown key → select next key
  ↓ 5xx/timeout → circuit breaker on endpoint
  ↓ all keys exhausted → model failover → provider failover
```

No proxy is involved at any step. The gateway remains fully operational with
**zero proxies** and **zero public-proxy dependency**.

# NEXUS Provider Connectivity

When an administrator adds a provider API key, Nexus:

1. Validates the provider.
2. Establishes **direct** connectivity (no proxy).
3. Authenticates using the key.
4. Calls the provider's model discovery endpoint.
5. Fetches **all** models returned by the provider.
6. Normalizes model metadata.
7. Registers models in the `ModelRegistry`.
8. Classifies pricing (FREE / PAID / UNKNOWN) automatically.
9. Detects capabilities (vision, tools, reasoning, streaming, embeddings).
10. Increments `catalogVersion`.
11. Exposes models through `/v1/models`, `/v1/catalog`, `/v1/debug/models`,
    `/v1/debug/models/agents`.

All of this happens with **zero proxies**.

## Provider connectivity diagnostics

The gateway exposes live per-provider health via `GET /v1/providers` and
transport diagnostics via `GET /v1/network/diagnostics`:

- **DNS** — system resolver reachability.
- **IPv4 / IPv6** — direct socket reachability.
- **Direct HTTPS** — direct TLS reachability to the open internet.
- **Active Egress** — `DIRECT` (default) or `PROXY` (only if an admin-configured
  custom proxy is in use).
- **Per-provider** — each registered `ProviderEndpoint` reports its `health`
  (`healthy` / `degraded` / `unhealthy`) and capability set.

### Example (live)

```
Anthropic      health=healthy   caps=vision,tools,reasoning,streaming
OpenAI        health=healthy   caps=vision,tools,embeddings,streaming
OpenRouter    health=healthy   caps=tools,streaming
```

This is real connectivity derived from the routing engine's endpoint health,
which is established via direct provider requests — not from arbitrary public
proxy probes.

## Model discovery independence

Model discovery is fully independent of proxies. The provider adapters
(`packages/providers/src/adapters/*`) perform model discovery via direct
`fetch()` to each provider's API. New models appear automatically; removed
models are marked `stale` and dropped from the catalog per the stale policy.
